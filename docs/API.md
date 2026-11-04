# API Reference

The Flask API returns JSON. Errors use:

```json
{"ok": false, "error": "A sanitized message.", "code": "not_found"}
```

Successful legacy endpoints retain their established response shapes. JSON payloads are validated by each route. Requests are limited to 10 MiB. Browser origins must be explicitly configured.

## Authentication and roles

Protected requests use HTTP Basic authentication over HTTPS outside local development. `/operator/session` verifies credentials and returns the operator name and role. Roles are `viewer`, `operator`, and `administrator`; a viewer can read control-room data, while operator and administrator roles can invoke protected mutations. If the role map is omitted, configured accounts retain the legacy `operator` role. With a role map present, users not explicitly mapped default to `viewer`.

Citizen intake endpoints intentionally remain unauthenticated. They use idempotency keys to prevent duplicate submissions.

## Routes

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/report` | Citizen | Submit a validated text report. |
| POST | `/voice-report` | Citizen | Validate and store voice audio, transcribe locally, and preserve the original S3 object on transcription failure. |
| POST | `/operator/session` | Basic credentials | Validate account and return role. |
| GET | `/incidents` | Viewer+ | Consolidated incident/report/location/resource/brief snapshot and risk indicators. |
| GET | `/resources` | Viewer+ | List persistent resource records. |
| POST | `/resources` | Operator+ | Create a resource. |
| PATCH | `/resources/{resource_id}` | Operator+ | Update resource inventory or deployment state. |
| POST | `/incidents/{incident_id}/resources` | Operator+ | Assign available resources. |
| PATCH | `/incidents/{incident_id}/response` | Operator+ | Record a valid response-status transition. |
| POST | `/incidents/{incident_id}/confirm` | Operator+ | Human-confirm an incident. |
| POST | `/reports/{report_id}/verification` | Operator+ | Verify or reject a report. |
| PATCH | `/reports/{report_id}/analysis-corrections` | Operator+ | Correct extracted analysis without changing verification. |
| GET | `/reports/{report_id}/audio` | Operator+ | Stream private S3 audio through Flask. |
| GET | `/intelligence/compare` | Viewer+ | Inspect candidate duplicates/conflicts. |
| GET | `/intelligence/patterns` | Viewer+ | Inspect data-derived anomaly recommendations. |
| POST | `/brief/generate` | Operator+ | Save a draft situation brief. |
| GET/PATCH | `/brief` | Viewer+ / Operator+ | Read the current brief or edit a draft. |
| POST | `/brief/approve` | Operator+ | Approve the current draft. |
| GET | `/brief/history` | Viewer+ | List archived brief versions. |
| POST | `/brief/archive` | Operator+ | Archive an approved brief. |
| GET/POST | `/alerts` | Viewer+ / Operator+ | List alerts or create a draft alert. |
| PATCH | `/alerts/{alert_id}` | Operator+ | Edit draft multilingual messages. |
| POST | `/alerts/{alert_id}/approve` | Operator+ | Approve an alert. |
| POST | `/alerts/{alert_id}/send` | Operator+ | Record simulated delivery only. |
| GET | `/analytics` | Viewer+ | Aggregate stored records with optional date/location filters. |

`GET /intelligence/compare` accepts `window_minutes` from 1 through 360. `GET /analytics` accepts `from_date`, `to_date` in `YYYY-MM-DD` form and a configured `place`.

## Request examples

Text intake:

```http
POST /report
Content-Type: application/json
Idempotency-Key: citizen-submit-20261104-001

{"original_text":"Water is rising near the bridge.","place":"Mandi","type":"Flood","severity":"High"}
```

Operator-only action:

```http
POST /brief/generate
Authorization: Basic <base64(username:password)>
```

Use the authenticated methods in `src/services/api.js`; do not store credentials in local storage or frontend build-time secrets.
