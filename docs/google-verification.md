# Google verification and recording rollout — September 10, 2026

## Completed

- Verified bittrees.org in Google Search Console for the project owner's account via a Vercel DNS TXT record. Keep the verification record in place.
- Changed OAuth audience from Testing to In production.
- Google verified the AutoNote branding; published it successfully.
- Calendar data-access verification is still pending, not approved. Current scope remains calendar.events.readonly only. New users may see Google's unverified-app warning and are subject to Google's unverified user cap.
- Calendar authorization and empty-state loading passed live. CRM authorization passed live and points to My workspace → AutoNote launch.
- Confirmed native automatic recording controls exist for bobofbuilding@bittrees.io. Created a private, no-guest test event named AutoNote recording setup (private test), September 10, 10:30–11:30 in Calendar's displayed local time, and enabled Record the meeting. No organization-wide defaults changed, no guests invited, no recording started.

## Calendar scope justification (review submission text)

AutoNote is a private meeting-notes application. A signed-in user can optionally connect Google Calendar in Settings to view upcoming Google Meet events from their primary calendar for the next 14 days. The application requests calendar.events.readonly to read event titles, start/end times, Google Meet links, and attendance/cancellation state, so the user can select individual meetings and see updated scheduling information. We do not create, edit, delete, or send calendar events or invitations. Free/busy access is insufficient because it does not provide the event title or meeting link. No broader Calendar or Drive scope is requested. Only selected event metadata is retained; selections expire after the meeting and are removed on disconnection. Tokens are encrypted. Data is not used for advertising, sold, or used to train models. Recording and transcription are separate, user-initiated features and do not use this Calendar permission to obtain audio.

## Demonstration video checklist

Use the live production website and a test event with no guests or private content. Record the actual browser flow (not a mockup):

1. Show AutoNote's homepage, app name, public privacy policy, and Calendar explanation.
2. Show the Google Cloud project and public production client ID, keeping the client secret hidden.
3. Sign in to AutoNote; open Settings → Connect Google Calendar.
4. Show Google's complete consent flow and the exact read-only Calendar permission.
5. Return to AutoNote; load the test event, select it, and show its title/time/Meet link in the saved selection.
6. Deselect the test event, then disconnect Google and show the connection is removed.
7. Explain that Calendar grants no audio access and that recording requires a separate explicit action; audio is processed locally with Whisper, then transcripts and reviewed notes sync.
8. Provide a reviewer-accessible video URL (Google's submission form may require YouTube). Do not include sign-in codes, client secrets, other users' meeting information, or private email content.

Submit the scope justification with the real video URL in Verification Center. Google controls approval and may ask for revisions. Do not set GOOGLE_OAUTH_VERIFIED=true until approval is confirmed. GOOGLE_OAUTH_TESTING is obsolete; status now uses GOOGLE_OAUTH_VERIFIED, defaulting to pending.

## Recording architecture decision

The user's existing Workspace account supports native recording. Prefer Google's native automatic recording, with participant notifications and organizer-managed Drive storage, over a hosted bot. Hosts configure Video call options → Meeting records → Record the meeting. Google documents that an eligible host/co-host must join on web before it starts. This is not an unattended bot that attends in place of the user.

Current AutoNote capture: microphone alone, meeting-tab audio mixed with microphone, or local upload. Tab mode requires an explicit browser share action; it cannot start on a timer. Audio-only output is saved locally; no screen video is recorded. Headphones reduce acoustic echo. Stop sharing stops capture. Whisper transcribes the mixed speech but does not reliably identify each speaker; do not promise speaker diarization.

Next import phase: Google Picker with drive.file permission for explicitly selected recordings, downloaded directly to the device and processed by Whisper. Avoid broad drive.readonly access (restricted) merely to scan a user's Drive. Validate file access, origin, MIME, size/duration and revocation; handle large Meet MP4 files exceeding the current 100 MB / 30-minute limit with local audio extraction/chunking. Do not silently transfer recordings through Vercel.

Fully automatic discovery/import requires additional design and consent: Meet artifact metadata / Workspace Events, explicit allowed meetings, idempotent import, bounded queues, deletion/revocation, and a device worker available to perform Whisper. A closed browser cannot perform on-device transcription. A persistent local companion could watch approved files while the user's computer is awake; hosted processing would change the free-only budget and audio privacy policy. These are planned, not implemented or enabled.

Google's Meet Media API remains developer preview, requires project/principal/all participants enrollment, and requests restricted media scopes. It is not the ordinary-meeting public launch path.

Sources:
- https://support.google.com/cloud/answer/13464321?hl=en
- https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification
- https://support.google.com/meet/answer/9308681?hl=en
- https://developers.google.com/workspace/meet/api/guides/artifacts
- https://developers.google.com/workspace/meet/media-api/guides/get-started
- https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia
