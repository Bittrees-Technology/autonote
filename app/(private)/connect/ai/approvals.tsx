"use client";
import { useEffect, useId, useRef, useState } from "react";
type Api = (action: string, method?: string, body?: unknown) => Promise<any>;
type Review = {
  snapshot: string;
  grant: any;
  title: string;
  minutes: number;
  challenge: string;
  start: number;
  mono: number;
  ends: number;
};
export default function Approvals({
  user,
  api,
}: {
  user: { id: string; name: string };
  api: Api;
}) {
  const selectId = useId(),
    durationId = useId(),
    ackId = useId(),
    region = useRef<HTMLElement>(null),
    generation = useRef(0),
    running = useRef(false);
  const [data, setData] = useState<any>(null),
    [selected, setSelected] = useState(""),
    [minutes, setMinutes] = useState(15),
    [challenge, setChallenge] = useState(""),
    [review, setReview] = useState<Review | null>(null),
    [ack, setAck] = useState(false),
    [code, setCode] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(
      "Refresh to review source approval permissions.",
    );
  const focused = () => document.hasFocus() && !document.hidden;
  const valid = (r: Review) =>
    focused() &&
    Date.now() >= r.start &&
    Date.now() < r.ends &&
    performance.now() >= r.mono &&
    performance.now() - r.mono < r.ends - r.start;
  function cancel() {
    generation.current++;
    setReview(null);
    setAck(false);
    setCode(null);
    setNotice(
      "Review closed. Refresh permissions if confirmation was already sent.",
    );
  }
  async function read() {
    const [grants, approvals] = await Promise.all([
      api("grants"),
      api("approval-grants"),
    ]);
    if (grants.user.id !== user.id || approvals.user.id !== user.id)
      throw Error("Signed-in account changed. Refresh the page.");
    const choices = approvals.enabled ? (await api("options")).items : [];
    return {
      grants: grants.items,
      approvals: approvals.items,
      enabled: approvals.enabled,
      choices,
    };
  }
  async function run(fn: (epoch: number) => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    const epoch = generation.current;
    try {
      await fn(epoch);
    } catch (e) {
      if (epoch === generation.current) {
        setError(
          e instanceof Error
            ? e.message
            : "Request failed. Refresh before trying again.",
        );
        setReview(null);
        setAck(false);
        setCode(null);
      }
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  async function refresh(epoch: number) {
    const next = await read();
    if (epoch !== generation.current) return;
    setData(next);
    setNotice("Source approval permissions loaded.");
  }
  useEffect(() => {
    const value =
      new URL(location.href).searchParams.get("approval_challenge") ?? "";
    if (/^[A-Za-z0-9_-]{43}$/.test(value)) setChallenge(value);
    const requested =
      new URL(location.href).searchParams.get("approval_grant") ?? "";
    if (/^[a-f0-9-]{36}$/i.test(requested)) setSelected(requested);
    let mounted = true;
    void read()
      .then((next) => {
        if (mounted) setData(next);
      })
      .catch((e) => {
        if (mounted)
          setError(
            e instanceof Error
              ? e.message
              : "Refresh permissions to try again.",
          );
      });
    const blur = () => cancel(),
      visibility = () => {
        if (document.hidden) cancel();
      },
      escape = (e: KeyboardEvent) => {
        if (e.key === "Escape") cancel();
      },
      outside = (e: PointerEvent) => {
        if (!region.current?.contains(e.target as Node)) cancel();
      };
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside);
    return () => {
      mounted = false;
      generation.current++;
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("keydown", escape);
      document.removeEventListener("pointerdown", outside);
    };
  }, [user.id, api]);
  useEffect(() => {
    if (!review && !code) return;
    const t = setInterval(() => {
      if (review && !valid(review)) cancel();
      if (
        code &&
        (Date.now() >= Date.parse(code.codeExpiresAt) ||
          performance.now() - code.mono >= code.ttl)
      ) {
        setCode(null);
        setNotice("The one-use code expired. Review again to create another.");
      }
    }, 250);
    return () => clearInterval(t);
  }, [review, code]);
  const eligible = (d: any) =>
    d.grants.filter(
      (g: any) =>
        !g.revoked_at &&
        g.reviews_enabled &&
        g.review_epoch &&
        Date.parse(g.expires_at) > Date.now() &&
        d.choices.some((c: any) => c.id === g.meeting_id),
    );
  function selection(d: any) {
    const grant = eligible(d).find((g: any) => g.id === selected);
    if (!d.enabled || !grant)
      throw Error(
        "This connection is unavailable. Refresh and choose another.",
      );
    const choice = d.choices.find((c: any) => c.id === grant.meeting_id);
    return {
      grant,
      title: choice.title,
      snapshot: JSON.stringify({
        user: user.id,
        grant: grant.id,
        meeting: grant.meeting_id,
        epoch: grant.review_epoch,
        expiry: grant.expires_at,
        title: choice.title,
        version: choice.version,
        minutes,
        challenge,
      }),
    };
  }
  async function begin(epoch: number) {
    if (!focused() || !/^[A-Za-z0-9_-]{43}$/.test(challenge))
      throw Error("Open approval setup from your companion first.");
    const next = await read();
    if (epoch !== generation.current) return;
    const current = selection(next),
      start = Date.now();
    setData(next);
    setNotice(
      "Review the meeting and duration, then acknowledge the permission below.",
    );
    setCode(null);
    setAck(false);
    setReview({
      ...current,
      minutes,
      challenge,
      start,
      mono: performance.now(),
      ends: Math.min(start + 60000, Date.parse(current.grant.expires_at)),
    });
  }
  async function confirm(epoch: number) {
    const r = review;
    if (!r || !ack || !valid(r))
      throw Error("Review expired. Review the permission again.");
    const next = await read();
    if (epoch !== generation.current) return;
    if (selection(next).snapshot !== r.snapshot || !valid(r))
      throw Error("Connection or meeting changed. Review again.");
    setReview(null);
    setAck(false);
    setNotice(
      "Confirmation sent. If its response is lost, refresh and inspect saved permissions before retrying.",
    );
    const result = await api("approval-authorize", "POST", {
      subjectId: user.id,
      grantId: r.grant.id,
      expectedReviewEpoch: r.grant.review_epoch,
      actions: ["approve_meeting_notes"],
      challenge: r.challenge,
      expiresInMinutes: r.minutes,
      confirmed: true,
      acknowledged: true,
    });
    if (epoch !== generation.current || !focused()) return;
    const ttl = Date.parse(result.codeExpiresAt) - Date.now();
    if (
      !/^[a-f0-9]{64}$/.test(result.code) ||
      result.grantId !== r.grant.id ||
      result.meetingId !== r.grant.meeting_id ||
      ttl <= 0 ||
      ttl > 60000
    )
      throw Error(
        "The response could not be confirmed. Refresh saved permissions.",
      );
    setCode({ ...result, mono: performance.now(), ttl });
    setNotice(
      "Approval permission created. Enter the one-use code in your companion.",
    );
    await refresh(epoch);
  }
  return (
    <section
      ref={region}
      className="ai-approvals"
      aria-label="AI approval permissions"
    >
      <h2>Review and save notes from your companion</h2>
      <p>
        This separate permission lets your companion show and save reviewed
        notes for one meeting. Each exact draft still needs your confirmation in
        AI. It does not allow CRM publication.
      </p>
      <button
        disabled={busy}
        onClick={() => {
          cancel();
          void run(refresh);
        }}
      >
        Refresh approval permissions
      </button>
      <p role="status">{notice}</p>
      {error && <p role="alert">{error}</p>}
      {data && !data.enabled && (
        <p>
          New approval permissions are disabled. You can still revoke saved
          permissions below.
        </p>
      )}
      {data?.enabled && !challenge && (
        <p>
          Start approval setup in your Mac companion, then open its
          source-permission link here.
        </p>
      )}
      {data?.enabled && challenge && (
        <>
          <label htmlFor={selectId}>Meeting connection</label>
          <select
            id={selectId}
            value={selected}
            disabled={busy || !!review}
            onChange={(e) => {
              cancel();
              setSelected(e.target.value);
            }}
          >
            <option value="">Choose a meeting connection</option>
            {eligible(data).map((g: any) => (
              <option key={g.id} value={g.id}>
                {data.choices.find((c: any) => c.id === g.meeting_id)?.title} ·{" "}
                {g.id.slice(0, 8)}
              </option>
            ))}
          </select>
          <label htmlFor={durationId}>Permission duration</label>
          <select
            id={durationId}
            value={minutes}
            disabled={busy || !!review}
            onChange={(e) => {
              cancel();
              setMinutes(Number(e.target.value));
            }}
          >
            {[15, 30, 60].map((n) => (
              <option key={n} value={n}>
                {n} minutes
              </option>
            ))}
          </select>
          {!review && (
            <button
              disabled={busy || !selected}
              onClick={() => void run(begin)}
            >
              Review approval permission
            </button>
          )}
        </>
      )}
      {review && (
        <div aria-label="Approval permission review">
          <h3>Allow reviewed notes to be saved?</h3>
          <p>
            Account: {user.name}. Meeting: {review.title}. Allow review and save
            for up to {review.minutes} minutes, ending no later than the
            connection expiry{" "}
            {new Date(review.grant.expires_at).toLocaleString()}.
          </p>
          <p>
            Connection {review.grant.id}. This replaces any earlier approval
            permission for this connection. It does not save a draft now.
          </p>
          <label className="approval-ack" htmlFor={ackId}>
            <input
              id={ackId}
              type="checkbox"
              checked={ack}
              disabled={busy}
              onChange={(e) => setAck(e.target.checked)}
            />
            I reviewed this meeting and the permission to save notes.
          </label>
          <button disabled={busy || !ack} onClick={() => void run(confirm)}>
            Allow approval from companion
          </button>
          <button onClick={cancel}>Cancel approval review</button>
        </div>
      )}
      {code && (
        <div>
          <h3>One-use companion code</h3>
          <p>
            Enter this code in the companion that opened this setup. It expires
            at {new Date(code.codeExpiresAt).toLocaleTimeString()}.
          </p>
          <output aria-label="Approval exchange code">{code.code}</output>
        </div>
      )}
      <h3>Saved approval permissions</h3>
      {data?.approvals.length === 0 && <p>No approval permissions saved.</p>}
      {data?.approvals.map((item: any) => (
        <article key={item.id}>
          <p>
            Meeting {item.meeting_id}. Permission {item.id}.{" "}
            {item.revoked_at
              ? "Revoked"
              : Date.parse(item.expires_at) <= Date.now()
                ? "Expired"
                : item.permission_current
                  ? "Saved; current meeting access is checked when used"
                  : "Unavailable"}
            . Expires {new Date(item.expires_at).toLocaleString()}.
          </p>
          {!item.revoked_at && (
            <button
              disabled={busy}
              onClick={() => {
                cancel();
                void run(async (epoch) => {
                  await api("approval-revoke", "POST", {
                    subjectId: user.id,
                    approvalId: item.id,
                  });
                  await refresh(epoch);
                });
              }}
            >
              Revoke approval permission
            </button>
          )}
        </article>
      ))}
    </section>
  );
}
