# AutoNote integrations

## Google Calendar and Google Meet

The first meeting platform is Google Meet with Google Calendar. The current integration reads the primary calendar and lets each signed-in user select individual upcoming Meet events for **manual recording**. It does not join meetings, start Google recordings, send invitations, notify participants, or schedule a bot. Selecting an event is not recording consent from its participants. The built-in recorder captures microphone input; remote voices in headphones require a separately captured recording that includes those participants.

The list checks the first 100 events in the next 14 days and explicitly reports truncation. Cancelled, declined, all-day, and non-Meet events are excluded. Only titles, meeting links, and times of selected events are persisted. There is no background calendar sync; reload to check cancellations and changes. Selected-event metadata expires through worker cleanup one day after the event. Calendar access is separate from AutoNote email/SIWE identity.

### Operator setup

1. In a Google Cloud project, enable Google Calendar API. Create a web OAuth client and configure the consent screen, support email, privacy policy, and authorized domain.
2. Use only `https://www.googleapis.com/auth/calendar.events.readonly`. For a private pilot, add the pilot users to the consent screen's test-user list. Confirm Google's verification and test-mode token-expiry requirements before public launch.
3. Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` using the hosting provider's secret settings. Do not put them in client code or chat. Keep preview and production clients separate.
4. Register the exact callback for each environment. Production: `https://autonote.bittrees.org/api/integrations/google/callback`. Local development: `http://127.0.0.1:3050/api/integrations/google/callback`. `APP_URL` must match that environment.
5. Migrate the database, then test connection, cancellation, reconnecting a different Google account, selection, cancellation of an event, and disconnect. Complete live browser verification before enabling public registration.

Connections use a session-bound, expiring OAuth state and PKCE. Refresh credentials are encrypted at rest using the server's `AUTH_SECRET`; rotating this secret requires reconnecting integrations. Disconnect revokes Google access before removing local credentials and selections. Account deletion/recovery destroys local Google credentials and selections; users can additionally revoke the app in Google Account connections. Recovery requires reconnecting Google to avoid accidentally combining calendars.

An unattended capture service is a separate milestone requiring a free compatible host and a consent/participant-notification design. Existing Google Meet recording artifacts depend on recording being available and started in Google; Calendar access does not grant recording capability.

References: [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth), [events list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list), [Google OAuth web applications](https://developers.google.com/identity/protocols/oauth2/web-server), [Meet artifacts](https://developers.google.com/workspace/meet/api/guides/artifacts).

## Bittrees CRM

Connect from AutoNote Settings, sign into CRM, and choose one writable workspace and destination record. The CRM approval screen grants 30-day access to publish notes and tasks to that destination. It does not expose private owner notes. AutoNote and CRM remain separate accounts; this is not shared SSO.

The meeting creator selects an editable summary and accepted actions, reviews the exact payload, and confirms publication. The review expires after ten minutes or a meeting change. CRM rechecks current membership and record access on every publication. New records inherit the destination's record-sharing restrictions, start unassigned, and contain an AutoNote source link. Repeated publications skip existing items instead of overwriting CRM edits.

Disconnect in AutoNote Settings or revoke in CRM at `/connect/autonote`. Published CRM copies remain independently editable and are not erased by disconnecting or deleting the source meeting. Account export does not include integration credentials.

Set `CRM_URL` on AutoNote and `AUTONOTE_URL` on CRM to the corresponding origins. Production defaults are `https://crm.bittrees.org` and `https://autonote.bittrees.org`. For local testing use ports 3040 and 3050 respectively. Migrate both applications before deploying. Authorization codes are single-use and protected with PKCE; bearer tokens are hashed in CRM and encrypted in AutoNote.


## Local Bittrees AI transcript grants (foundation)

`AI_CONNECTOR_ENABLED` defaults to false. The source module supports a separate one-meeting `read_transcript` grant issued by the signed-in source user after current access checks. A PKCE-protected code expires after 60 seconds and exchanges once for a hashed bearer credential; the user-selected grant expires within 30 days. Grant creation, exchange and reads reject unavailable accounts, lost membership/sharing, deleted meetings and unready or invalid transcripts. Sharing rights are checked again after a meeting-lock wait. Revocation and idempotent bearer disconnect remain available with the feature disabled or source access lost.

The bounded projection contains only meeting ID, title, language, version and timestamped transcript segments, with a projection hash for downstream invalidation. It excludes recording keys, recording bytes, existing notes and all Google/CRM credentials. Transcript transfer is capped at 1 MiB; larger or malformed transcripts fail explicitly. Account recovery revokes both accounts' AI grants rather than transferring them; account deletion clears grant credentials.

The private consent and connection routes described below now expose this foundation. Companion integration, cited generation and reviewed AutoNote saves remain pending. It grants no write or CRM publication action. The existing AutoNote-to-CRM exact-review and item-deduplication path remains the sole publication path for meeting content. Apply the additive schema migration before enabling future routes; no production flag or credential is activated by this change.


## Private AI consent and connection routes

The companion opens /connect/ai with a PKCE challenge, never a bearer credential. The user signs into AutoNote, loads currently permitted ready meetings, chooses one and an expiry, reviews transcript-only scope and explicitly approves. Consent binds the displayed source account. A single-use code is displayed for at most 60 seconds for manual transfer to the companion; it is not stored in URLs or browser storage. Users can inspect expiry/last use and revoke their own grants even when new grants are disabled.

The private page uses a nonce-based same-origin CSP, no-referrer/no-store headers and a separate layout without the ordinary app's analytics script. The ordinary app/privacy URLs remain unchanged. Session-and-origin-authorized endpoints own consent/revoke; bearer exchange/read/disconnect are distinct, bounded and rate-limited. Bearer possession cannot approve a connection or change its selected meeting. The choices endpoint returns only permitted meeting labels/IDs, with explicit truncation after 100 results.

GitHub browser tests exercise synthetic source consent, one-time exchange, transcript read, revoke, keyboard controls, narrow-screen layout and absence of third-party requests on this page. This does not activate production AI access or complete companion/local-model pilot acceptance. The additive migration and source feature flag remain operator release steps.

## Source-owned AI review/save foundation

`lib/ai-reviews.ts` adds separately enabled review-upload permission to an existing read grant. Only the source session can enable that permission, inspect the exact merged notes and save the review. A bearer can prepare a bounded proposal only after permission is enabled; it cannot approve or dispatch CRM writes. This backend is not exposed by the current routes or consent UI yet.

Each proposal fixes its operation ID, meeting version and transcript projection hash. Every summary/action cites current transcript segments. Review expiry is at most ten minutes and never exceeds its grant; disabling/re-enabling review permission invalidates pending reviews. Saving appends the cited summary and proposed actions while preserving all existing notes and reviewed action statuses. Stale existing notes must be resolved first. The normal edit path retains evidence checks, device storage limits, revision history and audit. Proposed owners/deadlines remain suggestions until the existing AutoNote review flow accepts them.

Meeting update and receipt commit in the same transaction. Duplicate saves return the original receipt, including after a later meeting edit. Pending review payloads are erased on explicit review deletion, meeting deletion and account cleanup; consumed payloads are removed after saving while minimal operation receipts remain for deduplication. Cleanup tolerates an absent additive table during deployment. No automatic CRM publication is added, and no production permission is enabled.

## Private review controls and routes

The private connection page now lets the signed-in user enable or disable review uploads per grant, load pending review metadata, inspect exact additions/resulting notes and audience, confirm review and save. The detail clears on focus loss and revalidates every 15 seconds while visible. New actions remain proposed; existing notes and action statuses are preserved. A saved receipt records the original operation and does not publish to CRM. Pending draft deletion and permission disable remain available with new AI access disabled.

Bearer-only `review-status`, `review-prepare` and `review-receipt` routes expose permission state, bounded staging and metadata-only receipt recovery. Separate source-session/Origin/account-bound routes own enable/disable, detail, save and deletion; a bearer cannot approve. Preparation is bounded to 64 KiB at the transport and 64,000 bytes after validation. Other route bodies retain their 16 KiB bound. Reviews and credentials never enter query strings or browser storage. The source list is capped at 100 reviews, with pending payloads ordered first; direct review operations still require ownership and fresh authority. Companion staging/receipt controls remain to be integrated, and production activation remains disabled.
