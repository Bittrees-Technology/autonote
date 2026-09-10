# AutoNote — product and delivery plan

Date: September 10, 2026  
Product: AutoNote by Bittrees  
Planned domain: autonote.bittrees.org  
Planned repository name: autonote; GitHub owner to be resolved at repository creation  
License intent: MIT for original application code, with required dependency notices  
Status: planning complete; implementation and publication are future milestones.

**1. Product direction**

AutoNote turns a recorded conversation into a searchable transcript, clear notes, decisions, and next steps. It serves Bittrees teams, founders, researchers, and people managing relationships through Bittrees CRM.

The first release should deliver one reliable loop: sign in → record or upload → review the transcript and notes → confirm actions → share or export. A subsequent release connects approved outputs to Bittrees CRM and introduces scheduled meeting capture.

The product uses Whisper for transcription. Summaries and recommendations require a separate language model, and automatic speaker separation requires a diarization component. Keep these three responsibilities replaceable.

Assumptions: “MIT version” means an independently implemented, MIT-licensed product; “versel” means Vercel. The requested deliverable is a plan, with GitHub and production publication after implementation. No budget, target languages, or meeting platform priority has yet been specified. Start with an English pilot and evaluate Portuguese as the next language.

**2. Read.ai inspection and feature mapping**

The comparison uses Read.ai’s public product and help pages. Direct app access could not be completed because a browser policy verification check was unavailable. Authenticated screens, account settings, and actual output quality were not tested.

Read documents meeting summaries, discussion points, action items, transcripts, recording playback, and audio/video uploads. These define the core AutoNote workflow. [Read meeting reports](https://www.read.ai/meeting-reports)

Read also documents calendar and conferencing integrations, CRM connections, sharing integrations, APIs, and webhooks. AutoNote should prioritize its own CRM connection before a broad integration catalog. [Read integrations](https://www.read.ai/integrations)

Read’s recommendations include reviewing recurring meetings, meeting duration, and attendance, using participation and engagement signals. AutoNote should begin with recommendations grounded in explicit discussion: unresolved questions, missing action owners, repeated blockers, and a proposed next agenda. [Read recommendations](https://www.read.ai/recommendations)

| Capability | AutoNote first release | Later release |
| --- | --- | --- |
| Capture | Audio/video upload; browser microphone recording | Browser tab audio; calendar-assisted and automated capture |
| Transcription | Whisper, timestamps, editable text, language selection | More evaluated languages; near-live output |
| Speakers | Anonymous speaker labels where diarization passes evaluation; manual naming | Better overlap handling and platform-provided participant mapping |
| Notes | Summary, topics, decisions, actions, unresolved questions | Team templates and recurring-meeting summaries |
| Recommendations | Suggested follow-ups and next agenda with evidence | Cross-meeting blocker and action tracking |
| Retrieval | Search titles and transcripts; filters | Ask AutoNote across permitted meetings with citations |
| Collaboration | Private meetings, explicit workspace sharing, roles | External guest access and expiring share links |
| Integrations | Downloadable Markdown, text, JSON, and subtitle exports | Bittrees CRM, calendars, signed webhooks |

Use original branding, interface design, and implementation. Read.ai is a functional reference, not a source of code, assets, or proprietary scoring methods.

**3. First-release experience**

- Home: recent meetings, processing progress, and actions awaiting review. Primary buttons: Record and Upload.
- Capture: name the meeting, select a workspace and language, show recording notice, check microphone input, then record with a visible timer and pause/stop controls. Save small recoverable chunks and clearly report upload failure.
- Upload: accept a tested set of MP3, WAV, M4A, WebM, and MP4 inputs. Provisional pilot limits: two hours and 1 GB per meeting, enforced again after decoding. Show supported formats and limits before upload.
- Meeting page: summary, decisions, actions, and open questions beside a timestamped transcript and audio player. Clicking evidence seeks to the relevant audio.
- Review: rename speakers, correct transcript text, edit notes, and approve suggested action owners and dates. Preserve original machine output and subsequent revisions.
- Actions: show proposed, accepted, completed, and dismissed items. Never invent a due date or assign a person from uncertain speech; display “Unassigned” or “No date stated.”
- Settings: identities, workspace membership, recording retention, processing provider, usage, exports, and deletion.

Provide accessible keyboard controls, readable transcripts, responsive mobile layouts, and a fictional demo meeting. Mobile browser recording needs explicit device testing, including interruption and backgrounding behavior.

Browser microphone recording captures the microphone, which does not reliably capture remote meeting participants wearing headphones. Browser tab/system audio is a distinct feature with varying browser and OS support; advertise only tested combinations and retain upload as the fallback. [MDN screen/audio capture documentation](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)

**4. Account management aligned with Bittrees CRM**

The inspected local CRM uses Next.js, React, PostgreSQL, Resend email delivery, ethers, and SIWE. Its authentication implementation already provides eight-digit email codes, ten-minute browser-bound challenges, seven-day sessions, verified identity linking, and controlled account recovery. Sources: `crm/lib/auth.ts`, `crm/lib/auth-client.ts`, `crm/lib/recovery.ts`, and `crm/README.md` in this workspace.

Reuse that account behavior with AutoNote-specific branding, domain validation, cookie names, and database migrations. Preserve the CRM’s MIT attribution when reusing code. Review and test the extracted behavior in its new context rather than assuming reuse is sufficient verification.

- One AutoNote user can own multiple verified email and Ethereum identities.
- Either verified method signs into the same AutoNote account once linked.
- Linking requires an authenticated session and proof of control of the new identity.
- If an identity belongs to a separate account, require fresh proof of both accounts and an explicit recovery review before combining data.
- Preserve single-use challenges, expiry, attempt limits, origin checks, session rotation, and server-side session revocation.
- Initial wallet support follows the CRM’s externally owned account support. Smart-contract wallet support is a separate compatibility milestone.
- Reuse owner/editor/viewer role concepts, workspace switching, and email-bound invitations. Enforce every authorization decision on the server.
- A wallet-only user can use the product without email. Email notifications require a linked, verified email address.

Recommended first release: the same sign-in experience with separate AutoNote sessions and application data. This does not automatically sign a CRM user into AutoNote. If shared Bittrees login is required, introduce a central identity service using a standard authorization-code flow and app-specific sessions as an explicit additional milestone. Do not share CRM session cookies across subdomains. CRM and AutoNote identities/workspaces need an explicit authorized mapping for integration.

Meeting visibility needs a separate policy from role labels: private meetings are visible to their creator and explicit recipients; workspace owners administer membership and quotas but do not silently gain access to private recordings. Workspace-shared meetings follow their workspace access rules. Apply the same policy to transcripts, audio, search, exports, and AI answers.

**5. Recommended architecture**

| Component | Proposed implementation | Purpose |
| --- | --- | --- |
| Web and short API requests | Next.js/TypeScript on Vercel | Product UI, authentication, authorization, upload grants, job status |
| Application database | Managed PostgreSQL | Accounts, permissions, meetings, revisions, job records |
| Recording storage | Private S3-compatible object storage | Direct multipart uploads, audio playback, retention |
| Processing queue | Durable PostgreSQL job table initially | Leases, retry scheduling, progress, deduplication |
| Processing worker | Containerized Python on separate compute | Decode media, run Whisper and diarization, generate notes |
| Transcription | faster-whisper with evaluated Whisper weights | Self-hostable transcription; benchmark turbo against large-v3 |
| Notes generation | Replaceable model adapter | Structured summaries and evidence-linked recommendations |
| Email | Resend, matching CRM | Sign-in codes and user-enabled notifications |
| Search | PostgreSQL full-text search initially | Simple, permission-filtered retrieval |

Vercel hosts the product; the recording processor is a separate deployment. Vercel Functions have bounded resources and a 4.5 MB request/response payload limit, so send recordings directly to private object storage using short-lived, permission-checked upload grants. [Vercel limits](https://vercel.com/docs/functions/limitations)

Whisper’s code and model weights are MIT-licensed. faster-whisper is an MIT-licensed implementation suitable for benchmarking CPU and GPU inference. Its published speed comparisons are hardware-specific and are not AutoNote performance guarantees. [Whisper](https://github.com/openai/whisper), [faster-whisper](https://github.com/SYSTRAN/faster-whisper)

Evaluate pyannote for speaker diarization, checking the selected model’s license, access conditions, and telemetry configuration separately from the library. Preserve anonymous speaker labels unless the user explicitly names them; voice clustering does not establish identity. [pyannote.audio](https://github.com/pyannote/pyannote-audio)

Model/provider choice for notes remains a pre-build decision. The adapter should support a hosted provider and a self-hosted option; pick the pilot default after comparing output quality, data handling, licensing, and measured cost. MIT application licensing does not make third-party services free or relicense their models.

**6. Processing, data, and reliability**

Flow: authorized upload → validate object ownership, size, format and duration → normalize audio → detect speech → transcribe → align speaker segments → generate structured notes → validate evidence links → publish a reviewable result.

Persist progress as uploading, queued, transcribing, generating notes, ready, failed, or deleting. Store stage attempts so a notes failure can be retried without repeating transcription. Expose usable transcripts when notes generation fails. Workers claim jobs with leases and heartbeats, use bounded retries, and deduplicate by meeting/version/stage. Rate-limit intake and enforce workspace quotas before allocating processing.

Core records: users, identities, sessions, challenges, workspaces, memberships, meeting grants, meetings, recordings, speakers, transcript segments, transcript revisions, note revisions, decisions, actions, recommendations, jobs, integration connections, audit events, and usage counters.

Every content object belongs to a workspace and meeting. Derived records retain source segment IDs and timestamps. Store processing model/version and prompt version for reproducibility. Transcript corrections mark affected notes stale; regeneration creates a new version and does not overwrite user-approved actions.

Treat meeting speech and transcripts as untrusted input to the notes model. The model cannot send messages, change calendars, access unrelated meetings, or execute CRM writes. Validate structured output and resolve citations against the supplied transcript. Show proposed recommendations separately from decisions actually made in the meeting.

**7. Recording privacy and controls**

Provide an explicit recording notice, visible recording state, pause/stop, and a record of the initiator’s consent/notice acknowledgment. Automated capture later needs a visible bot identity and a stop/opt-out path. An acknowledgment in the interface is a product control, not a claim that all recording-law requirements have been satisfied.

Default all recordings to private; sharing is explicit. Encrypt transport and storage, use short-lived playback links, avoid transcript content in operational logs, and publish the processing providers and regions. Do not train on meeting content by default.

Proposed default: raw recordings expire after 30 days; notes/transcripts remain until deleted, with a shorter configurable policy. Deletion immediately removes access, cancels jobs, and queues removal of audio, transcript, derived notes, search indexes, and temporary copies. Document backup expiry separately. Workers must check deletion/version state before writing results so late jobs cannot restore deleted content.

Include personal-data export and account deletion. Confirm jurisdiction, provider contracts, and retention needs before public launch; do not claim compliance certifications that have not been obtained.

**8. CRM and meeting-platform expansion**

First integration: user selects an authorized Bittrees CRM workspace and links a meeting to a person, organization, opportunity, or project. Present a preview of the summary and proposed tasks; publish only the selected approved content through a scoped integration endpoint. Enforce source and destination permissions, use idempotency keys, and retain the mapping to avoid duplicate tasks. Revoking a connection stops future synchronization; explain that previously copied CRM records are independent copies.

Next, connect calendars with minimal permissions and per-meeting capture opt-in. Pilot one conferencing platform selected from actual Bittrees usage. Validate official recording/import APIs and bot-provider options before committing to implementation. OAuth approval, host permissions, waiting rooms, platform terms, and bot operations are independent delivery risks. Calendar access alone cannot record a call.

After capture reliability, add cross-meeting Q&A with citations and permission-filtered retrieval, recurring-meeting comparisons, and reviewable next-agenda drafts. Defer broad mailbox ingestion, native desktop/mobile clients, live coaching, video-based sentiment, and autonomous communications beyond the initial roadmap.

**9. Delivery milestones and acceptance**

These are planning estimates for one experienced engineer with timely product review and configured infrastructure, not delivery commitments.

| Milestone | Estimate | Completion evidence |
| --- | --- | --- |
| Feasibility and decisions | 2–4 working days | Evaluated sample recordings; chosen model/runtime; measured cost and speed; confirmed capture and identity scope |
| Accounts and capture | 1–2 weeks | Email/SIWE linking and recovery; private workspaces; resumable uploads; microphone recording with recoverable interruptions |
| Transcripts and notes | 1–2 weeks | Background worker; timestamped playback; editable transcript; evidence-linked decisions/actions; retries |
| Pilot and launch preparation | About 1 week | Sharing/export/deletion; quota enforcement; permission and quality tests; accessibility pass; deployment/restore rehearsal |
| CRM connection | 3–5 working days after core release | Reviewed, scoped, deduplicated CRM note/task creation |
| Calendar and automated capture | Separate 2–4+ week estimate | One platform proven end to end; revise estimate after integration spike |

Core private beta estimate: approximately 4–6 weeks, excluding broad meeting-bot support, shared Bittrees SSO, and platform approval delays.

Pilot with 20–30 consented or synthetic recordings covering quiet/noisy speech, accents, overlap, silence, and long meetings. Proposed targets: at least 95% job completion without manual intervention; a 60-minute meeting ready within 10 minutes after upload at the agreed pilot load; at least 90% precision for extracted explicit actions on a human-labeled sample. Treat these as acceptance targets to validate, not current capabilities. Report transcription accuracy by language and recording condition rather than a single unsupported accuracy claim.

Release-blocking checks: no cross-workspace/private-meeting disclosure; no replay of used authentication challenges; identity-link/recovery race handling; upload and playback authorization; no duplicate job effects; deletion during processing; interrupted recordings; silence hallucinations; unsupported action owners/dates; complete export; and database backup restoration. Owner, editor, and viewer behavior needs browser-level verification.

**10. GitHub, Vercel, and operating cost**

Prepare a repository structure with `apps/web`, `workers/transcribe`, shared schemas, database migrations, documentation, a local container setup, an MIT license, and third-party notices. Create the GitHub repository when implementation begins, under the confirmed Bittrees owner; release publicly after the code and sample data are ready for publication.

Use GitHub checks for type validation, authorization tests, processing fixtures, and production builds. Maintain separate preview and production databases, buckets, credentials, and worker queues. Keep recordings, secrets, and personal test fixtures out of the repository.

Deployment order: provision storage/database and worker → deploy Vercel preview → configure sender/auth origins → run full upload-to-notes and recovery checks → run retention/deletion and restore checks → connect autonote.bittrees.org to the production Vercel project → verify HTTPS and sign-in on the final domain → publish the tagged release. Use backward-compatible migrations and a tested rollback procedure.

Track monthly meeting minutes, worker execution time, storage GB-months, playback/download traffic, model input/output usage, email volume, and fixed hosting charges. Calculate cost per processed meeting hour from observed usage. Compare idle GPU cost with jobs-per-hour demand before choosing always-on compute. Set per-workspace quotas and budget alerts before inviting users. Pricing and a paid plan can follow pilot measurements; do not promise unlimited transcription.

**11. Decisions carried into implementation**

Recommended defaults: MIT application; Vercel web app plus separate Whisper worker; CRM-style email/SIWE accounts with separate sessions; upload and microphone capture first; private by default; reviewable evidence-linked recommendations; Bittrees CRM as the first integration.

Resolve during feasibility: shared SSO versus matching sign-in behavior, pilot languages and browser support, first meeting platform, notes model/provider, hosting region and spending limit, and GitHub organization. These choices do not block this plan, but affect the implementation scope and infrastructure setup.
