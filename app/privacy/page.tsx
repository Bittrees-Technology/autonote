export default function Privacy() {
  return (
    <article style={{ maxWidth: 760, margin: "50px auto", padding: 24 }}>
      <a href="/">← AutoNote</a>
      <h1>Privacy and recording</h1>
      <p>
        AutoNote is an MIT-licensed meeting workspace by Bittrees. This beta
        records only when you start recording or upload a file. Inform
        participants and obtain the permissions required for your conversation
        before recording.
      </p>
      <h2>Who can see a meeting?</h2>
      <p>
        Meetings start private. Only their creator and explicitly selected
        current workspace members can access them. Choosing workspace sharing
        makes the recording, transcript, and notes available to all members of
        that workspace. Workspace owners do not automatically receive
        private-meeting access.
      </p>
      <h2>Processing</h2>
      <p>
        Audio is stored in a private object store and processed by a separately
        operated Whisper worker. Notes use the language-model endpoint
        configured by the operator. That endpoint may be a hosted service or a
        local model. The operator must disclose its actual providers, processing
        regions, and contact details before opening production registration.
        AutoNote does not use your meetings to train models.
      </p>
      <h2>Retention and deletion</h2>
      <p>
        Recordings expire after 30 days by default; workspace owners can change
        this period. Transcripts and notes remain until deleted. Deletion
        removes access immediately and schedules permanent cleanup by the
        worker, including revisions. Short-lived playback links may remain valid
        for up to two minutes. Copies you exported or shared outside AutoNote
        are independent. Backup retention is set by the deployment operator.
      </p>
      <h2>On your device</h2>
      <p>
        During microphone recording, audio chunks are saved in your browser so
        interrupted recordings can be recovered. They are cleared after a
        successful upload or when you choose Discard. Upload-resume identifiers
        are stored on your device. Signing out does not erase an unfinished
        local recording; recover or discard it on a shared device.
      </p>
      <h2>Account information</h2>
      <p>
        Email codes and Ethereum signatures establish control of a sign-in
        identity. Linking requires verification. Sessions use secure, HTTP-only
        cookies in production. Email sign-in uses the operator’s configured
        Resend sender. You can export your data and delete your account in
        Settings.
      </p>
      <h2>Beta limitations</h2>
      <p>
        Transcripts and generated notes can contain errors. Verify speakers,
        dates, and actions before relying on them. This software does not claim
        medical, legal, or compliance certification. Production operators must
        supply their privacy contact, processor details, region, and
        backup-expiry policy before launch.
      </p>
    </article>
  );
}
