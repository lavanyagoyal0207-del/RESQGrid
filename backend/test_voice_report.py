import base64
import hashlib
import json
import os
import sys
import types
import unittest
from datetime import datetime, timedelta, timezone
from io import BytesIO
from threading import Barrier, Lock, Thread
from unittest.mock import MagicMock, patch
from werkzeug.security import generate_password_hash


aws_config_stub = types.ModuleType("aws_config")
aws_config_stub.table = MagicMock()
aws_config_stub.s3 = MagicMock()
aws_config_stub.BUCKET_NAME = "resqgrid-test-bucket"
sys.modules["aws_config"] = aws_config_stub

import app as backend_app


PLACE = {
    "PK": "PLACE#MANDI",
    "SK": "METADATA",
    "place": "Mandi",
    "lat": 31.7087,
    "lng": 76.932,
}


class BackendWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.s3 = MagicMock()
        self.table = MagicMock()
        self.table.name = "ResQGrid"
        self.table.meta.client.transact_write_items = MagicMock()
        self.table.get_item.return_value = {"Item": None}
        self.table.scan.return_value = {"Items": [PLACE]}

        self.patches = [
            patch.object(backend_app, "s3", self.s3),
            patch.object(backend_app, "table", self.table),
            patch.object(backend_app, "get_brief_item", return_value=None),
            patch.object(backend_app, "_whisper_model", None),
        ]
        for patcher in self.patches:
            patcher.start()
            self.addCleanup(patcher.stop)

        transcribe_patch = patch.object(
            backend_app,
            "transcribe_audio",
            return_value=("The water is rising.", "en")
        )
        self.transcribe_mock = transcribe_patch.start()
        self.addCleanup(transcribe_patch.stop)
        self.client = backend_app.app.test_client()

    def voice_request(self, idempotency_key="voice-test-0001"):
        return self.client.post(
            "/voice-report",
            headers={"Idempotency-Key": idempotency_key},
            data={
                "audio": (
                    BytesIO(b"test audio data"),
                    "recording.wav",
                    "audio/wav"
                ),
                "place": "Mandi",
                "type": "Flood",
                "severity": "High"
            },
            content_type="multipart/form-data"
        )

    def operator(self):
        return patch.object(
            backend_app,
            "authenticate_operator",
            return_value=("operator-a", None)
        )

    def test_voice_report_saves_detected_english_hindi_and_punjabi(self):
        samples = {
            "en": "The water is rising.",
            "hi": "पानी बढ़ रहा है।",
            "pa": "ਪਾਣੀ ਵੱਧ ਰਿਹਾ ਹੈ।",
        }

        for index, (language, transcript) in enumerate(samples.items()):
            with self.subTest(language=language):
                self.transcribe_mock.return_value = (transcript, language)
                response = self.voice_request(f"voice-test-{index:04d}")
                body = response.get_json()

                self.assertEqual(response.status_code, 200)
                self.assertTrue(body["ok"])
                self.assertEqual(body["report"]["original_text"], transcript)
                self.assertEqual(body["report"]["detected_language"], language)
                self.assertEqual(
                    body["report"]["transcription_status"],
                    "Completed"
                )
                self.assertEqual(
                    body["report"]["review_status"],
                    "Needs Human Review"
                )
                self.assertEqual(body["report"]["verification_status"], "Unverified")
                self.assertTrue(body["report"]["has_audio"])
                self.s3.put_object.assert_called()
                self.s3.delete_object.assert_not_called()

    def test_transcription_failure_keeps_audio_and_returns_reviewable_record(self):
        self.transcribe_mock.side_effect = RuntimeError("model unavailable")

        response = self.voice_request()
        body = response.get_json()

        self.assertEqual(response.status_code, 200)
        self.assertTrue(body["ok"])
        self.assertIn("transcription failed", body["message"].lower())
        self.assertEqual(body["report"]["transcription_status"], "Failed")
        self.assertEqual(body["report"]["review_status"], "Needs Human Review")
        self.assertEqual(body["report"]["verification_status"], "Unverified")
        self.assertTrue(body["report"]["has_audio"])
        self.s3.put_object.assert_called_once()
        self.s3.delete_object.assert_not_called()
        transaction = self.table.meta.client.transact_write_items.call_args.kwargs
        self.assertEqual(len(transaction["TransactItems"]), 2)

    def test_invalid_audio_is_rejected_before_storage(self):
        response = self.client.post(
            "/voice-report",
            headers={"Idempotency-Key": "voice-invalid-0001"},
            data={
                "audio": (BytesIO(b"plain text"), "recording.txt", "text/plain"),
                "place": "Mandi",
                "type": "Flood",
                "severity": "High",
            },
            content_type="multipart/form-data"
        )

        self.assertEqual(response.status_code, 400)
        self.s3.put_object.assert_not_called()
        self.table.put_item.assert_not_called()

    def test_demo_marked_submissions_are_rejected_before_storage(self):
        text_response = self.client.post(
            "/report",
            json={
                "original_text": "Sample report",
                "place": "Mandi",
                "type": "Flood",
                "severity": "High",
                "is_demo": True,
            },
        )
        voice_response = self.client.post(
            "/voice-report",
            data={"demo_mode": "true"},
            content_type="multipart/form-data",
        )

        self.assertEqual(text_response.status_code, 400)
        self.assertEqual(voice_response.status_code, 400)
        self.assertEqual(self.table.scan.call_count, 0)
        self.table.put_item.assert_not_called()
        self.s3.put_object.assert_not_called()

    def test_missing_header_and_submission_id_are_rejected(self):
        response = self.client.post(
            "/report",
            json={
                "original_text": "Water is rising.",
                "place": "Mandi",
                "type": "Flood",
                "severity": "High",
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("submission_id", response.get_json()["error"])
        self.table.scan.assert_not_called()
        self.table.meta.client.transact_write_items.assert_not_called()

    def test_missing_header_retry_uses_stable_submission_id(self):
        payload = {
            "original_text": "Water is rising near the bridge.",
            "place": "Mandi",
            "type": "Flood",
            "severity": "High",
            "submission_id": "browser-action-0001",
        }
        saved_report = {
            "report_id": "REP-SAVED",
            "original_text": payload["original_text"],
            "verification_status": "Unverified",
        }
        with patch.object(
            backend_app,
            "get_report",
            side_effect=[None, saved_report],
        ), patch.object(
            backend_app,
            "get_all_items",
            return_value=[PLACE],
        ), patch.object(
            backend_app,
            "associate_report_with_incident",
        ) as associate, patch.object(
            backend_app,
            "mark_brief_needs_review",
        ):
            first = self.client.post("/report", json=payload)
            retry = self.client.post("/report", json=payload)

        self.assertEqual(first.status_code, 201)
        self.assertEqual(retry.status_code, 200)
        self.assertTrue(retry.get_json()["duplicate"])
        self.assertEqual(associate.call_count, 1)

    def test_voice_retry_without_header_reuses_submission_id(self):
        saved_report = {
            "report_id": "REP-VOICE-SAVED",
            "original_text": "The water is rising.",
            "audio_s3_key": "voice-reports/REP-VOICE-SAVED.wav",
        }

        def submit_voice():
            return self.client.post(
                "/voice-report",
                data={
                    "submission_id": "voice-action-0001",
                    "audio": (
                        BytesIO(b"test audio data"),
                        "recording.wav",
                        "audio/wav",
                    ),
                    "place": "Mandi",
                    "type": "Flood",
                    "severity": "High",
                },
                content_type="multipart/form-data",
            )

        with patch.object(
            backend_app,
            "get_report",
            side_effect=[None, saved_report],
        ):
            first = submit_voice()
            retry = submit_voice()

        self.assertEqual(first.status_code, 200)
        self.assertEqual(retry.status_code, 200)
        self.assertTrue(retry.get_json()["duplicate"])
        self.s3.put_object.assert_called_once()
        self.transcribe_mock.assert_called_once()

    def test_identical_text_with_distinct_submission_ids_is_preserved(self):
        base_payload = {
            "original_text": "Water is rising near the bridge.",
            "place": "Mandi",
            "type": "Flood",
            "severity": "High",
        }
        with patch.object(backend_app, "get_report", return_value=None), patch.object(
            backend_app, "get_all_items", return_value=[PLACE]
        ), patch.object(
            backend_app, "associate_report_with_incident"
        ), patch.object(backend_app, "mark_brief_needs_review"):
            first = self.client.post(
                "/report",
                json={**base_payload, "submission_id": "citizen-action-0001"},
            )
            second = self.client.post(
                "/report",
                json={**base_payload, "submission_id": "citizen-action-0002"},
            )

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
        self.assertNotEqual(
            first.get_json()["report"]["report_id"],
            second.get_json()["report"]["report_id"],
        )

    def test_concurrent_retries_without_header_create_one_report(self):
        payload = {
            "original_text": "Water is rising near the bridge.",
            "place": "Mandi",
            "type": "Flood",
            "severity": "High",
            "submission_id": "concurrent-action-0001",
        }
        saved_reports = {}
        state_lock = Lock()
        initial_reads = 0
        read_barrier = Barrier(2)

        def read_report(report_id):
            nonlocal initial_reads
            with state_lock:
                wait_for_peer = initial_reads < 2
                if wait_for_peer:
                    initial_reads += 1
            if wait_for_peer:
                read_barrier.wait(timeout=5)
            with state_lock:
                return saved_reports.get(report_id)

        def associate(report, items=None):
            with state_lock:
                if report["report_id"] in saved_reports:
                    raise RuntimeError("Conditional transaction conflict")
                saved_reports[report["report_id"]] = dict(report)

        responses = []
        response_lock = Lock()

        def submit():
            with backend_app.app.test_client() as client:
                response = client.post("/report", json=payload)
                with response_lock:
                    responses.append(response)

        with patch.object(
            backend_app, "get_report", side_effect=read_report
        ), patch.object(
            backend_app, "get_all_items", return_value=[PLACE]
        ), patch.object(
            backend_app,
            "associate_report_with_incident",
            side_effect=associate,
        ), patch.object(backend_app, "mark_brief_needs_review"):
            threads = [Thread(target=submit), Thread(target=submit)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(timeout=10)

        self.assertTrue(all(not thread.is_alive() for thread in threads))
        self.assertEqual(
            sorted(response.status_code for response in responses),
            [200, 201],
        )
        self.assertEqual(len(saved_reports), 1)
        self.assertEqual(
            sum(bool(response.get_json().get("duplicate")) for response in responses),
            1,
        )

    def test_duplicate_voice_submission_does_not_upload_audio_again(self):
        report = {
            "report_id": "REP-DUPLICATE",
            "original_text": "Already saved",
            "audio_s3_key": "voice-reports/REP-DUPLICATE.wav",
        }
        with patch.object(backend_app, "get_report", return_value=report):
            response = self.voice_request()

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["duplicate"])
        self.s3.put_object.assert_not_called()
        self.table.put_item.assert_not_called()

    def test_association_reuses_loaded_snapshot_instead_of_scanning_again(self):
        report = {
            "report_id": "REP-SNAPSHOT",
            "original_text": "Water is rising.",
            "type": "Flood",
            "place": "Mandi",
            "severity": "High",
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        with patch.object(backend_app, "get_all_items") as load_items:
            backend_app.associate_report_with_incident(
                report,
                items=[PLACE],
            )

        load_items.assert_not_called()
        self.table.meta.client.transact_write_items.assert_called_once()

    def test_full_table_scan_continues_using_dynamodb_pagination(self):
        self.table.scan.side_effect = [
            {
                "Items": [PLACE],
                "LastEvaluatedKey": {"PK": "PLACE#Mandi", "SK": "METADATA"},
            },
            {"Items": [{"PK": "RESOURCE#R-1", "SK": "METADATA"}]},
        ]

        records = backend_app.get_all_items()

        self.assertEqual(len(records), 2)
        self.assertEqual(self.table.scan.call_count, 2)
        self.assertEqual(
            self.table.scan.call_args_list[1].kwargs["ExclusiveStartKey"],
            {"PK": "PLACE#Mandi", "SK": "METADATA"},
        )

    def test_canonical_place_lookup_uses_exact_dynamodb_key(self):
        self.table.get_item.return_value = {"Item": PLACE}

        result = backend_app.get_place_by_name("Mandi")

        self.assertEqual(result, PLACE)
        self.table.get_item.assert_called_once_with(
            Key={"PK": "PLACE#Mandi", "SK": "METADATA"},
            ConsistentRead=True,
        )
        self.table.scan.assert_not_called()

    def test_report_grouping_requires_same_type_location_and_time(self):
        now = datetime.now(timezone.utc)
        existing = {
            "PK": "INCIDENT#INC-1",
            "SK": "METADATA",
            "incident_id": "INC-1",
            "type": "Flood",
            "place": "Mandi",
            "severity": "High",
            "status": "Unverified",
            "report_ids": ["REP-OLD"],
            "created_at": (now - timedelta(minutes=5)).isoformat(),
            "updated_at": (now - timedelta(minutes=2)).isoformat(),
        }
        report = {
            "report_id": "REP-NEW",
            "type": "Flood",
            "place": "Mandi",
            "severity": "Critical",
            "original_text": "Water is rising.",
            "created_at": now.isoformat(),
        }
        with patch.object(
            backend_app,
            "get_all_items",
            return_value=[PLACE, existing]
        ):
            result = backend_app.associate_report_with_incident(report)

        self.assertEqual(result["incident_id"], "INC-1")
        self.assertEqual(result["verification_status"], "Corroborated")
        self.assertIn("same type (Flood) and location (Mandi)", result["grouping_reason"])
        transaction = self.table.meta.client.transact_write_items.call_args.kwargs
        self.assertEqual(len(transaction["TransactItems"]), 2)
        incident_values = transaction["TransactItems"][1]["Update"][
            "ExpressionAttributeValues"
        ]
        self.assertEqual(incident_values[":severity"]["S"], "Critical")

    def test_grouping_does_not_match_different_types_or_stale_reports(self):
        now = datetime.now(timezone.utc)
        base_incident = {
            "PK": "INCIDENT#INC-1",
            "SK": "METADATA",
            "incident_id": "INC-1",
            "type": "Flood",
            "place": "Mandi",
            "severity": "High",
            "status": "Unverified",
            "report_ids": ["REP-OLD"],
            "created_at": (now - timedelta(hours=1)).isoformat(),
            "updated_at": now.isoformat(),
        }
        cases = [
            ("Landslide", (now - timedelta(minutes=1)).isoformat()),
            ("Flood", (now - timedelta(minutes=31)).isoformat()),
        ]
        for index, (report_type, last_report_at) in enumerate(cases):
            with self.subTest(report_type=report_type, last_report_at=last_report_at):
                incident = {
                    **base_incident,
                    "last_report_at": last_report_at,
                }
                report = {
                    "report_id": f"REP-NEW-{index}",
                    "type": report_type,
                    "place": "Mandi",
                    "severity": "Medium",
                    "original_text": "New field report.",
                    "created_at": now.isoformat(),
                }
                self.table.meta.client.transact_write_items.reset_mock()
                with patch.object(
                    backend_app,
                    "get_all_items",
                    return_value=[PLACE, incident]
                ):
                    result = backend_app.associate_report_with_incident(report)

                self.assertNotEqual(result["incident_id"], "INC-1")
                transaction = self.table.meta.client.transact_write_items.call_args.kwargs[
                    "TransactItems"
                ]
                self.assertIn("Put", transaction[1])

    def test_resource_creation_validates_and_persists_inventory(self):
        with self.operator():
            response = self.client.post(
                "/resources",
                json={"name": "North Ambulance", "type": "Ambulance", "quantity": 2}
            )

        body = response.get_json()
        self.assertEqual(response.status_code, 201)
        self.assertEqual(body["resource"]["available_quantity"], 2)
        self.assertEqual(body["resource"]["deployed_quantity"], 0)
        self.assertEqual(body["resource"]["status"], "Available")
        self.table.put_item.assert_called_once()
        stored = self.table.put_item.call_args.kwargs["Item"]
        self.assertEqual(stored["created_by"], "operator-a")
        self.assertEqual(stored["history"][0]["operator"], "operator-a")

        with self.operator():
            invalid = self.client.post(
                "/resources",
                json={"name": "Invalid", "type": "Unknown", "quantity": 0}
            )
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(self.table.put_item.call_count, 1)

    def test_resource_assignment_is_atomic_and_links_incident(self):
        incident = {
            "PK": "INCIDENT#INC-1",
            "SK": "METADATA",
            "incident_id": "INC-1",
            "place": "Mandi",
            "response_status": "Awaiting Assignment",
            "updated_at": "2026-11-04T00:00:00+00:00",
        }
        resource = {
            "PK": "RESOURCE#RES-1",
            "SK": "METADATA",
            "resource_id": "RES-1",
            "name": "North Ambulance",
            "type": "Ambulance",
            "available_quantity": 2,
            "deployed_quantity": 0,
            "updated_at": "2026-11-04T00:00:00+00:00",
        }
        self.table.get_item.side_effect = [
            {"Item": incident},
            {"Item": resource},
        ]
        with self.operator():
            response = self.client.post(
                "/incidents/INC-1/resources",
                json={"resource_id": "RES-1", "quantity": 1}
            )

        self.assertEqual(response.status_code, 201)
        body = response.get_json()
        self.assertEqual(body["response_status"], "Assigned")
        self.assertEqual(body["assignment"]["incident_id"], "INC-1")
        self.assertEqual(body["assignment"]["location"], "Mandi")
        self.assertEqual(body["assignment"]["assigned_by"], "operator-a")
        transaction = self.table.meta.client.transact_write_items.call_args.kwargs[
            "TransactItems"
        ]
        self.assertEqual(len(transaction), 2)
        expressions = [entry["Update"]["UpdateExpression"] for entry in transaction]
        self.assertTrue(any("available_quantity = available_quantity - :quantity" in value for value in expressions))
        self.assertTrue(any("response_assignments" in value for value in expressions))

    def test_resource_return_records_both_resource_and_incident_history(self):
        resource = {
            "PK": "RESOURCE#RES-1",
            "SK": "METADATA",
            "resource_id": "RES-1",
            "name": "North Ambulance",
            "total_quantity": 2,
            "available_quantity": 1,
            "deployed_quantity": 1,
            "unavailable_quantity": 0,
            "status": "Deployed",
            "updated_at": "2026-11-04T00:00:00+00:00",
            "deployments": [{
                "deployment_id": "DEP-1",
                "incident_id": "INC-1",
                "quantity": 1,
                "status": "Assigned",
            }],
            "history": [],
        }
        incident = {
            "PK": "INCIDENT#INC-1",
            "SK": "METADATA",
            "updated_at": "2026-11-04T00:00:00+00:00",
        }
        self.table.get_item.side_effect = [
            {"Item": resource},
            {"Item": incident},
        ]
        with self.operator():
            response = self.client.patch(
                "/resources/RES-1",
                json={"action": "return", "deployment_id": "DEP-1"}
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["resource"]["available_quantity"], 2)
        self.assertEqual(response.get_json()["resource"]["deployed_quantity"], 0)
        operations = self.table.meta.client.transact_write_items.call_args.kwargs[
            "TransactItems"
        ]
        self.assertEqual(len(operations), 2)
        self.assertTrue(any(
            "response_history" in entry["Update"]["UpdateExpression"]
            for entry in operations
        ))

    def test_operator_session_and_report_verification_routes(self):
        report = {
            "report_id": "REP-1",
            "verification_status": "Unverified",
            "original_text": "Water is rising.",
        }
        self.table.get_item.return_value = {"Item": report}
        with self.operator():
            session = self.client.post("/operator/session")
        self.assertEqual(session.status_code, 200)
        self.assertEqual(session.get_json()["operator"], "operator-a")

        with self.operator():
            verification = self.client.post(
                "/reports/REP-1/verification",
                json={"status": "Confirmed"}
            )
        self.assertEqual(verification.status_code, 200)
        self.assertEqual(
            verification.get_json()["report"]["verification_status"],
            "Confirmed"
        )
        values = self.table.update_item.call_args.kwargs["ExpressionAttributeValues"]
        self.assertEqual(values[":operator"], "operator-a")
        self.assertEqual(values[":review_status"], "Reviewed")

    def test_private_audio_route_returns_bytes_only_after_operator_auth(self):
        self.table.get_item.return_value = {
            "Item": {
                "report_id": "REP-AUDIO",
                "audio_s3_key": "voice-reports/REP-AUDIO.wav",
                "audio_content_type": "audio/wav",
            }
        }
        self.s3.get_object.return_value = {"Body": BytesIO(b"private recording")}
        with self.operator():
            response = self.client.get("/reports/REP-AUDIO/audio")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, b"private recording")
        self.assertEqual(response.headers["Cache-Control"], "private, no-store")
        self.s3.get_object.assert_called_once_with(
            Bucket="resqgrid-test-bucket",
            Key="voice-reports/REP-AUDIO.wav"
        )

    def test_field_report_preserves_original_and_marks_english_unchanged(self):
        with patch.object(backend_app, "get_all_items", return_value=[PLACE]):
            response = self.client.post(
                "/report",
                headers={"Idempotency-Key": "field-report-0001"},
                json={
                    "original_text": "Water is rising near the bridge.",
                    "place": "Mandi",
                    "type": "Flood",
                    "severity": "High",
                }
            )

        self.assertEqual(response.status_code, 201)
        report = response.get_json()["report"]
        self.assertEqual(report["original_text"], "Water is rising near the bridge.")
        self.assertEqual(report["translated_text"], report["original_text"])
        self.assertEqual(report["translation_status"], "Unchanged")
        self.assertEqual(report["verification_status"], "Unverified")

    def test_resource_list_and_inventory_update_routes(self):
        resource = {
            "PK": "RESOURCE#RES-1",
            "SK": "METADATA",
            "resource_id": "RES-1",
            "name": "North Ambulance",
            "type": "Ambulance",
            "total_quantity": 2,
            "available_quantity": 2,
            "deployed_quantity": 0,
            "unavailable_quantity": 0,
            "updated_at": "2026-11-04T00:00:00+00:00",
            "history": [],
        }
        with patch.object(backend_app, "get_all_items", return_value=[resource]):
            with self.operator():
                listing = self.client.get("/resources")
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(listing.get_json()["resources"][0]["resource_id"], "RES-1")

        self.table.get_item.return_value = {"Item": resource}
        with self.operator():
            updated = self.client.patch(
                "/resources/RES-1",
                json={
                    "action": "update",
                    "name": "Mandi Ambulance",
                    "type": "Ambulance",
                    "quantity": 3,
                }
            )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.get_json()["resource"]["total_quantity"], 3)
        values = self.table.update_item.call_args.kwargs["ExpressionAttributeValues"]
        self.assertEqual(values[":available"], 3)
        self.assertEqual(values[":name"], "Mandi Ambulance")

    def test_brief_generate_get_and_approve_routes(self):
        items = [{
            "PK": "INCIDENT#INC-1",
            "SK": "METADATA",
            "incident_id": "INC-1",
            "type": "Flood",
            "place": "Mandi",
            "severity": "Critical",
            "status": "Unverified",
            "report_ids": ["REP-1"],
        }, {
            "PK": "REPORT#REP-1",
            "SK": "METADATA",
            "report_id": "REP-1",
            "incident_id": "INC-1",
            "place": "Mandi",
            "verification_status": "Corroborated",
        }]
        with patch.object(backend_app, "get_all_items", return_value=items):
            with self.operator():
                generated = self.client.post("/brief/generate")
        self.assertEqual(generated.status_code, 200)
        draft = generated.get_json()
        self.assertEqual(draft["status"], "Draft — Needs Human Review")
        self.assertIn("Critical", draft["text"])
        self.table.put_item.assert_called_once()

        with patch.object(backend_app, "get_brief_item", return_value=draft):
            with self.operator():
                current = self.client.get("/brief")
        self.assertEqual(current.status_code, 200)

        with self.operator(), patch.object(
            backend_app,
            "get_brief_item",
            return_value=draft
        ):
            approved = self.client.post("/brief/approve")
        self.assertEqual(approved.status_code, 200)
        self.assertEqual(
            approved.get_json()["status"],
            "Approved"
        )

    def test_brief_generation_requires_operator_authentication(self):
        password_hash = hashlib.sha256(b"strong-test-password").hexdigest()
        with patch.dict(
            os.environ,
            {
                "RESQGRID_OPERATOR_PASSWORD_HASHES": json.dumps(
                    {"operator-a": password_hash}
                ),
                "RESQGRID_OPERATOR_ROLES": json.dumps(
                    {"operator-a": "operator"}
                ),
            },
        ):
            response = self.client.post("/brief/generate")
        self.assertEqual(response.status_code, 401)
        self.assertFalse(response.get_json()["ok"])
        self.table.scan.assert_not_called()
        self.table.put_item.assert_not_called()

    def test_viewer_role_cannot_confirm_incidents(self):
        password_hash = hashlib.sha256(b"strong-test-password").hexdigest()
        auth_header = base64.b64encode(
            b"viewer-a:strong-test-password"
        ).decode("ascii")
        with patch.dict(
            os.environ,
            {
                "RESQGRID_OPERATOR_PASSWORD_HASHES": json.dumps(
                    {"viewer-a": password_hash}
                ),
                "RESQGRID_OPERATOR_ROLES": json.dumps(
                    {"viewer-a": "viewer"}
                ),
            },
        ), patch.object(
            backend_app,
            "get_all_items",
            return_value=[PLACE],
        ):
            read_response = self.client.get(
                "/incidents",
                headers={"Authorization": f"Basic {auth_header}"},
            )
            response = self.client.post(
                "/incidents/INC-1/confirm",
                headers={"Authorization": f"Basic {auth_header}"},
            )
        self.assertEqual(read_response.status_code, 200)
        self.assertEqual(response.status_code, 403)
        self.table.get_item.assert_not_called()

    def test_control_room_data_requires_at_least_viewer_authentication(self):
        password_hash = hashlib.sha256(b"strong-test-password").hexdigest()
        with patch.dict(
            os.environ,
            {
                "RESQGRID_OPERATOR_PASSWORD_HASHES": json.dumps(
                    {"viewer-a": password_hash}
                ),
                "RESQGRID_OPERATOR_ROLES": json.dumps(
                    {"viewer-a": "viewer"}
                ),
            },
        ), patch.object(backend_app, "get_all_items") as load_items:
            response = self.client.get("/incidents")

        self.assertEqual(response.status_code, 401)
        load_items.assert_not_called()

    def test_operator_password_accepts_scrypt_hashes(self):
        stored_hash = generate_password_hash("strong-test-password")
        self.assertTrue(
            backend_app.verify_operator_password(
                stored_hash,
                "strong-test-password",
            )
        )
        self.assertFalse(
            backend_app.verify_operator_password(
                stored_hash,
                "wrong-password",
            )
        )

    def test_cors_allows_configured_development_origin_only(self):
        allowed = self.client.options(
            "/incidents",
            headers={
                "Origin": "http://localhost:5173",
                "Access-Control-Request-Method": "GET",
            },
        )
        denied = self.client.options(
            "/incidents",
            headers={
                "Origin": "https://unapproved.example",
                "Access-Control-Request-Method": "GET",
            },
        )
        self.assertEqual(
            allowed.headers.get("Access-Control-Allow-Origin"),
            "http://localhost:5173",
        )
        self.assertIsNone(denied.headers.get("Access-Control-Allow-Origin"))

    def test_api_errors_use_sanitized_json_and_security_headers(self):
        response = self.client.get("/route-that-does-not-exist")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(
            response.get_json(),
            {
                "ok": False,
                "error": "The requested resource was not found.",
                "code": "not_found",
            },
        )
        self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(response.headers["X-Frame-Options"], "DENY")

    def test_human_incident_confirmation_route_records_operator(self):
        incident = {
            "PK": "INCIDENT#INC-1",
            "SK": "METADATA",
            "incident_id": "INC-1",
            "status": "Unverified",
        }
        self.table.get_item.return_value = {"Item": incident}
        with self.operator():
            response = self.client.post("/incidents/INC-1/confirm")

        self.assertEqual(response.status_code, 200)
        result = response.get_json()["incident"]
        self.assertEqual(result["confirmed_by"], "operator-a")
        self.assertEqual(result["status"], "Confirmed")

    def test_response_status_requires_valid_operator_transition_and_records_history(self):
        incident = {
            "PK": "INCIDENT#INC-1",
            "SK": "METADATA",
            "response_status": "Assigned",
            "updated_at": "2026-11-04T00:00:00+00:00",
        }
        self.table.get_item.return_value = {"Item": incident}
        with self.operator():
            response = self.client.patch(
                "/incidents/INC-1/response",
                json={"status": "Team Dispatched", "notes": "Crew moving"}
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["incident"]["response_status"], "Team Dispatched")
        values = self.table.update_item.call_args.kwargs["ExpressionAttributeValues"]
        self.assertEqual(values[":entry"][0]["operator"], "operator-a")
        self.assertEqual(values[":entry"][0]["notes"], "Crew moving")

        with self.operator():
            invalid = self.client.patch(
                "/incidents/INC-1/response",
                json={"status": "Resolved"}
            )
        self.assertEqual(invalid.status_code, 409)

    def test_risk_assessment_uses_stored_incidents_and_reports(self):
        now = datetime(2026, 11, 4, 12, 0, tzinfo=timezone.utc)
        incidents = [
            {
                "incident_id": "INC-1",
                "place": "Mandi",
                "severity": "Critical",
                "status": "Unverified",
                "report_ids": ["REP-1"],
                "lat": 31.7087,
                "lng": 76.932,
            },
            {
                "incident_id": "INC-2",
                "place": "Mandi",
                "severity": "High",
                "status": "Unverified",
                "report_ids": ["REP-2"],
                "lat": 31.7087,
                "lng": 76.932,
            },
        ]
        reports = [
            {"place": "Mandi", "created_at": (now - timedelta(minutes=5)).isoformat()},
            {"place": "Mandi", "created_at": (now - timedelta(minutes=8)).isoformat()},
        ]
        assessment = backend_app.build_risk_assessment(
            incidents,
            reports,
            [PLACE],
            now=now
        )
        mandi = next(location for location in assessment["locations"] if location["place"] == "Mandi")
        self.assertTrue(mandi["requires_attention"])
        self.assertEqual(mandi["high_severity_incident_count"], 2)
        self.assertEqual(mandi["recent_report_count"], 2)
        self.assertEqual(mandi["lat"], PLACE["lat"])
        self.assertIn("human review", assessment["label"])

    def test_dashboard_returns_resources_and_risk_in_single_snapshot(self):
        items = [
            PLACE,
            {
                "PK": "INCIDENT#INC-1",
                "SK": "METADATA",
                "incident_id": "INC-1",
                "place": "Mandi",
                "type": "Flood",
                "severity": "High",
                "status": "Unverified",
                "lat": PLACE["lat"],
                "lng": PLACE["lng"],
                "report_ids": [],
                "report_count": 0,
            },
            {
                "PK": "RESOURCE#RES-1",
                "SK": "METADATA",
                "resource_id": "RES-1",
                "name": "Operator-entered ambulance",
                "available_quantity": 1,
            },
        ]
        with patch.object(backend_app, "get_all_items", return_value=items):
            with self.operator():
                response = self.client.get("/incidents")

        self.assertEqual(response.status_code, 200)
        body = response.get_json()
        self.assertEqual(body["resources"][0]["resource_id"], "RES-1")
        self.assertEqual(body["incidents"][0]["response_status"], "Awaiting Assignment")
        self.assertTrue(body["risk_assessment"]["locations"])

    def test_resource_mutations_require_operator_authentication(self):
        def deny(*args, **kwargs):
            return None, (
                backend_app.jsonify({"ok": False, "error": "Unauthorized"}),
                401
            )

        with patch.object(backend_app, "authenticate_operator", side_effect=deny):
            response = self.client.post(
                "/resources",
                json={"name": "Ambulance", "type": "Ambulance", "quantity": 1}
            )

        self.assertEqual(response.status_code, 401)
        self.table.put_item.assert_not_called()


if __name__ == "__main__":
    unittest.main()
