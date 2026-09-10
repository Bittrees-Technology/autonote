# AutoNote — launch and next steps

The code is an implementation beta, not a completed public-service launch. Do not enable real customer recording on a demo-only Vercel deployment.

## 1. Configure production services

- PostgreSQL: a dedicated database with backups, an explicit retention schedule, TLS, and pooled web connections. Run the checked-in migration against the new database.
- Recording storage: a private S3-compatible bucket, permitted web-origin CORS, short-lived upload and playback grants, incomplete-upload cleanup, and no public bucket policy. Set a separate preview bucket.
- Whisper worker: deploy the container on a chosen CPU/GPU host. Start with one worker; measure latency and throughput before increasing concurrency. Use a multilingual Whisper model for Portuguese. Verify storage cleanup is running even when the transcription queue is quiet.
- Notes provider: choose a production model after checking quality and data handling. Set the endpoint, model, and credentials on the worker only. Test long meetings and invalid provider responses. A provider outage leaves the transcript accessible and exposes a retry path.
- Email: verify the Resend sender and deliver real sign-in codes. Turn off console delivery. Use a new production AUTH_SECRET.

The approved budget is **free resources only**. Separate Neon free-plan databases in Frankfurt are provisioned for preview and production, and their schemas have been migrated. A private Frankfurt Vercel Blob store has been created but is empty and not connected to application uploads; the working application storage adapter is still S3-compatible. Do not enable billable storage usage or a paid worker/model service.

Vercel deployments default to demo mode even when a database is present. Set `AUTONOTE_MODE=live` only after all operational gates pass. Local/self-hosted environments retain their existing behavior. No recording host or production notes endpoint is connected yet. Existing local Whisper, MinIO, and Ollama resources remain available for development without purchasing cloud compute.

## 2. Complete the pilot gates

- Browser QA on supported Chrome/Safari desktop and mobile: email, wallet cancellation, identity linking and recovery, keyboard/focus, 200% zoom, upload retry, recording interruption, IndexedDB limits, pause/stop, sharing revocation, and audio seek.
- Diarization: install the optional dependency and model only if automated speaker separation is needed at launch. Confirm model access/license and telemetry settings; evaluate overlapping speakers. Otherwise keep “Unlabeled speaker” and manual naming explicit.
- The first 20 synthetic cases are evaluated in [the pilot report](evaluations/synthetic-pilot.md). The small local notes model failed action extraction quality; improve it and review 20–30 consented recordings by language and noise condition. Score transcript quality and explicit-action precision. Measure the proposed 60-minute/10-minute latency target under realistic load; it has not been established by a short smoke test.
- Verify retained audio expires, deleted meetings cannot be restored by late jobs, queued uploads cannot exceed quotas, and orphaned uploads are removed.
- Confirm each provider and region, supply the operator’s privacy contact and backup-expiry policy, and update the privacy page before public registration.

## 3. Publish the operational service

- Configure Vercel preview and production environments with separate resources.
- Deploy a preview connected to preview services; run the complete upload-to-notes workflow and real email sign-in.
- Use an immutable release and a production migration that is backward compatible with the previous release.
- Attach autonote.bittrees.org only once its operational services and pilot gates pass. Verify DNS, HTTPS, correct APP_URL, SIWE domain binding, sender delivery, storage CORS, and the final-domain session cookie.
- Publish the MIT source release and keep private data out of issues and fixtures.

## 4. Operate, restore, and roll back

Track queue depth/age, failed jobs by stage, lease expiry, minutes processed, worker time, storage size, notes-model usage, and deletion backlog. Never log transcript text, codes, signatures, session tokens, or presigned URLs.

Back up PostgreSQL using the selected managed service and private object storage according to the published retention policy. In staging, restore a database backup and a test recording into isolated resources; verify record permissions, playback, and job consistency. Keep restored resources inaccessible to ordinary users until deletion tombstones and retention policy are reapplied. Record the restore time and recovery point.

To roll back code, stop new processing claims, return Vercel and the worker to the previous compatible release, and keep the database schema forward compatible. Do not drop data to reverse a schema change. Expired leases can be retried with the current generation; verify that no old worker can publish after deployment. Restore backups only for actual data-loss incidents, with deletion reconciliation.

## 5. Next product milestone

CRM connection and reviewed, idempotent publication are implemented. Google Calendar/Meet is the confirmed first platform: read-only primary-calendar access and per-event manual-recording selection are implemented, pending Google OAuth credentials and a live browser test. See [integration setup](integrations.md).

The remaining capture milestone is a suitable free worker/storage deployment and explicitly consented unattended Meet capture. Calendar selection alone does not record a meeting. Shared Bittrees SSO remains a separate identity-service decision.
