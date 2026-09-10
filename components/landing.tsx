import {
  Activity,
  ArrowRight,
  Check,
  FileText,
  Lock,
  Mic,
  ShieldCheck,
  Upload,
} from "lucide-react";
import styles from "./landing.module.css";

export function Landing({
  onStart,
  onExplore,
  notice,
}: {
  onStart: () => void;
  onExplore: () => void;
  notice?: string;
}) {
  return (
    <div className={styles.page}>
      <a className={styles.skip} href="#main-content">
        Skip to content
      </a>
      <header className={styles.header}>
        <a href="/" className={styles.brand} aria-label="AutoNote home">
          <span>
            <Activity size={24} />
          </span>
          <b>
            autonote<small>BY BITTREES</small>
          </b>
        </a>
        <nav aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#privacy">Privacy</a>
          <button onClick={onStart}>
            Sign in <ArrowRight size={16} />
          </button>
        </nav>
      </header>
      <main id="main-content" className={styles.main}>
        {notice && (
          <p className={styles.notice} role="status">
            {notice}
          </p>
        )}
        <section className={styles.hero}>
          <div className={styles.intro}>
            <span className={styles.eyebrow}>
              <span /> MEETING NOTES, ON YOUR TERMS
            </span>
            <h1>
              Good conversations.
              <br />
              <em>Clear next steps.</em>
            </h1>
            <p className={styles.lead}>
              Turn a recording into a searchable transcript, quoted highlights,
              and actions you can review. Keep your audio on your device and
              your team on the same page.
            </p>
            <div className={styles.actions}>
              <button className={styles.primary} onClick={onStart}>
                Start taking notes <ArrowRight size={18} />
              </button>
              <button className={styles.secondary} onClick={onExplore}>
                Explore a sample
              </button>
            </div>
            <p className={styles.caption}>
              Free beta · No credit card · Email or Ethereum sign-in
            </p>
          </div>
          <div
            className={styles.preview}
            aria-label="Illustrative meeting notes preview"
          >
            <div className={styles.previewBar}>
              <span>
                <Activity size={17} /> YOUR MEETING, MADE USEFUL
              </span>
              <span>
                <Lock size={12} /> Private
              </span>
            </div>
            <div className={styles.previewBody}>
              <p className={styles.sampleLabel}>ILLUSTRATIVE SAMPLE</p>
              <h2>Product check-in</h2>
              <p className={styles.meta}>
                A conversation with a clear way forward.
              </p>
              <div className={styles.quote}>
                <span>QUOTED HIGHLIGHT</span>
                <p>“We agreed to keep the first release free.”</p>
                <small>From the transcript · 04:12</small>
              </div>
              <div className={styles.actionRow}>
                <span className={styles.check}>
                  <Check size={17} />
                </span>
                <div>
                  <strong>Prepare the launch checklist</strong>
                  <small>Reviewed action · Ready for CRM</small>
                </div>
              </div>
              <div className={styles.transcript}>
                <span>TRANSCRIPT</span>
                <p>
                  <b>04:12</b> We agreed to keep the first release free.
                </p>
                <p>
                  <b>04:18</b> I’ll prepare the launch checklist.
                </p>
              </div>
            </div>
            <div className={styles.previewFooter}>
              <ShieldCheck size={16} /> Audio stays in your browser.
            </div>
          </div>
        </section>
        <div className={styles.trust}>
          <span>
            <Lock size={17} /> Private by default
          </span>
          <span>
            <Mic size={17} /> On-device transcription
          </span>
          <span>
            <FileText size={17} /> Editable, exportable notes
          </span>
        </div>
        <section id="how-it-works" className={styles.workflow}>
          <div className={styles.sectionHeading}>
            <span className={styles.eyebrow}>
              FROM CONVERSATION TO FOLLOW-THROUGH
            </span>
            <h2>A simple rhythm for better meeting notes.</h2>
            <p>
              You bring the conversation. AutoNote helps you find what matters
              and decide what happens next.
            </p>
          </div>
          <div className={styles.steps}>
            <article>
              <span className={styles.stepIcon}>
                <Upload size={23} />
              </span>
              <small>01 / CAPTURE</small>
              <h3>Start with your audio</h3>
              <p>
                Upload a recording or record your microphone after getting
                everyone’s permission. Use audio that includes all speakers.
              </p>
            </article>
            <article>
              <span className={styles.stepIcon}>
                <FileText size={23} />
              </span>
              <small>02 / REVIEW</small>
              <h3>Make the notes yours</h3>
              <p>
                Whisper transcribes in your browser. Review the transcript,
                quoted highlights, and suggested action candidates before
                sharing.
              </p>
            </article>
            <article>
              <span className={styles.stepIcon}>
                <Check size={23} />
              </span>
              <small>03 / FOLLOW THROUGH</small>
              <h3>Move work forward</h3>
              <p>
                Share with selected teammates, export your notes, or publish
                reviewed content to a destination in Bittrees CRM.
              </p>
            </article>
          </div>
        </section>
        <section id="privacy" className={styles.privacy}>
          <div>
            <span className={styles.eyebrow}>BUILT AROUND YOUR CONTROL</span>
            <h2>Your audio stays with you.</h2>
            <p>
              Speech processing happens on your device. Transcripts and notes
              sync to your account, where meetings start private. You choose who
              can see them.
            </p>
            <a href="/privacy">
              Read the privacy details <ArrowRight size={17} />
            </a>
          </div>
          <ul>
            <li>
              <Check size={18} /> No audio upload for transcription
            </li>
            <li>
              <Check size={18} /> Explicit sharing and CRM publication
            </li>
            <li>
              <Check size={18} /> Export your work and delete your meetings
            </li>
            <li>
              <Check size={18} /> Open source under the MIT license
            </li>
          </ul>
        </section>
        <section className={styles.faq} aria-labelledby="launch-details">
          <div className={styles.sectionHeading}>
            <span className={styles.eyebrow}>BEFORE YOUR FIRST MEETING</span>
            <h2 id="launch-details">A clear picture of the beta.</h2>
          </div>
          <details>
            <summary>What’s included for free?</summary>
            <p>
              Up to 20 active meetings per account, with recordings up to 30
              minutes and 100 MB each. The beta supports up to 50 active
              accounts. No credit card is required.
            </p>
          </details>
          <details>
            <summary>Does AutoNote join Google Meet?</summary>
            <p>
              No. Recording is manual. Google Calendar connection is being
              prepared and is not available yet. Microphone recording does not
              capture remote voices in headphones; upload a recording containing
              all speakers when needed.
            </p>
          </details>
          <details>
            <summary>Which browser should I use?</summary>
            <p>
              A current desktop browser is recommended. The speech model
              downloads on first use; keep the tab open during transcription.
              Processing speed depends on your device. English is supported,
              with Portuguese available as a pilot.
            </p>
          </details>
          <details>
            <summary>Are the notes ready to share automatically?</summary>
            <p>
              Review them first. Highlights quote your transcript, which can
              contain transcription errors. Action candidates need your review,
              and owners and dates are not inferred. You choose what is shared
              or published.
            </p>
          </details>
          <details>
            <summary>Where is my recording saved?</summary>
            <p>
              Audio remains in this browser and does not sync between devices.
              Download recordings you want to keep before clearing browser data.
              Your transcript and notes are saved to your account.
            </p>
          </details>
        </section>
        <section className={styles.cta}>
          <h2>Make your next conversation count.</h2>
          <p>Start with one recording. Leave with something useful.</p>
          <button className={styles.primary} onClick={onStart}>
            Get started free <ArrowRight size={18} />
          </button>
        </section>
      </main>
      <footer className={styles.footer}>
        <span>
          AutoNote <span className={styles.by}>by Bittrees</span>
        </span>
        <nav aria-label="Footer">
          <a href="/privacy">Privacy</a>
          <a href="https://github.com/Bittrees-Technology/autonote">
            Source code
          </a>
          <button onClick={onExplore}>Sample workspace</button>
          <span>Free beta</span>
        </nav>
      </footer>
    </div>
  );
}
