# ResQGrid — Emergency Intelligence Platform

> **Golden Rule**: During floods and landslides, people send scattered reports. ResQGrid clusters them onto one clear tactical map. **AI only SUGGESTS, human CONFIRMS.** Nowhere does the system write "Confirmed Emergency" automatically.

## Theme & Design Specs
- **Background**: Deep Night-Watch Purple (`#1a0b2e` / `#2D1B4E`) with faint drifting atmospheric fog overlay
- **Highlight**: Tactical Signal Orange (`#FF6B35`)
- **Typography**: `Space Grotesk` (headers & counters) + `Inter` (body & multilingual reports)
- **Map**: Leaflet + OpenStreetMap tiles with a dark-purple presentation covering 15 fixed places across Himachal Pradesh. Incident markers use stored coordinates or matching predefined-location coordinates; they are never randomly generated.

## Project Structure
```text
resqgrid-frontend/
├── index.html
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── src/
│   ├── main.jsx
│   ├── App.jsx
│   ├── index.css
│   ├── data/
│   │   └── mockData.json          # Mock reports & incidents in exact required schema
│   ├── services/
│   │   └── api.js                 # Flask API client and operator actions
│   └── components/
│       ├── LandingPage.jsx        # Public introduction and citizen/operator entry points
│       ├── TopBar.jsx             # Live/offline/mock connection status and counters
│       ├── DarkMap.jsx            # Fixed locations, incident markers and map filters
│       ├── IncidentCard.jsx       # "14 reports -> 1 incident", Type, Place, Severity & Status badges, Orange dot
│       ├── IncidentList.jsx       # Sorted by latest with filter controls
│       ├── IncidentDetail.jsx     # Report evidence, private audio and response history
│       ├── BriefPanel.jsx         # Situation Brief + "Draft, needs review" yellow badge + [Approve Brief]
│       ├── SubmitReportModal.jsx  # Separate page / modal + Voice Upload (Hindi/Punjabi) -> POST /report
│       ├── OperationsOverview.jsx # Incoming reports and human-reviewed risk recommendations
│       └── ResourceManagementPanel.jsx # Persistent inventory and incident assignments
│       ├── PhaseFourDashboard.jsx # Report intelligence, briefs, alerts, and analytics navigation
│       └── AnalyticsDashboard.jsx # Filtered actual-record analytics
│       └── FogOverlay.jsx         # Subtle night-watch fog animation
└── backend/
    ├── app.py                     # Flask APIs, DynamoDB workflows, private S3 audio proxy
    ├── intelligence.py            # Local language heuristics, extraction, comparison, and patterns
    ├── test_voice_report.py       # Existing mocked workflow tests
    ├── test_phase4.py             # Phase 4 mocked intelligence/API tests
    └── requirements.txt
```

## Quick Start

### 1. Run Frontend (React + Vite + Tailwind + Leaflet)
```bash
npm ci
npm run dev
```
The development server proxies API requests to `http://127.0.0.1:5000` by default. Offline fallback content is labeled as mock and must never be treated as operational data. Build the production bundle with `npm run build`.

### 2. Run the Flask API

Configure AWS credentials through an AWS profile or an IAM role. Do not put credentials in the frontend or commit them. The backend uses the table and region configured in `backend/aws_config.py`; the S3 bucket must remain private.
For a configured local AWS profile, set it in the same backend terminal with `$env:AWS_PROFILE = "resqgrid"`.

Configure operator identities with `RESQGRID_OPERATOR_PASSWORD_HASHES`, a JSON object mapping usernames to Werkzeug password hashes. Use the stronger Werkzeug hash format; legacy SHA-256 hashes remain supported for migration only. In PowerShell, create a hash without printing the password:

```powershell
$env:RESQGRID_OPERATOR_PASSWORD_HASHES = (& python -c "import getpass,json; from werkzeug.security import generate_password_hash; print(json.dumps({'operator-a':generate_password_hash(getpass.getpass('Operator password: '))}))")
$env:RESQGRID_OPERATOR_ROLES = '{"operator-a":"administrator"}'
```

Roles are `viewer`, `operator`, and `administrator`; viewers can read protected control-room data, while operator and administrator roles can perform protected actions. Keep the hashes out of source control. Configure exact browser origins using `RESQGRID_ALLOWED_ORIGINS`. Flask binds to `127.0.0.1` with debug mode off by default.

```bash
cd backend
pip install -r requirements.txt
# Local development only:
python app.py
```

For a WSGI server on the private backend interface:

```powershell
cd backend
waitress-serve --listen=127.0.0.1:5000 wsgi:app
```

Waitress does not terminate TLS. Production must use an approved HTTPS reverse proxy. See [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md).

### 3. Run automated tests

From the project root and `backend` respectively:

```powershell
cd backend
python -m unittest -v
cd ..
npm test
npm run build
```

## Live Monitoring and Data Source

- After viewer/operator sign-in, the dashboard requests one consolidated `GET /incidents` snapshot every 15 seconds while its browser tab is visible. Control-room data is not loaded for anonymous users.
- The header distinguishes `LIVE API`, `OFFLINE · LAST SNAPSHOT`, and `MOCK DATA · API UNAVAILABLE`. Mock reports are a clearly labeled UI fallback and are never presented as real resource availability.
- Incoming report cards show timestamps and mark IDs first seen during the current live session.
- Map filters cover severity (including Critical), incident type, and human-reviewed/unverified status. Markers use only incident coordinates or configured fixed-location coordinates.
- Risk recommendations are derived from stored incidents and reports. The current advisory flags two or more High/Critical incidents, multiple incidents at a place, or an increase in reports across consecutive 30-minute windows. It is not a validated disaster prediction and requires operator review.
- Resource registry entries are explicitly added by operators. Availability, deployments, returns, response assignments, operator identity, and timestamps are persisted in DynamoDB.

## Frontend navigation

- The public landing page explains the citizen reporting and operator review workflow without presenting fallback records as live activity.
- The control room is organized into Overview (live metrics, severity profile, map, and incident feed), Evidence (incident review and verification), Operations (brief, risk, and resources), and Intelligence (brief lifecycle, alerts, and analytics).
- The interface uses a responsive midnight-purple and charcoal visual system with restrained orange/amber accents. Reduced-motion preferences are respected.

## Operator API

Protected read endpoints require Basic authentication for a configured viewer or higher role. Mutations below require the operator or administrator role. Citizen report submissions are public by design.

| Method and route | Purpose |
|---|---|
| `POST /operator/session` | Validate operator credentials |
| `GET /resources` | List persisted resources |
| `POST /resources` | Create an available resource record |
| `PATCH /resources/{resource_id}` | Update inventory, mark available/unavailable, or record a return |
| `POST /incidents/{incident_id}/resources` | Assign available units to an incident |
| `PATCH /incidents/{incident_id}/response` | Record a valid response-status transition and operator history |
| `POST /reports/{report_id}/verification` | Human verification decision |
| `GET /reports/{report_id}/audio` | Authenticated audio proxy; S3 objects remain private |
| `POST /brief/generate` | Generate and save an unpublished draft |
| `POST /brief/approve` | Approve the current draft brief |
| `PATCH /brief` | Edit draft section text |
| `POST /brief/archive` | Archive an approved brief |
| `POST /alerts` | Create a draft from human-confirmed reports |
| `PATCH /alerts/{alert_id}` | Edit multilingual alert text while in draft |
| `POST /alerts/{alert_id}/approve` | Approve all three language messages |
| `POST /alerts/{alert_id}/send` | Record simulated delivery (no external service) |
| `PATCH /reports/{report_id}/analysis-corrections` | Correct extracted fields without changing report verification |

`POST /report` and `POST /voice-report` accept an `Idempotency-Key` header and a stable `submission_id` body/form fallback. Reuse the same ID for retries and generate a new ID for each separate citizen action, even when the report text is identical. The first-party frontend sends both; a submission missing both identifiers is rejected. Resource records use the DynamoDB partition key `RESOURCE#{resource_id}` and sort key `METADATA`. Incident response status, assignments, and history are stored with each incident. Assignment and return updates use DynamoDB transactions so incident and resource records are updated together.

Response status transitions are constrained to `Awaiting Assignment -> Assigned -> Team Dispatched -> Response in Progress -> Resolved`; an assigned incident may return to `Awaiting Assignment`. Each accepted update records the operator, timestamp, and optional note.

### Phase 4 API and data

- `GET /intelligence/compare?window_minutes=60` returns location/time/text candidate comparisons, explicit contradiction evidence, and severity conflicts. It never deletes reports or confirms incidents.
- `GET /intelligence/patterns` returns deterministic count-based anomaly indicators using the current server time and no more than 24 hours of reports. Stale or insufficient evidence is labeled and produces no current pattern. Results are decision support, not disaster predictions.
- `GET /analytics?from_date=YYYY-MM-DD&to_date=YYYY-MM-DD&place=...` aggregates stored reports, incidents, resources, response histories, transcription outcomes, and alert records. Omit filters for all stored data.
- `GET /brief/history` lists archived versions. A new draft archives the prior approved brief atomically; generated briefs remain drafts until an authenticated operator approves them.
- `GET /alerts` returns the stored alert history. Simulated send only changes database status; no SMS, broadcast, or external delivery service is contacted.
- Report metadata retains `original_text`, `translated_text`, `detected_language`, translation status, and an `analysis` map. Operator corrections are stored separately from source text and do not change verification status.
- Alert records use `ALERT#{alert_id}`. Archived briefs use `BRIEF#ARCHIVE#{version_id}`. No table migration or destructive data change is required.

### Local translation model

The backend contains a lazy local IndicTrans2 adapter for Hindi/Punjabi-to-English reports and English-to-Hindi/Punjabi alert messages. It makes no per-request AI API calls. The model weights are not installed with the base requirements and will be downloaded from Hugging Face when the adapter is first used in an environment with the optional model stack:

```bash
pip install "numpy>=2.1" "torch>=2.5" "transformers>=4.51" IndicTransToolkit
```

The upstream IndicTransToolkit README currently describes Python 3.10+ and Linux/macOS environments and says it is not built/tested for Windows. This project’s current development environment is Windows with Python 3.14, and the optional model dependencies/weights have **not** been installed or validated here. Until run in a compatible environment, Hindi/Punjabi translation reports `Failed` or `Unavailable` without replacing the original text; the operator can still inspect/edit alert messages, and an alert cannot be approved until all language messages are present. English input is retained unchanged. No external paid AI service is configured.

The extraction and contradiction logic is conservative, phrase-based decision support—not a trained multilingual classifier. It marks unsupported fields `Unknown`; spelling, transliteration, dialect, and semantic contradictions need human review.

## Phase 4 test coverage

`backend/test_phase4.py` covers language-script detection, explicit-value extraction, missing-model failure behavior, severity/contradiction comparisons, pattern counts, operator corrections, alert review/simulated delivery, and actual-record analytics calculations with mocked AWS clients. These tests do not validate translation quality, live DynamoDB writes, or external alert delivery.

## Limitations and Verification Scope

- Backend tests use mocked DynamoDB and S3 clients. They verify route validation, transaction construction, report grouping, risk calculations, resource/response updates, and audio retention on transcription failure; they do not prove live AWS writes or playback.
- The browser smoke test uses intercepted API responses. Real English/Hindi/Punjabi recordings, live S3 retention, DynamoDB persistence, and real operator credentials still need deployment-environment verification.
- `GET /incidents` currently paginates a DynamoDB table scan because the existing table has no query index for a consolidated snapshot. At scale, replace it with a query-oriented index or maintained dashboard projection before increasing refresh frequency.
- `seed_dynamodb.py` reads the fixed-location definitions from `mockData.json` and writes only location reference records. Simulated reports, incidents, and briefs are never seeded into operational storage; legacy sample IDs are excluded from operational API snapshots.
- OpenStreetMap tiles require network access and should be used in accordance with the tile usage policy. Incident details still load if map tiles are unavailable.

## Phase 5 security and operations

- Protected control-room reads require a configured viewer or higher role; write endpoints require operator or administrator access. Citizen report submissions remain public by design.
- CORS is restricted to `RESQGRID_ALLOWED_ORIGINS`. AWS table/bucket/region configuration is environment-based, and boto3 uses the standard credential chain with bounded connection/read timeouts and retries.
- Brief generation, audio access, verification, response assignment, resource changes, alert lifecycle, and report analysis corrections require operator authorization.
- Flask enforces a 10 MiB request limit and returns sanitized JSON for HTTP and unexpected server errors. Audio upload formats and metadata are checked before storage.
- The database still uses full table scans for dashboard/intelligence/analytics snapshots. Data pagination/indexing is a production scaling task, not solved by the existing table schema.
- No provider was selected and the application was not deployed publicly. Hosting and running-cost estimates require an approved provider, operating region, expected traffic, retention, and transcription model size.
- Optional IndicTrans2 translation still needs a compatible runtime and real Hindi/Punjabi quality testing. No external paid AI or messaging API is integrated.

## Project documentation

- [Architecture](./ARCHITECTURE.md) and [technology stack](./STACK.md)
- [API reference](./docs/API.md)
- [DynamoDB model](./docs/DATABASE.md)
- [AWS setup](./docs/AWS_SETUP.md)
- [Deployment preparation and rollback](./docs/DEPLOYMENT.md)
- [Testing instructions](./docs/TESTING.md)
- [Demonstration workflow and limitations](./docs/DEMONSTRATION.md)
- [README limitations and future development](./README.md#limitations-and-verification-scope)
