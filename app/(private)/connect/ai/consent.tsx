"use client";
import Reviews from "./reviews";
import Approvals from "./approvals";
import { useEffect, useRef, useState } from "react";
type Choice = {
  id: string;
  workspace_id: string;
  workspace_name: string;
  title: string;
  version: number;
};
async function api(action: string, method = "GET", body?: unknown) {
  const response = await fetch("/api/integrations/ai/" + action, {
    method,
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed.");
  return data;
}
export default function Consent() {
  const [user, setUser] = useState<any>(null),
    [grants, setGrants] = useState<any[]>([]),
    [choices, setChoices] = useState<Choice[]>([]),
    [selected, setSelected] = useState(""),
    [days, setDays] = useState(7),
    [challenge, setChallenge] = useState(""),
    [review, setReview] = useState(false),
    [code, setCode] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [enabled, setEnabled] = useState(false),
    [truncated, setTruncated] = useState(false);
  const epoch = useRef(0),
    working = useRef(false);
  const chosen = choices.find((item) => item.id === selected);
  async function refresh() {
    const generation = ++epoch.current;
    setUser(null);
    setGrants([]);
    setChoices([]);
    setSelected("");
    setReview(false);
    setCode(null);
    const data = await api("grants");
    if (generation !== epoch.current) return;
    setUser(data.user);
    setGrants(data.items);
    setEnabled(data.enabled);
  }
  useEffect(() => {
    const value =
      new URL(window.location.href).searchParams.get("challenge") ?? "";
    if (/^[A-Za-z0-9_-]{43}$/.test(value)) setChallenge(value);
    void refresh().catch((e) => setError(e.message));
    return () => {
      epoch.current++;
    };
  }, []);
  useEffect(() => {
    if (!code) return;
    const timer = setTimeout(
      () => setCode(null),
      Math.max(0, new Date(code.codeExpiresAt).getTime() - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [code]);
  async function act(fn: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection failed.");
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  return (
    <main className="ai-consent">
      <a href="/" rel="noreferrer">
        AutoNote
      </a>
      <h1>Connect local Bittrees AI</h1>
      <p>
        This private page has no analytics or third-party scripts. Sign in to
        AutoNote in another tab if needed, then return and refresh.
      </p>
      <button disabled={busy} onClick={() => void act(refresh)}>
        Refresh signed-in account and connections
      </button>
      {error && <p role="alert">{error}</p>}
      {user && (
        <p>
          Signed in as {user.name}. AutoNote and your companion remain separate
          accounts.
        </p>
      )}
      {user && !enabled && (
        <p>
          New AI connections are disabled. Existing connections can still be
          revoked below.
        </p>
      )}
      {user && enabled && challenge && !code && (
        <>
          <button
            disabled={busy}
            onClick={() =>
              void act(async () => {
                setReview(false);
                setChoices([]);
                setSelected("");
                const generation = ++epoch.current;
                const data = await api("options");
                if (generation === epoch.current) {
                  setChoices(data.items);
                  setTruncated(data.truncated);
                }
              })
            }
          >
            Load permitted meetings
          </button>
          {truncated && (
            <p>
              Showing the 100 most recent ready meetings. Older meetings are not
              included in this selection.
            </p>
          )}
          {choices.length > 0 && (
            <>
              <label htmlFor="ai-meeting">One meeting transcript</label>
              <select
                id="ai-meeting"
                value={selected}
                disabled={busy || review}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setReview(false);
                }}
              >
                <option value="">Choose a meeting</option>
                {choices.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title} · {item.workspace_name}
                  </option>
                ))}
              </select>
              <label htmlFor="ai-expiry">Connection expires in days</label>
              <input
                id="ai-expiry"
                type="number"
                min={1}
                max={30}
                value={days}
                disabled={busy || review}
                onChange={(e) => setDays(Number(e.target.value))}
              />
              {!review && (
                <button
                  disabled={
                    busy ||
                    !chosen ||
                    !Number.isInteger(days) ||
                    days < 1 ||
                    days > 30
                  }
                  onClick={() => setReview(true)}
                >
                  Review connection
                </button>
              )}
            </>
          )}
          {review && chosen && (
            <section>
              <h2>Review transcript access</h2>
              <p>
                {chosen.title} in {chosen.workspace_name}. Expires in {days}{" "}
                days.
              </p>
              <p>
                Allow the local companion to read this meeting's current title,
                language and timestamped transcript. Later edits to this
                selected meeting are included while access remains valid; other
                meetings are not included.
              </p>
              <p>
                This does not grant recordings, existing notes, Google access,
                write access or CRM publication. Local drafts require current
                source checks. Retained drafts and independent exports have
                their own deletion controls; revocation cannot retract copies
                already exported.
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    const result = await api("authorize", "POST", {
                      subjectId: user.id,
                      workspaceId: chosen.workspace_id,
                      meetingId: chosen.id,
                      actions: ["read_transcript"],
                      challenge,
                      expiresInDays: days,
                    });
                    await refresh();
                    setCode(result);
                  })
                }
              >
                Allow this transcript connection
              </button>
              <button disabled={busy} onClick={() => setReview(false)}>
                Back to selection
              </button>
            </section>
          )}
        </>
      )}
      {user && enabled && !challenge && (
        <p>
          Start a new connection from the local companion to obtain a valid
          connection challenge.
        </p>
      )}
      {code && (
        <section>
          <h2>Finish in the local companion</h2>
          <p>
            Copy this single-use code into the companion that opened this page.
            It expires at {new Date(code.codeExpiresAt).toLocaleTimeString()}.
          </p>
          <output aria-label="Connection code">{code.code}</output>
          <p>
            The code stays on this page only; it is not placed in a URL or
            browser storage.
          </p>
          <button onClick={() => setCode(null)}>Hide code</button>
        </section>
      )}
      {user && (
        <section>
          <h2>Your transcript connections</h2>
          {!grants.length && <p>No saved connections.</p>}
          {grants.map((grant) => (
            <article key={grant.id}>
              <p>
                Meeting reference: <code>{grant.meeting_id}</code>
              </p>
              <p>
                {grant.revoked_at
                  ? "Revoked"
                  : new Date(grant.expires_at).getTime() <= Date.now()
                    ? "Expired"
                    : "Active"}{" "}
                · Expires {new Date(grant.expires_at).toLocaleString()}
              </p>
              <p>
                Last read:{" "}
                {grant.last_used_at
                  ? new Date(grant.last_used_at).toLocaleString()
                  : "Not yet used"}
              </p>
              {!grant.revoked_at && (
                <>
                  <p>
                    Draft review uploads:{" "}
                    {grant.reviews_enabled ? "Enabled" : "Disabled"}. Each save
                    still requires exact review here or a separately granted
                    approval permission.
                  </p>
                  <button
                    disabled={busy || (!enabled && !grant.reviews_enabled)}
                    onClick={() =>
                      void act(async () => {
                        await api(
                          grant.reviews_enabled
                            ? "review-disable"
                            : "review-enable",
                          "POST",
                          { subjectId: user.id, grantId: grant.id },
                        );
                        await refresh();
                      })
                    }
                  >
                    {grant.reviews_enabled
                      ? "Disable draft review uploads"
                      : "Enable draft review uploads"}
                  </button>
                </>
              )}
              {!grant.revoked_at && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await api("revoke", "POST", { grantId: grant.id });
                      await refresh();
                    })
                  }
                >
                  Revoke connection
                </button>
              )}
            </article>
          ))}
        </section>
      )}
      {user && (
        <Approvals key={user.id + ":" + epoch.current} user={user} api={api} />
      )}
      {user && <Reviews key={user.id} user={user} api={api} />}
    </main>
  );
}
