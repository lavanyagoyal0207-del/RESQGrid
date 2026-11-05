import sys
import types
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch


aws_config_stub = types.ModuleType("aws_config")
aws_config_stub.table = MagicMock()
aws_config_stub.s3 = MagicMock()
aws_config_stub.BUCKET_NAME = "resqgrid-test-bucket"
sys.modules["aws_config"] = aws_config_stub

import app as backend_app
from intelligence import (
    compare_reports,
    detect_emerging_patterns,
    detect_language,
    extract_report_fields,
    is_simulated_record,
    translate_text,
)
from app import generate_situation_brief
import seed_dynamodb
from seed_dynamodb import seed_places


PLACE = {
    "PK": "PLACE#MANDI",
    "SK": "METADATA",
    "place": "Mandi",
    "lat": 31.7087,
    "lng": 76.932,
}


class MultilingualIntelligenceTests(unittest.TestCase):
    def test_detects_english_hindi_and_punjabi_scripts(self):
        self.assertEqual(detect_language("Water is rising.")["code"], "en")
        self.assertEqual(detect_language("पानी बढ़ रहा है।")["code"], "hi")
        self.assertEqual(detect_language("ਪਾਣੀ ਵੱਧ ਰਿਹਾ ਹੈ।")["code"], "pa")

    def test_extraction_uses_explicit_evidence_and_unknown_defaults(self):
        fields = extract_report_fields(
            "Flood at Mandi: 12 people trapped; water is rising. Need ambulance.",
            ["Mandi"],
        )
        self.assertEqual(fields["incident_type"]["value"], "Flood")
        self.assertEqual(fields["location"]["value"], "Mandi")
        self.assertEqual(fields["people_affected"]["value"], 12)
        self.assertEqual(fields["severity"]["value"], "Unknown")
        self.assertEqual(
            fields["immediate_threats"]["value"],
            ["Rising water", "People trapped"],
        )
        self.assertEqual(
            fields["urgent_resource_requirements"]["value"],
            ["Ambulance"],
        )
        self.assertTrue(all(
            field["verification_status"] == "Unverified"
            for field in fields.values()
        ))

    def test_hindi_and_punjabi_extraction_uses_configured_location_aliases(self):
        hindi = extract_report_fields(
            "मंडी में बाढ़ है, 12 लोग फंसे हैं।",
            ["Mandi"],
        )
        punjabi = extract_report_fields(
            "ਮੰਡੀ ਵਿੱਚ ਹੜ੍ਹ ਹੈ, 5 ਲੋਕ ਫਸੇ ਹਨ ਅਤੇ ਪੁਲ ਟੁੱਟ ਗਿਆ।",
            ["Mandi"],
        )
        self.assertEqual(hindi["incident_type"]["value"], "Flood")
        self.assertEqual(hindi["location"]["value"], "Mandi")
        self.assertEqual(hindi["people_affected"]["value"], 12)
        self.assertEqual(punjabi["incident_type"]["value"], "Flood")
        self.assertEqual(punjabi["location"]["value"], "Mandi")
        self.assertEqual(punjabi["people_affected"]["value"], 5)
        self.assertIn("Bridge damage", punjabi["infrastructure_damage"]["value"])

    def test_translation_failure_is_explicit_and_never_uses_fallback_text(self):
        with patch(
            "intelligence._load_translation_model",
            side_effect=RuntimeError("model unavailable"),
        ):
            result = translate_text("पानी बढ़ रहा है।", "hi")
        self.assertEqual(result["status"], "Failed")
        self.assertIsNone(result["text"])

    def test_comparison_flags_severity_and_explicit_contradiction(self):
        now = datetime.now(timezone.utc)
        reports = [
            {
                "report_id": "REP-1",
                "incident_id": "INC-1",
                "place": "Mandi",
                "type": "Flood",
                "severity": "High",
                "original_text": "Flood water rising near the town.",
                "created_at": now.isoformat(),
                "verification_status": "Unverified",
            },
            {
                "report_id": "REP-2",
                "incident_id": "INC-1",
                "place": "Mandi",
                "type": "Flood",
                "severity": "Low",
                "original_text": "Flood water is not rising near the town.",
                "created_at": (now + timedelta(minutes=5)).isoformat(),
                "verification_status": "Corroborated",
            },
        ]
        comparisons = compare_reports(reports, [], [PLACE])
        self.assertEqual(len(comparisons), 1)
        self.assertEqual(comparisons[0]["classification"], "Conflicting Severity")
        self.assertTrue(comparisons[0]["contradictory_evidence"])
        self.assertTrue(comparisons[0]["contradicts_incident"])
        self.assertFalse(comparisons[0]["supports_incident"])

    def test_patterns_use_report_counts_and_supporting_ids(self):
        now = datetime.now(timezone.utc)
        reports = [
            {
                "report_id": f"REP-{index}",
                "place": "Mandi",
                "severity": "High",
                "original_text": "Bridge damaged.",
                "created_at": (now - timedelta(minutes=index * 5)).isoformat(),
                "verification_status": "Unverified",
            }
            for index in range(3)
        ]
        patterns = detect_emerging_patterns(reports, [], [PLACE])
        types_found = {pattern["type"] for pattern in patterns["patterns"]}
        self.assertIn("Report Frequency Increase", types_found)
        self.assertIn("Multiple High-Severity Reports", types_found)
        self.assertIn("Repeated Infrastructure Damage Reports", types_found)
        self.assertTrue(all(
            pattern["supporting_report_ids"]
            for pattern in patterns["patterns"]
        ))
        self.assertIn("not validated", patterns["label"])

    def test_patterns_are_anchored_to_server_time_and_ignore_stale_reports(self):
        now = datetime(2026, 11, 5, 0, 0, tzinfo=timezone.utc)
        recent_reports = [
            {
                "report_id": f"REP-CURRENT-{index}",
                "place": "Mandi",
                "severity": "High",
                "original_text": "Bridge damaged.",
                "created_at": (now - timedelta(minutes=index * 5)).isoformat(),
                "verification_status": "Unverified",
            }
            for index in range(3)
        ]
        stale_reports = [
            {
                **report,
                "report_id": f"REP-OLD-{index}",
                "created_at": (now - timedelta(days=2, minutes=index)).isoformat(),
            }
            for index, report in enumerate(recent_reports)
        ]

        current = detect_emerging_patterns(
            stale_reports + recent_reports,
            [],
            [PLACE],
            now=now,
        )
        self.assertEqual(current["data_status"], "current")
        self.assertEqual(current["evaluated_at"], now.isoformat())
        self.assertTrue(all(
            pattern["detected_at"] == now.isoformat()
            for pattern in current["patterns"]
        ))
        frequency = next(
            pattern for pattern in current["patterns"]
            if pattern["type"] == "Report Frequency Increase"
        )
        self.assertEqual(
            set(frequency["supporting_report_ids"]),
            {report["report_id"] for report in recent_reports},
        )

        stale = detect_emerging_patterns(stale_reports, [], [PLACE], now=now)
        self.assertEqual(stale["data_status"], "stale")
        self.assertEqual(stale["stale_report_count"], 3)
        self.assertEqual(stale["patterns"], [])
        self.assertIn("Stale evidence", stale["label"])

    def test_patterns_label_empty_recent_data_insufficient(self):
        result = detect_emerging_patterns([], [], [PLACE])
        self.assertEqual(result["data_status"], "insufficient")
        self.assertEqual(result["patterns"], [])
        self.assertIn("Insufficient recent evidence", result["label"])

    def test_demo_records_are_filtered_from_intelligence_snapshot_and_brief(self):
        demo_report = {
            "PK": "REPORT#REP-9001",
            "SK": "METADATA",
            "report_id": "REP-9001",
            "original_text": "SIMULATED SAMPLE",
            "place": "Mandi",
        }
        demo_incident = {
            "PK": "INCIDENT#INC-101",
            "SK": "METADATA",
            "incident_id": "INC-101",
            "place": "Mandi",
        }
        self.assertTrue(is_simulated_record(demo_report))
        self.assertTrue(is_simulated_record(demo_incident))
        real_report = {
            "PK": "REPORT#REP-REAL",
            "SK": "METADATA",
            "report_id": "REP-REAL",
            "original_text": "Real caller report",
            "place": "Mandi",
            "verification_status": "Unverified",
        }
        with patch.object(
            backend_app,
            "get_all_items",
            return_value=[demo_report, demo_incident, real_report, PLACE],
        ):
            _, incidents, reports, _ = backend_app.load_intelligence_snapshot()

        self.assertEqual(incidents, [])
        self.assertEqual([report["report_id"] for report in reports], ["REP-REAL"])
        brief = generate_situation_brief(
            [demo_incident],
            [demo_report],
        )
        self.assertIn("0 individual reports", brief["text"])
        self.assertIn("0 active incidents", brief["text"])
        self.assertNotIn("SIMULATED SAMPLE", brief["text"])
        patterns = detect_emerging_patterns(
            [demo_report],
            [demo_incident],
            [PLACE],
        )
        self.assertEqual(patterns["patterns"], [])

    def test_mock_seed_data_writes_only_fixed_locations(self):
        writes = []
        seed_places(
            [
                {"place": "Mandi", "lat": 31.7087, "lng": 76.932},
            ],
            save=writes.append,
        )
        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0]["PK"], "PLACE#Mandi")
        self.assertFalse(any(
            item["PK"].startswith(("REPORT#", "INCIDENT#", "BRIEF#"))
            for item in writes
        ))

    def test_seed_entry_point_never_writes_simulated_reports_or_briefs(self):
        writes = []
        with patch.object(seed_dynamodb, "save_once", side_effect=writes.append):
            seed_dynamodb.main()

        self.assertTrue(writes)
        self.assertTrue(all(item["PK"].startswith("PLACE#") for item in writes))

    def test_seeded_demo_brief_is_not_returned_as_operational_brief(self):
        backend_app.table.get_item.return_value = {
            "Item": {
                "PK": "BRIEF#CURRENT",
                "SK": "METADATA",
                "generated_at": "2026-11-03T22:50:00+05:30",
                "text": "SIMULATED BRIEF",
            }
        }
        self.assertIsNone(backend_app.get_brief_item())

    def test_situation_brief_excludes_resolved_and_rejected_incidents(self):
        incidents = [
            {
                "incident_id": "INC-ACTIVE",
                "place": "Mandi",
                "type": "Flood",
                "severity": "High",
                "status": "Unverified",
            },
            {
                "incident_id": "INC-RESOLVED",
                "place": "Kullu",
                "type": "Landslide",
                "severity": "Critical",
                "status": "Confirmed",
                "response_status": "Resolved",
            },
            {
                "incident_id": "INC-REJECTED",
                "place": "Shimla",
                "type": "Flood",
                "severity": "Critical",
                "status": "Rejected",
            },
        ]
        brief = generate_situation_brief(incidents, [])
        self.assertIn("across 1 active incident", brief["text"])
        self.assertIn("Affected locations: Mandi.", brief["text"])
        self.assertNotIn("Kullu", brief["text"])
        self.assertNotIn("Shimla", brief["text"])


class PhaseFourApiTests(unittest.TestCase):
    def setUp(self):
        self.table = MagicMock()
        self.table.name = "ResQGrid"
        self.table.meta.client.transact_write_items = MagicMock()
        self.table.get_item.return_value = {"Item": None}
        self.patches = [
            patch.object(backend_app, "table", self.table),
            patch.object(backend_app, "get_brief_item", return_value=None),
            patch.object(
                backend_app,
                "authenticate_citizen",
                return_value=({
                    "user_id": "USR-PHASE4-CITIZEN",
                    "name": "Citizen Reporter",
                    "email": "citizen@example.com",
                    "role": "citizen",
                }, None),
            ),
        ]
        for patcher in self.patches:
            patcher.start()
            self.addCleanup(patcher.stop)
        self.client = backend_app.app.test_client()

    def operator(self):
        return patch.object(
            backend_app,
            "authenticate_operator",
            return_value=("operator-a", None),
        )

    def test_analysis_corrections_require_operator_and_preserve_verification(self):
        report = {
            "report_id": "REP-1",
            "original_text": "Flood at Mandi",
            "verification_status": "Unverified",
            "analysis": {"fields": {}},
        }
        with self.operator(), patch.object(
            backend_app, "get_report", return_value=report
        ), patch.object(
            backend_app, "get_all_items", return_value=[PLACE]
        ):
            response = self.client.patch(
                "/reports/REP-1/analysis-corrections",
                json={"fields": {"incident_type": "Flood", "people_affected": 5}},
            )
        self.assertEqual(response.status_code, 200)
        body = response.get_json()["report"]
        self.assertEqual(body["analysis"]["fields"]["incident_type"]["value"], "Flood")
        self.assertEqual(body["analysis"]["human_correction"]["operator"], "operator-a")
        self.assertEqual(body["verification_status"], "Unverified")
        self.table.update_item.assert_called_once()

    def test_analysis_correction_rejects_invalid_values(self):
        with self.operator(), patch.object(
            backend_app,
            "get_report",
            return_value={"report_id": "REP-1", "analysis": {"fields": {}}},
        ):
            response = self.client.patch(
                "/reports/REP-1/analysis-corrections",
                json={"fields": {"severity": "Extreme"}},
            )
        self.assertEqual(response.status_code, 400)

    def test_analytics_returns_empty_actual_record_counts_and_validates_dates(self):
        with patch.object(
            backend_app,
            "load_intelligence_snapshot",
            return_value=([], [], [], [PLACE]),
        ), self.operator():
            response = self.client.get("/analytics?from_date=2026-01-01")
            invalid = self.client.get("/analytics?from_date=not-a-date")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data["incident_analytics"]["total_reports"], 0)
        self.assertEqual(data["incident_analytics"]["total_incidents"], 0)
        self.assertIsNone(data["response_analytics"]["average_response_minutes"])
        self.assertEqual(invalid.status_code, 400)

    def test_alert_draft_requires_confirmed_evidence(self):
        with self.operator(), patch.object(
            backend_app,
            "load_intelligence_snapshot",
            return_value=(
                [PLACE],
                [],
                [{
                    "report_id": "REP-1",
                    "place": "Mandi",
                    "verification_status": "Unverified",
                }],
                [PLACE],
            ),
        ):
            response = self.client.post(
                "/alerts",
                json={
                    "locations": ["Mandi"],
                    "severity": "High",
                    "urgency": "Warning",
                },
            )
        self.assertEqual(response.status_code, 409)
        self.table.put_item.assert_not_called()

    def test_citizen_report_to_operator_verification_to_alert_draft(self):
        with patch.object(
            backend_app,
            "get_all_items",
            return_value=[PLACE],
        ):
            submitted = self.client.post(
                "/report",
                headers={"Idempotency-Key": "phase4-flow-0001"},
                json={
                    "original_text": "Flood reported at Mandi.",
                    "place": "Mandi",
                    "type": "Flood",
                    "severity": "High",
                },
            )
        self.assertEqual(submitted.status_code, 201)
        report = submitted.get_json()["report"]
        self.assertEqual(report["verification_status"], "Unverified")
        self.assertEqual(report["original_text"], "Flood reported at Mandi.")

        with self.operator(), patch.object(
            backend_app,
            "get_report",
            return_value=report,
        ):
            verified = self.client.post(
                f"/reports/{report['report_id']}/verification",
                json={"status": "Confirmed"},
            )
        self.assertEqual(verified.status_code, 200)
        confirmed_report = verified.get_json()["report"]
        self.assertEqual(confirmed_report["verification_status"], "Confirmed")
        self.assertEqual(confirmed_report["verified_by"], "operator-a")

        with self.operator(), patch.object(
            backend_app,
            "load_intelligence_snapshot",
            return_value=([PLACE], [], [confirmed_report], [PLACE]),
        ), patch.object(
            backend_app,
            "translate_text",
            side_effect=lambda text, source, target: {
                "text": f"{target}:{text}",
                "status": "Completed",
                "error": None,
            },
        ):
            alert = self.client.post(
                "/alerts",
                json={
                    "locations": ["Mandi"],
                    "severity": "High",
                    "urgency": "Warning",
                },
            )
        self.assertEqual(alert.status_code, 201)
        self.assertEqual(
            alert.get_json()["alert"]["supporting_report_ids"],
            [report["report_id"]],
        )

    def test_comparison_and_pattern_routes_return_data_driven_results(self):
        now = datetime.now(timezone.utc)
        reports = [
            {
                "report_id": "REP-1",
                "incident_id": "INC-1",
                "place": "Mandi",
                "type": "Flood",
                "severity": "High",
                "original_text": "Flood water rising.",
                "created_at": now.isoformat(),
            },
            {
                "report_id": "REP-2",
                "incident_id": "INC-1",
                "place": "Mandi",
                "type": "Flood",
                "severity": "High",
                "original_text": "Flood water rising near the bridge.",
                "created_at": (now + timedelta(minutes=2)).isoformat(),
            },
        ]
        with patch.object(
            backend_app,
            "load_intelligence_snapshot",
            return_value=(
                [],
                [{"incident_id": "INC-1", "place": "Mandi", "report_ids": ["REP-1", "REP-2"]}],
                reports,
                [PLACE],
            ),
        ), self.operator():
            comparisons = self.client.get("/intelligence/compare")
            invalid_window = self.client.get("/intelligence/compare?window_minutes=0")
            patterns = self.client.get("/intelligence/patterns")
        self.assertEqual(comparisons.status_code, 200)
        self.assertEqual(len(comparisons.get_json()["comparisons"]), 1)
        self.assertEqual(invalid_window.status_code, 400)
        self.assertEqual(patterns.status_code, 200)
        self.assertIn("patterns", patterns.get_json())

    def test_analytics_excludes_legacy_demo_reports_and_incidents(self):
        items = [
            {
                "PK": "REPORT#REP-9001",
                "SK": "METADATA",
                "report_id": "REP-9001",
                "place": "Mandi",
                "verification_status": "Confirmed",
            },
            {
                "PK": "INCIDENT#INC-101",
                "SK": "METADATA",
                "incident_id": "INC-101",
                "place": "Mandi",
                "severity": "Critical",
                "type": "Flood",
            },
            {
                "PK": "REPORT#REP-REAL",
                "SK": "METADATA",
                "report_id": "REP-REAL",
                "place": "Mandi",
                "source": "Citizen Field Report",
                "verification_status": "Unverified",
            },
            {
                "PK": "INCIDENT#INC-REAL",
                "SK": "METADATA",
                "incident_id": "INC-REAL",
                "place": "Mandi",
                "severity": "High",
                "type": "Flood",
            },
        ]
        with patch.object(backend_app, "get_all_items", return_value=items):
            with self.operator():
                response = self.client.get("/analytics")

        self.assertEqual(response.status_code, 200)
        analytics = response.get_json()["incident_analytics"]
        self.assertEqual(analytics["total_reports"], 1)
        self.assertEqual(analytics["total_incidents"], 1)
        self.assertEqual(analytics["by_severity"], {"High": 1})

    def test_alert_requires_review_and_simulates_delivery_without_external_service(self):
        confirmed = {
            "report_id": "REP-1",
            "place": "Mandi",
            "type": "Flood",
            "verification_status": "Confirmed",
        }
        with self.operator(), patch.object(
            backend_app,
            "load_intelligence_snapshot",
            return_value=([PLACE], [], [confirmed], [PLACE]),
        ), patch.object(
            backend_app,
            "translate_text",
            side_effect=lambda text, source, target: {
                "text": f"{target}:{text}",
                "status": "Completed",
                "error": None,
            },
        ):
            created = self.client.post(
                "/alerts",
                json={
                    "locations": ["Mandi"],
                    "severity": "High",
                    "urgency": "Warning",
                },
            )
        self.assertEqual(created.status_code, 201)
        alert = created.get_json()["alert"]
        self.assertEqual(alert["status"], "Draft")
        self.assertIn("hi", alert["messages"])
        self.assertIn("pa", alert["messages"])
        self.table.put_item.assert_called_once()

        alert_id = alert["alert_id"]
        stored = {
            **alert,
            "PK": f"ALERT#{alert_id}",
            "SK": "METADATA",
            "status": "Approved",
        }
        self.table.get_item.return_value = {"Item": stored}
        with self.operator():
            sent = self.client.post(f"/alerts/{alert_id}/send")
        self.assertEqual(sent.status_code, 200)
        self.assertIn("Simulated", sent.get_json()["alert"]["delivery_mode"])

    def test_brief_edit_and_archive_are_operator_only_and_preserve_version(self):
        draft = {
            "PK": "BRIEF#CURRENT",
            "SK": "METADATA",
            "version_id": "brief-v1",
            "status": "Draft — Needs Human Review",
            "text": "Draft summary",
            "sections": [{
                "key": "executive_summary",
                "title": "Executive Summary",
                "text": "Draft summary",
                "report_ids": ["REP-1"],
            }],
        }
        with self.operator(), patch.object(
            backend_app, "get_brief_item", return_value=draft
        ):
            edited = self.client.patch(
                "/brief",
                json={"sections": {"executive_summary": "Operator-edited summary"}},
            )
        self.assertEqual(edited.status_code, 200)
        self.assertEqual(
            edited.get_json()["brief"]["sections"][0]["text"],
            "Operator-edited summary",
        )
        self.table.update_item.assert_called_once()

        approved = {
            **draft,
            "status": "Approved",
            "approved_by": "operator-a",
            "approved_at": datetime.now(timezone.utc).isoformat(),
        }
        with self.operator(), patch.object(
            backend_app, "get_brief_item", return_value=approved
        ):
            archived = self.client.post("/brief/archive")
        self.assertEqual(archived.status_code, 200)
        self.assertEqual(archived.get_json()["brief"]["state"], "archived")
        self.table.meta.client.transact_write_items.assert_called_once()

    def test_generating_new_brief_archives_previous_approval_atomically(self):
        approved = {
            "PK": "BRIEF#CURRENT",
            "SK": "METADATA",
            "version_id": "brief-v1",
            "status": "Approved",
            "approved_by": "operator-a",
            "sections": [],
        }
        with patch.object(
            backend_app,
            "load_intelligence_snapshot",
            return_value=([PLACE], [], [], [PLACE]),
        ), patch.object(
            backend_app,
            "get_brief_item",
            return_value=approved,
        ), self.operator():
            response = self.client.post("/brief/generate")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["status"], "Draft — Needs Human Review")
        operations = self.table.meta.client.transact_write_items.call_args.kwargs[
            "TransactItems"
        ]
        self.assertEqual(len(operations), 2)
        self.assertEqual(operations[0]["Put"]["TableName"], "ResQGrid")
        self.assertEqual(operations[1]["Put"]["TableName"], "ResQGrid")

    def test_alert_draft_can_be_edited_and_operator_approved(self):
        alert = {
            "PK": "ALERT#ALT-1",
            "SK": "METADATA",
            "alert_id": "ALT-1",
            "status": "Draft",
            "messages": {"en": "English", "hi": "", "pa": ""},
            "translation_status": {"en": "Completed", "hi": "Failed", "pa": "Failed"},
            "history": [],
        }
        self.table.get_item.return_value = {"Item": alert}
        with self.operator():
            edited = self.client.patch(
                "/alerts/ALT-1",
                json={"messages": {"hi": "हिंदी संदेश", "pa": "ਪੰਜਾਬੀ ਸੁਨੇਹਾ"}},
            )
        self.assertEqual(edited.status_code, 200)
        self.assertEqual(
            edited.get_json()["alert"]["translation_status"]["hi"],
            "Human Provided",
        )

        with self.operator():
            approved = self.client.post("/alerts/ALT-1/approve")
        self.assertEqual(approved.status_code, 200)
        self.assertEqual(approved.get_json()["alert"]["status"], "Approved")

    def test_analytics_aggregates_real_report_counts_and_language(self):
        now = datetime.now(timezone.utc).isoformat()
        report = {
            "report_id": "REP-1",
            "place": "Mandi",
            "created_at": now,
            "source": "Voice",
            "detected_language": "hi",
            "verification_status": "Confirmed",
            "transcription_status": "Completed",
        }
        incident = {
            "incident_id": "INC-1",
            "place": "Mandi",
            "type": "Flood",
            "severity": "High",
            "created_at": now,
            "status": "Confirmed",
            "response_status": "Awaiting Assignment",
            "report_ids": ["REP-1"],
        }
        with patch.object(
            backend_app,
            "load_intelligence_snapshot",
            return_value=([PLACE], [incident], [report], [PLACE]),
        ), self.operator():
            response = self.client.get("/analytics?place=Mandi")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data["incident_analytics"]["total_reports"], 1)
        self.assertEqual(data["incident_analytics"]["verified_reports"], 1)
        self.assertEqual(data["incident_analytics"]["by_category"], {"Flood": 1})
        self.assertEqual(
            data["communication_analytics"]["reports_by_language"],
            {"hi": 1},
        )
        self.assertEqual(data["communication_analytics"]["transcription_successes"], 1)


if __name__ == "__main__":
    unittest.main()
