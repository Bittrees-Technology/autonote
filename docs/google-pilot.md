# Google Calendar pilot

Configured September 10, 2026 under bobofbuilding@bittrees.io.

- Google Cloud project: bittrees-autonote (423041682990), organization bittrees.io.
- Calendar API enabled; OAuth consent app AutoNote, External / Testing.
- Production web client uses only https://autonote.bittrees.org/api/integrations/google/callback. No JavaScript origins or local/preview callbacks.
- Scope: https://www.googleapis.com/auth/calendar.events.readonly.
- Test user: bobofbuilding@bittrees.io. Users must individually grant consent.
- Home and privacy links use autonote.bittrees.org; authorized domain bittrees.org.
- GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET stored in Vercel production. GOOGLE_OAUTH_TESTING=true labels the limited pilot. Do not commit or expose the client secret.
- No paid trial or billing was activated.

Verification still required: sign into AutoNote, connect the test Google account, load upcoming Meet events, select/deselect an event, disconnect and reconnect. Only Google test users can connect until the audience changes. Google verification, including domain ownership and a consent-flow demonstration, is required before claiming unrestricted public availability. Keep the pilot indicator enabled until that review is resolved.

Reference: https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification
