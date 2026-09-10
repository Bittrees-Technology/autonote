# AutoNote by Bittrees

**[Open AutoNote](https://autonote.bittrees.org)** · [GitHub](https://github.com/Bittrees-Technology/autonote)

An MIT-licensed meeting workspace: record or upload, transcribe with Whisper, review notes and actions, and share deliberately.

**Release status:** free on-device beta. The hosted app runs Whisper in your browser; audio stays on the device. Only transcripts and editable, quoted highlights are synced. No paid inference service or recording storage is required for this mode.

## Included

- CRM-style email-code and Ethereum EOA sign-in, verified identity linking, reviewed recovery, and workspaces.
- Owner/editor/viewer roles, email-bound invitations, private meetings and selected-member or workspace sharing.
- Browser microphone recording, pause/stop, local recovery and downloads; importing supported audio/video files.
- Quantized Whisper base in a browser worker, local playback, cancellation, and resumable transcript saving.
- Quoted highlights and action candidates with source references. No inferred owners or deadlines and no generated recommendations in this mode.
- Editable timestamped transcripts, notes and action status; Markdown, text, JSON, SRT and WebVTT exports.
- Immediate device-meeting content deletion and account export/deletion.
- Optional reviewed Bittrees CRM publication. Google Calendar selection is implemented but requires OAuth configuration.

Free hosted beta limits: 50 active accounts, 20 active meetings per account, 100 MB / 30 minutes per recording, and bounded shared database/email allowances. Desktop Chromium is the initial tested browser. English is primary; Portuguese is experimental. Keep the tab open during transcription. The first run downloads the speech model; processing speed depends on the device. Back up important recordings and exports yourself.

Speaker labels are **Unlabeled speaker** until manually edited. This release does not perform diarization or automatically record Google Meet. Microphone capture does not reliably include remote participants heard through headphones; import a consented recording that contains all speakers.

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

The hosted device mode requires PostgreSQL, a new AUTH_SECRET, verified Resend sender, `PROCESSING_MODE=device`, `AUTONOTE_MODE=live`, and `APP_URL=https://autonote.bittrees.org`. Set a separate CRON_SECRET for daily housekeeping. Apply the database migration before deploying. Keep preview and production databases and secrets separate. Neither S3 nor the Python worker is used by device mode.

The original self-hosted server mode remains available (`PROCESSING_MODE=server`) using private S3-compatible storage, the Python faster-whisper worker, and an explicitly configured notes provider. Their operating costs and quality checks are the self-hosting operator's responsibility.

See [launch status and operations](docs/launch.md). `AUTONOTE_SMOKE_URL=https://your-deployment npx tsx scripts/device-smoke.ts` runs an explicitly targeted synthetic API check and deletes its own temporary accounts. Browser Whisper inference must also be checked with a fictional audio file.

## Scope boundaries

This release matches CRM sign-in behavior, not shared SSO. Unattended meeting bots, full tab/system audio, native clients, live coaching, generated recommendations, and semantic Q&A remain future work. No paid resources should be added without approval.

The meeting library currently loads the latest 200 visible meetings and searches that set in the interface; the API also supports permission-filtered full-text queries. This is suitable for the initial pilot. Pagination is required before wider usage.

The software license does not include hosting, inference service charges, or third-party model rights. Review [third-party notices](THIRD_PARTY_NOTICES.md).

## Calendar and CRM integrations

Google Calendar/Meet is the first supported calendar target. Read-only connection and individual event selection are implemented for manual recording; no meeting bot is running. Google OAuth setup is required. Bittrees CRM supports a scoped destination connection and reviewed publication of summaries and accepted actions. See [integration setup](docs/integrations.md).

The current hosting budget is free resources only. Vercel defaults to demo mode until `AUTONOTE_MODE=live` is explicitly set after the launch gates pass. Separate free Frankfurt databases are provisioned, but live recording storage and a free processing host still need to be connected.
