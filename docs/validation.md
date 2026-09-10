# Validation report — September 10, 2026

## Passed

- Production Next.js build and TypeScript checking.
- 14 database-backed TypeScript tests: SIWE replay/browser binding, origin validation, private meeting isolation (including workspace owners), explicit sharing/revocation, viewer restrictions, optimistic concurrency and transcript timing, citation validation, email-bound invitations, last-owner protection, exports, deletion fencing, account merging with fresh proofs, email code reuse/attempt limits, and account deletion.
- 8 Python tests: notes shape/evidence/date validation, reviewed-action preservation, exclusive leases, expired-lease fencing, deletion during processing, and silence handling.
- Real local API smoke using a generated wallet and a short fictional synthesized recording: SIWE → signed S3-compatible multipart upload → resume listing → idempotent completion → multilingual Whisper `small` → local Qwen2.5 1.5B notes with strict JSON schema → range playback → editing → meeting deletion → account deletion. The recording produced five transcript segments and one proposed action. This validates operation, not extraction completeness or production accuracy.
- Local worker container built and ran as an unprivileged user. Local PostgreSQL and MinIO were used; no production CRM database or private CRM records were used.

## Fixes found through validation

- Adapted local MinIO setup for its server-level CORS and unsupported incomplete-upload lifecycle configuration; worker cleanup remains active.
- Bound upload part signatures to their expected byte length.
- Handled empty notes API keys for a local model service.
- Added strict JSON schema generation after the small model returned a structurally invalid summary.
- Preserved transcript editing version tokens and existing sharing recipients.
- Fenced old worker leases and protected deleted meetings from late publication.

## Still required before operational production launch

- Hands-on browser and microphone/device QA. Browser automation was unavailable because the environment could not verify its admin-enforced browser policy; no alternate browser-control path was used.
- Diarization adapter/model validation; optional diarization is not installed in the default worker image.
- The 20–30 recording evaluation, language/noise breakdown, action-precision target, long-meeting latency, concurrent-load testing, and mobile interruption checks.
- Production email delivery, database/object storage/worker setup, region/budget selection, final privacy/operator details, backup restore rehearsal, final-domain DNS/HTTPS/SIWE tests, and production retention verification.

The implementation is a beta. A demo-only Vercel deployment is not evidence that production recording infrastructure is configured.
