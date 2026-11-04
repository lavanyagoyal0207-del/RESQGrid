from datetime import datetime
import json
import os
from flask import Flask, jsonify, request
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

DATA_PATH = os.path.join(
    os.path.dirname(__file__), "..", "src", "data", "mockData.json"
)

with open(DATA_PATH, "r", encoding="utf-8") as f:
    STATE = json.load(f)


@app.route("/incidents", methods=["GET"])
def get_incidents():
    return jsonify({
        "incidents": STATE["incidents"],
        "reports": STATE["reports"],
        "places": STATE["places"],
    })


@app.route("/incidents/<incident_id>/confirm", methods=["POST"])
def confirm_incident(incident_id):
    for inc in STATE["incidents"]:
        if inc["incident_id"] == incident_id:
            inc["status"] = "Confirmed"
            inc["confirmed_by"] = "Human Control Room Duty Officer"
            inc["updated_at"] = datetime.now().isoformat()
            return jsonify({"ok": True, "incident": inc})
    return jsonify({"ok": False, "error": "Incident not found"}), 404


@app.route("/report", methods=["POST"])
def submit_report():
    payload = request.get_json(force=True) or {}
    original_text = payload.get("original_text", "").strip()
    place = payload.get("place", "Mandi")
    inc_type = payload.get("type", "Flood")
    severity = payload.get("severity", "Medium")
    source = payload.get("source", "Citizen Web Form")

    if not original_text:
        return jsonify({"ok": False, "error": "original_text is required"}), 400

    now_iso = datetime.now().isoformat()
    new_rep_id = f"REP-{9000 + len(STATE['reports']) + 1}"
    new_report = {
        "report_id": new_rep_id,
        "source": source,
        "original_text": original_text,
        "translated_text": f"[AI Suggested Translation — Unverified]: Field report for {place} ({inc_type}): {original_text}",
        "type": inc_type,
        "place": place,
        "severity": severity,
        "created_at": now_iso,
    }
    STATE["reports"].insert(0, new_report)

    for inc in STATE["incidents"]:
        if inc["place"].lower() == place.lower():
            inc["report_count"] += 1
            inc["report_ids"].insert(0, new_rep_id)
            if inc["status"] != "Confirmed":
                inc["status"] = "Corroborated"
            inc["updated_at"] = now_iso
            break

    STATE["brief"]["status"] = "Draft, needs review"
    return jsonify({"ok": True, "report": new_report}), 201


@app.route("/brief", methods=["GET"])
def get_brief():
    return jsonify(STATE["brief"])


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
