# AutoNote integrations

## Google Calendar and Google Meet

The first meeting platform is Google Meet with Google Calendar. The current integration reads the primary calendar and lets each signed-in user select individual upcoming Meet events for **manual recording**. It does not join meetings, start Google recordings, send invitations, notify participants, or schedule a bot. Selecting an event is not recording consent from its participants.

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
