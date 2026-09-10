# Validation report — September 10, 2026

## Passed

- Production Next.js build and TypeScript checking.
- 19 TypeScript tests, including database-backed security checks: SIWE replay/browser binding, origin validation, private meeting isolation (including workspace owners), explicit sharing/revocation, viewer restrictions, optimistic concurrency and transcript timing, citation validation, email-bound invitations, last-owner protection, exports, deletion fencing, account merging with fresh proofs, email code reuse/attempt limits, and account deletion. Additional checks cover Google OAuth session binding/replay/privacy, unsafe event filtering, encrypted-token tamper detection, CRM approved-selection enforcement, reviewed-meeting changes, and duplicate publication.
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
- The initial 20-case synthetic pilot is complete; [results](evaluations/synthetic-pilot.md) expose poor action extraction in the small local model. Improve the model/extraction and complete independent real-meeting review, long-meeting latency, concurrent-load testing, and mobile interruption checks.
- Production email delivery, object storage/worker integration, final privacy/operator details, backup restore rehearsal, final-domain DNS/HTTPS/SIWE tests, and production retention verification.

The implementation is a beta. A demo-only Vercel deployment is not evidence that production recording infrastructure is configured.

## Integration release checks

CRM passes 40 tests and a production build, including destination sharing inheritance, PKCE rejection/replay, duplicate publication, membership downgrades, and grant revocation. AutoNote passes its production build. Dedicated Frankfurt Neon preview/production schemas and the additive CRM production schema migration succeeded. Google OAuth tests use synthetic provider responses; a real Google account connection has not been verified.
