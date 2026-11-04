# Technology Stack

## Runtime

| Technology | Version | Purpose |
|---|---:|---|
| Python | Python 3 (project uses the selected local interpreter) | Flask backend and AWS workflows. |
| Node.js | Node 20.19+ or 22.12+ recommended | Frontend build/test tooling. |
| React | 18.3 | Control-room interface. |
| Flask | 3.0.3 | Backend API. |

## Dependencies

| Package | Scope | Purpose |
|---|---|---|
| boto3 | Backend | DynamoDB and S3 clients. |
| faster-whisper | Backend | Local audio transcription. |
| Flask-CORS | Backend | Allowlisted browser origins. |
| Waitress | Backend | Production WSGI server; TLS must terminate at an approved HTTPS proxy. |
| React, React DOM | Frontend | UI. |
| Leaflet | Frontend | Emergency map. |
| Vite, `@vitejs/plugin-react` | Frontend build | Development server and static production bundle. |
| Vitest, jsdom, Testing Library | Development/test | Frontend automated tests. |
| Tailwind CSS | Frontend build | Existing design system styling. |

Exact resolved JavaScript versions are recorded in `package-lock.json`. Backend dependency versions are in `backend/requirements.txt`; boto3 is currently not pinned.

## Infrastructure

| Service | Provider | Purpose |
|---|---|---|
| DynamoDB | AWS | Application metadata using the existing table. |
| S3 | AWS | Private original audio. |
| IAM | AWS | Backend-only permissions; prefer instance/task roles over access keys. |
| HTTPS reverse proxy | Not selected | TLS termination and forwarding to the private Waitress listener. |

No hosting provider or real messaging provider has been chosen. Alert delivery remains explicitly simulated.

## Configuration

| Variable | Purpose | Required for configured use |
|---|---|---|
| `AWS_REGION` | AWS region (defaults to `ap-south-1`). | Yes |
| `RESQGRID_ENV` | Environment mode; production disables default development CORS origins. | Production |
| `RESQGRID_DYNAMODB_TABLE` | DynamoDB table name (defaults to `ResQGrid`). | Yes |
| `RESQGRID_AUDIO_BUCKET` | Private S3 bucket name. | Voice reporting |
| `RESQGRID_ALLOWED_ORIGINS` | Comma-separated exact browser origins. | Production |
| `RESQGRID_OPERATOR_PASSWORD_HASHES` | JSON mapping of operator names to Werkzeug password hashes. | Operator access |
| `RESQGRID_OPERATOR_ROLES` | JSON mapping of names to `viewer`, `operator`, or `administrator`. Missing role entries default to read-only `viewer` when this map is configured. | Recommended |
| `FLASK_HOST`, `FLASK_PORT`, `FLASK_DEBUG` | Development Flask binding only. | No |
| `WHISPER_MODEL_SIZE` | Faster-Whisper model name (defaults to `base`). | No |
| `REPORT_GROUPING_WINDOW_MINUTES` | Report matching window (defaults to 30). | No |
| `VITE_FLASK_API_URL` | Frontend API origin; leave unset for same-origin/reverse-proxy deployment. | When API is cross-origin |
| `RESQGRID_API_PROXY_TARGET` | Vite development proxy destination (defaults to `http://127.0.0.1:5000`). | No |
