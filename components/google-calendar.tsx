"use client";
import { useEffect, useState } from "react";
import type { CalendarMeeting } from "../lib/google";
async function api(path: string, body?: unknown) {
  const r = await fetch("/api/integrations/google" + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({
    error: "Google Calendar is temporarily unavailable. Try again shortly.",
  }));
  if (!r.ok) throw new Error(d.error);
  return d;
}
export function GoogleCalendarSettings() {
  const [status, setStatus] = useState<any>(null),
    [events, setEvents] = useState<CalendarMeeting[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [truncated, setTruncated] = useState(false);
  async function load() {
    setStatus(await api(""));
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h2>Google Calendar &amp; Meet</h2>
      <p className="muted">
        Choose individual Google Meet events from your primary calendar.
        Calendar access is read-only. Your email and wallet sign-in stay the
        same.
      </p>
      <p>
        <strong>AutoNote capture starts manually.</strong> Selecting an event
        saves it to your list. It does not join, record, or notify participants.
        At meeting time, open Meet and start a recording in AutoNote after
        obtaining participant consent. Choose Meeting tab + microphone in
        AutoNote to include remote voices, or upload a Google Meet recording
        that contains all speakers.
      </p>
      <details>
        <summary>Use Google Meet’s automatic recording</summary>
        <p>
          If your Workspace plan includes recording and you host the meeting,
          open its Google Calendar event, choose Video call options → Meeting
          records, and enable Record the meeting. Recording starts when the host
          or co-host joins on the web, and Google notifies participants.
        </p>
        <p>
          After the meeting, download the recording from Google Drive and choose
          Upload in AutoNote. The free beta accepts up to 100 MB / 30 minutes.
          Automatic Drive import is not connected yet.
        </p>
        <a data-insights="navigate-supportgooglecom/meet/answer/9308681"
          href="https://support.google.com/meet/answer/9308681?hl=en"
          target="_blank"
          rel="noreferrer"
        >
          Google recording instructions
        </a>
      </details>
      {status?.configured && status.verificationPending && (
        <p className="message">
          Google verification is pending. Google may show an unverified-app
          warning or limit new connections until its review is complete.
          Recording and uploads work without Google.
        </p>
      )}
      {!status ? (
        <p role="status">
          {error
            ? "Connection status could not be loaded."
            : "Checking connection…"}
        </p>
      ) : !status.configured ? (
        <p className="message">
          Google Calendar is not available yet. You can record or import a
          meeting without connecting Google.
        </p>
      ) : !status.connected ? (
        <button data-insights="connect-google-calendar"
          className="secondary"
          disabled={busy}
          onClick={() =>
            run(async () => location.assign((await api("/start", {})).url))
          }
        >
          Connect Google Calendar
        </button>
      ) : (
        <>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const d = await api("/events");
                setEvents(d.events);
                setTruncated(d.truncated);
                setLoaded(true);
                await load();
              })
            }
          >
            {busy
              ? "Please wait…"
              : loaded
                ? "Refresh meetings"
                : "Load upcoming meetings"}
          </button>{" "}
          <button data-insights="disconnect-google"
            className="text-button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api("/disconnect", {});
                setEvents([]);
                setLoaded(false);
                await load();
              })
            }
          >
            Disconnect Google
          </button>
          <p className="fine">
            Next 14 days · up to 20 selected meetings · refresh to update saved
            titles, times, and cancellations.
          </p>
          {truncated && (
            <p>
              Only the first 100 calendar events were checked. Later meetings
              may be missing, and saved events outside this page could be out of
              date.
            </p>
          )}
          {loaded && !events.length && (
            <p>No upcoming Google Meet events found in this window.</p>
          )}
          {events.map((e) => (
            <label key={e.id} className="consent">
              <input
                type="checkbox"
                disabled={busy}
                checked={status.selections.some(
                  (s: any) => s.event_id === e.id,
                )}
                onChange={(v) =>
                  run(async () => {
                    await api("/select", {
                      eventId: e.id,
                      selected: v.target.checked,
                    });
                    await load();
                  })
                }
              />
              <span>
                {e.title}
                <small>
                  {" "}
                  · {new Date(e.startsAt).toLocaleString()} · saved meeting link
                </small>
              </span>
            </label>
          ))}
          {!!status.selections.length && (
            <>
              <h3>Selected meetings</h3>
              {status.selections.map((s: any) => (
                <div key={s.event_id} className="identity">
                  <span>
                    {s.title} · {new Date(s.starts_at).toLocaleString()}{" "}
                    <a
                      href={s.meet_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open Meet
                    </a>
                  </span>
                  <button data-insights="remove"
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api("/select", {
                          eventId: s.event_id,
                          selected: false,
                        });
                        await load();
                      })
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
            </>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      {!status && error && (
        <button data-insights="try-again" className="secondary" disabled={busy} onClick={() => run(load)}>
          Try again
        </button>
      )}
    </section>
  );
}
