# Separate source-owned AI approval permission

This internal module prepares the source side of approving exact AutoNote proposals from the AI companion. Authenticated routes now expose issuance, exchange, exact review/save and owner-local list/revoke. Source consent UI and companion integration remain unfinished. Approval remains disabled unless both AI connector and remote-approval feature settings are explicitly enabled. Installation/migration grants no authority.

The source user independently authorizes `approve_meeting_notes` for one existing meeting connection with draft reviews enabled. A one-use PKCE code exchanges for a distinct opaque approval bearer; read/upload credentials cannot approve, and the approval bearer cannot read the transcript. Lifetime is at most one hour and never outlives the parent connection. Issuing a replacement revokes earlier approval credentials for that connection. This is a bearer permission, not a cryptographic browser/device identity proof.

Each save locks current source rights, the meeting and review grant before the approval row. It requires the current review epoch and exact source review digest; the source revalidates the proposed notes and saves in the same transaction as its retained receipt. Approval authority is checked again after the write and before commit. Exact duplicates return the original receipt only while authority remains current. Revoke, expired credentials, changed source, changed review epoch and removed access deny use. Account cleanup clears approval credentials. The capability cannot publish to CRM or modify other meetings.

Two focused database scenarios cover the usable issuance/exchange/save/replay path and authority changes. Database execution is confined to disposable GitHub CI. Type checking is local. Source consent UI, companion credential storage, encrypted exact-proposal review/delivery, export controls and final user flow remain required before activation. No live database, existing grant, personal data or Acer service is changed.

## Authenticated routes

`approval-authorize` requires a current source session, matching origin and subject, plus separate confirmation/acknowledgement. `approval-exchange` is PKCE-only; `approval-review` and `approval-save` require the distinct approval bearer. Read credentials cannot enter either path. Proposal review includes the exact notes being saved; it is not a transcript/recording read capability. The existing source-session `review-save` remains unchanged.

`approval-grants` lists only the signed-in user's bounded metadata without credential hashes; stored permission state is not a guarantee of current source membership or enabled deployment. `approval-revoke` remains available when feature flags are off or source access has been lost, with a current source session, same origin and matching subject. Rate-limit identifiers for new exchange/bearer routes use hashes, not raw credentials.

One focused authenticated-route scenario exercises consent, wrong origin/subject, missing acknowledgement, separate credentials, exact proposal inspection, save/replay, metadata and disabled-feature revocation. Local type checking passes; current route database/CI execution is pending. No user-facing source UI, live grants or deployment settings were activated.
