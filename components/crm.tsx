"use client";
import { useEffect, useState } from "react";
import type { Meeting } from "../lib/model";
async function api(path: string, body?: unknown) {
  const r = await fetch("/api/integrations/crm" + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({
    error: "CRM is temporarily unavailable. Try again shortly.",
  }));
  if (!r.ok) throw new Error(d.error);
  return d;
}
export function CrmSettings() {
  const [connections, setConnections] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  async function load() {
    setConnections(await api(""));
    setLoaded(true);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  return (
    <section>
      <h2>Bittrees CRM</h2>
      <p className="muted">
        Connect a CRM destination, then review meeting notes and accepted
        actions before publishing. CRM tasks start unassigned.
      </p>
      {!loaded && !error && (
        <p role="status" className="muted">
          Checking CRM connections…
        </p>
      )}
      {loaded && !connections.length && (
        <p className="muted">No CRM destination connected yet.</p>
      )}
      {connections.map((c) => (
        <div className="identity" key={c.id}>
          <span>
            {c.workspace_name} → {c.target_name}
            <small>
              {" "}
              {Date.parse(c.expires_at) <= Date.now()
                ? "Expired · reconnect to publish"
                : "Expires " + new Date(c.expires_at).toLocaleDateString()}
            </small>
          </span>
          <button
            className="text-button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api("/disconnect", { id: c.id });
                await load();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Disconnect
          </button>
        </div>
      ))}
      <button
        className="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            location.assign((await api("/start", {})).url);
          } catch (e) {
            setError((e as Error).message);
            setBusy(false);
          }
        }}
      >
        Connect CRM destination
      </button>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
    </section>
  );
}
export function CrmPublish({
  meeting,
  onDone,
}: {
  meeting: Meeting;
  onDone: () => void;
}) {
  const [connections, setConnections] = useState<any[]>([]),
    [selected, setSelected] = useState(""),
    [summary, setSummary] = useState(
      meeting.notes?.summary.slice(0, 3800) || "",
    ),
    [ids, setIds] = useState<string[]>([]),
    [preview, setPreview] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    api("")
      .then((items) => {
        setConnections(
          items.filter((c: any) => Date.parse(c.expires_at) > Date.now()),
        );
        setLoaded(true);
      })
      .catch((e) => setError(e.message));
  }, []);
  return (
    <div>
      <p className="muted">
        Publish only the content reviewed below. CRM copies follow the
        destination’s sharing rules and remain after you disconnect or delete
        this meeting.
      </p>
      {meeting.notes_stale && (
        <p role="alert" className="inline-error">
          The transcript changed. Regenerate and review the notes before
          publishing.
        </p>
      )}
      {!loaded && !error && <p role="status">Loading destinations…</p>}
      {!preview ? (
        <>
          <label>
            CRM destination
            <select
              disabled={!loaded || busy || !connections.length}
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Choose connected destination</option>
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.workspace_name} → {c.target_name}
                </option>
              ))}
            </select>
          </label>
          {loaded && !connections.length && (
            <p>Connect a destination in Settings first.</p>
          )}
          <label>
            Summary to publish · maximum 3,800 characters
            <textarea
              value={summary}
              maxLength={3800}
              onChange={(e) => setSummary(e.target.value)}
            />
          </label>
          <p>Accepted actions · unassigned in CRM</p>
          {!meeting.notes?.actions.some((a) => a.status === "accepted") && (
            <p className="fine">
              No accepted actions yet. Review actions in the meeting and mark
              the ones you want to publish as Accepted.
            </p>
          )}
          {ids.length >= 30 && (
            <p className="fine">You can publish up to 30 actions at a time.</p>
          )}
          {(meeting.notes?.actions || [])
            .filter((a) => a.status === "accepted")
            .map((a) => (
              <label className="consent" key={a.id}>
                <input
                  type="checkbox"
                  disabled={busy || (!ids.includes(a.id) && ids.length >= 30)}
                  checked={ids.includes(a.id)}
                  onChange={(e) =>
                    setIds(
                      e.target.checked
                        ? [...ids, a.id]
                        : ids.filter((id) => id !== a.id),
                    )
                  }
                />
                <span>
                  {a.text} · {a.dueDate || "No due date"}
                </span>
              </label>
            ))}
          <button
            className="primary full"
            disabled={
              !loaded ||
              !selected ||
              busy ||
              meeting.notes_stale ||
              (!summary.trim() && !ids.length)
            }
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                setPreview(
                  await api("/preview", {
                    connectionId: selected,
                    meetingId: meeting.id,
                    version: meeting.version,
                    summary,
                    actionIds: ids,
                  }),
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Review publication
          </button>
        </>
      ) : (
        <>
          <h3>
            {preview.destination.workspace_name} →{" "}
            {preview.destination.target_name}
          </h3>
          <p style={{ whiteSpace: "pre-wrap" }}>
            {preview.payload.summary || "No summary selected."}
          </p>
          {preview.payload.actions.map((a: any) => (
            <p key={a.id}>
              □ {a.text} · {a.dueDate || "No due date"}
            </p>
          ))}
          <p className="fine">
            Items previously published to this destination will be skipped.
            Existing CRM copies will not be overwritten.
          </p>
          <button
            className="primary full"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api("/publish", { token: preview.token });
                onDone();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Confirm and publish to CRM
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => setPreview(null)}
          >
            Back to selection
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
    </div>
  );
}
