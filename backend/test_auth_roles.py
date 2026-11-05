import base64
import json
import os
import sys
import types
import unittest
from io import BytesIO
from unittest.mock import MagicMock, patch

from botocore.exceptions import ClientError
from werkzeug.security import generate_password_hash

if "aws_config" not in sys.modules:
    aws_config_stub = types.ModuleType("aws_config")
    aws_config_stub.table = MagicMock()
    aws_config_stub.s3 = MagicMock()
    aws_config_stub.BUCKET_NAME = "resqgrid-test-bucket"
    aws_config_stub.dynamodb_client = MagicMock()
    sys.modules["aws_config"] = aws_config_stub

import app as backend_app

PLACE = {
    "PK": "PLACE#MANDI",
    "SK": "METADATA",
    "place": "Mandi",
    "lat": 31.7087,
    "lng": 76.932,
}


class AuthAndRoleTests(unittest.TestCase):
    def setUp(self):
        backend_app.app.config["TESTING"] = True
        self.s3 = MagicMock()
        self.table = MagicMock()
        self.table.name = "ResQGrid"
        self.table.meta.client.transact_write_items = MagicMock()
        self.table.scan.return_value = {"Items": [PLACE]}

        self.operator_password = "operator-strong-password"
        self.operator_hash = generate_password_hash(self.operator_password)
        self.operator_env = {
            "RESQGRID_OPERATOR_PASSWORD_HASHES": json.dumps({"operator-a": self.operator_hash}),
            "RESQGRID_OPERATOR_ROLES": json.dumps({"operator-a": "operator"}),
        }

        self.citizen_password = "citizen-secret-123"
        self.citizen_hash = generate_password_hash(self.citizen_password)
        self.citizen_auth = base64.b64encode(f"jane@example.com:{self.citizen_password}".encode()).decode("ascii")
        self.alice_auth = base64.b64encode(f"alice@example.com:{self.citizen_password}".encode()).decode("ascii")

        self.sample_incident = {
            "PK": "INCIDENT#INC-1",
            "SK": "METADATA",
            "incident_id": "INC-1",
            "status": "Unverified",
            "place": "Mandi",
        }

        def mock_get_item(Key, ConsistentRead=False):
            pk = Key.get("PK", "")
            if pk == "USER#jane@example.com":
                return {
                    "Item": {
                        "PK": "USER#jane@example.com",
                        "SK": "METADATA",
                        "user_id": "USR-JANE-REAL",
                        "name": "Jane Citizen Real",
                        "email": "jane@example.com",
                        "password_hash": self.citizen_hash,
                        "role": "citizen",
                    }
                }
            if pk == "USER#alice@example.com":
                return {
                    "Item": {
                        "PK": "USER#alice@example.com",
                        "SK": "METADATA",
                        "user_id": "USR-ALICE-100",
                        "name": "Alice Real",
                        "email": "alice@example.com",
                        "password_hash": self.citizen_hash,
                        "role": "citizen",
                    }
                }
            if pk.startswith("INCIDENT#"):
                return {"Item": self.sample_incident}
            return {"Item": None}

        self.table.get_item.side_effect = mock_get_item

        transcribe_patch = patch.object(
            backend_app,
            "transcribe_audio",
            return_value=("Water is rising rapidly near the river bank.", "en")
        )
        self.transcribe_mock = transcribe_patch.start()
        self.addCleanup(transcribe_patch.stop)

        self.patches = [
            patch.object(backend_app, "s3", self.s3),
            patch.object(backend_app, "table", self.table),
            patch.object(backend_app, "get_brief_item", return_value=None),
            patch.object(backend_app, "_whisper_model", None),
            patch.dict(os.environ, self.operator_env),
        ]
        for patcher in self.patches:
            patcher.start()
            self.addCleanup(patcher.stop)

        self.client = backend_app.app.test_client()

    # 1. New citizen can register
    def test_citizen_registration_success(self):
        response = self.client.post(
            "/auth/register",
            json={
                "name": "Jane Citizen",
                "email": "Jane.Citizen@Example.com",
                "password": "strongpassword123",
            },
        )
        self.assertEqual(response.status_code, 201)
        data = response.get_json()
        self.assertTrue(data["ok"])
        self.assertEqual(data["user"]["name"], "Jane Citizen")
        self.assertEqual(data["user"]["email"], "jane.citizen@example.com")
        self.assertEqual(data["user"]["role"], "citizen")
        self.assertTrue(data["user"]["user_id"].startswith("USR-"))

        # Verify DynamoDB put_item was called
        self.table.put_item.assert_called_once()
        put_call = self.table.put_item.call_args
        item = put_call.kwargs["Item"]
        self.assertEqual(item["PK"], "USER#jane.citizen@example.com")
        self.assertEqual(item["SK"], "METADATA")
        self.assertEqual(item["role"], "citizen")
        # Ensure password is not plaintext
        self.assertNotEqual(item["password_hash"], "strongpassword123")
        self.assertEqual(put_call.kwargs["ConditionExpression"], "attribute_not_exists(PK)")

    # 2. Duplicate registrations are rejected
    def test_duplicate_registration_rejected(self):
        self.table.put_item.side_effect = ClientError(
            {"Error": {"Code": "ConditionalCheckFailedException"}},
            "PutItem"
        )
        response = self.client.post(
            "/auth/register",
            json={
                "name": "Jane Citizen",
                "email": "jane@example.com",
                "password": "strongpassword123",
            },
        )
        self.assertEqual(response.status_code, 409)
        data = response.get_json()
        self.assertFalse(data["ok"])
        self.assertIn("already exists", data["error"])

    # 3. Invalid inputs are rejected during registration
    def test_invalid_registration_rejected(self):
        # Short password
        short_pass_resp = self.client.post(
            "/auth/register",
            json={"name": "Jane", "email": "jane@example.com", "password": "short"},
        )
        self.assertEqual(short_pass_resp.status_code, 400)

        # Invalid email
        invalid_email_resp = self.client.post(
            "/auth/register",
            json={"name": "Jane", "email": "not-an-email", "password": "strongpassword123"},
        )
        self.assertEqual(invalid_email_resp.status_code, 400)

        # Blank name
        blank_name_resp = self.client.post(
            "/auth/register",
            json={"name": "   ", "email": "jane@example.com", "password": "strongpassword123"},
        )
        self.assertEqual(blank_name_resp.status_code, 400)

    # 4. Citizen can log in
    def test_citizen_login_success(self):
        response = self.client.post(
            "/auth/login",
            json={
                "email": "Jane@Example.com",
                "password": "citizen-secret-123",
                "role": "citizen",
            },
        )
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(data["ok"])
        self.assertEqual(data["user"]["role"], "citizen")
        self.assertEqual(data["user"]["name"], "Jane Citizen Real")
        self.assertEqual(data["user"]["email"], "jane@example.com")

    # 5. Invalid credentials are rejected
    def test_invalid_credentials_rejected(self):
        response = self.client.post(
            "/auth/login",
            json={
                "email": "jane@example.com",
                "password": "wrong-password",
                "role": "citizen",
            },
        )
        self.assertEqual(response.status_code, 401)
        self.assertFalse(response.get_json()["ok"])

    # 6. Citizen cannot access operator dashboard
    def test_citizen_cannot_access_operator_dashboard(self):
        response = self.client.get(
            "/incidents",
            headers={"Authorization": f"Basic {self.citizen_auth}"},
        )
        self.assertEqual(response.status_code, 401)
        data = response.get_json()
        self.assertFalse(data["ok"])
        self.assertEqual(data["error"], "Operator credentials are invalid.")

    # 7. Citizen cannot confirm incidents
    def test_citizen_cannot_confirm_incidents(self):
        response = self.client.post(
            "/incidents/INC-1/confirm",
            headers={"Authorization": f"Basic {self.citizen_auth}"},
        )
        self.assertEqual(response.status_code, 401)
        self.assertFalse(response.get_json()["ok"])
        self.table.update_item.assert_not_called()

    # 8. Citizen cannot generate situation briefs
    def test_citizen_cannot_generate_brief(self):
        response = self.client.post(
            "/brief/generate",
            headers={"Authorization": f"Basic {self.citizen_auth}"},
        )
        self.assertEqual(response.status_code, 401)
        self.assertFalse(response.get_json()["ok"])

    # 9. Existing operator can still log in
    def test_existing_operator_login(self):
        operator_auth = base64.b64encode(f"operator-a:{self.operator_password}".encode()).decode("ascii")
        session_resp = self.client.post(
            "/operator/session",
            headers={"Authorization": f"Basic {operator_auth}"},
        )
        self.assertEqual(session_resp.status_code, 200)
        session_data = session_resp.get_json()
        self.assertTrue(session_data["ok"])
        self.assertEqual(session_data["operator"], "operator-a")
        self.assertEqual(session_data["role"], "operator")

        auth_login_resp = self.client.post(
            "/auth/login",
            json={
                "username": "operator-a",
                "password": self.operator_password,
                "role": "operator",
            },
        )
        self.assertEqual(auth_login_resp.status_code, 200)
        auth_data = auth_login_resp.get_json()
        self.assertTrue(auth_data["ok"])
        self.assertEqual(auth_data["user"]["operator"], "operator-a")

    # 10. Operator can access the dashboard and confirm incidents
    def test_operator_can_access_dashboard_and_confirm(self):
        operator_auth = base64.b64encode(f"operator-a:{self.operator_password}".encode()).decode("ascii")
        dashboard_resp = self.client.get(
            "/incidents",
            headers={"Authorization": f"Basic {operator_auth}"},
        )
        self.assertEqual(dashboard_resp.status_code, 200)
        self.assertIn("incidents", dashboard_resp.get_json())

        self.table.update_item.return_value = {
            "Attributes": {**self.sample_incident, "status": "Confirmed", "confirmed_by": "operator-a"}
        }

        confirm_resp = self.client.post(
            "/incidents/INC-1/confirm",
            headers={"Authorization": f"Basic {operator_auth}"},
        )
        self.assertEqual(confirm_resp.status_code, 200)
        self.assertTrue(confirm_resp.get_json()["ok"])
        self.assertEqual(confirm_resp.get_json()["incident"]["confirmed_by"], "operator-a")

    # 11. Authenticated citizen can submit a text report
    def test_authenticated_citizen_can_submit_text_report(self):
        report_payload = {
            "original_text": "Heavy rainfall caused flooding near Mandi main road.",
            "place": "Mandi",
            "type": "Flood",
            "severity": "High",
            "submission_id": "cit-sub-1001",
        }
        response = self.client.post(
            "/report",
            headers={
                "Authorization": f"Basic {self.citizen_auth}",
                "Idempotency-Key": "cit-sub-1001",
            },
            json=report_payload,
        )
        self.assertEqual(response.status_code, 201)
        data = response.get_json()
        self.assertTrue(data["ok"])
        self.assertIn("report", data)
        report = data["report"]
        self.assertEqual(report["place"], "Mandi")
        self.assertEqual(report["reporter_name"], "Jane Citizen Real")
        self.assertEqual(report["reporter_email"], "jane@example.com")
        self.assertEqual(report["reporter_id"], "USR-JANE-REAL")

    # 12. Authenticated citizen can submit a voice report
    def test_authenticated_citizen_can_submit_voice_report(self):
        response = self.client.post(
            "/voice-report",
            headers={
                "Authorization": f"Basic {self.citizen_auth}",
                "Idempotency-Key": "voice-sub-1001",
            },
            data={
                "audio": (BytesIO(b"RIFF....WAVEfmt ....data...."), "report.wav", "audio/wav"),
                "place": "Mandi",
                "type": "Flood",
                "severity": "High",
                "submission_id": "voice-sub-1001",
            },
            content_type="multipart/form-data",
        )
        self.assertIn(response.status_code, (200, 201))
        data = response.get_json()
        self.assertTrue(data["ok"])
        report = data["report"]
        self.assertEqual(report["place"], "Mandi")
        self.assertEqual(report["reporter_name"], "Jane Citizen Real")
        self.assertEqual(report["reporter_email"], "jane@example.com")
        self.assertEqual(report["reporter_id"], "USR-JANE-REAL")

    # 13. Unauthenticated text report is rejected with 401
    def test_unauthenticated_text_report_rejected(self):
        response = self.client.post(
            "/report",
            headers={"Idempotency-Key": "unauth-sub-1"},
            json={
                "original_text": "Unauthenticated test report.",
                "place": "Mandi",
                "type": "Flood",
                "severity": "High",
            },
        )
        self.assertEqual(response.status_code, 401)
        data = response.get_json()
        self.assertFalse(data["ok"])
        self.assertEqual(data["error"], "Citizen credentials are required.")

    # 14. Unauthenticated voice report is rejected with 401
    def test_unauthenticated_voice_report_rejected(self):
        response = self.client.post(
            "/voice-report",
            headers={"Idempotency-Key": "unauth-voice-1"},
            data={
                "audio": (BytesIO(b"audio data"), "report.wav", "audio/wav"),
                "place": "Mandi",
                "type": "Flood",
                "severity": "High",
            },
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 401)
        data = response.get_json()
        self.assertFalse(data["ok"])
        self.assertEqual(data["error"], "Citizen credentials are required.")

    # 15. Invalid citizen credentials are rejected on report submission
    def test_invalid_citizen_credentials_rejected_on_submission(self):
        bad_auth = base64.b64encode(b"jane@example.com:wrong-password").decode("ascii")

        # Text report
        text_resp = self.client.post(
            "/report",
            headers={"Authorization": f"Basic {bad_auth}"},
            json={
                "original_text": "Bad credentials report.",
                "place": "Mandi",
                "type": "Flood",
                "severity": "High",
            },
        )
        self.assertEqual(text_resp.status_code, 401)
        self.assertEqual(text_resp.get_json()["error"], "Citizen credentials are invalid.")

        # Voice report
        voice_resp = self.client.post(
            "/voice-report",
            headers={"Authorization": f"Basic {bad_auth}"},
            data={
                "audio": (BytesIO(b"audio data"), "report.wav", "audio/wav"),
                "place": "Mandi",
                "type": "Flood",
                "severity": "High",
            },
            content_type="multipart/form-data",
        )
        self.assertEqual(voice_resp.status_code, 401)
        self.assertEqual(voice_resp.get_json()["error"], "Citizen credentials are invalid.")

    # 16. Spoofed reporter_name and reporter_email in payload are ignored
    def test_spoofed_reporter_name_and_email_ignored(self):
        response = self.client.post(
            "/report",
            headers={
                "Authorization": f"Basic {self.citizen_auth}",
                "Idempotency-Key": "spoof-test-101",
            },
            json={
                "original_text": "Flooding on Highway 21.",
                "place": "Mandi",
                "type": "Flood",
                "severity": "High",
                "reporter_name": "Malicious Spoof Actor",
                "reporter_email": "spoof@victim.org",
            },
        )
        self.assertEqual(response.status_code, 201)
        report = response.get_json()["report"]
        # Attributes MUST reflect the authenticated DynamoDB user, not the payload
        self.assertEqual(report["reporter_name"], "Jane Citizen Real")
        self.assertEqual(report["reporter_email"], "jane@example.com")
        self.assertEqual(report["reporter_id"], "USR-JANE-REAL")

    # 17. Citizen A cannot submit report under Citizen B's identity
    def test_citizen_a_cannot_submit_as_citizen_b(self):
        # Alice authenticates with her credentials but attempts to submit as Jane
        response = self.client.post(
            "/report",
            headers={
                "Authorization": f"Basic {self.alice_auth}",
                "Idempotency-Key": "alice-impersonate-1",
            },
            json={
                "original_text": "Landslide on road.",
                "place": "Mandi",
                "type": "Landslide",
                "severity": "High",
                "reporter_name": "Jane Citizen Real",
                "reporter_email": "jane@example.com",
            },
        )
        self.assertEqual(response.status_code, 201)
        report = response.get_json()["report"]
        # Must be attributed to Alice, NOT Jane
        self.assertEqual(report["reporter_name"], "Alice Real")
        self.assertEqual(report["reporter_email"], "alice@example.com")
        self.assertEqual(report["reporter_id"], "USR-ALICE-100")

    # 18. Citizen with Unicode / emoji password authenticates and submits report
    def test_citizen_with_unicode_password_and_emoji_authenticates_and_submits_report(self):
        unicode_email = "unicode@example.com"
        unicode_password = "सुरक्षित_पासवर्ड_123😀"
        unicode_hash = generate_password_hash(unicode_password)

        def mock_get_item_with_unicode(Key, ConsistentRead=False):
            pk = Key.get("PK", "")
            if pk == f"USER#{unicode_email}":
                return {
                    "Item": {
                        "PK": f"USER#{unicode_email}",
                        "SK": "METADATA",
                        "user_id": "USR-UNICODE-99",
                        "name": "Unicode Citizen",
                        "email": unicode_email,
                        "password_hash": unicode_hash,
                        "role": "citizen",
                    }
                }
            if pk.startswith("INCIDENT#"):
                return {"Item": self.sample_incident}
            return {"Item": None}

        self.table.get_item.side_effect = mock_get_item_with_unicode

        raw_creds = f"{unicode_email}:{unicode_password}".encode("utf-8")
        auth_header = f"Basic {base64.b64encode(raw_creds).decode('ascii')}"

        response = self.client.post(
            "/report",
            headers={
                "Authorization": auth_header,
                "Idempotency-Key": "unicode-sub-1",
            },
            json={
                "original_text": "Landslide reported near Mandi.",
                "place": "Mandi",
                "type": "Landslide",
                "severity": "High",
            },
        )
        self.assertEqual(response.status_code, 201)
        data = response.get_json()
        self.assertTrue(data["ok"])
        report = data["report"]
        self.assertEqual(report["reporter_name"], "Unicode Citizen")
        self.assertEqual(report["reporter_email"], unicode_email)
        self.assertEqual(report["reporter_id"], "USR-UNICODE-99")

    # 19. Malformed login inputs return HTTP 400 instead of 500
    def test_malformed_login_inputs_rejected_with_http_400(self):
        cases = [
            # Non-string identifier (int)
            ({"email": 12345, "password": "validpassword"}, 400),
            # Non-string password (list)
            ({"email": "user@example.com", "password": ["not", "string"]}, 400),
            # Non-string password (dict)
            ({"email": "user@example.com", "password": {"pass": "word"}}, 400),
            # Non-dict JSON payload (list)
            ([1, 2, 3], 400),
            # Whitespace-only identifier
            ({"email": "   ", "password": "validpassword"}, 400),
            # Empty password
            ({"email": "user@example.com", "password": ""}, 400),
        ]
        for payload, expected_status in cases:
            response = self.client.post("/auth/login", json=payload)
            self.assertEqual(
                response.status_code,
                expected_status,
                f"Failed for payload: {payload}, got {response.status_code}"
            )
            data = response.get_json()
            self.assertFalse(data["ok"])


if __name__ == "__main__":
    unittest.main()
