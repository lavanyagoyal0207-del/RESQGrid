# AWS Setup

This guide documents required permissions; it does not create AWS resources. Confirm the AWS account, region, retention policy, and operating budget with the service owner before provisioning.

## Required configuration

Set these in the backend process environment:

- `AWS_REGION` (default `ap-south-1`)
- `RESQGRID_DYNAMODB_TABLE` (default `ResQGrid`)
- `RESQGRID_AUDIO_BUCKET` (required for voice uploads)

The backend uses boto3's credential chain. Prefer an IAM role attached to the backend runtime. For local development, use a named AWS CLI profile (`AWS_PROFILE`) instead of embedding access keys in source or frontend configuration.

## DynamoDB permissions

Grant the backend identity access only to the configured table. The current implementation uses table scans, item reads/writes/updates, and transactions; the policy therefore needs the corresponding `Scan`, `GetItem`, `PutItem`, `UpdateItem`, and `TransactWriteItems` permissions. Scope each action to the one table ARN and its indexes where appropriate.

The current table must have string partition and sort keys named `PK` and `SK`. See [DATABASE.md](./DATABASE.md) for record prefixes.

## S3 permissions and privacy

- Keep all Block Public Access settings enabled and do not add a public bucket policy or public ACL.
- Grant the backend `s3:PutObject` and `s3:GetObject` on only the audio prefix used by the application.
- Use bucket-owner-enforced object ownership and default server-side encryption according to the organization's policy.
- Configure lifecycle/retention only after audit and legal requirements are agreed.
- The frontend must never receive bucket credentials, a public object URL, or an S3 key.

## Validate safely

1. Use a non-production AWS account or isolated test table/bucket.
2. Verify the backend role can write/read only the configured resources.
3. Confirm an anonymous request to `GET /reports/{id}/audio` is rejected and an authorized request streams through Flask.
4. Confirm the object is private with an unauthenticated S3 request denied.
5. Do not run `backend/seed_dynamodb.py` against an operational table.

AWS charges depend on region, request volume, stored bytes, retention, and transcription compute. No AWS resources were created or queried as part of the Phase 5 automated tests.
