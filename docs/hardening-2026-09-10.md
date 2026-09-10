# Integration and interface hardening — September 10, 2026

This pass strengthens the free, on-device beta. Google Calendar still needs its production OAuth client and a real-account verification run; selecting an event never starts recording.

## Changes

- CRM authorization has loading, empty, expired and signed-out states. Destination requests cannot overwrite a newer workspace selection. Invalid connection links explain how to restart.
- AutoNote callback errors return to Settings without exposing authorization codes. Google cancellation validates and consumes the session-bound state.
- Google refresh updates selected meeting titles, links and times, removes unavailable selections after a complete result set, and handles truncated calendars conservatively. Selections are capped at 20; malformed renewed tokens are rejected.
- CRM publication rejects stale generated notes, empty submissions and duplicate action identifiers. Grants are rechecked after locking. Reviewed content and current permissions remain required; retries stay idempotent.
- CRM source links resolve the authorized meeting's workspace, including when it differs from the default workspace.
- Sign-out and expired sessions clear private workspace state. Interrupted microphone audio is isolated by account; device errors release microphone tracks and report recovery failures.
- Account-scoped interrupted audio uses a new browser store. Legacy, unscoped interrupted chunks are not automatically assigned to a user. Already saved device recordings keep their existing account-scoped store and are unaffected.
- Dropdowns, disabled controls, placeholders, text inputs, wrapping and modal scrolling have consistent styling. Navigation and meeting toolbars have responsive wrapping rules. Dialogs have accessible headings; Escape respects recording/upload close guards.
- Invitation links now present an acceptance action on arrival instead of a Settings button that fails without an invitation.

## Verification

- AutoNote: 26 automated tests and production build; added cases cover callback redirects, malformed JSON, cancellation/replay, calendar refresh, stale/empty CRM publication.
- CRM: 40 automated tests and production build; duplicate/empty publication cases added.
- CRM existing browser suite: all six record forms, validation, conflicts, expired sessions, failed requests, mobile navigation, authentication linking, workspace operations, scoped invitations and email controls passed.
- Local cross-product smoke: SIWE in both apps, PKCE authorization/exchange, destination selection, a meeting in a second workspace, reviewed summary and accepted action publication, source links, idempotent retry and disconnect passed. Synthetic accounts were cleaned up.
- Manual browser review: AutoNote meeting list/detail, upload fields, Settings, callback feedback and CRM sign-in recovery screen. A 319 px browser view subsequently became available: published meeting navigation and sign-in fields had no horizontal overflow; signed-in workspace fields were inspected at that width. This revealed cramped local-recording labels, which now wrap above their action buttons. Broader phone/tablet coverage remains a beta follow-up.

Run the local cross-product check with both development servers running, AutoNote's local CRM_URL=http://127.0.0.1:3040 and CRM's local AUTONOTE_URL=http://127.0.0.1:3050:

```
npx tsx --env-file=.env.local scripts/crm-smoke.ts
```

The script deliberately requires local URLs and the adjacent CRM repository. It never targets production.

## Remaining launch work

Configure Google OAuth using the intended Google Cloud project, then verify consent, reconnect, calendar selection and revocation with a real account. Public support/privacy mail receiving still needs activation according to the separate Bittrees email plan. Recording remains manual; users must supply audio containing all speakers. A broader real-device usability and long-meeting performance pilot remains appropriate for this beta.

## Published verification

AutoNote d933410 and CRM 35b49e4 passed GitHub checks and were published to their custom domains. Production device smoke verified final-origin SIWE, private/idempotent saves, isolation, export, edits and deletion, with synthetic accounts removed. Both integration callback failures returned safe 303 recovery redirects. A final CSS-only follow-up improves narrow local-recording rows.
