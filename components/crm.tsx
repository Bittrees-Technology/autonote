"use client";
import { useEffect, useState } from "react";
import type { Meeting } from "../lib/model";
async function api(path: string, body?: unknown) {
  const r = await fetch("/api/integrations/crm" + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error);
  return d;
}
export function CrmSettings() {
  const [connections, setConnections] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    setConnections(await api(""));
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
      {connections.map((c) => (
        <div className="identity" key={c.id}>
          <span>
            {c.workspace_name} → {c.target_name}
            <small>
              {" "}
              · expires {new Date(c.expires_at).toLocaleDateString()}
            </small>
          </span>
          <button
            className="text-button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
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
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api("")
      .then(setConnections)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <div>
      <p className="muted">
        Publish only the content reviewed below. CRM copies follow the
        destination’s sharing rules and remain after you disconnect or delete
        this meeting.
      </p>
      {!preview ? (
        <>
          <label>
            CRM destination
            <select
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
          {!connections.length && (
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
          {(meeting.notes?.actions || [])
            .filter((a) => a.status === "accepted")
            .map((a) => (
              <label className="consent" key={a.id}>
                <input
                  type="checkbox"
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
            disabled={!selected || busy || (!summary && !ids.length)}
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
          <button className="text-button" onClick={() => setPreview(null)}>
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
