# Testing

Automated tests use mocked AWS clients; they do not create real AWS resources.

## Backend

From `backend`:

```powershell
python -m unittest -v
python -m py_compile app.py aws_config.py intelligence.py wsgi.py test_phase4.py test_voice_report.py
```

The current suites cover report and voice submission, transcription success/failure, idempotency, grouping, verification, private audio access, resource changes/assignments, response status history, brief lifecycle, alert review, analysis, analytics, validation, and authorization.

## Frontend

From the project root:

```powershell
npm ci
npm test
npm run build
npm audit
```

Vitest/jsdom and Testing Library exercise report form validation/failure states, audio type validation and explicit sample labeling, incident card selection, search/filter callbacks, operator sign-in states, and authenticated API requests.

## Manual integration tests still required

Use an isolated AWS environment and real configured credentials to check:

1. English text intake and idempotent resubmission.
2. English, Hindi, and Punjabi audio upload, real transcription, and private S3 retention.
3. Operator/viewer role restrictions and audio playback.
4. Report-to-incident association, human verification, approved brief generation, and resource assignment.
5. Browser polling after a new report and data persistence after refresh.

The current environment has not run these live AWS/model integration tests. Hindi/Punjabi translation is unavailable until the optional local model is installed in a compatible runtime.
