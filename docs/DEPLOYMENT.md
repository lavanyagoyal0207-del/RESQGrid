# Deployment Preparation

No hosting provider has been selected and no public deployment has been performed. Selecting a provider requires an explicit approval after its estimated compute, storage, network, and AWS costs are reviewed.

## Configuration separation

- Local backend values: copy `backend/.env.example` to a local, untracked environment file or export variables in the process environment.
- Production backend values: configure them in the chosen host's protected environment/secret facility. Do not copy real values into source control.
- Frontend build-time API origin: copy `.env.production.example` to an untracked `.env.production` and set `VITE_FLASK_API_URL`, or leave it unset when the approved reverse proxy serves both frontend and `/` API paths on one HTTPS origin.
- Set `RESQGRID_ENV=production` and `RESQGRID_ALLOWED_ORIGINS` to exact production frontend origins. Do not use wildcard origins. Production mode does not fall back to development CORS origins.

Vite embeds `VITE_*` values into the browser bundle. Only public API origins belong there; never place credentials or AWS secrets in frontend variables.

## Build and serve

Build the static frontend:

```powershell
npm ci
npm run test
npm run build
```

Install backend dependencies and run the WSGI app from the `backend` directory:

```powershell
python -m pip install -r requirements.txt
waitress-serve --listen=127.0.0.1:5000 wsgi:app
```

Waitress is an HTTP WSGI server; it does not configure TLS. In production, bind it to a private interface and place it behind an approved HTTPS reverse proxy/load balancer that enforces TLS, request limits, and appropriate forwarding headers. Keep the S3 bucket private and use an IAM role for AWS access.

## Pre-deployment checklist

- [ ] Choose hosting only after the cost/security review and explicit approval.
- [ ] Set backend operator password hashes and roles using protected configuration.
- [ ] Configure exact frontend CORS origins, database/table, region, and private audio bucket.
- [ ] Restrict the backend IAM role to the one DynamoDB table and audio prefix.
- [ ] Configure HTTPS, monitoring, log retention, backups/PITR, and S3 retention.
- [ ] Check `npm audit`, backend dependency review, automated tests, and production frontend build.
- [ ] Verify report intake, operator login, read/write access, audio proxy, and AWS persistence in a non-production environment.
- [ ] Confirm backup restoration and rollback before handling real reports.

## Rollback

1. Stop or route traffic away from the newly deployed API/frontend.
2. Restore the last known-good backend and static bundle from the deployment artifact.
3. Keep the database and S3 objects intact; this phase introduces no destructive migration.
4. If data corruption is suspected, follow the account owner's DynamoDB point-in-time recovery and S3 retention procedures. Do not delete records as a rollback shortcut.
5. Re-run smoke tests in a restricted environment before restoring traffic.

This repository does not yet include provider-specific infrastructure-as-code, a CI/CD workflow, a production reverse-proxy configuration, or live AWS deployment verification.
