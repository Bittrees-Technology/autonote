# AutoNote by Bittrees

An MIT-licensed meeting workspace: record or upload, transcribe with Whisper, review notes and actions, and share deliberately.

**Release status:** implementation beta. The core pipeline runs locally; public deployment requires separately configured PostgreSQL, private object storage, email delivery, a worker, and a notes model. A Vercel deployment without these services is a clearly labeled fictional demo, not an operational recording service.

## Included

- CRM-derived email-code and Ethereum EOA sign-in, verified identity linking, reviewed account recovery, rotating sessions, and multiple workspaces.
- Owner/editor/viewer roles, email-bound invitation links, private meetings, workspace sharing, and selected-member grants.
- Browser microphone recording with IndexedDB recovery, pause/stop, local downloads, and direct resumable multipart uploads (1 GB / 2-hour limits).
- Separate Python worker with faster-whisper, VAD, durable PostgreSQL jobs, leases, heartbeats, retries, and deletion fencing.
- A configurable chat-completions-compatible notes model, structured output validation, source references, proposed actions, and preservation of reviewed actions when regenerating.
- Editable timestamped transcripts, notes, action owners/status/dates; audio seeking; library search and filtering; Markdown, text, JSON, SRT, and WebVTT export.
- Recording retention, account export/deletion, asynchronous content cleanup, and a fictional demo.

Whisper handles transcription; the notes model is a separate service. Speaker diarization is optional and must be installed/configured separately; default transcripts show **Unlabeled speaker**, which users can rename. This avoids claiming all speech belongs to one person.

## Local setup

Requires Node 24 or 25 and Docker. The web app is at `http://127.0.0.1:3050`.

1. `npm ci`
2. Copy `.env.example` to `.env.local`; replace `AUTH_SECRET` with a random secret of at least 32 characters.
3. `docker compose up -d postgres storage`
4. `npm run db:migrate`
5. `npx tsx --env-file=.env.local scripts/storage.ts`
6. Configure `NOTES_BASE_URL`, `NOTES_MODEL`, and optional `NOTES_API_KEY`. A local Ollama service can expose its `/v1` endpoint; from the worker container on Docker Desktop, use `http://host.docker.internal:11434/v1`.
7. `docker compose --profile worker up -d --build worker`
8. `npm run dev`

For the initial local validation, Ollama `qwen2.5:1.5b` was used for notes. It is a lightweight development model, not a certified production-quality choice. The default Whisper model is `small` on CPU. Multilingual use requires a multilingual model such as `small` or `large-v3`; `.en` models are English-only. Select worker model and language together before a Portuguese pilot.

In development only, `DEV_EMAIL_CONSOLE=true` prints requested sign-in codes to the local web server console. Production requires a verified Resend sender. The application never prints production email codes. No built-in demo login or production authentication bypass exists.

The MinIO setup binds to loopback and uses explicitly local credentials. Its CORS policy is configured at server level. The setup script tolerates unsupported bucket CORS/lifecycle controls only for the exact local endpoint; production errors are fatal. The worker cleans abandoned application uploads after one day; production storage should also abort orphaned multipart uploads.

## Tests

Create a separate `autonote_test` database and `.env.test` containing `DATABASE_URL`, `APP_URL`, `AUTH_SECRET`, and `DEV_EMAIL_CONSOLE=true`. Then:

- `npm test` — PostgreSQL-backed authentication, account recovery, access, editing, invitation, and export tests.
- `npm run typecheck` and `npm run build`.
- `docker compose run --rm worker python -m unittest test_notes`.
- `docker compose run --rm -e DATABASE_URL=postgresql://autonote:local-autonote-only@postgres:5432/autonote_test worker python -m unittest test_jobs` (run after the TypeScript tests, not concurrently).
- `SMOKE_AUDIO=/path/to/fictional.wav npx tsx --env-file=.env.local scripts/smoke.ts` exercises real SIWE, storage upload, Whisper, the notes model, playback, editing, and deletion through the running API. It uses a generated temporary wallet and deletes its test account. It is restricted to local URLs.

No audio or credentials belong in source control. Browser microphone, interrupted-device capture, responsive visual QA, and accessibility acceptance still require hands-on browser validation; see the release report.

## Deployment

Vercel runs the Next.js web app and short API requests. It does not run the transcription worker. Deploy the Python container to a separate CPU/GPU host with outbound access to the database, bucket, model repository, and configured notes endpoint. Use pooled PostgreSQL for web requests and a direct or session-compatible connection for the worker.

Set production `APP_URL=https://autonote.bittrees.org`, a unique auth secret, verified Resend sender, private S3 configuration, and database URL in Vercel. Configure worker variables separately. Do not use local MinIO credentials, console email, or a developer machine as the production worker. Apply the database migration explicitly before release; requests do not auto-migrate.

Use separate preview and production resources. The production launch sequence, unresolved operating choices, and rollback/restore procedures are in [the launch guide](docs/launch.md).

## Scope boundaries

This release implements matching CRM sign-in behavior, not cross-application SSO. CRM synchronization, calendar connections, meeting bots, browser tab/system audio, native clients, live coaching, semantic cross-meeting Q&A, and hosted billing are later milestones. Microphone capture does not reliably include remote participants heard through headphones.

The meeting library currently loads the latest 200 visible meetings and searches that set in the interface; the API also supports permission-filtered full-text queries. This is suitable for the initial pilot. Pagination is required before wider usage.

The software license does not include hosting, inference service charges, or third-party model rights. Review [third-party notices](THIRD_PARTY_NOTICES.md).
