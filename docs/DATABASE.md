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
- Idempotency keys are hashed into report IDs. Reusing the same key returns the existing report rather than uploading/creating a duplicate.
- S3 object keys are not included in public report payloads. Audio bytes are fetched only through the authenticated API.
- The backend currently uses paginated `Scan` calls and filters record prefixes in application code. It does not have a GSI for report-by-incident, incident-by-location, or time-range queries.
- The existing model can grow without a migration, but scan cost/latency grows with the table. Before production scale, review a query-first schema or GSI and update the dashboard to consume paginated results.
- Tests replace boto3 table/client objects with mocks. No AWS resources or live data are created by the automated test suite.

## Backups and retention

Configure DynamoDB point-in-time recovery, S3 versioning/retention, and access logging in the approved AWS account according to operational policy. The application does not configure or verify these account-level controls automatically.
