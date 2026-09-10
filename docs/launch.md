# AutoNote free on-device beta

Target: https://autonote.bittrees.org. Budget: free resources only.

## Operating configuration

- Next.js on Vercel; functions in Frankfurt.
- Separate Neon free-plan preview and production databases in Frankfurt. Device schema migrated September 10, 2026.
- Browser Whisper base, quantized WASM, pinned model revision. Audio stays in IndexedDB and never goes through a recording upload endpoint in device mode.
- Deterministic quoted highlights replace the small generative notes model that failed the earlier pilot. No owners, dates, or recommendations are invented. Candidates require review.
- Resend sign-in through the existing verified Bittrees CRM sender, branded AutoNote. No public incoming support mailbox has been confirmed. Public GitHub issues are for non-sensitive product reports only; export/deletion is self-service.
- No production S3 recording storage, Python worker, or paid inference endpoint. The existing empty Blob store is unused.
- Daily authenticated cleanup expires sign-in state, integration selections/previews, and budget counters.

Required Vercel variables: DATABASE_URL, AUTH_SECRET, CRON_SECRET, APP_URL, PROCESSING_MODE=device, AUTONOTE_MODE=live, RESEND_API_KEY, EMAIL_FROM, DEV_EMAIL_CONSOLE=false. Preview secrets and databases are separate. Never commit environment files.

## Free beta boundaries

50 active accounts, 20 active meetings per account, 100 MB / 30 minutes per recording, 60,000 transcript characters, three recent edit revisions, and a 300 MB database guard. AutoNote reserves at most 50 sign-in emails/day and 500/month. Provider allowances are shared with other account projects and can still pause service; do not enable overage billing or paid resources. Initial support is desktop Chromium. English is primary; Portuguese remains a pilot language. Model loading requires an internet connection; long recordings and low-memory devices need further evaluation.

Google Calendar/Meet selection needs Google OAuth credentials and a live connection test. Selection does not record a meeting. CRM publication requires the user to review the target and selected content. No unattended bot or automatic publication is enabled.

## Validation

- 25 TypeScript tests cover email/SIWE, identity recovery, isolation, sharing, deletion, integration boundaries, quoted highlights, device-save idempotency and malformed transcripts.
- Local browser: actual 8.76-second fictional WAV → Whisper base → saved transcript → cited highlights → local blob playback. Corrected quote extraction tested against its actual punctuation/timestamp boundaries.
- TypeScript and production build pass. Dependency audit reports zero vulnerabilities after the transitive sharp override.
- `scripts/device-smoke.ts` is the deployment API check: generated wallet accounts, final-origin SIWE, private/idempotent saves, isolation, exports, edits, deletion and blocked raw-audio upload; temporary accounts are deleted.
- The earlier 20-case server Whisper-small/Qwen pilot is historical and is not a quality benchmark for browser Whisper base. See evaluations/synthetic-pilot.md. No claim of broad language, mobile, or long-meeting validation is made.

## Operations and rollback

Check deployment health, authentication delivery, database size and free-plan allowances in provider dashboards. Do not log transcripts, codes, signatures, cookies, or connection credentials. Download recordings and exports you need to retain: browser storage may be evicted. Neon free restore history is limited (currently up to six hours or 1 GB of changes). No separate audio backup is maintained.

For code rollback, return to a tested device-mode release with the forward-compatible schema. If only the old demo release is available, set AUTONOTE_MODE=demo and redeploy it; do not point old server-mode behavior at the device launch. Do not drop data to reverse migrations. Restoring database history must reconcile deletion tombstones before users regain access. A full disaster-recovery exercise remains future operating work.

## Next milestones

1. Configure a monitored private support/privacy inbox.
2. Configure and test Google OAuth for primary-calendar/Meet selection.
3. Pilot longer consented recordings, Portuguese, additional browsers, recording interruption and device-storage eviction.
4. Evaluate better local summarization and explicit-action precision before adding generative notes.
5. Add tab/system-audio capture and unattended capture only after a supported capture design and free-resource feasibility are established.
