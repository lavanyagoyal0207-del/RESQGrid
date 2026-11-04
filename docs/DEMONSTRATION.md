# Demonstration Workflow

## Prerequisites

Run the backend with an isolated DynamoDB table, private S3 bucket, IAM credentials, configured operator account, and exact CORS origins. The frontend sample buttons are **demo content** and are not citizen submissions or real-world incidents.

The current workspace does not have live AWS credentials configured, and the optional IndicTrans2 stack is not installed or validated on this Windows/Python environment. Therefore, the steps below describe a real integration demonstration after prerequisites are met; this workspace's unit tests are mocked and are not evidence of live service behavior.

## Operator/citizen walkthrough

1. Open the dashboard and sign in with a configured viewer/operator account to load stored control-room data.
2. Open the report form and submit a text report with a configured location, incident type, and severity.
3. Upload an actual Hindi or Punjabi audio file. Verify that the backend keeps the original recording private in S3, stores the report in DynamoDB, and displays the actual transcript/language/status. Translation is shown only when the optional local model works; it must not be substituted with fabricated text.
4. Inspect the incident detail's individual evidence and grouping reason. Similar reports are not proof and are not automatically confirmed.
5. Sign in with an operator account, review the original report and evidence, then explicitly confirm or reject it.
6. Generate a situation brief, edit it if needed, and explicitly approve it. Generated drafts are not published automatically.
7. Add or select a real operator-entered resource, associate it with the incident, and record response status changes.
8. Observe the dashboard refresh and verify that the report, incident, verification, brief, resource, and response history persist after a reload.

## Safety checks

- Never use mock voice samples as real incidents.
- Never interpret heuristic risk/pattern output as a validated disaster prediction.
- Alert "send" records simulated delivery only; there is no real SMS or emergency broadcast connection.
- Do not demonstrate against a production table or real S3 data unless the operator authorizes that test.
