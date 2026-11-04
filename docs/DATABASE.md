# DynamoDB Data Model

ResQGrid reuses the configured DynamoDB table with string partition and sort keys (`PK`, `SK`). No new table, index, or migration is introduced by this phase.

## Record families

| Entity | Partition key | Sort key | Common fields |
|---|---|---|---|
| Fixed location | `PLACE#{place_id}` | `METADATA` | `place`, `district`, `lat`, `lng` |
| Individual report | `REPORT#{report_id}` | `METADATA` | `original_text`, type, place, severity, timestamps, verification status, analysis and translation metadata, optional private `audio_s3_key` |
| Incident | `INCIDENT#{incident_id}` | `METADATA` | type, place/coordinates, severity, status, report IDs/count, grouping reason, response assignments and history |
| Resource | `RESOURCE#{resource_id}` | `METADATA` | type, total/available/deployed/unavailable quantities, status, deployment and update history |
| Current brief | `BRIEF#CURRENT` | `METADATA` | version, state, sections, generation/approval metadata |
| Archived brief | `BRIEF#ARCHIVE#{version_id}` | `METADATA` | prior brief sections and archive metadata |
| Alert | `ALERT#{alert_id}` | `METADATA` | locations, severity, urgency, messages by language, status and operator history |

AWS transactions are used for workflows that need coordinated resource/incident or current/archive brief writes. Reports remain individual records when associated with an incident.

## Consistency and operations

- DynamoDB writes retain original report text and do not automatically set human verification to confirmed.
- `Idempotency-Key` and the body/form `submission_id` are hashed into report IDs. Reuse the same ID for retries and issue a new one for each separate citizen action, including identical text. A request missing both is rejected because the server cannot safely distinguish a retry from a separate identical submission.
- Operational writes are marked `data_classification=operational`. Simulated records and the legacy mock IDs are excluded from report snapshots, situation briefs, patterns, and analytics. `seed_dynamodb.py` now initializes fixed locations only; it does not persist mock reports, incidents, or briefs.
- S3 object keys are not included in public report payloads. Audio bytes are fetched only through the authenticated API.
- Dashboard, intelligence, analytics, resources, and archive-list snapshots use a DynamoDB `Scan` and paginate through all `LastEvaluatedKey` pages. This is required by the current entity-specific keys (`REPORT#{id}`, `INCIDENT#{id}`, etc.): DynamoDB `Query` requires an exact partition-key value, and no GSI or shared entity partition exists to query all reports/incidents. Known report and brief IDs already use `GetItem`; canonical place lookup now uses exact-key `GetItem` before its case-insensitive fallback scan. Report submission reuses its loaded snapshot for incident grouping instead of performing a second full scan.
- `GET /incidents` and the analytics/intelligence responses currently return complete joined snapshots without an API cursor. Adding response pagination alone would make the current map/evidence/dashboard view incomplete; production-scale pagination needs a coordinated API/client change, ideally alongside an approved query-first index or maintained projection. No index/resource migration is included here.
- Tests replace boto3 table/client objects with mocks. No AWS resources or live data are created by the automated test suite.

## Backups and retention

Configure DynamoDB point-in-time recovery, S3 versioning/retention, and access logging in the approved AWS account according to operational policy. The application does not configure or verify these account-level controls automatically.
