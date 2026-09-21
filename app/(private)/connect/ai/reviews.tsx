"use client";
import { useEffect, useRef, useState } from "react";
type Api = (action: string, method?: string, body?: unknown) => Promise<any>;
export default function Reviews({
  user,
  api,
}: {
  user: { id: string };
  api: Api;
}) {
  const [items, setItems] = useState<any[]>([]),
    [detail, setDetail] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const epoch = useRef(0),
    working = useRef(false);
  useEffect(() => {
    const hide = () => {
      epoch.current++;
      setDetail(null);
      setConfirmed(false);
    };
    window.addEventListener("blur", hide);
    document.addEventListener("visibilitychange", hide);
    useEffect(() => {
      if (!detail?.id || detail.receipt) return;
      const id = detail.id;
      const timer = setInterval(() => {
        if (!working.current && !document.hidden && document.hasFocus())
          void act(() => open(id));
      }, 15000);
      return () => clearInterval(timer);
    }, [detail?.id, user.id]);
    return () => {
      hide();
      window.removeEventListener("blur", hide);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [user.id]);
  async function act(fn: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setDetail(null);
      setConfirmed(false);
      setError(e instanceof Error ? e.message : "Review unavailable.");
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  async function load() {
    setDetail(null);
    setConfirmed(false);
    const generation = ++epoch.current;
    const data = await api("reviews");
    if (generation === epoch.current) setItems(data.items);
  }
  async function open(id: string) {
    setDetail(null);
    setConfirmed(false);
    const generation = ++epoch.current;
    const data = await api("review-detail", "POST", {
      subjectId: user.id,
      reviewId: id,
    });
    if (generation === epoch.current && !document.hidden && document.hasFocus())
      setDetail(data);
  }
  return (
    <section>
      <h2>Review local AI drafts</h2>
      <p>
        Drafts can be uploaded only after you enable review for their
        connection. Saving appends to this meeting’s notes. Existing notes and
        action statuses are preserved. New actions and proposed owners/deadlines
        still require your normal AutoNote review. Nothing is sent to CRM here.
      </p>
      <button disabled={busy} onClick={() => void act(load)}>
        Load draft reviews
      </button>
      <p>Up to 100 reviews are shown, with pending drafts first.</p>
      {error && <p role="alert">{error}</p>}
      {items.map((item) => (
        <article key={item.id}>
          <p>
            Meeting reference: <code>{item.meeting_id}</code> ·{" "}
            {item.receipt
              ? "Saved"
              : item.cleared
                ? "Deleted"
                : "Pending review"}
          </p>
          <button
            disabled={busy || (item.cleared && !item.receipt)}
            onClick={() => void act(() => open(item.id))}
          >
            Open review
          </button>
          {!item.cleared && (
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await api("review-delete", "POST", {
                    subjectId: user.id,
                    reviewId: item.id,
                  });
                  await load();
                })
              }
            >
              Delete pending draft
            </button>
          )}
        </article>
      ))}
      {detail &&
        (detail.receipt ? (
          <section>
            <h3>Saved to AutoNote</h3>
            <p>
              Meeting version {detail.receipt.version}. This receipt records the
              original save; it does not publish to CRM.
            </p>
          </section>
        ) : (
          <section>
            <h3>Review exact additions</h3>
            <p>Meeting: {detail.title}</p>
            <p>
              Audience:{" "}
              {detail.visibility === "workspace"
                ? "Current workspace members"
                : "Meeting creator and people with explicit meeting access"}
              . Access and version are checked again when saving.
            </p>
            <p>
              Review expires {new Date(detail.expiresAt).toLocaleString()}. This
              view clears when you leave the window.
            </p>
            <h4>Summary additions</h4>
            {detail.proposal.summary.map((item: any, i: number) => (
              <p key={i}>
                {item.text} <small>Segments: {item.evidence.join(", ")}</small>
              </p>
            ))}
            <h4>Proposed actions</h4>
            {detail.proposal.actions.map((item: any, i: number) => (
              <p key={i}>
                {item.text} · Suggested owner: {item.owner ?? "Unknown"} ·
                Suggested deadline: {item.dueDate ?? "Unknown"} · Unconfirmed.
                Segments: {item.evidence.join(", ")}
              </p>
            ))}
            <details>
              <summary>Exact resulting notes and evidence</summary>
              <pre>{JSON.stringify(detail.notes, null, 2)}</pre>
            </details>
            <label>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I reviewed these additions and the meeting audience.
            </label>
            <button
              disabled={busy || !confirmed}
              onClick={() =>
                void act(async () => {
                  const selected = detail,
                    generation = ++epoch.current;
                  const receipt = await api("review-save", "POST", {
                    subjectId: user.id,
                    reviewId: selected.id,
                    digest: selected.digest,
                  });
                  setConfirmed(false);
                  if (generation === epoch.current) setDetail({ receipt });
                })
              }
            >
              Save reviewed additions
            </button>
          </section>
        ))}
    </section>
  );
}
