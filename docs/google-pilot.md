# Google Calendar pilot

Configured September 10, 2026 under bobofbuilding@bittrees.io.

Update: the audience is now In production and Google has verified and published the branding. Calendar data-access review is still pending. See [current verification status and rollout](google-verification.md); the testing details below describe the original pilot setup.

- Google Cloud project: bittrees-autonote (423041682990), organization bittrees.io.
- Calendar API enabled; OAuth consent app AutoNote, External / Testing.
- Production web client uses only https://autonote.bittrees.org/api/integrations/google/callback. No JavaScript origins or local/preview callbacks.
- Scope: https://www.googleapis.com/auth/calendar.events.readonly.
- Test user: bobofbuilding@bittrees.io. Users must individually grant consent.
- Home and privacy links use autonote.bittrees.org; authorized domain bittrees.org.
- GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET stored in Vercel production. GOOGLE_OAUTH_TESTING=true labels the limited pilot. Do not commit or expose the client secret.
- No paid trial or billing was activated.

Live production verification completed September 10, 2026: email sign-in succeeded, the pilot Google account granted the expected read-only scope, the OAuth callback returned successfully, and loading upcoming Meet events succeeded with an empty result for the next 14 days. The connection remains enabled.

Still untested with this account: selecting/deselecting an actual event and disconnecting/reconnecting. No calendar events were created or changed. The CRM handoff reached its sign-in gate; connecting a destination requires signing into the intended existing CRM account. Only Google test users can connect until the audience changes. Google verification, including domain ownership and a consent-flow demonstration, is required before claiming unrestricted public availability. Keep the pilot indicator enabled until that review is resolved.

Reference: https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification
