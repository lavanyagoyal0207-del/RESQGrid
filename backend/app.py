import os
import tempfile
import uuid
import hashlib
import hmac
import json
import re
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from threading import Lock

from boto3.dynamodb.types import TypeSerializer
from botocore.exceptions import ClientError
from faster_whisper import WhisperModel
from flask import Flask, Response, jsonify, request
from flask_cors import CORS
from werkzeug.exceptions import HTTPException
from werkzeug.security import check_password_hash
from aws_config import table, s3, BUCKET_NAME
from intelligence import (
    compare_reports,
    detect_emerging_patterns,
    is_simulated_record,
    process_report,
    translate_text,
)

app = Flask(__name__)
default_cors_origins = (
    ""
    if os.getenv("RESQGRID_ENV", "development").strip().lower() == "production"
    else "http://localhost:5173,http://127.0.0.1:5173"
)
parsed_origins = [
    origin.strip()
    for origin in os.getenv(
        "RESQGRID_ALLOWED_ORIGINS",
        default_cors_origins,
    ).split(",")
    if origin.strip()
]
print("RESQGRID CORS origins loaded:", parsed_origins, flush=True)
CORS(
    app,
    resources={
        r"/*": {
            "origins": parsed_origins,
            "allow_headers": [
                "Authorization",
                "Content-Type",
                "Idempotency-Key",
            ],
            "methods": ["GET", "POST", "PATCH", "OPTIONS"],
        }
    },
)
app.config["MAX_CONTENT_LENGTH"] = 10 * 1024 * 1024  # 10 MB
app.config["JSON_SORT_KEYS"] = False


@app.errorhandler(HTTPException)
def handle_http_error(error):
    status_code = error.code or 500
    messages = {
        400: "The request is invalid.",
        404: "The requested resource was not found.",
        405: "The request method is not allowed.",
        413: "The request exceeds the maximum allowed size.",
    }
    return jsonify({
        "ok": False,
        "error": messages.get(status_code, "The request could not be completed."),
        "code": error.name.lower().replace(" ", "_"),
    }), status_code


@app.errorhandler(Exception)
def handle_unexpected_error(error):
    app.logger.exception("Unhandled API exception")
    return jsonify({
        "ok": False,
        "error": "An unexpected server error occurred.",
        "code": "internal_server_error",
    }), 500


@app.after_request
def add_security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    return response


WHISPER_MODEL_SIZE = os.getenv("WHISPER_MODEL_SIZE", "base")
REPORT_GROUPING_WINDOW_MINUTES = int(
    os.getenv("REPORT_GROUPING_WINDOW_MINUTES", "30")
)
if REPORT_GROUPING_WINDOW_MINUTES <= 0:
    raise ValueError("REPORT_GROUPING_WINDOW_MINUTES must be positive")

VALID_INCIDENT_TYPES = {"Flood", "Landslide", "Blocked Road"}
VALID_SEVERITIES = {"Critical", "High", "Medium", "Low"}
VALID_RESOURCE_TYPES = {
    "Ambulance",
    "Rescue Team",
    "Medical Supplies",
    "Food and Water",
    "Temporary Shelter",
    "Rescue Equipment"
}
VALID_RESPONSE_STATUSES = {
    "Awaiting Assignment",
    "Assigned",
    "Team Dispatched",
    "Response in Progress",
    "Resolved"
}
_dynamodb_serializer = TypeSerializer()
_whisper_model = None
_whisper_model_lock = Lock()


def get_whisper_model():
    global _whisper_model

    if _whisper_model is None:
        with _whisper_model_lock:
            if _whisper_model is None:
                _whisper_model = WhisperModel(
                    WHISPER_MODEL_SIZE,
                    device="cpu",
                    compute_type="int8"
                )

    return _whisper_model


def transcribe_audio(audio_path):
    segments, info = get_whisper_model().transcribe(
        audio_path,
        beam_size=5
    )
    transcript = " ".join(
        segment.text.strip()
        for segment in segments
        if segment.text.strip()
    ).strip()
    detected_language = getattr(info, "language", None) or "unknown"

    return transcript, detected_language


def convert_numbers(value):
    if isinstance(value, list):
        return [convert_numbers(item) for item in value]

    if isinstance(value, dict):
        return {
            key: convert_numbers(item)
            for key, item in value.items()
            if key not in ("PK", "SK")
        }

    if isinstance(value, Decimal):
        if value % 1 == 0:
            return int(value)
        return float(value)

    return value


def get_all_items():
    items = []
    response = table.scan(ConsistentRead=True)
    items.extend(response.get("Items", []))

    while "LastEvaluatedKey" in response:
        response = table.scan(
            ExclusiveStartKey=response["LastEvaluatedKey"],
            ConsistentRead=True
        )
        items.extend(response.get("Items", []))

    return [
        item for item in items
        if not is_simulated_record(item)
    ]


def get_items_by_prefix(prefix):
    return [
        convert_numbers(item)
        for item in get_all_items()
        if item.get("PK", "").startswith(prefix)
    ]


def get_brief_item():
    response = table.get_item(
        Key={
            "PK": "BRIEF#CURRENT",
            "SK": "METADATA"
        }
    )
    item = response.get("Item")
    return None if is_simulated_record(item) else item


def parse_iso_datetime(value):
    if not isinstance(value, str) or not value:
        return None

    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)

    return parsed.astimezone(timezone.utc)


def get_idempotent_report_id(namespace):
    idempotency_key = request.headers.get("Idempotency-Key")
    if idempotency_key is None:
        if request.is_json:
            payload = request.get_json(silent=True)
            idempotency_key = (
                payload.get("submission_id")
                if isinstance(payload, dict)
                else None
            )
        else:
            idempotency_key = request.form.get("submission_id")

    if idempotency_key is not None:
        if not isinstance(idempotency_key, str):
            return None, (jsonify({
                "ok": False,
                "error": "Idempotency-Key or submission_id must be a string."
            }), 400)
        idempotency_key = idempotency_key.strip()
        if not 8 <= len(idempotency_key) <= 128:
            return None, (jsonify({
                "ok": False,
                "error": (
                    "Idempotency-Key or submission_id must be between "
                    "8 and 128 characters."
                )
            }), 400)
    else:
        return None, (jsonify({
            "ok": False,
            "error": (
                "Provide Idempotency-Key or a stable submission_id so retries "
                "cannot create duplicate reports."
            )
        }), 400)

    digest = hashlib.sha256(
        f"{namespace}:{idempotency_key}".encode("utf-8")
    ).hexdigest()[:20].upper()
    return f"REP-{digest}", None


def has_demo_submission_marker(payload):
    if not isinstance(payload, dict):
        return False
    flags = ("is_demo", "is_simulated", "demo_mode", "simulated")
    if any(
        payload.get(flag) is True
        or (
            isinstance(payload.get(flag), str)
            and payload[flag].strip().casefold()
            in {"true", "1", "demo", "simulated"}
        )
        for flag in flags
    ):
        return True
    return str(payload.get("data_classification", "")).casefold() in {
        "demo", "mock", "simulated"
    }


def get_report(report_id):
    response = table.get_item(
        Key={
            "PK": f"REPORT#{report_id}",
            "SK": "METADATA"
        },
        ConsistentRead=True
    )
    return response.get("Item")


def get_place_by_name(name, items=None):
    if items is None:
        exact_match = table.get_item(
            Key={
                "PK": f"PLACE#{name.strip()}",
                "SK": "METADATA",
            },
            ConsistentRead=True,
        ).get("Item")
        if exact_match and not is_simulated_record(exact_match):
            return exact_match
        items = get_all_items()
    target = name.strip().casefold()

    for item in items:
        if not item.get("PK", "").startswith("PLACE#"):
            continue
        place_name = item.get("place") or item.get("name")
        if isinstance(place_name, str) and place_name.strip().casefold() == target:
            return item

    return None


def normalize_for_dynamodb(values):
    def normalize(value):
        if isinstance(value, float):
            return Decimal(str(value))
        if isinstance(value, list):
            return [normalize(item) for item in value]
        if isinstance(value, dict):
            return {key: normalize(item) for key, item in value.items()}
        return value

    return {
        key: normalize(value)
        for key, value in values.items()
    }


def serialize_for_dynamodb(values):
    return {
        key: _dynamodb_serializer.serialize(value)
        for key, value in normalize_for_dynamodb(values).items()
    }

def valid_entity_id(value):
    return isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,80}", value) is not None


def make_report_operation(report, is_existing):
    key = {
        "PK": f"REPORT#{report['report_id']}",
        "SK": "METADATA"
    }
    if not is_existing:
        return {
            "Put": {
                "TableName": table.name,
                "Item": serialize_for_dynamodb({**key, **report}),
                "ConditionExpression": (
                    "attribute_not_exists(PK) AND attribute_not_exists(SK)"
                )
            }
        }

    mutable_fields = (
        "original_text",
        "translated_text",
        "detected_language",
        "translation_status",
        "analysis_status",
        "analysis",
        "transcription_status",
        "review_status",
        "verification_status",
        "incident_id",
        "grouping_reason",
        "lat",
        "lng",
    )
    update_values = {
        f":value_{field}": report[field]
        for field in mutable_fields
        if field in report
    }
    update_expression = "SET " + ", ".join(
        f"{field} = :value_{field}"
        for field in mutable_fields
        if field in report
    )
    return {
        "Update": {
            "TableName": table.name,
            "Key": serialize_for_dynamodb(key),
            "UpdateExpression": update_expression,
            "ExpressionAttributeValues": serialize_for_dynamodb(update_values),
            "ConditionExpression": "attribute_exists(PK)"
        }
    }


def associate_report_with_incident(report, is_existing=False, items=None):
    all_items = items if items is not None else get_all_items()
    all_items = [
        item for item in all_items
        if not is_simulated_record(item)
    ]
    place_record = get_place_by_name(report["place"], all_items)
    if not place_record:
        raise ValueError("Place is not in the configured location list.")

    report["place"] = place_record.get("place") or place_record.get("name")
    report["lat"] = place_record.get("lat")
    report["lng"] = place_record.get("lng")
    report_time = parse_iso_datetime(report["created_at"])
    matching_incidents = []

    for incident in all_items:
        if not incident.get("PK", "").startswith("INCIDENT#"):
            continue
        if incident.get("type", "").casefold() != report["type"].casefold():
            continue
        if incident.get("place", "").casefold() != report["place"].casefold():
            continue
        if incident.get("status") == "Rejected":
            continue

        incident_time = parse_iso_datetime(
            incident.get("last_report_at")
            or incident.get("updated_at")
            or incident.get("created_at")
        )
        if not incident_time or not report_time:
            continue

        distance = abs(report_time - incident_time)
        if distance <= timedelta(minutes=REPORT_GROUPING_WINDOW_MINUTES):
            matching_incidents.append((distance, incident))

    matching_incidents.sort(key=lambda candidate: candidate[0])

    if matching_incidents:
        distance, incident = matching_incidents[0]
        incident_id = incident["incident_id"]
        report["verification_status"] = "Corroborated"
        report["grouping_reason"] = (
            f"Grouped with {incident_id}: same type ({report['type']}) and "
            f"location ({report['place']}); report arrived within "
            f"{REPORT_GROUPING_WINDOW_MINUTES} minutes "
            f"({int(distance.total_seconds())} seconds) of its latest "
            "associated report."
        )
        report["incident_id"] = incident_id

        incident_status = incident.get("status", "Unverified")
        if incident_status not in ("Confirmed", "Rejected"):
            incident_status = "Corroborated"

        severity_order = {"Low": 0, "Medium": 1, "High": 2, "Critical": 3}
        current_severity = incident.get("severity", "Low")
        severity = max(
            (current_severity, report["severity"]),
            key=lambda value: severity_order.get(value, 0)
        )
        incident_operation = {
            "Update": {
                "TableName": table.name,
                "Key": serialize_for_dynamodb({
                    "PK": f"INCIDENT#{incident_id}",
                    "SK": "METADATA"
                }),
                "UpdateExpression": (
                    "SET report_ids = list_append("
                    "if_not_exists(report_ids, :empty), :new_report), "
                    "report_count = if_not_exists(report_count, :zero) + :one, "
                    "#status = :status, severity = :severity, "
                    "updated_at = :updated, last_report_at = :updated, "
                    "grouping_reason = :reason"
                ),
                "ExpressionAttributeNames": {"#status": "status"},
                "ExpressionAttributeValues": serialize_for_dynamodb({
                    ":empty": [],
                    ":new_report": [report["report_id"]],
                    ":zero": 0,
                    ":one": 1,
                    ":status": incident_status,
                    ":severity": severity,
                    ":updated": report["created_at"],
                    ":reason": report["grouping_reason"]
                }),
                "ConditionExpression": "attribute_exists(PK)"
            }
        }
    else:
        incident_id = f"INC-{uuid.uuid4().hex[:10].upper()}"
        report["incident_id"] = incident_id
        report["verification_status"] = "Unverified"
        report["grouping_reason"] = (
            f"Created {incident_id}: no non-rejected incident with the same "
            f"type ({report['type']}) and location ({report['place']}) had "
            f"a report within {REPORT_GROUPING_WINDOW_MINUTES} minutes."
        )
        incident = {
            "incident_id": incident_id,
            "type": report["type"],
            "place": report["place"],
            "lat": place_record.get("lat"),
            "lng": place_record.get("lng"),
            "severity": report["severity"],
            "status": "Unverified",
            "summary": report["original_text"],
            "report_ids": [report["report_id"]],
            "report_count": 1,
            "grouping_reason": report["grouping_reason"],
            "created_at": report["created_at"],
            "updated_at": report["created_at"],
            "last_report_at": report["created_at"],
            "data_classification": "operational"
        }
        incident_operation = {
            "Put": {
                "TableName": table.name,
                "Item": serialize_for_dynamodb({
                    "PK": f"INCIDENT#{incident_id}",
                    "SK": "METADATA",
                    **incident
                }),
                "ConditionExpression": (
                    "attribute_not_exists(PK) AND attribute_not_exists(SK)"
                )
            }
        }

    report_operation = make_report_operation(report, is_existing)
    try:
        table.meta.client.transact_write_items(
            TransactItems=[report_operation, incident_operation]
        )
    except ClientError as error:
        first_operation_type = next(iter(report_operation))
        app.logger.error(
            "DynamoDB report/incident transaction failed; "
            "first operation=%s; response=%r",
            first_operation_type,
            error.response,
        )
        raise

    if matching_incidents:
        for report_id in incident.get("report_ids", []):
            if report_id == report["report_id"]:
                continue
            try:
                table.update_item(
                    Key={
                        "PK": f"REPORT#{report_id}",
                        "SK": "METADATA"
                    },
                    UpdateExpression=(
                        "SET verification_status = :corroborated, "
                        "grouping_reason = :reason"
                    ),
                    ExpressionAttributeValues={
                        ":corroborated": "Corroborated",
                        ":reason": report["grouping_reason"],
                        ":unverified": "Unverified"
                    },
                    ConditionExpression=(
                        "attribute_not_exists(verification_status) OR "
                        "verification_status = :unverified"
                    )
                )
            except Exception:
                app.logger.exception(
                    "Could not update corroboration for report %s",
                    report_id
                )

    return report


def get_operator_credentials():
    raw_credentials = os.getenv("RESQGRID_OPERATOR_PASSWORD_HASHES", "").strip()
    if not raw_credentials:
        return None, "Operator authentication is not configured."

    try:
        credentials = json.loads(raw_credentials)
    except json.JSONDecodeError:
        return None, "Operator authentication configuration is invalid."

    if not isinstance(credentials, dict) or not credentials:
        return None, "Operator authentication configuration is invalid."

    if any(
        not isinstance(username, str)
        or not username.strip()
        or not isinstance(password_hash, str)
        or not password_hash
        for username, password_hash in credentials.items()
    ):
        return None, "Operator authentication configuration is invalid."

    return credentials, None


def verify_operator_password(expected_hash, password):
    if re.fullmatch(r"[a-fA-F0-9]{64}", expected_hash):
        supplied_hash = hashlib.sha256(password.encode("utf-8")).hexdigest()
        return hmac.compare_digest(expected_hash.casefold(), supplied_hash)
    try:
        return check_password_hash(expected_hash, password)
    except (TypeError, ValueError):
        return False


def get_operator_role(username):
    raw_roles = os.getenv("RESQGRID_OPERATOR_ROLES", "").strip()
    if not raw_roles:
        return "operator", None

    try:
        roles = json.loads(raw_roles)
    except json.JSONDecodeError:
        return None, "Operator role configuration is invalid."
    if (
        not isinstance(roles, dict)
        or any(
            not isinstance(name, str)
            or role not in ("viewer", "operator", "administrator")
            for name, role in roles.items()
        )
    ):
        return None, "Operator role configuration is invalid."
    return roles.get(username, "viewer"), None


def authenticate_operator(required_role="operator"):
    credentials, configuration_error = get_operator_credentials()
    if configuration_error:
        return None, (jsonify({
            "ok": False,
            "error": configuration_error
        }), 503)

    auth = request.authorization
    if not auth or not auth.username or auth.password is None:
        return None, (jsonify({
            "ok": False,
            "error": "Operator credentials are required."
        }), 401)

    expected_hash = credentials.get(auth.username)
    if not expected_hash or not verify_operator_password(
        expected_hash,
        auth.password
    ):
        return None, (jsonify({
            "ok": False,
            "error": "Operator credentials are invalid."
        }), 401)

    role, role_configuration_error = get_operator_role(auth.username)
    if role_configuration_error:
        return None, (jsonify({
            "ok": False,
            "error": role_configuration_error
        }), 503)
    role_levels = {"viewer": 0, "operator": 1, "administrator": 2}
    if role_levels[role] < role_levels[required_role]:
        return None, (jsonify({
            "ok": False,
            "error": "This operator role is not permitted to perform the action."
        }), 403)

    return auth.username, None


def public_report(report):
    result = convert_numbers(report)
    audio_s3_key = result.pop("audio_s3_key", None)
    result["has_audio"] = bool(audio_s3_key)
    result.setdefault("verification_status", "Unverified")
    return result


def enrich_report(report, place_items, source_language=None):
    place_names = [
        item.get("place") or item.get("name")
        for item in place_items
        if item.get("PK", "").startswith("PLACE#")
        and (item.get("place") or item.get("name"))
    ]
    try:
        analysis = process_report(
            report.get("original_text", ""),
            place_names,
            source_language=source_language,
        )
    except Exception:
        app.logger.exception(
            "Report analysis failed for %s",
            report.get("report_id", "unknown"),
        )
        analysis = {
            "pipeline_version": "1",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "verification_status": "Unverified",
            "language": {
                "code": "unknown",
                "name": "Unknown",
                "confidence": 0.0,
            },
            "translation": {
                "text": None,
                "status": "Failed",
                "model": None,
                "error": "The local analysis pipeline failed.",
            },
            "fields": {},
        }

    translation = analysis.get("translation", {})
    report["analysis"] = analysis
    report["detected_language"] = analysis.get("language", {}).get(
        "code", "unknown"
    )
    report["translated_text"] = translation.get("text") or ""
    report["translation_status"] = translation.get("status", "Unavailable")
    report["analysis_status"] = (
        "Failed" if not analysis.get("fields") else "Completed"
    )
    report["review_status"] = "Needs Human Review"
    report.setdefault("verification_status", "Unverified")
    if translation.get("error"):
        app.logger.warning(
            "Translation %s for report %s: %s",
            translation.get("status", "failed"),
            report.get("report_id", "unknown"),
            translation["error"],
        )
        translation["error"] = (
            "The local translation model is unavailable or failed; no "
            "translated text has been added."
        )
    return report


def mark_brief_needs_review():
    brief = get_brief_item()
    if not brief or brief.get("status") == "Archived":
        return
    if brief.get("status") in ("Approved", "Approved by Human Operator"):
        table.update_item(
            Key={
                "PK": "BRIEF#CURRENT",
                "SK": "METADATA"
            },
            UpdateExpression=(
                "SET new_data_available = :available, "
                "new_data_received_at = :received_at"
            ),
            ExpressionAttributeValues={
                ":available": True,
                ":received_at": datetime.now(timezone.utc).isoformat(),
            },
        )
    else:
        table.update_item(
            Key={
                "PK": "BRIEF#CURRENT",
                "SK": "METADATA"
            },
            UpdateExpression="SET #status = :status",
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":status": "Draft — Needs Human Review"
            }
        )


def generate_situation_brief(
    incidents,
    reports,
    resources=None,
    patterns=None,
    comparisons=None,
):
    incidents = [
        incident for incident in incidents
        if not is_simulated_record(incident)
    ]
    reports = [
        report for report in reports
        if not is_simulated_record(report)
    ]
    report_ids = {
        report.get("report_id") for report in reports
        if report.get("report_id")
    }
    resources = resources or []
    patterns = patterns or {"patterns": []}
    comparisons = comparisons or []
    patterns = {
        **patterns,
        "patterns": [
            pattern for pattern in patterns.get("patterns", [])
            if pattern.get("supporting_report_ids")
            and set(pattern["supporting_report_ids"]).issubset(report_ids)
        ],
    }
    active_incidents = [
        incident for incident in incidents
        if incident.get("status") != "Rejected"
        and incident.get("response_status") != "Resolved"
    ]
    report_by_id = {report.get("report_id"): report for report in reports}
    affected_locations = sorted({
        incident.get("place", "Unknown")
        for incident in active_incidents
    })
    high_severity = [
        incident for incident in active_incidents
        if incident.get("severity") in ("High", "Critical")
    ]
    confirmed_reports = [
        report for report in reports
        if report.get("verification_status") == "Confirmed"
    ]
    rejected_reports = [
        report for report in reports
        if report.get("verification_status") == "Rejected"
    ]
    unverified_reports = [
        report for report in reports
        if report.get("verification_status", "Unverified")
        in ("Unverified", "Corroborated")
    ]
    corroborated_incidents = [
        incident for incident in active_incidents
        if len(incident.get("report_ids", [])) > 1
    ]
    corroboration_count = sum(
        1 for incident in corroborated_incidents
        for report_id in incident.get("report_ids", [])
        if report_id in report_by_id
    )

    high_summary = (
        ", ".join(
            f"{incident.get('place', 'Unknown')} "
            f"({incident.get('type', 'Incident')}, "
            f"{incident.get('severity', 'High')})"
            for incident in high_severity
        )
        if high_severity else "None currently marked High or Critical"
    )
    locations_summary = ", ".join(affected_locations) or "None"
    report_noun = "report" if len(reports) == 1 else "reports"
    report_verb = "is" if len(reports) == 1 else "are"
    incident_noun = "incident" if len(active_incidents) == 1 else "incidents"
    text = (
        f"Current situation: {len(reports)} individual {report_noun} {report_verb} on "
        f"record across {len(active_incidents)} active {incident_noun}. "
        "Affected locations: "
        f"{locations_summary}. High-severity incidents: {high_summary}. "
        f"{corroboration_count} reports are in multi-report corroborating "
        f"groups. Verification: {len(confirmed_reports)} reports are "
        f"human-confirmed; {len(unverified_reports)} remain unverified or "
        f"corroborated and require human review; "
        f"{len(rejected_reports)} have been human-rejected. "
        "Unverified/corroborated observations are not confirmed facts."
    )

    def report_fields(report):
        return (report.get("analysis") or {}).get("fields") or {}

    def field_value(report, field_name):
        field = report_fields(report).get(field_name)
        if (
            isinstance(field, dict)
            and field.get("verification_status") == "Human Corrected"
        ):
            return field.get("value", "Unknown")
        return "Unknown"

    confirmed_ids = [
        report.get("report_id")
        for report in confirmed_reports
        if report.get("report_id")
    ]
    unverified_ids = [
        report.get("report_id")
        for report in unverified_reports
        if report.get("report_id")
    ]
    known_people = [
        (report, field_value(report, "people_affected"))
        for report in confirmed_reports
    ]
    known_people = [
        (report, count)
        for report, count in known_people
        if isinstance(count, int) and not isinstance(count, bool)
    ]
    verified_damage = [
        (report, field_value(report, "infrastructure_damage"))
        for report in confirmed_reports
    ]
    verified_damage = [
        (report, damage)
        for report, damage in verified_damage
        if isinstance(damage, list) and damage and "Unknown" not in damage
    ]
    unknown_fields = [
        report.get("report_id")
        for report in reports
        if any(
            field.get("value") == "Unknown"
            for field in report_fields(report).values()
            if isinstance(field, dict)
        )
    ]
    available_resources = [
        resource for resource in resources
        if resource.get("status", "Available") == "Available"
    ]
    deployed_resources = [
        resource for resource in resources
        if resource.get("status") == "Deployed"
    ]
    pattern_records = patterns.get("patterns", [])
    conflicting_comparisons = [
        comparison
        for comparison in comparisons
        if comparison.get("classification") != "Potential Duplicate"
        and (
            comparison.get("severity_conflict")
            or comparison.get("contradictory_evidence")
        )
    ]
    conflicting_ids = list(dict.fromkeys(
        report_id
        for comparison in conflicting_comparisons
        for report_id in comparison.get("report_ids", [])
        if report_id
    ))
    conflict_summary = (
        f"{len(conflicting_comparisons)} potential conflicting report pairs need review."
        if conflicting_comparisons
        else "No explicit cross-report conflicts were detected by current rules."
    )
    pattern_text = (
        "; ".join(
            pattern.get("description", "")
            for pattern in pattern_records
            if pattern.get("description")
        )
        or "No patterns met the current evidence thresholds."
    )
    recommended_actions = [
        "Review unverified reports and original evidence.",
        "Resolve conflicting report details before issuing public guidance.",
        "An authorized operator must make all verification and dispatch decisions.",
    ]
    if not available_resources:
        recommended_actions.append(
            "Check the resource registry; no available resource is recorded."
        )
    all_current_ids = list(dict.fromkeys(confirmed_ids + unverified_ids))
    sections = [
        {
            "key": "executive_summary",
            "title": "Executive Summary",
            "text": text,
            "report_ids": all_current_ids,
            "verification": "Verified and unverified evidence are labeled separately.",
        },
        {
            "key": "current_emergency_situation",
            "title": "Current Emergency Situation",
            "text": (
                f"{len(active_incidents)} active incidents and {len(reports)} "
                f"individual reports are stored. {len(confirmed_reports)} reports "
                "are human-confirmed; other reports remain unverified, "
                f"corroborated, or rejected. {conflict_summary}"
            ),
            "report_ids": list(dict.fromkeys(all_current_ids + conflicting_ids)),
            "verification": "Mixed; see report statuses and supporting IDs.",
        },
        {
            "key": "high_priority_incidents",
            "title": "High-Priority Incidents",
            "text": high_summary,
            "report_ids": [
                report_id
                for incident in high_severity
                for report_id in incident.get("report_ids", [])
            ],
            "incident_ids": [
                incident.get("incident_id") for incident in high_severity
            ],
            "verification": "Incident severity labels require operator review.",
        },
        {
            "key": "affected_locations",
            "title": "Affected Locations",
            "text": locations_summary,
            "report_ids": all_current_ids,
            "verification": "Locations come from stored report and incident records.",
        },
        {
            "key": "people_potentially_at_risk",
            "title": "People Potentially at Risk",
            "text": (
                f"{sum(count for _, count in known_people)} explicitly mentioned "
                "people across human-confirmed reports."
                if known_people
                else "Unknown — no explicit affected-person count is available in human-confirmed reports."
            ),
            "report_ids": [report.get("report_id") for report, _ in known_people],
            "verification": "Counts use only human-confirmed reports and explicit numbers.",
        },
        {
            "key": "infrastructure_damage",
            "title": "Infrastructure Damage",
            "text": (
                "; ".join(
                    f"{report.get('report_id')}: {', '.join(damage)}"
                    for report, damage in verified_damage
                )
                if verified_damage
                else "Unknown — no infrastructure damage is recorded in human-confirmed analysis."
            ),
            "report_ids": [
                report.get("report_id") for report, _ in verified_damage
            ],
            "verification": "Only human-confirmed report extractions are included.",
        },
        {
            "key": "available_emergency_resources",
            "title": "Available Emergency Resources",
            "text": (
                f"{len(available_resources)} resources are recorded as available; "
                f"{len(deployed_resources)} as deployed."
                if resources
                else "Unknown — the resource registry contains no records."
            ),
            "report_ids": [],
            "verification": "Registry state only; confirm operational availability with operators.",
        },
        {
            "key": "resource_shortages",
            "title": "Resource Shortages",
            "text": "Unknown — resource demand and inventory coverage have not been independently validated.",
            "report_ids": [],
            "verification": "No shortage is inferred from missing data.",
        },
        {
            "key": "emerging_patterns",
            "title": "Emerging Patterns",
            "text": pattern_text,
            "report_ids": list(dict.fromkeys(
                report_id
                for pattern in pattern_records
                for report_id in pattern.get("supporting_report_ids", [])
            )),
            "verification": "Heuristic anomaly indicators; not validated predictions.",
        },
        {
            "key": "recommended_operator_actions",
            "title": "Recommended Operator Actions",
            "text": " ".join(recommended_actions),
            "report_ids": all_current_ids,
            "verification": "Recommendations only; no dispatch or publication is automatic.",
        },
        {
            "key": "missing_conflicting_information",
            "title": "Missing or Conflicting Information",
            "text": (
                f"{len(unknown_fields)} reports have at least one extraction marked "
                f"Unknown. {conflict_summary}"
            ),
            "report_ids": list(dict.fromkeys(unknown_fields + conflicting_ids)),
            "verification": "Rule-based flags only; inspect original reports before resolution.",
        },
    ]

    return {
        "title": "Current Situation Brief",
        "text": text,
        "status": "Draft — Needs Human Review",
        "state": "draft",
        "version_id": str(uuid.uuid4()),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "report_count": len(reports),
        "incident_count": len(active_incidents),
        "affected_locations": affected_locations,
        "high_severity_incidents": [
            incident.get("incident_id") for incident in high_severity
        ],
        "confirmed_report_count": len(confirmed_reports),
        "unverified_report_count": len(unverified_reports),
        "rejected_report_count": len(rejected_reports),
        "corroborating_report_count": corroboration_count,
        "supporting_report_ids": all_current_ids,
        "missing_information_report_ids": list(dict.fromkeys(unknown_fields)),
        "conflicting_report_ids": conflicting_ids,
        "sections": sections,
    }


def build_risk_assessment(incidents, reports, places, now=None):
    now = now or datetime.now(timezone.utc)
    window = timedelta(minutes=30)
    place_by_name = {
        (place.get("place") or place.get("name", "")).casefold(): place
        for place in places
        if isinstance(place.get("place") or place.get("name"), str)
    }
    active_incidents = [
        incident for incident in incidents
        if incident.get("status") != "Rejected"
    ]
    rejected_report_ids = {
        report_id
        for incident in incidents
        if incident.get("status") == "Rejected"
        for report_id in incident.get("report_ids", [])
    }
    rejected_report_ids.update(
        report.get("report_id")
        for report in reports
        if report.get("verification_status") == "Rejected"
    )
    report_times = {}
    for report in reports:
        if (
            report.get("report_id") in rejected_report_ids
            or report.get("verification_status") == "Rejected"
        ):
            continue
        report_time = parse_iso_datetime(report.get("created_at"))
        place = report.get("place")
        if report_time and isinstance(place, str):
            report_times.setdefault(place.casefold(), []).append(report_time)

    incidents_by_place = {}
    for incident in active_incidents:
        place = incident.get("place")
        if isinstance(place, str):
            incidents_by_place.setdefault(place.casefold(), []).append(incident)

    location_keys = set(place_by_name) | set(incidents_by_place) | set(report_times)
    locations = []
    for key in sorted(location_keys):
        location_incidents = incidents_by_place.get(key, [])
        times = report_times.get(key, [])
        recent_count = sum(now - window <= item <= now for item in times)
        prior_count = sum(now - (window * 2) <= item < now - window for item in times)
        high_count = sum(
            incident.get("severity") in ("High", "Critical")
            for incident in location_incidents
        )
        total_reports = sum(
            sum(
                report_id not in rejected_report_ids
                for report_id in incident.get("report_ids", [])
            )
            for incident in location_incidents
        )
        reasons = []
        if high_count >= 2:
            reasons.append(
                f"{high_count} active incidents are marked High or Critical."
            )
        if recent_count > prior_count:
            reasons.append(
                f"Report frequency increased from {prior_count} to "
                f"{recent_count} in consecutive 30-minute windows."
            )
        if len(location_incidents) >= 2:
            reasons.append(
                f"{len(location_incidents)} active incidents are concentrated here."
            )

        place_record = place_by_name.get(key, {})
        latitude = next(
            (
                incident.get("lat") for incident in location_incidents
                if incident.get("lat") is not None
            ),
            place_record.get("lat")
        )
        longitude = next(
            (
                incident.get("lng") for incident in location_incidents
                if incident.get("lng") is not None
            ),
            place_record.get("lng")
        )
        locations.append({
            "place": place_record.get("place") or place_record.get("name")
                or (location_incidents[0].get("place") if location_incidents else key),
            "lat": latitude,
            "lng": longitude,
            "incident_count": len(location_incidents),
            "report_count": max(total_reports, len(times)),
            "recent_report_count": recent_count,
            "previous_report_count": prior_count,
            "high_severity_incident_count": high_count,
            "requires_attention": bool(reasons),
            "reasons": reasons
        })

    return {
        "label": "AI-generated recommendation — requires human review",
        "generated_at": now.isoformat(),
        "window_minutes": 30,
        "locations": locations
    }


@app.route("/voice-report", methods=["POST"])
def submit_voice_report():
    allowed_formats = {
        "webm": "audio/webm",
        "wav": "audio/wav",
        "mp3": "audio/mpeg",
        "ogg": "audio/ogg",
        "m4a": "audio/mp4",
        "mp4": "audio/mp4"
    }

    if has_demo_submission_marker(request.form.to_dict()):
        return jsonify({
            "ok": False,
            "error": "Simulated reports cannot be submitted to operational storage."
        }), 400

    report_id, idempotency_error = get_idempotent_report_id("voice")
    if idempotency_error:
        return idempotency_error

    existing_report = get_report(report_id)
    if existing_report:
        return jsonify({
            "ok": True,
            "duplicate": True,
            "message": "This voice report was already submitted.",
            "report": public_report(existing_report)
        }), 200

    audio_file = request.files.get("audio")
    if not audio_file or not audio_file.filename:
        return jsonify({
            "ok": False,
            "error": "Audio file is required."
        }), 400

    extension = audio_file.filename.rsplit(".", 1)[-1].lower()

    if extension not in allowed_formats:
        return jsonify({
            "ok": False,
            "error": "Unsupported audio format"
        }), 400

    if audio_file.mimetype not in (
        allowed_formats[extension],
        "application/octet-stream"
    ):
        return jsonify({
            "ok": False,
            "error": "Invalid audio content type"
        }), 400

    # Read the audio and check its actual size
    audio_data = audio_file.read()

    if not audio_data:
        return jsonify({
            "ok": False,
            "error": "Audio file is empty"
        }), 400

    if len(audio_data) > 10 * 1024 * 1024:
        return jsonify({
            "ok": False,
            "error": "Audio file must be smaller than 10 MB"
        }), 400

    place = request.form.get("place", "").strip()
    inc_type = request.form.get("type", "").strip()
    severity = request.form.get("severity", "").strip()
    if not place or not inc_type or not severity:
        return jsonify({
            "ok": False,
            "error": "Place, type and severity are required"
        }), 400

    if not isinstance(inc_type, str) or inc_type not in VALID_INCIDENT_TYPES:
        return jsonify({"ok": False, "error": "Invalid incident type."}), 400
    if not isinstance(severity, str) or severity not in VALID_SEVERITIES:
        return jsonify({"ok": False, "error": "Invalid severity."}), 400

    intelligence_items = get_all_items()
    place_record = get_place_by_name(place, intelligence_items)
    if not place_record:
        return jsonify({"ok": False, "error": "Unknown report location."}), 400
    place = place_record.get("place") or place_record.get("name")

    s3_key = f"voice-reports/{report_id}.{extension}"
    now_iso = datetime.now(timezone.utc).isoformat()

    voice_report = {
        "report_id": report_id,
        "source": "Voice",
        "original_text": "",
        "translated_text": "",
        "lat": place_record.get("lat"),
        "lng": place_record.get("lng"),
        "type": inc_type,
        "place": place,
        "severity": severity,
        "created_at": now_iso,
        "audio_s3_key": s3_key,
        "audio_format": extension,
        "audio_content_type": allowed_formats[extension],
        "detected_language": "unknown",
        "transcription_status": "Pending",
        "review_status": "Needs Human Review",
        "verification_status": "Unverified",
        "data_classification": "operational"
    }

    try:
        table.put_item(
            Item={
                "PK": f"REPORT#{report_id}",
                "SK": "METADATA",
                **voice_report
            },
            ConditionExpression=(
                "attribute_not_exists(PK) AND attribute_not_exists(SK)"
            )
        )
    except Exception:
        existing_report = get_report(report_id)
        if existing_report:
            return jsonify({
                "ok": True,
                "duplicate": True,
                "message": "This voice report was already submitted.",
                "report": public_report(existing_report)
            }), 200
        app.logger.exception("Voice report metadata save failed for %s", report_id)
        return jsonify({"ok": False, "error": "Report metadata could not be saved."}), 500

    try:
        s3.put_object(
            Bucket=BUCKET_NAME,
            Key=s3_key,
            Body=audio_data,
            ContentType=allowed_formats[extension],
            ServerSideEncryption="AES256"
        )
    except Exception:
        app.logger.exception("Voice audio upload failed for report %s", report_id)
        try:
            table.update_item(
                Key={"PK": f"REPORT#{report_id}", "SK": "METADATA"},
                UpdateExpression="SET transcription_status = :failed",
                ExpressionAttributeValues={":failed": "Failed"}
            )
        except Exception:
            app.logger.exception("Could not update failed audio upload status for %s", report_id)
        return jsonify({
            "ok": False,
            "error": "The report record was saved, but audio upload failed."
        }), 500

    temporary_audio_path = None
    try:
        with tempfile.NamedTemporaryFile(
            suffix=f".{extension}",
            delete=False
        ) as temporary_audio:
            temporary_audio.write(audio_data)
            temporary_audio_path = temporary_audio.name

        transcript, detected_language = transcribe_audio(
            temporary_audio_path
        )
        transcription_status = "Completed"
        transcription_message = "Audio uploaded and transcription completed."
    except Exception:
        app.logger.exception("Whisper transcription failed for report %s", report_id)
        transcript = ""
        detected_language = "unknown"
        transcription_status = "Failed"
        transcription_message = (
            "Audio and report metadata were saved, but transcription failed. "
            "The original recording is retained for human review."
        )
    finally:
        if temporary_audio_path:
            try:
                os.remove(temporary_audio_path)
            except OSError:
                app.logger.exception(
                    "Could not remove temporary audio file for report %s",
                    report_id
                )

    voice_report.update({
        "original_text": transcript,
        "detected_language": detected_language,
        "transcription_status": transcription_status,
        "review_status": "Needs Human Review",
        "verification_status": "Unverified"
    })
    enrich_report(
        voice_report,
        intelligence_items,
        source_language=detected_language,
    )

    try:
        associate_report_with_incident(
            voice_report,
            is_existing=True,
            items=intelligence_items,
        )
        mark_brief_needs_review()
    except Exception:
        app.logger.exception("Could not associate voice report %s with incident", report_id)
        try:
            table.update_item(
                Key={"PK": f"REPORT#{report_id}", "SK": "METADATA"},
                UpdateExpression=(
                    "SET original_text = :text, detected_language = :language, "
                    "transcription_status = :transcription_status, "
                    "review_status = :review_status"
                ),
                ExpressionAttributeValues={
                    ":text": transcript,
                    ":language": detected_language,
                    ":transcription_status": transcription_status,
                    ":review_status": "Needs Human Review"
                }
            )
        except Exception:
            app.logger.exception("Could not save transcription for report %s", report_id)
        return jsonify({
            "ok": False,
            "error": (
                "The recording and report were saved, but incident grouping "
                "could not be completed. The report remains available for review."
            ),
            "report": public_report(voice_report)
        }), 500

    return jsonify({
        "ok": True,
        "message": transcription_message,
        "report": public_report(voice_report)
    }), 200
@app.route("/incidents", methods=["GET"])
def get_incidents():
    _, error = authenticate_operator(required_role="viewer")
    if error:
        return error

    items = get_all_items()
    incidents = [
        convert_numbers(item)
        for item in items
        if item.get("PK", "").startswith("INCIDENT#")
    ]
    reports = [
        public_report(item)
        for item in items
        if item.get("PK", "").startswith("REPORT#")
    ]
    places = [
        convert_numbers(item)
        for item in items
        if item.get("PK", "").startswith("PLACE#")
    ]
    place_by_name = {
        (place.get("place") or place.get("name", "")).casefold(): place
        for place in places
        if isinstance(place.get("place") or place.get("name"), str)
    }
    resources = [
        convert_numbers(item)
        for item in items
        if item.get("PK", "").startswith("RESOURCE#")
    ]
    brief_item = next(
        (item for item in items if item.get("PK") == "BRIEF#CURRENT"),
        None
    )

    for incident in incidents:
        incident_place = incident.get("place")
        place_record = place_by_name.get(
            incident_place.casefold(),
            {}
        ) if isinstance(incident_place, str) else {}
        if incident.get("lat") is None:
            incident["lat"] = place_record.get("lat")
        if incident.get("lng") is None:
            incident["lng"] = place_record.get("lng")
        incident.setdefault("response_status", "Awaiting Assignment")
        incident.setdefault("response_history", [])
        incident.setdefault("response_assignments", [])
        incident["report_count"] = max(
            incident.get("report_count", 0),
            len(incident.get("report_ids", []))
        )

    reports.sort(
        key=lambda report: report.get("created_at", ""),
        reverse=True
    )

    return jsonify({
        "incidents": incidents,
        "reports": reports,
        "places": places,
        "resources": resources,
        "brief": convert_numbers(brief_item) if brief_item else None,
        "risk_assessment": build_risk_assessment(
            incidents,
            reports,
            places
        )
    })


def load_intelligence_snapshot():
    items = [
        item for item in get_all_items()
        if not is_simulated_record(item)
    ]
    incidents = [
        convert_numbers(item)
        for item in items
        if item.get("PK", "").startswith("INCIDENT#")
    ]
    reports = [
        public_report(item)
        for item in items
        if item.get("PK", "").startswith("REPORT#")
    ]
    places = [
        convert_numbers(item)
        for item in items
        if item.get("PK", "").startswith("PLACE#")
    ]
    return items, incidents, reports, places


@app.route("/intelligence/compare", methods=["GET"])
def get_report_comparisons():
    _, error = authenticate_operator(required_role="viewer")
    if error:
        return error

    raw_window = request.args.get("window_minutes", "60")
    try:
        window_minutes = int(raw_window)
    except (TypeError, ValueError):
        return jsonify({
            "ok": False,
            "error": "window_minutes must be an integer between 1 and 360.",
        }), 400
    if not 1 <= window_minutes <= 360:
        return jsonify({
            "ok": False,
            "error": "window_minutes must be between 1 and 360.",
        }), 400

    _, incidents, reports, places = load_intelligence_snapshot()
    return jsonify({
        "label": (
            "Potential evidence comparisons only; similar reports are not "
            "proof and are never automatically deleted or confirmed."
        ),
        "window_minutes": window_minutes,
        "comparisons": compare_reports(
            reports,
            incidents,
            places,
            window_minutes=window_minutes,
        ),
    })


@app.route("/intelligence/patterns", methods=["GET"])
def get_intelligence_patterns():
    _, error = authenticate_operator(required_role="viewer")
    if error:
        return error

    _, incidents, reports, places = load_intelligence_snapshot()
    return jsonify(detect_emerging_patterns(reports, incidents, places))


@app.route("/reports/<report_id>/analysis-corrections", methods=["PATCH"])
def correct_report_analysis(report_id):
    operator, error = authenticate_operator()
    if error:
        return error
    if not valid_entity_id(report_id):
        return jsonify({"ok": False, "error": "Invalid report ID."}), 400

    payload = request.get_json(silent=True)
    corrections = payload.get("fields") if isinstance(payload, dict) else None
    if not isinstance(corrections, dict) or not corrections:
        return jsonify({
            "ok": False,
            "error": "A non-empty fields object is required.",
        }), 400
    allowed_fields = {
        "incident_type",
        "location",
        "severity",
        "people_affected",
        "immediate_threats",
        "infrastructure_damage",
        "urgent_resource_requirements",
    }
    if set(corrections) - allowed_fields:
        return jsonify({
            "ok": False,
            "error": "One or more analysis fields cannot be edited.",
        }), 400

    report = get_report(report_id)
    if not report:
        return jsonify({"ok": False, "error": "Report not found."}), 404

    known_places = [
        item.get("place") or item.get("name")
        for item in get_all_items()
        if item.get("PK", "").startswith("PLACE#")
    ]
    field_values = {}
    for field_name, value in corrections.items():
        if field_name == "incident_type":
            valid = isinstance(value, str) and (
                value == "Unknown" or value in VALID_INCIDENT_TYPES
            )
        elif field_name == "severity":
            valid = isinstance(value, str) and (
                value == "Unknown" or value in VALID_SEVERITIES
            )
        elif field_name == "location":
            valid = isinstance(value, str) and (
                value == "Unknown" or value in known_places
            )
        elif field_name == "people_affected":
            valid = (
                value == "Unknown"
                or isinstance(value, int) and not isinstance(value, bool) and value >= 0
            )
        elif field_name in (
            "immediate_threats",
            "infrastructure_damage",
            "urgent_resource_requirements",
        ):
            valid = value == "Unknown" or (
                isinstance(value, list)
                and len(value) <= 8
                and all(
                    isinstance(item, str) and 0 < len(item) <= 100
                    for item in value
                )
            )
        else:
            valid = False
        if not valid:
            return jsonify({
                "ok": False,
                "error": f"Invalid value for analysis field: {field_name}.",
            }), 400
        field_values[field_name] = value

    analysis = convert_numbers(report.get("analysis") or {})
    fields = analysis.setdefault("fields", {})
    analysis.setdefault("ai_fields", {
        key: dict(value) if isinstance(value, dict) else value
        for key, value in fields.items()
    })
    for field_name, value in field_values.items():
        fields[field_name] = {
            "value": value,
            "evidence": [],
            "confidence": 1.0,
            "verification_status": "Human Corrected",
            "source": "Authorized operator",
        }
    corrected_at = datetime.now(timezone.utc).isoformat()
    analysis["human_correction"] = {
        "operator": operator,
        "corrected_at": corrected_at,
        "fields": list(field_values),
    }

    try:
        table.update_item(
            Key={"PK": f"REPORT#{report_id}", "SK": "METADATA"},
            UpdateExpression=(
                "SET analysis = :analysis, analysis_status = :analysis_status, "
                "analysis_corrected_by = :operator, "
                "analysis_corrected_at = :corrected_at"
            ),
            ExpressionAttributeValues=normalize_for_dynamodb({
                ":analysis": analysis,
                ":analysis_status": "Human Corrected",
                ":operator": operator,
                ":corrected_at": corrected_at,
            }),
            ConditionExpression="attribute_exists(PK)",
        )
    except Exception:
        app.logger.exception("Report analysis correction failed for %s", report_id)
        return jsonify({
            "ok": False,
            "error": "The analysis correction could not be saved.",
        }), 500

    report.update({
        "analysis": analysis,
        "analysis_status": "Human Corrected",
        "analysis_corrected_by": operator,
        "analysis_corrected_at": corrected_at,
    })
    return jsonify({"ok": True, "report": public_report(report)})


@app.route("/operator/session", methods=["POST"])
def operator_session():
    operator, error = authenticate_operator(required_role="viewer")
    if error:
        return error
    role, role_error = get_operator_role(operator)
    if role_error:
        return jsonify({"ok": False, "error": role_error}), 503
    return jsonify({"ok": True, "operator": operator, "role": role})


@app.route("/reports/<report_id>/verification", methods=["POST"])
def verify_report(report_id):
    operator, error = authenticate_operator()
    if error:
        return error

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or payload.get("status") not in (
        "Confirmed",
        "Rejected"
    ):
        return jsonify({
            "ok": False,
            "error": "Status must be Confirmed or Rejected."
        }), 400

    report = get_report(report_id)
    if not report:
        return jsonify({"ok": False, "error": "Report not found."}), 404

    current_status = report.get("verification_status", "Unverified")
    if current_status in ("Confirmed", "Rejected"):
        return jsonify({
            "ok": False,
            "error": f"Report is already {current_status.lower()}."
        }), 409

    new_status = payload["status"]
    verified_at = datetime.now(timezone.utc).isoformat()
    try:
        table.update_item(
            Key={
                "PK": f"REPORT#{report_id}",
                "SK": "METADATA"
            },
            UpdateExpression=(
                "SET #verification_status = :status, "
                "verified_by = :operator, verified_at = :verified_at, "
                "review_status = :review_status"
            ),
            ExpressionAttributeNames={
                "#verification_status": "verification_status"
            },
            ExpressionAttributeValues={
                ":status": new_status,
                ":operator": operator,
                ":verified_at": verified_at,
                ":review_status": "Reviewed",
                ":unverified": "Unverified",
                ":corroborated": "Corroborated"
            },
            ConditionExpression=(
                "attribute_not_exists(#verification_status) OR "
                "#verification_status = :unverified OR "
                "#verification_status = :corroborated"
            )
        )
    except Exception:
        app.logger.exception("Verification update failed for report %s", report_id)
        return jsonify({
            "ok": False,
            "error": "The verification decision could not be saved."
        }), 500

    report.update({
        "verification_status": new_status,
        "verified_by": operator,
        "verified_at": verified_at,
        "review_status": "Reviewed"
    })
    return jsonify({"ok": True, "report": public_report(report)})


@app.route("/reports/<report_id>/audio", methods=["GET"])
def get_report_audio(report_id):
    _, error = authenticate_operator()
    if error:
        return error

    report = get_report(report_id)
    if not report:
        return jsonify({"ok": False, "error": "Report not found."}), 404

    audio_s3_key = report.get("audio_s3_key")
    if not audio_s3_key:
        return jsonify({"ok": False, "error": "This report has no audio."}), 404

    try:
        audio_object = s3.get_object(Bucket=BUCKET_NAME, Key=audio_s3_key)
        audio_bytes = audio_object["Body"].read()
    except Exception:
        app.logger.exception("Private audio retrieval failed for report %s", report_id)
        return jsonify({
            "ok": False,
            "error": "The original recording could not be retrieved."
        }), 502

    return Response(
        audio_bytes,
        mimetype=report.get("audio_content_type", "application/octet-stream"),
        headers={
            "Cache-Control": "private, no-store",
            "Content-Disposition": "inline",
            "X-Content-Type-Options": "nosniff"
        }
    )


@app.route("/incidents/<incident_id>/confirm", methods=["POST"])
def confirm_incident(incident_id):
    operator, error = authenticate_operator()
    if error:
        return error

    response = table.get_item(
        Key={
            "PK": f"INCIDENT#{incident_id}",
            "SK": "METADATA"
        },
        ConsistentRead=True
    )

    incident = response.get("Item")

    if not incident:
        return jsonify({
            "ok": False,
            "error": "Incident not found"
        }), 404

    now_iso = datetime.now(timezone.utc).isoformat()

    try:
        table.update_item(
            Key={
                "PK": f"INCIDENT#{incident_id}",
                "SK": "METADATA"
            },
            UpdateExpression=(
                "SET #status = :status, confirmed_by = :operator, "
                "confirmed_at = :updated, updated_at = :updated"
            ),
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":status": "Confirmed",
                ":operator": operator,
                ":updated": now_iso
            }
        )
    except Exception:
        app.logger.exception("Incident confirmation failed for %s", incident_id)
        return jsonify({
            "ok": False,
            "error": "The incident confirmation could not be saved."
        }), 500

    incident["status"] = "Confirmed"
    incident["confirmed_by"] = operator
    incident["confirmed_at"] = now_iso
    incident["updated_at"] = now_iso

    return jsonify({
        "ok": True,
        "incident": convert_numbers(incident)
    })


@app.route("/report", methods=["POST"])
def submit_report():
    payload = request.get_json(silent=True) or {}

    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": "A JSON object is required."}), 400
    if has_demo_submission_marker(payload):
        return jsonify({
            "ok": False,
            "error": "Simulated reports cannot be submitted to operational storage."
        }), 400

    original_text = payload.get("original_text")
    place = payload.get("place")
    inc_type = payload.get("type")
    severity = payload.get("severity")

    if not isinstance(original_text, str) or not original_text.strip():
        return jsonify({
            "ok": False,
            "error": "original_text is required"
        }), 400
    original_text = original_text.strip()
    if len(original_text) > 5000:
        return jsonify({
            "ok": False,
            "error": "original_text must be 5000 characters or fewer."
        }), 400
    if not isinstance(place, str) or not place.strip():
        return jsonify({"ok": False, "error": "A valid place is required."}), 400
    if not isinstance(inc_type, str) or inc_type not in VALID_INCIDENT_TYPES:
        return jsonify({"ok": False, "error": "Invalid incident type."}), 400
    if not isinstance(severity, str) or severity not in VALID_SEVERITIES:
        return jsonify({"ok": False, "error": "Invalid severity."}), 400

    report_id, idempotency_error = get_idempotent_report_id("text")
    if idempotency_error:
        return idempotency_error

    existing_report = get_report(report_id)
    if existing_report:
        return jsonify({
            "ok": True,
            "duplicate": True,
            "message": "This report was already submitted.",
            "report": public_report(existing_report)
        }), 200

    intelligence_items = get_all_items()
    place_record = get_place_by_name(place, intelligence_items)
    if not place_record:
        return jsonify({"ok": False, "error": "Unknown report location."}), 400
    place = place_record.get("place") or place_record.get("name")

    now_iso = datetime.now(timezone.utc).isoformat()

    new_report = {
        "report_id": report_id,
        "source": "Citizen Field Report",
        "original_text": original_text,
        "lat": place_record.get("lat"),
        "lng": place_record.get("lng"),
        "type": inc_type,
        "place": place,
        "severity": severity,
        "created_at": now_iso,
        "verification_status": "Unverified",
        "review_status": "Needs Human Review",
        "data_classification": "operational"
    }
    enrich_report(new_report, intelligence_items)

    try:
        associate_report_with_incident(new_report, items=intelligence_items)
    except Exception:
        existing_report = get_report(report_id)
        if existing_report:
            return jsonify({
                "ok": True,
                "duplicate": True,
                "message": "This report was already submitted.",
                "report": public_report(existing_report)
            }), 200
        app.logger.exception("Report submission failed for %s", report_id)
        return jsonify({
            "ok": False,
            "error": "The report and incident association could not be saved."
        }), 500

    try:
        mark_brief_needs_review()
    except Exception:
        app.logger.exception("Report saved but current brief could not be marked for review")
        return jsonify({
            "ok": False,
            "error": (
                "The report was saved, but the current brief could not be "
                "marked for review."
            ),
            "report": public_report(new_report),
        }), 500

    return jsonify({"ok": True, "report": public_report(new_report)}), 201


@app.route("/brief/generate", methods=["POST"])
def generate_brief():
    operator, error = authenticate_operator()
    if error:
        return error

    items, incidents, reports, places = load_intelligence_snapshot()
    resources = [
        convert_numbers(item)
        for item in items
        if item.get("PK", "").startswith("RESOURCE#")
    ]
    patterns = detect_emerging_patterns(reports, incidents, places)
    comparisons = compare_reports(reports, incidents, places)
    brief = generate_situation_brief(
        incidents,
        reports,
        resources=resources,
        patterns=patterns,
        comparisons=comparisons,
    )
    brief.update({
        "generated_by": operator,
        "PK": "BRIEF#CURRENT",
        "SK": "METADATA",
        "new_data_available": False,
    })

    try:
        current_brief = get_brief_item()
        if current_brief and current_brief.get("status") in (
            "Approved",
            "Approved by Human Operator",
        ):
            archived = {
                **convert_numbers(current_brief),
                "PK": f"BRIEF#ARCHIVE#{current_brief.get('version_id') or uuid.uuid4()}",
                "SK": "METADATA",
                "status": "Archived",
                "state": "archived",
                "archived_at": datetime.now(timezone.utc).isoformat(),
                "archived_reason": "Superseded by a newly generated draft.",
            }
            table.meta.client.transact_write_items(
                TransactItems=[
                    {
                        "Put": {
                            "TableName": table.name,
                            "Item": serialize_for_dynamodb(archived),
                            "ConditionExpression": (
                                "attribute_not_exists(PK) AND attribute_not_exists(SK)"
                            ),
                        }
                    },
                    {
                        "Put": {
                            "TableName": table.name,
                            "Item": serialize_for_dynamodb(brief),
                        }
                    },
                ]
            )
        else:
            table.put_item(Item=normalize_for_dynamodb(brief))
    except Exception:
        app.logger.exception("Situation brief generation could not be saved")
        return jsonify({
            "ok": False,
            "error": "The generated situation brief could not be saved."
        }), 500

    return jsonify(convert_numbers(brief))


@app.route("/brief", methods=["PATCH"])
def edit_brief():
    operator, error = authenticate_operator()
    if error:
        return error

    payload = request.get_json(silent=True)
    edits = payload.get("sections") if isinstance(payload, dict) else None
    if not isinstance(edits, dict) or not edits:
        return jsonify({
            "ok": False,
            "error": "A non-empty sections object is required.",
        }), 400
    brief = get_brief_item()
    if not brief:
        return jsonify({"ok": False, "error": "No situation brief is available."}), 404
    if brief.get("status") not in ("Draft — Needs Human Review", "Draft"):
        return jsonify({
            "ok": False,
            "error": "Only a draft brief can be edited.",
        }), 409

    sections = convert_numbers(brief.get("sections") or [])
    if not isinstance(sections, list):
        return jsonify({
            "ok": False,
            "error": "The stored brief sections are invalid.",
        }), 500
    section_by_key = {
        section.get("key"): section
        for section in sections
        if isinstance(section, dict)
    }
    if set(edits) - set(section_by_key):
        return jsonify({
            "ok": False,
            "error": "One or more brief section keys are invalid.",
        }), 400
    for key, text in edits.items():
        if not isinstance(text, str) or not text.strip() or len(text) > 5000:
            return jsonify({
                "ok": False,
                "error": f"Section {key} must contain 1 to 5000 characters.",
            }), 400
        section_by_key[key]["text"] = text.strip()

    if "executive_summary" in edits:
        brief["text"] = section_by_key["executive_summary"]["text"]
    edited_at = datetime.now(timezone.utc).isoformat()
    try:
        table.update_item(
            Key={"PK": "BRIEF#CURRENT", "SK": "METADATA"},
            UpdateExpression=(
                "SET sections = :sections, edited_at = :edited_at, "
                "edited_by = :operator, #text = :text"
            ),
            ExpressionAttributeNames={
                "#text": "text",
                "#status": "status",
            },
            ExpressionAttributeValues=normalize_for_dynamodb({
                ":sections": sections,
                ":edited_at": edited_at,
                ":operator": operator,
                ":text": brief.get("text", ""),
                ":draft": brief.get("status"),
            }),
            ConditionExpression="#status = :draft",
        )
    except Exception:
        app.logger.exception("Situation brief editing failed")
        return jsonify({
            "ok": False,
            "error": "The situation brief edits could not be saved.",
        }), 409

    brief.update({
        "sections": sections,
        "edited_at": edited_at,
        "edited_by": operator,
    })
    return jsonify({"ok": True, "brief": convert_numbers(brief)})


@app.route("/brief/approve", methods=["POST"])
def approve_brief():
    operator, error = authenticate_operator()
    if error:
        return error

    brief = get_brief_item()
    if not brief:
        return jsonify({
            "ok": False,
            "error": "No situation brief is available to approve."
        }), 404
    if brief.get("status") in ("Approved", "Approved by Human Operator"):
        return jsonify({
            "ok": False,
            "error": "This brief has already been approved."
        }), 409
    if brief.get("status") not in ("Draft — Needs Human Review", "Draft"):
        return jsonify({
            "ok": False,
            "error": "Only a draft brief can be approved.",
        }), 409

    approved_at = datetime.now(timezone.utc).isoformat()
    try:
        table.update_item(
            Key={
                "PK": "BRIEF#CURRENT",
                "SK": "METADATA"
            },
            UpdateExpression=(
                "SET #status = :status, #state = :state, "
                "approved_by = :operator, approved_at = :approved_at"
            ),
            ExpressionAttributeNames={
                "#status": "status",
                "#state": "state",
            },
            ExpressionAttributeValues={
                ":status": "Approved",
                ":state": "approved",
                ":operator": operator,
                ":approved_at": approved_at,
                ":draft": brief.get("status"),
            },
            ConditionExpression="#status = :draft"
        )
    except Exception:
        app.logger.exception("Situation brief approval could not be saved")
        return jsonify({
            "ok": False,
            "error": "The brief approval could not be saved."
        }), 500

    brief.update({
        "status": "Approved",
        "state": "approved",
        "approved_by": operator,
        "approved_at": approved_at
    })
    return jsonify(convert_numbers(brief))


@app.route("/resources", methods=["GET"])
def list_resources():
    _, error = authenticate_operator(required_role="viewer")
    if error:
        return error

    resources = get_items_by_prefix("RESOURCE#")
    resources.sort(key=lambda resource: resource.get("created_at", ""), reverse=True)
    return jsonify({"resources": resources})


@app.route("/resources", methods=["POST"])
def create_resource():
    operator, error = authenticate_operator()
    if error:
        return error

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": "A JSON object is required."}), 400

    resource_type = payload.get("type")
    name = payload.get("name")
    quantity = payload.get("quantity")
    if resource_type not in VALID_RESOURCE_TYPES:
        return jsonify({"ok": False, "error": "Invalid resource type."}), 400
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 120:
        return jsonify({
            "ok": False,
            "error": "Resource name is required and must be 120 characters or fewer."
        }), 400
    if isinstance(quantity, bool) or not isinstance(quantity, int) or not 1 <= quantity <= 10000:
        return jsonify({
            "ok": False,
            "error": "Quantity must be an integer between 1 and 10000."
        }), 400

    now = datetime.now(timezone.utc).isoformat()
    resource_id = f"RES-{uuid.uuid4().hex[:12].upper()}"
    resource = {
        "resource_id": resource_id,
        "type": resource_type,
        "name": name.strip(),
        "total_quantity": quantity,
        "available_quantity": quantity,
        "deployed_quantity": 0,
        "unavailable_quantity": 0,
        "status": "Available",
        "deployments": [],
        "history": [{
            "action": "Resource Created",
            "operator": operator,
            "timestamp": now
        }],
        "created_by": operator,
        "created_at": now,
        "updated_at": now
    }

    try:
        table.put_item(
            Item={
                "PK": f"RESOURCE#{resource_id}",
                "SK": "METADATA",
                **resource
            },
            ConditionExpression=(
                "attribute_not_exists(PK) AND attribute_not_exists(SK)"
            )
        )
    except Exception:
        app.logger.exception("Resource creation failed for %s", resource_id)
        return jsonify({
            "ok": False,
            "error": "The resource could not be saved."
        }), 500

    return jsonify({"ok": True, "resource": resource}), 201


@app.route("/resources/<resource_id>", methods=["PATCH"])
def update_resource(resource_id):
    operator, error = authenticate_operator()
    if error:
        return error

    if not valid_entity_id(resource_id):
        return jsonify({"ok": False, "error": "Invalid resource ID."}), 400

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": "A JSON object is required."}), 400
    action = payload.get("action")
    if action not in {"update", "available", "unavailable", "return"}:
        return jsonify({"ok": False, "error": "Invalid resource action."}), 400

    response = table.get_item(
        Key={"PK": f"RESOURCE#{resource_id}", "SK": "METADATA"},
        ConsistentRead=True
    )
    resource = response.get("Item")
    if not resource:
        return jsonify({"ok": False, "error": "Resource not found."}), 404

    now = datetime.now(timezone.utc).isoformat()
    total = int(resource.get("total_quantity", resource.get("quantity", 0)))
    available = int(resource.get("available_quantity", total))
    deployed = int(resource.get("deployed_quantity", 0))
    unavailable = int(resource.get("unavailable_quantity", 0))
    history = list(resource.get("history", []))
    deployments = list(resource.get("deployments", []))
    history_entry = {
        "action": action.title(),
        "operator": operator,
        "timestamp": now
    }

    if action == "unavailable":
        if deployed:
            return jsonify({
                "ok": False,
                "error": "Return deployed units before marking this resource unavailable."
            }), 409
        unavailable += available
        available = 0
    elif action == "available":
        available += unavailable
        unavailable = 0
    elif action == "return":
        deployment_id = payload.get("deployment_id")
        deployment_index = next(
            (
                index for index, deployment in enumerate(deployments)
                if deployment.get("deployment_id") == deployment_id
                and deployment.get("status") != "Returned"
            ),
            None
        )
        if deployment_index is None:
            return jsonify({
                "ok": False,
                "error": "Active deployment was not found."
            }), 404

        deployment = dict(deployments[deployment_index])
        returned_quantity = int(deployment["quantity"])
        if returned_quantity > deployed:
            return jsonify({
                "ok": False,
                "error": "Resource deployment quantities are inconsistent."
            }), 409

        incident_id = deployment["incident_id"]
        incident_response = table.get_item(
            Key={"PK": f"INCIDENT#{incident_id}", "SK": "METADATA"},
            ConsistentRead=True
        ).get("Item")
        if not incident_response:
            return jsonify({
                "ok": False,
                "error": "The associated incident no longer exists."
            }), 409

        deployment["status"] = "Returned"
        deployment["returned_at"] = now
        deployments[deployment_index] = deployment
        deployed -= returned_quantity
        available += returned_quantity
        history_entry.update({
            "deployment_id": deployment_id,
            "incident_id": incident_id,
            "quantity": returned_quantity
        })
        history.append(history_entry)
        incident_history = {
            "action": "Resource Returned",
            "deployment_id": deployment_id,
            "resource_id": resource_id,
            "resource_name": resource.get("name"),
            "quantity": returned_quantity,
            "operator": operator,
            "timestamp": now
        }

        resource_values = {
            ":available": available,
            ":deployed": deployed,
            ":unavailable": unavailable,
            ":status": (
                "Deployed" if deployed
                else "Available" if available
                else "Unavailable"
            ),
            ":deployments": deployments,
            ":history": history,
            ":updated": now,
            ":old_updated": resource.get("updated_at"),
        }
        incident_values = {
            ":empty": [],
            ":event": [incident_history],
            ":updated": now,
            ":old_updated": incident_response.get("updated_at"),
        }
        resource_update = {
            "Update": {
                "TableName": table.name,
                "Key": serialize_for_dynamodb({
                    "PK": f"RESOURCE#{resource_id}",
                    "SK": "METADATA"
                }),
                "UpdateExpression": (
                    "SET available_quantity = :available, "
                    "deployed_quantity = :deployed, "
                    "unavailable_quantity = :unavailable, #status = :status, "
                    "deployments = :deployments, history = :history, updated_at = :updated"
                ),
                "ExpressionAttributeNames": {"#status": "status"},
                "ExpressionAttributeValues": serialize_for_dynamodb(resource_values),
                "ConditionExpression": "updated_at = :old_updated"
            }
        }
        incident_update = {
            "Update": {
                "TableName": table.name,
                "Key": serialize_for_dynamodb({
                    "PK": f"INCIDENT#{incident_id}",
                    "SK": "METADATA"
                }),
                "UpdateExpression": (
                    "SET response_history = list_append("
                    "if_not_exists(response_history, :empty), :event), "
                    "updated_at = :updated"
                ),
                "ExpressionAttributeValues": serialize_for_dynamodb(incident_values),
                "ConditionExpression": "updated_at = :old_updated"
            }
        }
        try:
            table.meta.client.transact_write_items(
                TransactItems=[resource_update, incident_update]
            )
        except Exception:
            app.logger.exception("Resource return failed for %s", resource_id)
            return jsonify({
                "ok": False,
                "error": "The resource return could not be recorded."
            }), 409

        return jsonify({
            "ok": True,
            "resource": {
                **convert_numbers(resource),
                "available_quantity": available,
                "deployed_quantity": deployed,
                "unavailable_quantity": unavailable,
                "status": (
                    "Deployed" if deployed
                    else "Available" if available
                    else "Unavailable"
                ),
                "deployments": convert_numbers(deployments),
                "history": convert_numbers(history),
                "updated_at": now
            }
        })
    else:
        resource_type = payload.get("type", resource.get("type"))
        name = payload.get("name", resource.get("name"))
        quantity = payload.get(
            "quantity",
            resource.get("total_quantity", resource.get("quantity"))
        )
        if resource_type not in VALID_RESOURCE_TYPES:
            return jsonify({"ok": False, "error": "Invalid resource type."}), 400
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > 120:
            return jsonify({"ok": False, "error": "Invalid resource name."}), 400
        if (
            isinstance(quantity, bool)
            or not isinstance(quantity, int)
            or not 1 <= quantity <= 10000
            or quantity < deployed + unavailable
        ):
            return jsonify({
                "ok": False,
                "error": "Quantity must be from 1 to 10000 and cannot be lower than deployed plus unavailable units."
            }), 400
        total = quantity
        available = total - deployed - unavailable
        history_entry["action"] = "Resource Updated"
        history.append(history_entry)
        resource.update({"type": resource_type, "name": name.strip()})

    status = (
        "Deployed" if deployed
        else "Available" if available
        else "Unavailable"
    )
    try:
        table.update_item(
            Key={"PK": f"RESOURCE#{resource_id}", "SK": "METADATA"},
            UpdateExpression=(
                "SET #type = :type, #name = :name, total_quantity = :total, "
                "available_quantity = :available, deployed_quantity = :deployed, "
                "unavailable_quantity = :unavailable, #status = :status, "
                "history = :history, updated_at = :updated"
            ),
            ExpressionAttributeNames={
                "#type": "type",
                "#name": "name",
                "#status": "status"
            },
            ExpressionAttributeValues={
                ":type": resource["type"],
                ":name": resource["name"],
                ":total": total,
                ":available": available,
                ":deployed": deployed,
                ":unavailable": unavailable,
                ":status": status,
                ":history": history,
                ":updated": now,
                ":old_updated": resource.get("updated_at")
            },
            ConditionExpression="updated_at = :old_updated"
        )
    except Exception:
        app.logger.exception("Resource update failed for %s", resource_id)
        return jsonify({
            "ok": False,
            "error": "The resource update conflicted or could not be saved."
        }), 409

    resource.update({
        "total_quantity": total,
        "available_quantity": available,
        "deployed_quantity": deployed,
        "unavailable_quantity": unavailable,
        "status": status,
        "history": history,
        "updated_at": now
    })
    return jsonify({"ok": True, "resource": convert_numbers(resource)})


@app.route("/incidents/<incident_id>/resources", methods=["POST"])
def assign_resource(incident_id):
    operator, error = authenticate_operator()
    if error:
        return error

    if not valid_entity_id(incident_id):
        return jsonify({"ok": False, "error": "Invalid incident ID."}), 400

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": "A JSON object is required."}), 400
    resource_id = payload.get("resource_id")
    quantity = payload.get("quantity", 1)
    if not isinstance(resource_id, str) or not resource_id:
        return jsonify({"ok": False, "error": "resource_id is required."}), 400
    if not valid_entity_id(resource_id):
        return jsonify({"ok": False, "error": "Invalid resource ID."}), 400
    if isinstance(quantity, bool) or not isinstance(quantity, int) or quantity <= 0:
        return jsonify({"ok": False, "error": "quantity must be a positive integer."}), 400

    incident = table.get_item(
        Key={"PK": f"INCIDENT#{incident_id}", "SK": "METADATA"},
        ConsistentRead=True
    ).get("Item")
    resource = table.get_item(
        Key={"PK": f"RESOURCE#{resource_id}", "SK": "METADATA"},
        ConsistentRead=True
    ).get("Item")
    if not incident:
        return jsonify({"ok": False, "error": "Incident not found."}), 404
    if not resource:
        return jsonify({"ok": False, "error": "Resource not found."}), 404
    if incident.get("response_status", "Awaiting Assignment") == "Resolved":
        return jsonify({
            "ok": False,
            "error": "Resources cannot be assigned to a resolved incident."
        }), 409
    available = int(resource.get("available_quantity", 0))
    if quantity > available:
        return jsonify({
            "ok": False,
            "error": f"Only {available} units are currently available."
        }), 409

    now = datetime.now(timezone.utc).isoformat()
    deployment_id = f"DEP-{uuid.uuid4().hex[:12].upper()}"
    assignment = {
        "deployment_id": deployment_id,
        "resource_id": resource_id,
        "resource_name": resource.get("name"),
        "resource_type": resource.get("type"),
        "quantity": quantity,
        "location": incident.get("place"),
        "incident_id": incident_id,
        "status": "Assigned",
        "assigned_by": operator,
        "assigned_at": now
    }
    resource_history_entry = {
        "action": "Resource Assigned",
        "deployment_id": deployment_id,
        "incident_id": incident_id,
        "quantity": quantity,
        "operator": operator,
        "timestamp": now
    }
    response_history_entry = {
        "action": "Resource Assigned",
        "resource_id": resource_id,
        "resource_name": resource.get("name"),
        "quantity": quantity,
        "operator": operator,
        "timestamp": now
    }
    current_response_status = incident.get(
        "response_status",
        "Awaiting Assignment"
    )
    next_response_status = (
        "Assigned"
        if current_response_status == "Awaiting Assignment"
        else current_response_status
    )
    resource_values = {
        ":quantity": quantity,
        ":deployed_quantity": quantity,
        ":deployed": "Deployed",
        ":assignment": [assignment],
        ":resource_history": [resource_history_entry],
        ":updated": now,
    }
    incident_values = {
        ":empty": [],
        ":assignment": [assignment],
        ":event": [response_history_entry],
        ":response_status": next_response_status,
        ":resolved": "Resolved",
        ":updated": now,
    }
    try:
        table.meta.client.transact_write_items(
            TransactItems=[
                {
                    "Update": {
                        "TableName": table.name,
                        "Key": serialize_for_dynamodb({
                            "PK": f"RESOURCE#{resource_id}",
                            "SK": "METADATA"
                        }),
                        "UpdateExpression": (
                            "SET available_quantity = available_quantity - :quantity, "
                            "deployed_quantity = if_not_exists(deployed_quantity, :zero) "
                            "+ :deployed_quantity, #status = :deployed, "
                            "deployments = list_append("
                            "if_not_exists(deployments, :empty), :assignment), "
                            "history = list_append("
                            "if_not_exists(history, :empty), :resource_history), "
                            "updated_at = :updated"
                        ),
                        "ExpressionAttributeNames": {"#status": "status"},
                        "ExpressionAttributeValues": serialize_for_dynamodb({
                            **resource_values,
                            ":zero": 0
                        }),
                        "ConditionExpression": (
                            "attribute_exists(PK) AND available_quantity >= :quantity"
                        )
                    }
                },
                {
                    "Update": {
                        "TableName": table.name,
                        "Key": serialize_for_dynamodb({
                            "PK": f"INCIDENT#{incident_id}",
                            "SK": "METADATA"
                        }),
                        "UpdateExpression": (
                            "SET response_assignments = list_append("
                            "if_not_exists(response_assignments, :empty), :assignment), "
                            "response_history = list_append("
                            "if_not_exists(response_history, :empty), :event), "
                            "response_status = :response_status, updated_at = :updated"
                        ),
                        "ExpressionAttributeValues": serialize_for_dynamodb(incident_values),
                        "ConditionExpression": (
                            "attribute_exists(PK) AND "
                            "(attribute_not_exists(response_status) OR "
                            "response_status <> :resolved)"
                        )
                    }
                }
            ]
        )
    except Exception:
        app.logger.exception(
            "Resource assignment failed for %s to incident %s",
            resource_id,
            incident_id
        )
        return jsonify({
            "ok": False,
            "error": "The resource could not be assigned. Refresh and retry."
        }), 409

    return jsonify({
        "ok": True,
        "assignment": assignment,
        "response_status": next_response_status
    }), 201


@app.route("/incidents/<incident_id>/response", methods=["PATCH"])
def update_incident_response(incident_id):
    operator, error = authenticate_operator()
    if error:
        return error

    if not valid_entity_id(incident_id):
        return jsonify({"ok": False, "error": "Invalid incident ID."}), 400

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": "A JSON object is required."}), 400
    next_status = payload.get("status")
    if next_status not in VALID_RESPONSE_STATUSES:
        return jsonify({"ok": False, "error": "Invalid response status."}), 400
    notes = payload.get("notes", "")
    if not isinstance(notes, str) or len(notes) > 500:
        return jsonify({"ok": False, "error": "Notes must be 500 characters or fewer."}), 400

    incident = table.get_item(
        Key={"PK": f"INCIDENT#{incident_id}", "SK": "METADATA"},
        ConsistentRead=True
    ).get("Item")
    if not incident:
        return jsonify({"ok": False, "error": "Incident not found."}), 404

    current_status = incident.get("response_status", "Awaiting Assignment")
    transitions = {
        "Awaiting Assignment": {"Assigned"},
        "Assigned": {"Awaiting Assignment", "Team Dispatched"},
        "Team Dispatched": {"Response in Progress"},
        "Response in Progress": {"Resolved"},
        "Resolved": set()
    }
    if next_status not in transitions[current_status]:
        return jsonify({
            "ok": False,
            "error": f"Response cannot transition from {current_status} to {next_status}."
        }), 409

    now = datetime.now(timezone.utc).isoformat()
    entry = {
        "action": "Response Status Changed",
        "from_status": current_status,
        "to_status": next_status,
        "notes": notes.strip(),
        "operator": operator,
        "timestamp": now
    }
    try:
        table.update_item(
            Key={"PK": f"INCIDENT#{incident_id}", "SK": "METADATA"},
            UpdateExpression=(
                "SET response_status = :status, response_updated_at = :updated, "
                "updated_at = :updated, response_history = list_append("
                "if_not_exists(response_history, :empty), :entry)"
            ),
            ExpressionAttributeValues={
                ":status": next_status,
                ":updated": now,
                ":empty": [],
                ":entry": [entry],
                ":old_updated": incident.get("updated_at")
            },
            ConditionExpression="updated_at = :old_updated"
        )
    except Exception:
        app.logger.exception("Response status update failed for %s", incident_id)
        return jsonify({
            "ok": False,
            "error": "The response status conflicted or could not be saved."
        }), 409

    incident.update({
        "response_status": next_status,
        "response_updated_at": now,
        "updated_at": now,
        "response_history": list(incident.get("response_history", [])) + [entry]
    })
    return jsonify({"ok": True, "incident": convert_numbers(incident)})


@app.route("/brief", methods=["GET"])
def get_brief():
    _, error = authenticate_operator(required_role="viewer")
    if error:
        return error

    brief = get_brief_item()

    if not brief:
        return jsonify({
            "ok": False,
            "error": "Situation brief not found"
        }), 404

    return jsonify(convert_numbers(brief))


@app.route("/brief/history", methods=["GET"])
def get_brief_history():
    _, error = authenticate_operator(required_role="viewer")
    if error:
        return error

    archived = [
        convert_numbers(item)
        for item in get_items_by_prefix("BRIEF#ARCHIVE#")
    ]
    archived.sort(key=lambda item: item.get("generated_at", ""), reverse=True)
    return jsonify({"briefs": archived})


@app.route("/brief/archive", methods=["POST"])
def archive_current_brief():
    operator, error = authenticate_operator()
    if error:
        return error

    brief = get_brief_item()
    if not brief:
        return jsonify({"ok": False, "error": "No current brief is available."}), 404
    if brief.get("status") not in ("Approved", "Approved by Human Operator"):
        return jsonify({
            "ok": False,
            "error": "Only an approved brief can be archived.",
        }), 409
    archived_at = datetime.now(timezone.utc).isoformat()
    archived = {
        **convert_numbers(brief),
        "PK": f"BRIEF#ARCHIVE#{brief.get('version_id') or uuid.uuid4()}",
        "SK": "METADATA",
        "status": "Archived",
        "state": "archived",
        "archived_at": archived_at,
        "archived_by": operator,
    }
    try:
        table.meta.client.transact_write_items(
            TransactItems=[
                {
                    "Put": {
                        "TableName": table.name,
                        "Item": serialize_for_dynamodb(archived),
                        "ConditionExpression": (
                            "attribute_not_exists(PK) AND attribute_not_exists(SK)"
                        ),
                    }
                },
                {
                    "Delete": {
                        "TableName": table.name,
                        "Key": serialize_for_dynamodb({
                            "PK": "BRIEF#CURRENT",
                            "SK": "METADATA",
                        }),
                        "ConditionExpression": "attribute_exists(PK)",
                    }
                },
            ]
        )
    except Exception:
        app.logger.exception("Situation brief archival failed")
        return jsonify({
            "ok": False,
            "error": "The approved brief could not be archived.",
        }), 500
    return jsonify({"ok": True, "brief": convert_numbers(archived)})


@app.route("/alerts", methods=["GET"])
def list_alerts():
    _, error = authenticate_operator(required_role="viewer")
    if error:
        return error

    alerts = get_items_by_prefix("ALERT#")
    alerts.sort(key=lambda alert: alert.get("created_at", ""), reverse=True)
    return jsonify({
        "alerts": alerts,
        "delivery_mode": "Prototype only; no external messages are sent.",
    })


@app.route("/alerts", methods=["POST"])
def create_alert():
    operator, error = authenticate_operator()
    if error:
        return error

    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"ok": False, "error": "A JSON object is required."}), 400
    locations = payload.get("locations")
    severity = payload.get("severity")
    urgency = payload.get("urgency")
    if (
        not isinstance(locations, list)
        or not locations
        or len(locations) > 15
        or any(not isinstance(location, str) for location in locations)
    ):
        return jsonify({
            "ok": False,
            "error": "Select between 1 and 15 affected locations.",
        }), 400
    if not isinstance(severity, str) or severity not in VALID_SEVERITIES:
        return jsonify({"ok": False, "error": "Invalid severity label."}), 400
    if not isinstance(urgency, str) or urgency not in (
        "Advisory",
        "Watch",
        "Warning",
        "Emergency",
    ):
        return jsonify({"ok": False, "error": "Invalid urgency label."}), 400

    items, _, reports, places = load_intelligence_snapshot()
    valid_locations = {
        item.get("place") or item.get("name")
        for item in places
    }
    locations = list(dict.fromkeys(locations))
    if any(location not in valid_locations for location in locations):
        return jsonify({
            "ok": False,
            "error": "One or more selected locations are not configured.",
        }), 400
    verified_reports = [
        report for report in reports
        if report.get("verification_status") == "Confirmed"
        and report.get("place") in locations
    ]
    if not verified_reports:
        return jsonify({
            "ok": False,
            "error": (
                "No human-confirmed reports exist for the selected locations. "
                "A public alert cannot be generated from unverified information."
            ),
        }), 409

    verified_types = list(dict.fromkeys(
        report.get("type")
        for report in verified_reports
        if report.get("type")
    ))
    type_text = ", ".join(verified_types) or "reported emergency"
    english_message = (
        f"ResQGrid {urgency.lower()} for {', '.join(locations)}: "
        f"human-confirmed reports indicate {type_text}. "
        f"Operator-selected severity: {severity}. "
        "This prototype notice is informational; follow instructions from local authorities."
    )
    translations = {"en": english_message}
    translation_status = {"en": "Completed"}
    for language in ("hi", "pa"):
        translated = translate_text(english_message, "en", language)
        translations[language] = translated.get("text") or ""
        translation_status[language] = translated.get("status", "Failed")
        if translated.get("error"):
            app.logger.warning(
                "Alert translation to %s failed: %s",
                language,
                translated["error"],
            )

    now = datetime.now(timezone.utc).isoformat()
    alert_id = f"ALT-{uuid.uuid4().hex[:12].upper()}"
    alert = {
        "PK": f"ALERT#{alert_id}",
        "SK": "METADATA",
        "alert_id": alert_id,
        "locations": locations,
        "severity": severity,
        "urgency": urgency,
        "messages": translations,
        "translation_status": translation_status,
        "supporting_report_ids": [
            report.get("report_id") for report in verified_reports
        ],
        "status": "Draft",
        "delivery_mode": "Simulated; no external message sent.",
        "created_by": operator,
        "created_at": now,
        "history": [{
            "status": "Draft",
            "operator": operator,
            "timestamp": now,
        }],
    }
    try:
        table.put_item(
            Item=normalize_for_dynamodb(alert),
            ConditionExpression="attribute_not_exists(PK) AND attribute_not_exists(SK)",
        )
    except Exception:
        app.logger.exception("Alert draft could not be saved")
        return jsonify({"ok": False, "error": "The alert draft could not be saved."}), 500
    return jsonify({"ok": True, "alert": convert_numbers(alert)}), 201


@app.route("/alerts/<alert_id>", methods=["PATCH"])
def edit_alert(alert_id):
    operator, error = authenticate_operator()
    if error:
        return error
    if not valid_entity_id(alert_id):
        return jsonify({"ok": False, "error": "Invalid alert ID."}), 400

    payload = request.get_json(silent=True)
    messages = payload.get("messages") if isinstance(payload, dict) else None
    if not isinstance(messages, dict) or not messages:
        return jsonify({
            "ok": False,
            "error": "A messages object is required.",
        }), 400
    if set(messages) - {"en", "hi", "pa"} or any(
        not isinstance(message, str)
        or not message.strip()
        or len(message) > 2000
        for message in messages.values()
    ):
        return jsonify({
            "ok": False,
            "error": "Provide non-empty English, Hindi, or Punjabi messages (max 2000 characters each).",
        }), 400

    alert = table.get_item(
        Key={"PK": f"ALERT#{alert_id}", "SK": "METADATA"},
        ConsistentRead=True,
    ).get("Item")
    if not alert:
        return jsonify({"ok": False, "error": "Alert not found."}), 404
    if alert.get("status") != "Draft":
        return jsonify({"ok": False, "error": "Only a draft alert can be edited."}), 409

    updated_messages = dict(alert.get("messages") or {})
    updated_status = dict(alert.get("translation_status") or {})
    for language, message in messages.items():
        updated_messages[language] = message.strip()
        updated_status[language] = "Human Provided"
    now = datetime.now(timezone.utc).isoformat()
    history = list(alert.get("history", [])) + [{
        "status": "Draft Edited",
        "operator": operator,
        "timestamp": now,
    }]
    try:
        table.update_item(
            Key={"PK": f"ALERT#{alert_id}", "SK": "METADATA"},
            UpdateExpression=(
                "SET messages = :messages, translation_status = :translation_status, "
                "history = :history, updated_at = :updated, updated_by = :operator"
            ),
            ExpressionAttributeValues=normalize_for_dynamodb({
                ":messages": updated_messages,
                ":translation_status": updated_status,
                ":history": history,
                ":updated": now,
                ":operator": operator,
                ":draft": "Draft",
            }),
            ConditionExpression="#status = :draft",
            ExpressionAttributeNames={"#status": "status"},
        )
    except Exception:
        app.logger.exception("Alert draft editing failed for %s", alert_id)
        return jsonify({"ok": False, "error": "The alert draft could not be updated."}), 409
    alert.update({
        "messages": updated_messages,
        "translation_status": updated_status,
        "history": history,
        "updated_at": now,
        "updated_by": operator,
    })
    return jsonify({"ok": True, "alert": convert_numbers(alert)})


@app.route("/alerts/<alert_id>/approve", methods=["POST"])
def approve_alert(alert_id):
    operator, error = authenticate_operator()
    if error:
        return error
    if not valid_entity_id(alert_id):
        return jsonify({"ok": False, "error": "Invalid alert ID."}), 400

    alert = table.get_item(
        Key={"PK": f"ALERT#{alert_id}", "SK": "METADATA"},
        ConsistentRead=True,
    ).get("Item")
    if not alert:
        return jsonify({"ok": False, "error": "Alert not found."}), 404
    if alert.get("status") != "Draft":
        return jsonify({"ok": False, "error": "Only a draft alert can be approved."}), 409
    messages = alert.get("messages") or {}
    if any(
        not isinstance(messages.get(language), str) or not messages[language].strip()
        for language in ("en", "hi", "pa")
    ):
        return jsonify({
            "ok": False,
            "error": "Complete and review all three language messages before approval.",
        }), 409

    now = datetime.now(timezone.utc).isoformat()
    history = list(alert.get("history", [])) + [{
        "status": "Approved",
        "operator": operator,
        "timestamp": now,
    }]
    try:
        table.update_item(
            Key={"PK": f"ALERT#{alert_id}", "SK": "METADATA"},
            UpdateExpression=(
                "SET #status = :status, approved_by = :operator, "
                "approved_at = :timestamp, history = :history"
            ),
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues=normalize_for_dynamodb({
                ":status": "Approved",
                ":operator": operator,
                ":timestamp": now,
                ":history": history,
                ":draft": "Draft",
            }),
            ConditionExpression="#status = :draft",
        )
    except Exception:
        app.logger.exception("Alert approval failed for %s", alert_id)
        return jsonify({"ok": False, "error": "The alert approval could not be saved."}), 409
    alert.update({
        "status": "Approved",
        "approved_by": operator,
        "approved_at": now,
        "history": history,
    })
    return jsonify({"ok": True, "alert": convert_numbers(alert)})


@app.route("/alerts/<alert_id>/send", methods=["POST"])
def simulate_alert_delivery(alert_id):
    operator, error = authenticate_operator()
    if error:
        return error
    if not valid_entity_id(alert_id):
        return jsonify({"ok": False, "error": "Invalid alert ID."}), 400

    alert = table.get_item(
        Key={"PK": f"ALERT#{alert_id}", "SK": "METADATA"},
        ConsistentRead=True,
    ).get("Item")
    if not alert:
        return jsonify({"ok": False, "error": "Alert not found."}), 404
    if alert.get("status") != "Approved":
        return jsonify({
            "ok": False,
            "error": "Only an approved alert can be simulated as sent.",
        }), 409
    now = datetime.now(timezone.utc).isoformat()
    history = list(alert.get("history", [])) + [{
        "status": "Sent",
        "operator": operator,
        "timestamp": now,
        "delivery_mode": "Simulated; no external message sent.",
    }]
    try:
        table.update_item(
            Key={"PK": f"ALERT#{alert_id}", "SK": "METADATA"},
            UpdateExpression=(
                "SET #status = :status, sent_by = :operator, sent_at = :timestamp, "
                "history = :history, delivery_mode = :delivery_mode"
            ),
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues=normalize_for_dynamodb({
                ":status": "Sent",
                ":operator": operator,
                ":timestamp": now,
                ":history": history,
                ":delivery_mode": "Simulated; no external message sent.",
                ":approved": "Approved",
            }),
            ConditionExpression="#status = :approved",
        )
    except Exception:
        app.logger.exception("Simulated alert send failed for %s", alert_id)
        return jsonify({"ok": False, "error": "Simulated delivery could not be recorded."}), 409
    alert.update({
        "status": "Sent",
        "sent_by": operator,
        "sent_at": now,
        "history": history,
        "delivery_mode": "Simulated; no external message sent.",
    })
    return jsonify({"ok": True, "alert": convert_numbers(alert)})


@app.route("/analytics", methods=["GET"])
def get_operational_analytics():
    _, error = authenticate_operator(required_role="viewer")
    if error:
        return error

    start_value = request.args.get("from_date")
    end_value = request.args.get("to_date")
    place_filter = request.args.get("place", "").strip()
    start_date = None
    end_date = None
    try:
        if start_value:
            start_date = datetime.strptime(start_value, "%Y-%m-%d").replace(
                tzinfo=timezone.utc
            )
        if end_value:
            end_date = datetime.strptime(end_value, "%Y-%m-%d").replace(
                tzinfo=timezone.utc
            ) + timedelta(days=1)
    except ValueError:
        return jsonify({
            "ok": False,
            "error": "Dates must use the YYYY-MM-DD format.",
        }), 400
    if start_date and end_date and start_date >= end_date:
        return jsonify({
            "ok": False,
            "error": "from_date must be on or before to_date.",
        }), 400

    items, incidents, reports, places = load_intelligence_snapshot()
    known_locations = {
        item.get("place") or item.get("name")
        for item in places
    }
    if place_filter and place_filter not in known_locations:
        return jsonify({"ok": False, "error": "Unknown location filter."}), 400

    def within_dates(record):
        if not start_date and not end_date:
            return True
        timestamp = parse_iso_datetime(record.get("created_at"))
        if not timestamp:
            return False
        if start_date and timestamp < start_date:
            return False
        return not end_date or timestamp < end_date

    def included(record):
        return (
            (not place_filter or record.get("place") == place_filter)
            and within_dates(record)
        )

    reports = [report for report in reports if included(report)]
    incidents = [incident for incident in incidents if included(incident)]

    def count_by(records, key, fallback="Unknown"):
        counts = {}
        for record in records:
            label = record.get(key) or fallback
            counts[label] = counts.get(label, 0) + 1
        return dict(sorted(counts.items()))

    confirmed = sum(
        report.get("verification_status") == "Confirmed"
        for report in reports
    )
    rejected = sum(
        report.get("verification_status") == "Rejected"
        for report in reports
    )
    unverified = sum(
        report.get("verification_status", "Unverified")
        in ("Unverified", "Corroborated")
        for report in reports
    )
    voice_reports = [
        report for report in reports if report.get("source") == "Voice"
    ]
    language_counts = {}
    source_counts = {}
    for report in reports:
        language = (
            (report.get("analysis") or {}).get("language", {}).get("code")
            or report.get("detected_language")
            or "unknown"
        )
        language_counts[language] = language_counts.get(language, 0) + 1
        source = "Voice" if report.get("source") == "Voice" else "Text"
        source_counts[source] = source_counts.get(source, 0) + 1

    resources = [
        convert_numbers(item)
        for item in items
        if item.get("PK", "").startswith("RESOURCE#")
        and (
            not place_filter
            or item.get("deployment_location") == place_filter
            or item.get("place") == place_filter
            or any(
                assignment.get("location") == place_filter
                for assignment in (item.get("deployments") or [])
                if isinstance(assignment, dict)
            )
        )
        and within_dates(item)
    ]
    available_units = sum(
        int(resource.get("available_quantity", 0) or 0)
        for resource in resources
    )
    deployed_units = sum(
        int(resource.get("deployed_quantity", 0) or 0)
        for resource in resources
    )
    unavailable_resources = sum(
        resource.get("status") == "Unavailable"
        for resource in resources
    )

    response_durations = []
    for incident in incidents:
        history = incident.get("response_history", [])
        if not isinstance(history, list):
            continue
        dispatch_times = [
            parse_iso_datetime(entry.get("timestamp"))
            for entry in history
            if isinstance(entry, dict)
            and entry.get("to_status") == "Team Dispatched"
        ]
        resolved_times = [
            parse_iso_datetime(entry.get("timestamp"))
            for entry in history
            if isinstance(entry, dict)
            and entry.get("to_status") == "Resolved"
        ]
        valid_dispatch = [value for value in dispatch_times if value]
        valid_resolved = [value for value in resolved_times if value]
        if valid_dispatch and valid_resolved:
            elapsed = (valid_resolved[-1] - valid_dispatch[0]).total_seconds()
            if elapsed >= 0:
                response_durations.append(elapsed / 60)

    daily_reports = {}
    for report in reports:
        timestamp = parse_iso_datetime(report.get("created_at"))
        if timestamp:
            day = timestamp.date().isoformat()
            daily_reports[day] = daily_reports.get(day, 0) + 1
    severity_by_day = {}
    for incident in incidents:
        timestamp = parse_iso_datetime(incident.get("created_at"))
        if timestamp:
            day = timestamp.date().isoformat()
            day_counts = severity_by_day.setdefault(day, {})
            severity = incident.get("severity", "Unknown")
            day_counts[severity] = day_counts.get(severity, 0) + 1

    resolved_count = sum(
        incident.get("response_status") == "Resolved"
        for incident in incidents
    )
    active_count = len(incidents) - resolved_count
    pending_assignments = sum(
        incident.get("response_status", "Awaiting Assignment")
        == "Awaiting Assignment"
        for incident in incidents
    )
    filtered_alerts = [
        convert_numbers(item)
        for item in items
        if item.get("PK", "").startswith("ALERT#")
        and within_dates(item)
        and (
            not place_filter
            or place_filter in item.get("locations", [])
        )
    ]
    return jsonify({
        "filters": {
            "from_date": start_value,
            "to_date": end_value,
            "place": place_filter or None,
        },
        "incident_analytics": {
            "total_reports": len(reports),
            "total_incidents": len(incidents),
            "verified_reports": confirmed,
            "unverified_or_corroborated_reports": unverified,
            "rejected_reports": rejected,
            "by_severity": count_by(incidents, "severity"),
            "by_category": count_by(incidents, "type"),
            "by_location": count_by(incidents, "place"),
        },
        "response_analytics": {
            "average_response_minutes": (
                round(sum(response_durations) / len(response_durations), 1)
                if response_durations else None
            ),
            "resolved_incidents": resolved_count,
            "active_incidents": active_count,
            "pending_assignments": pending_assignments,
            "resources_deployed": deployed_units,
            "resources_available": available_units,
            "resources_unavailable": unavailable_resources,
            "resource_utilization_percent": (
                round(
                    deployed_units * 100 / (deployed_units + available_units),
                    1,
                )
                if deployed_units + available_units else None
            ),
        },
        "communication_analytics": {
            "reports_by_language": dict(sorted(language_counts.items())),
            "voice_vs_text": dict(sorted(source_counts.items())),
            "transcription_successes": sum(
                report.get("transcription_status") == "Completed"
                for report in voice_reports
            ),
            "transcription_failures": sum(
                report.get("transcription_status") == "Failed"
                for report in voice_reports
            ),
            "alert_history": {
                "total": len(filtered_alerts),
                "by_status": count_by(filtered_alerts, "status"),
            },
        },
        "historical_analytics": {
            "reports_by_day": dict(sorted(daily_reports.items())),
            "incidents_by_location": count_by(incidents, "place"),
            "severity_by_day": dict(sorted(severity_by_day.items())),
            "report_volume": {
                "total_in_filtered_period": len(reports),
                "first_recorded": min(
                    (report.get("created_at") for report in reports if report.get("created_at")),
                    default=None,
                ),
                "last_recorded": max(
                    (report.get("created_at") for report in reports if report.get("created_at")),
                    default=None,
                ),
            },
        },
        "data_source": "Stored DynamoDB records only; no mock values are included.",
    })


if __name__ == "__main__":
    app.run(
        host=os.getenv("FLASK_HOST", "127.0.0.1"),
        port=int(os.getenv("FLASK_PORT", "5000")),
        debug=os.getenv("FLASK_DEBUG", "false").strip().lower() == "true"
    )