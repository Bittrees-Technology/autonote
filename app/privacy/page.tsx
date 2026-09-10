export default function Privacy() {
  return (
    <article
      style={{
        maxWidth: 760,
        margin: "50px auto",
        padding: 24,
        lineHeight: 1.7,
      }}
    >
      <a href="/">← AutoNote</a>
      <h1>Privacy and recording</h1>
      <p>
        AutoNote is a free, MIT-licensed beta operated by Bittrees. Updated
        September 10, 2026. Recording starts only when you choose it. Inform
        participants and obtain permission before recording or importing a
        conversation.
      </p>
      <h2>Audio stays on your device</h2>
      <p>
        For this hosted beta, Whisper runs inside your browser. Audio is saved
        in this browser for recovery and playback, and is never uploaded to
        AutoNote. Keep the tab open while transcribing. The first use downloads
        model files from Hugging Face and the speech runtime from its CDN; these
        providers receive ordinary connection information such as your IP
        address, but no recording or transcript from AutoNote.
      </p>
      <p>
        Recordings remain here until you remove them in Settings or clear
        browser storage. Signing out does not erase them. Anyone with access to
        this browser profile may be able to access local data. Download
        important recordings: browser storage can be cleared or evicted. Other
        devices and people you share with do not receive audio.
      </p>
      <h2>What is saved online?</h2>
      <p>
        Your account stores your verified email or wallet address, workspace
        membership, meeting title, transcript, editable notes, sharing choices,
        and basic activity records. Vercel serves the application, with
        application functions in Frankfurt. Neon stores account data,
        transcripts, and notes in Frankfurt. Resend delivers sign-in emails
        using our verified Bittrees CRM sender. Providers may process service
        metadata elsewhere under their own policies. Google Fonts supplies
        interface fonts and receives ordinary connection metadata. AutoNote does
        not use your meetings to train models.
      </p>
      <h2>Who can see a meeting?</h2>
      <p>
        Meetings start private. Only their creator and explicitly selected
        current workspace members can access them. Workspace sharing gives all
        current members access to the transcript and notes. Workspace owners do
        not automatically receive private-meeting access. Audio remains local.
      </p>
      <h2>Notes and accuracy</h2>
      <p>
        The free beta extracts quoted highlights and possible actions from the
        transcript. It does not send text to a generative AI provider, infer
        owners or due dates, or automatically publish actions. Review speech
        recognition, speaker labels, and action candidates before accepting or
        sharing them. English is the primary launch language; Portuguese is
        experimental.
      </p>
      <h2>Deletion, exports, and backups</h2>
      <p>
        Transcripts and notes remain until you delete them. Deleting a meeting
        removes its content, revisions, and access grants from the active
        database immediately. A minimal deletion record prevents interrupted
        saves from restoring it. Account deletion removes sign-in identities and
        owned meeting content. Export your data in Settings. Exported copies and
        content already published to CRM are independent.
      </p>
      <p>
        Deleting through this browser also removes its corresponding local
        audio. Local copies on other devices must be removed there. Neon’s free
        plan offers limited restore history, currently up to six hours or 1 GB
        of changes, whichever comes first. Provider operational backups follow
        provider policies. AutoNote maintains no separate recording backups.
        This beta is not a long-term archive; keep your own exports.
      </p>
      <h2>Optional connections</h2>
      <p>
        Google Calendar is optional and requires administrator setup. When
        enabled, it grants read-only calendar access. Only selected events’
        title, time, and Meet link are saved. Selecting an event does not start
        recording or send a bot. Saved selections expire in daily cleanup after
        the event ends. Disconnecting removes saved selections and revokes
        access.
      </p>
      <p>
        Bittrees CRM publication requires your review and confirmation of a
        chosen summary and accepted actions. Published copies follow the
        destination’s sharing rules and remain after you disconnect or delete an
        AutoNote meeting. Connection credentials are encrypted in AutoNote; you
        can also revoke access in Google and CRM.
      </p>
      <h2>Help</h2>
      <p>
        Use Settings to export or delete your data. Report product problems
        through{" "}
        <a href="https://github.com/Bittrees-Technology/autonote/issues">
          AutoNote support on GitHub
        </a>
        . Issues are public: do not include meeting content, account secrets, or
        personal information. A dedicated private support mailbox is not yet
        available.
      </p>
      <p>
        <a href="https://neon.com/pricing">Neon restore limits</a> ·{" "}
        <a href="https://vercel.com/legal/privacy-policy">Vercel privacy</a> ·{" "}
        <a href="https://neon.com/privacy-policy">Neon privacy</a> ·{" "}
        <a href="https://resend.com/legal/privacy-policy">Resend privacy</a> ·{" "}
        <a href="https://huggingface.co/privacy">Hugging Face privacy</a>
      </p>
    </article>
  );
}
