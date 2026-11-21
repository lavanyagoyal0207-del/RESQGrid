import json
import os
import unittest
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from unittest.mock import MagicMock, patch
from werkzeug.security import generate_password_hash

import app as backend_app
from intelligence import distance_km


MANALI_PLACE = {
    "PK": "PLACE#Manali",
    "SK": "METADATA",
    "place": "Manali",
    "lat": Decimal("32.2432"),
    "lng": Decimal("77.1892"),
    "district": "Kullu",
}

SHIMLA_PLACE = {
    "PK": "PLACE#Shimla",
    "SK": "METADATA",
    "place": "Shimla",
    "lat": Decimal("31.1048"),
    "lng": Decimal("77.1734"),
    "district": "Shimla",
}


class ClusteringAndVerificationTests(unittest.TestCase):
    def setUp(self):
        self.table = MagicMock()
        self.table.name = "ResQGrid"
        self.table.meta.client.transact_write_items = MagicMock()
        self.table.get_item.return_value = {"Item": None}
        self.table.scan.return_value = {"Items": [MANALI_PLACE, SHIMLA_PLACE]}

        self.operator_hash = generate_password_hash("test-pass")
        self.patches = [
            patch.object(backend_app, "table", self.table),
            patch.object(backend_app, "get_brief_item", return_value=None),
            patch.dict(
                os.environ,
                {"RESQGRID_OPERATOR_PASSWORD_HASHES": json.dumps({"control-operator": self.operator_hash})}
            ),
            patch.object(
                backend_app,
                "authenticate_citizen",
                return_value=({
                    "user_id": "USR-CITIZEN-001",
                    "name": "Citizen Ramesh",
                    "email": "ramesh@example.com",
                    "role": "citizen",
                }, None),
            ),
        ]
        for p in self.patches:
            p.start()
            self.addCleanup(p.stop)

        self.client = backend_app.app.test_client()

    def operator_auth(self):
        return patch.object(
            backend_app,
            "authenticate_operator",
            return_value=("control-operator", None),
        )

    def test_ten_manali_flood_reports_cluster_into_one_incident(self):
        """10 flood reports around Manali within 15 km cluster into 1 incident with report_count = 10."""
        # Coordinates around Manali within 15km
        manali_coords = [
            (Decimal("32.2432"), Decimal("77.1892")),  # Manali Center
            (Decimal("32.2530"), Decimal("77.1850")),  # Old Manali (~1.2 km)
            (Decimal("32.2610"), Decimal("77.1980")),  # Vashisht (~2.1 km)
            (Decimal("32.2350"), Decimal("77.1890")),  # Aleo (~0.9 km)
            (Decimal("32.1950"), Decimal("77.2020")),  # Jagatsukh (~5.5 km)
            (Decimal("32.2700"), Decimal("77.1850")),  # Bahang (~3.0 km)
            (Decimal("32.2480"), Decimal("77.1810")),  # Dhungri (~0.9 km)
            (Decimal("32.2900"), Decimal("77.1680")),  # Palchan (~5.6 km)
            (Decimal("32.3160"), Decimal("77.1580")),  # Solang Valley (~8.6 km)
            (Decimal("32.1450"), Decimal("77.1700")),  # Naggar (~11.0 km)
        ]

        now = datetime.now(timezone.utc)
        items_in_db = [MANALI_PLACE, SHIMLA_PLACE]

        # First report creates the incident
        rep1 = {
            "report_id": "REP-MANALI-01",
            "type": "Flood",
            "place": "Manali",
            "lat": manali_coords[0][0],
            "lng": manali_coords[0][1],
            "severity": "Medium",
            "original_text": "Water levels rising near Mall Road Manali.",
            "created_at": now.isoformat(),
        }
        res1 = backend_app.associate_report_with_incident(rep1, items=items_in_db)
        incident = res1["_incident"]
        self.assertEqual(incident["report_count"], 1)
        self.assertEqual(res1["verification_status"], "Unverified")
        inc_id = incident["incident_id"]

        # Put the created incident into items_in_db so subsequent reports can match it
        items_in_db.append(incident)

        # Subsequent 9 reports cluster into the same incident
        for i, (lat, lng) in enumerate(manali_coords[1:], start=2):
            rep_time = now + timedelta(minutes=i)
            rep = {
                "report_id": f"REP-MANALI-{i:02d}",
                "type": "Flood",
                "place": "Manali",
                "lat": lat,
                "lng": lng,
                "severity": "High" if i % 2 == 0 else "Medium",
                "original_text": f"Severe flood waters reported at site {i}.",
                "created_at": rep_time.isoformat(),
            }
            res = backend_app.associate_report_with_incident(rep, items=items_in_db)
            self.assertEqual(res["incident_id"], inc_id, f"Report {i} should cluster into {inc_id}")
            self.assertEqual(res["verification_status"], "Corroborated")
            self.assertIn("Grouped with", res["grouping_reason"])

        # The incident now aggregates all 10 reports and escalated to High severity
        self.assertEqual(incident["report_count"], 10)
        self.assertEqual(len(incident["report_ids"]), 10)
        self.assertEqual(incident["severity"], "High")

    def test_three_reports_cluster_into_one_incident_and_escalate(self):
        """Phase 4 verification: 3 simulated reports within 15km and 30m cluster into 1 incident,
        escalating status from Unverified to Corroborated and severity from Low to High,
        persisting all items in DynamoDB atomically via TransactWriteItems."""
        now = datetime.now(timezone.utc)
        items_in_db = [MANALI_PLACE, SHIMLA_PLACE]

        # Report 1: Low severity, Flood in Manali (T0)
        rep1 = {
            "report_id": "REP-CLUSTER-01",
            "type": "Flood",
            "place": "Manali",
            "lat": Decimal("32.2432"),
            "lng": Decimal("77.1892"),
            "severity": "Low",
            "original_text": "Water puddle forming near Mall Road Manali.",
            "created_at": now.isoformat(),
        }

        res1 = backend_app.associate_report_with_incident(rep1, items=items_in_db)
        incident = res1["_incident"]
        inc_id = incident["incident_id"]

        # Verify Report 1 creates incident in Unverified state with severity Low
        self.assertEqual(incident["report_count"], 1)
        self.assertEqual(incident["report_ids"], ["REP-CLUSTER-01"])
        self.assertEqual(incident["status"], "Unverified")
        self.assertEqual(incident["severity"], "Low")
        self.assertEqual(res1["verification_status"], "Unverified")
        self.assertEqual(res1["incident_id"], inc_id)

        # Verify DynamoDB TransactWriteItems for initial incident creation
        self.table.meta.client.transact_write_items.assert_called()
        last_call_args = self.table.meta.client.transact_write_items.call_args[1]
        transact_items = last_call_args["TransactItems"]
        self.assertEqual(len(transact_items), 2)
        # First op is Put Report, second is Put Incident
        self.assertIn("Put", transact_items[0])
        self.assertIn("Put", transact_items[1])
        report_put = transact_items[0]["Put"]
        incident_put = transact_items[1]["Put"]
        self.assertEqual(report_put["TableName"], "ResQGrid")
        self.assertEqual(report_put["Item"]["PK"], {"S": "REPORT#REP-CLUSTER-01"})
        self.assertEqual(report_put["Item"]["SK"], {"S": "METADATA"})
        self.assertEqual(incident_put["TableName"], "ResQGrid")
        self.assertEqual(incident_put["Item"]["PK"], {"S": f"INCIDENT#{inc_id}"})
        self.assertEqual(incident_put["Item"]["SK"], {"S": "METADATA"})

        # Put newly created incident into DB items so subsequent reports find it
        items_in_db.append(incident)

        # Report 2: Medium severity, Flood in Manali, 10 minutes later (+10m <= 30m window)
        rep2_time = now + timedelta(minutes=10)
        rep2 = {
            "report_id": "REP-CLUSTER-02",
            "type": "Flood",
            "place": "Manali",
            "lat": Decimal("32.2530"),  # ~1.2 km away (<= 15 km threshold)
            "lng": Decimal("77.1850"),
            "severity": "Medium",
            "original_text": "Water rising rapidly near Beas River bridge.",
            "created_at": rep2_time.isoformat(),
        }

        res2 = backend_app.associate_report_with_incident(rep2, items=items_in_db)

        # Verify Report 2 clusters into the same incident
        self.assertEqual(res2["incident_id"], inc_id)
        self.assertEqual(res2["verification_status"], "Corroborated")
        self.assertIn("Grouped with", res2["grouping_reason"])

        # Verify Incident escalates to Corroborated and Medium severity, report_count = 2
        self.assertEqual(incident["report_count"], 2)
        self.assertEqual(incident["report_ids"], ["REP-CLUSTER-01", "REP-CLUSTER-02"])
        self.assertEqual(incident["status"], "Corroborated")
        self.assertEqual(incident["severity"], "Medium")

        # Verify TransactWriteItems uses Update for incident
        last_call_args = self.table.meta.client.transact_write_items.call_args[1]
        transact_items = last_call_args["TransactItems"]
        self.assertIn("Put", transact_items[0])
        self.assertIn("Update", transact_items[1])
        incident_update = transact_items[1]["Update"]
        self.assertIn("list_append", incident_update["UpdateExpression"])
        self.assertIn("report_count", incident_update["UpdateExpression"])

        # Verify prior report was updated to Corroborated
        self.table.update_item.assert_called()

        # Report 3: High severity, Flood in Manali, 20 minutes later (+20m <= 30m window)
        rep3_time = now + timedelta(minutes=20)
        rep3 = {
            "report_id": "REP-CLUSTER-03",
            "type": "Flood",
            "place": "Manali",
            "lat": Decimal("32.2610"),  # ~2.1 km away (<= 15 km threshold)
            "lng": Decimal("77.1980"),
            "severity": "High",
            "original_text": "Houses inundated near Vashisht, urgent response required.",
            "created_at": rep3_time.isoformat(),
        }

        res3 = backend_app.associate_report_with_incident(rep3, items=items_in_db)

        # Verify Report 3 clusters into the same incident
        self.assertEqual(res3["incident_id"], inc_id)
        self.assertEqual(res3["verification_status"], "Corroborated")

        # Verify Incident has exactly 3 reports and severity escalated to High (highest)
        self.assertEqual(incident["report_count"], 3)
        self.assertEqual(incident["report_ids"], ["REP-CLUSTER-01", "REP-CLUSTER-02", "REP-CLUSTER-03"])
        self.assertEqual(incident["status"], "Corroborated")
        self.assertEqual(incident["severity"], "High")

    def test_clustering_temporal_spatial_type_and_rejection_boundaries(self):
        """Demonstrate that reports outside spatial/temporal thresholds, with different types,
        or matching rejected incidents do NOT cluster and create separate incidents."""
        now = datetime.now(timezone.utc)
        active_incident = {
            "PK": "INCIDENT#INC-ACTIVE-01",
            "SK": "METADATA",
            "incident_id": "INC-ACTIVE-01",
            "type": "Flood",
            "place": "Manali",
            "lat": Decimal("32.2432"),
            "lng": Decimal("77.1892"),
            "severity": "Medium",
            "status": "Corroborated",
            "report_ids": ["REP-BASE"],
            "report_count": 1,
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
            "last_report_at": now.isoformat(),
        }
        rejected_incident = {
            "PK": "INCIDENT#INC-REJECTED-02",
            "SK": "METADATA",
            "incident_id": "INC-REJECTED-02",
            "type": "Flood",
            "place": "Manali",
            "lat": Decimal("32.2432"),
            "lng": Decimal("77.1892"),
            "severity": "High",
            "status": "Rejected",
            "report_ids": ["REP-REJECTED-BASE"],
            "report_count": 1,
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
            "last_report_at": now.isoformat(),
        }
        items = [MANALI_PLACE, SHIMLA_PLACE, active_incident, rejected_incident]

        # 1. Temporal boundary: 35 minutes later (> 30 min threshold)
        late_report = {
            "report_id": "REP-LATE-01",
            "type": "Flood",
            "place": "Manali",
            "lat": Decimal("32.2432"),
            "lng": Decimal("77.1892"),
            "severity": "Medium",
            "original_text": "Flooding hours later.",
            "created_at": (now + timedelta(minutes=35)).isoformat(),
        }
        res_late = backend_app.associate_report_with_incident(late_report, items=items)
        self.assertNotEqual(res_late["incident_id"], "INC-ACTIVE-01")
        self.assertEqual(res_late["verification_status"], "Unverified")
        self.assertIn("Created", res_late["grouping_reason"])

        # 2. Spatial boundary: Shimla is ~125 km away (> 15 km threshold)
        distant_report = {
            "report_id": "REP-DISTANT-01",
            "type": "Flood",
            "place": "Shimla",
            "lat": Decimal("31.1048"),
            "lng": Decimal("77.1734"),
            "severity": "Medium",
            "original_text": "Flooding in Shimla.",
            "created_at": (now + timedelta(minutes=5)).isoformat(),
        }
        res_distant = backend_app.associate_report_with_incident(distant_report, items=items)
        self.assertNotEqual(res_distant["incident_id"], "INC-ACTIVE-01")
        self.assertEqual(res_distant["verification_status"], "Unverified")

        # 3. Type boundary: Landslide instead of Flood (same place, within 5 min)
        type_mismatch_report = {
            "report_id": "REP-TYPE-01",
            "type": "Landslide",
            "place": "Manali",
            "lat": Decimal("32.2432"),
            "lng": Decimal("77.1892"),
            "severity": "High",
            "original_text": "Landslide on hill.",
            "created_at": (now + timedelta(minutes=5)).isoformat(),
        }
        res_type = backend_app.associate_report_with_incident(type_mismatch_report, items=items)
        self.assertNotEqual(res_type["incident_id"], "INC-ACTIVE-01")
        self.assertEqual(res_type["verification_status"], "Unverified")

        # 4. Rejection exclusion: A report arriving when ONLY the rejected incident exists
        # must NOT cluster with the rejected incident
        items_only_rejected = [MANALI_PLACE, rejected_incident]
        fresh_report = {
            "report_id": "REP-FRESH-01",
            "type": "Flood",
            "place": "Manali",
            "lat": Decimal("32.2432"),
            "lng": Decimal("77.1892"),
            "severity": "Medium",
            "original_text": "Fresh flood report.",
            "created_at": (now + timedelta(minutes=5)).isoformat(),
        }
        res_fresh = backend_app.associate_report_with_incident(fresh_report, items=items_only_rejected)
        self.assertNotEqual(res_fresh["incident_id"], "INC-REJECTED-02")
        self.assertEqual(res_fresh["verification_status"], "Unverified")
        self.assertIn("Created", res_fresh["grouping_reason"])

    def test_unrelated_report_creates_separate_incident(self):
        """Unrelated report (different place > 15 km distant or different type) creates a separate incident."""
        now = datetime.now(timezone.utc)
        existing_incident = {
            "PK": "INCIDENT#INC-MANALI",
            "SK": "METADATA",
            "incident_id": "INC-MANALI",
            "type": "Flood",
            "place": "Manali",
            "lat": Decimal("32.2432"),
            "lng": Decimal("77.1892"),
            "severity": "High",
            "status": "Corroborated",
            "report_ids": ["REP-1"],
            "report_count": 1,
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
            "last_report_at": now.isoformat(),
        }
        items = [MANALI_PLACE, SHIMLA_PLACE, existing_incident]

        # Case 1: Different location (Shimla is ~125 km away)
        shimla_report = {
            "report_id": "REP-SHIMLA-01",
            "type": "Flood",
            "place": "Shimla",
            "lat": Decimal("31.1048"),
            "lng": Decimal("77.1734"),
            "severity": "Medium",
            "original_text": "Flooding near Shimla bypass.",
            "created_at": (now + timedelta(minutes=5)).isoformat(),
        }
        res_shimla = backend_app.associate_report_with_incident(shimla_report, items=items)
        self.assertNotEqual(res_shimla["incident_id"], "INC-MANALI")
        self.assertEqual(res_shimla["verification_status"], "Unverified")

        # Case 2: Different incident type (Landslide at Manali)
        landslide_report = {
            "report_id": "REP-MANALI-LANDSLIDE",
            "type": "Landslide",
            "place": "Manali",
            "lat": Decimal("32.2432"),
            "lng": Decimal("77.1892"),
            "severity": "Critical",
            "original_text": "Rockfall and landslide blocking highway.",
            "created_at": (now + timedelta(minutes=6)).isoformat(),
        }
        res_landslide = backend_app.associate_report_with_incident(landslide_report, items=items)
        self.assertNotEqual(res_landslide["incident_id"], "INC-MANALI")
        self.assertEqual(res_landslide["verification_status"], "Unverified")

    def test_operator_verification_and_rejection_workflow(self):
        """Operator can verify (Confirmed) and reject (Rejected) reports."""
        mock_report_1 = {
            "PK": "REPORT#REP-CONFIRM-01",
            "SK": "METADATA",
            "report_id": "REP-CONFIRM-01",
            "type": "Flood",
            "place": "Manali",
            "verification_status": "Unverified",
        }
        mock_report_2 = {
            "PK": "REPORT#REP-REJECT-02",
            "SK": "METADATA",
            "report_id": "REP-REJECT-02",
            "type": "Flood",
            "place": "Manali",
            "verification_status": "Unverified",
        }

        def fake_get_item(Key, ConsistentRead=False):
            pk = Key.get("PK", "")
            if pk == "REPORT#REP-CONFIRM-01":
                return {"Item": mock_report_1}
            elif pk == "REPORT#REP-REJECT-02":
                return {"Item": mock_report_2}
            return {"Item": None}

        self.table.get_item.side_effect = fake_get_item

        # 1. Operator confirms report 1
        with self.operator_auth():
            resp = self.client.post(
                "/reports/REP-CONFIRM-01/verification",
                json={"status": "Confirmed"},
            )
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(data["ok"])
        self.assertEqual(data["report"]["verification_status"], "Confirmed")

        # 2. Operator rejects report 2
        with self.operator_auth():
            resp2 = self.client.post(
                "/reports/REP-REJECT-02/verification",
                json={"status": "Rejected"},
            )
        self.assertEqual(resp2.status_code, 200)
        data2 = resp2.get_json()
        self.assertTrue(data2["ok"])
        self.assertEqual(data2["report"]["verification_status"], "Rejected")

    def test_operator_incident_confirmation(self):
        """Operator confirms an entire aggregated incident."""
        mock_incident = {
            "PK": "INCIDENT#INC-TEST-456",
            "SK": "METADATA",
            "incident_id": "INC-TEST-456",
            "type": "Flood",
            "place": "Manali",
            "status": "Corroborated",
            "report_count": 5,
        }
        self.table.get_item.return_value = {"Item": mock_incident}

        with self.operator_auth():
            resp = self.client.post("/incidents/INC-TEST-456/confirm")

        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(data["ok"])
        self.table.update_item.assert_called()

    def test_unauthorized_citizen_blocked_from_operator_endpoints(self):
        """Unauthorized citizen is blocked from verifying reports or confirming incidents."""
        # Without Authorization header, verifying a report must return 401 Unauthorized
        resp = self.client.post(
            "/reports/REP-TEST-123/verification",
            json={"status": "Confirmed"},
        )
        self.assertEqual(resp.status_code, 401)

        # Confirming an incident must return 401 Unauthorized
        resp2 = self.client.post("/incidents/INC-TEST-456/confirm")
        self.assertEqual(resp2.status_code, 401)


if __name__ == "__main__":
    unittest.main()
