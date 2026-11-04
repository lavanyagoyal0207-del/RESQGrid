# ResQGrid Architecture

## Overview

ResQGrid is a React/Vite control-room interface backed by a Flask JSON API. Flask reads and writes incident metadata in DynamoDB, stores voice recordings in S3, and serves audio through an authenticated proxy. Report intake remains available to citizens; control-room data and mutations require an operator role.

```text
Citizen browser
  | text/audio intake
  v
React + Vite -----------------------> Flask API
  | control-room requests              |-- operator authentication/RBAC
  | 15-second polling                  |-- report/incident workflows
  |                                     |-- local Whisper and intelligence
  |                                     |-- DynamoDB metadata
  |                                     `-- private S3 audio proxy
  `-- report/map/brief/analytics UI
```

## Components

| Component | Purpose |
|---|---|
| `src/App.jsx` | Dashboard state, polling, operator access, and cross-component workflows. |
| `src/services/api.js` | HTTP client, request deadlines, environment-specific API URL, and operator headers. |
| `src/components/` | Map, incident queue/detail, reporting, resources, briefs, alerts, and analytics views. |
| `backend/app.py` | Flask routes, authentication, validation, DynamoDB/S3 workflows, and JSON errors. |
| `backend/intelligence.py` | Local language detection, conservative extraction, translation adapter, report comparisons, and count-based patterns. |
| `backend/aws_config.py` | Environment-based AWS region/table/bucket setup and bounded botocore retries/timeouts. |
| `backend/wsgi.py` | WSGI entry point for Waitress. |
| `backend/test_*.py` | Backend unit/API tests with mocked AWS clients. |
| `src/**/*.test.jsx`, `src/**/*.test.js` | Frontend component and API-client tests. |

## Data flow

1. `POST /report` or `POST /voice-report` validates a citizen submission and its idempotency key.
2. Voice audio is uploaded to private S3 before transcription. Transcription failures preserve the recording and report metadata.
3. Reports are associated with an incident using stored location, type, and time criteria. Original reports remain independently stored.
4. Operator actions record an identity and timestamp. AI recommendations do not confirm incidents or dispatch resources.
5. The control-room client polls authenticated `GET /incidents` while the page is visible.
6. Audio playback is streamed from S3 only after backend operator authorization.

## Integrations

| Service | Purpose |
|---|---|
| AWS DynamoDB | Incident, report, resource, brief, alert, and response metadata. |
| AWS S3 | Private original voice recordings. |
| Faster-Whisper | Local audio transcription; no AWS Transcribe integration. |
| IndicTrans2 (optional) | Local translation adapter; dependencies/model weights are not installed or validated in the current Windows environment. |
| CartoDB tiles | Basemap tiles requested by Leaflet; incident coordinates come from stored/configured locations. |

## Security boundaries

- AWS uses the boto3 credential chain (IAM role, profile, or environment); no AWS access key is embedded in the frontend.
- CORS permits only origins listed in `RESQGRID_ALLOWED_ORIGINS`; local Vite origins are the development default.
- Read-only control-room roles can retrieve operational data. Operator/admin roles can use write endpoints. Citizen report submission remains unauthenticated by design.
- Original audio keys are not returned in public report payloads. Audio requires authenticated backend proxy access.
- The application has a 10 MiB Flask request limit, endpoint-specific input checks, sanitized HTTP/500 JSON errors, and security headers.

## Known architectural limits

- The current table has no query-oriented index or materialized dashboard projection. `GET /incidents`, analytics, and intelligence workflows scan and paginate through the table in application code. This is acceptable only for a small prototype; add a reviewed GSI/projection and API pagination before production scale.
- Operator credentials are sent with HTTP Basic on each request. TLS is mandatory outside local development; credential rotation, rate limiting, and centralized identity management remain deployment concerns.
- Deployment is not selected or performed. See [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md).
