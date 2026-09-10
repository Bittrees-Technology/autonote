"use client";
import { useEffect, useState } from "react";
import type { CalendarMeeting } from "../lib/google";
async function api(path: string, body?: unknown) {
  const r = await fetch("/api/integrations/google" + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
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
        <strong>Manual recording only.</strong> Selecting an event saves it to
        your list. It does not join, record, or notify participants. At meeting
        time, open Meet and start a recording in AutoNote after obtaining
        participant consent. Microphone recording does not capture remote voices
        in headphones. To include everyone, upload a recording made with
        participant consent that contains all speakers.
      </p>
      {!status ? (
        <p>Checking connection…</p>
      ) : !status.configured ? (
        <p>Google connection is awaiting administrator setup.</p>
      ) : !status.connected ? (
        <button
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
            Load upcoming meetings
          </button>{" "}
          <button
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
            Next 14 days · first 100 calendar events · reload to check changes
            or cancellations.
          </p>
          {truncated && (
            <p>
              Only the first 100 calendar events were checked. Later meetings
              may be missing.
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
                  · {new Date(e.startsAt).toLocaleString()} · manual recording
                </small>
              </span>
            </label>
          ))}
          {!!status.selections.length && (
            <>
              <h3>Selected for manual recording</h3>
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
                  <button
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
    </section>
  );
}
