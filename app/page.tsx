"use client";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  Check,
  ChevronRight,
  Clock,
  FileAudio,
  FileText,
  Headphones,
  KeyRound,
  Link as LinkIcon,
  Loader2,
  Lock,
  LogOut,
  Mic,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Square,
  Trash2,
  Upload,
  Users,
  Wallet,
  X,
} from "lucide-react";
import type { Meeting, Notes, Segment } from "../lib/model";
import { demoMeeting } from "../lib/demo";
import { walletIdentity, type EthereumProvider } from "../lib/auth-client";
import { clearRecording, recordedChunks, saveChunk } from "../lib/recording";
import { exportMeeting } from "../lib/export";
type Workspace = {
  id: string;
  name: string;
  role: string;
  retention_days: number;
  monthly_minutes: number;
};
const stamp = (n: number) =>
  `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;
async function api(
  path: string,
  body?: unknown,
  method = body ? "POST" : "GET",
) {
  const r = await fetch("/api/" + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || "Request failed.");
  return d;
}
function download(text: string, name: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} onCancel={onClose}>
      <header>
        <h2>{title}</h2>
        <button className="icon" aria-label="Close" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      {children}
    </dialog>
  );
}
export default function App() {
  const [user, setUser] = useState<{ id: string; name: string } | null>(null),
    [identities, setIdentities] = useState<any[]>([]),
    [workspaces, setWorkspaces] = useState<Workspace[]>([]),
    [workspace, setWorkspace] = useState(""),
    [meetings, setMeetings] = useState<Meeting[]>([]),
    [demo, setDemo] = useState(true),
    [selected, setSelected] = useState<string | null>("demo"),
    [demoData, setDemoData] = useState(demoMeeting),
    [page, setPage] = useState("meetings"),
    [tab, setTab] = useState("overview"),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [modal, setModal] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  const [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [challenge, setChallenge] = useState(""),
    [authLink, setAuthLink] = useState(false),
    [authStep, setAuthStep] = useState(""),
    [recovery, setRecovery] = useState<any>(null),
    [reauth, setReauth] = useState(false);
  const [file, setFile] = useState<File | null>(null),
    [title, setTitle] = useState(""),
    [language, setLanguage] = useState("en"),
    [consent, setConsent] = useState(false),
    [progress, setProgress] = useState(0),
    [recording, setRecording] = useState(false),
    [paused, setPaused] = useState(false),
    [elapsed, setElapsed] = useState(0),
    [savedRecording, setSavedRecording] = useState(false),
    [recoverable, setRecoverable] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null),
    saveChain = useRef(Promise.resolve()),
    saveFailed = useRef(false),
    stream = useRef<MediaStream | null>(null),
    [audioUrl, setAudioUrl] = useState(""),
    player = useRef<HTMLAudioElement>(null),
    [editTranscript, setEditTranscript] = useState(false),
    [transcriptDraft, setTranscriptDraft] = useState<Segment[]>([]),
    [editingNotes, setEditingNotes] = useState(false),
    [notesDraft, setNotesDraft] = useState<Notes | null>(null),
    [settings, setSettings] = useState<any>(null),
    [inviteEmail, setInviteEmail] = useState(""),
    [inviteRole, setInviteRole] = useState("viewer"),
    [inviteUrl, setInviteUrl] = useState(""),
    [newWorkspace, setNewWorkspace] = useState(""),
    [deleteText, setDeleteText] = useState(""),
    [shareMode, setShareMode] = useState("private"),
    [grantIds, setGrantIds] = useState<string[]>([]),
    [retention, setRetention] = useState(30),
    [workspaceName, setWorkspaceName] = useState("");
  const draftVersion = useRef<number>(0);
  const abort = useRef<AbortController | null>(null);
  const currentWorkspace = workspaces.find((w) => w.id === workspace);
  const list = demo ? [demoData] : meetings;
  const active = list.find((m) => m.id === selected);
  const readOnly = !demo && currentWorkspace?.role === "viewer";
  async function refresh(ws = workspace) {
    const d = await api(
      "me" + (ws ? "?workspace=" + encodeURIComponent(ws) : ""),
    );
    setUser(d.user);
    if (d.user) {
      setDemo(false);
      setIdentities(d.identities);
      setWorkspaces(d.workspaces);
      setWorkspace(d.selected || "");
      setMeetings(d.meetings);
      if (selected === "demo") setSelected(null);
    }
    setLoaded(true);
    return d;
  }
  useEffect(() => {
    refresh().catch((e) => {
      setLoaded(true);
      setNotice(e.message);
    });
    recordedChunks()
      .then((c) => setRecoverable(c.length > 0))
      .catch(() => {});
    return () => {
      abort.current?.abort();
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  useEffect(() => {
    if (!user || demo) return;
    const timer = setInterval(() => refresh().catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, [user, workspace, demo]);
  useEffect(() => {
    if (!recording || paused) return;
    const timer = setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => clearInterval(timer);
  }, [recording, paused]);
  useEffect(() => {
    setAudioUrl("");
    setEditTranscript(false);
    setEditingNotes(false);
  }, [selected]);
  useEffect(() => {
    if (elapsed >= 7200 && recording) stopRecording();
  }, [elapsed, recording]);
  async function run(fn: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }
  function signIn(link = false) {
    setAuthLink(link);
    setChallenge("");
    setCode("");
    setEmail("");
    setReauth(false);
    setError("");
    setModal("auth");
  }
  async function authResult(d: any) {
    if (d.recovery) {
      setRecovery(d.recovery);
      setModal("recovery");
      return;
    }
    if (d.reauthenticated) {
      setReauth(true);
      setModal("recovery");
      return;
    }
    await refresh();
    setModal("");
    setNotice("You are signed in. Your meetings are private by default.");
  }
  async function emailStart() {
    await run(async () => {
      const d = await api("auth/challenge", {
        kind: "email",
        value: email,
        link: authLink,
        ...(modal === "reauth" ? { recoveryToken: recovery.token } : {}),
      });
      setChallenge(d.id);
      setAuthStep("Check your email for an eight-digit code.");
    });
  }
  async function emailVerify() {
    await run(async () =>
      authResult(
        await api("auth/verify", {
          id: challenge,
          proof: code,
          recover: authLink,
        }),
      ),
    );
  }
  async function walletSign() {
    await run(async () => {
      const provider = (window as unknown as { ethereum?: EthereumProvider })
        .ethereum;
      if (!provider)
        throw new Error(
          "Open AutoNote in a browser with an Ethereum wallet, or use email.",
        );
      abort.current = new AbortController();
      const d = await walletIdentity(
        provider,
        abort.current.signal,
        setAuthStep,
        api,
        authLink,
        modal === "reauth" ? recovery.token : undefined,
      );
      await authResult(d);
    });
  }
  async function openSettings() {
    setPage("settings");
    if (user && !demo)
      await run(async () => {
        const d = await api("workspaces/" + workspace);
        setSettings(d);
        setRetention(currentWorkspace?.retention_days || 30);
        setWorkspaceName(currentWorkspace?.name || "");
      });
  }
  async function upload() {
    if (demo || !user) {
      signIn();
      return;
    }
    if (!file || !consent) return;
    await run(async () => {
      setProgress(0);
      const key = "autonote-upload-" + user.id;
      const fingerprint = [file.name, file.size, file.lastModified].join(":");
      let saved: any;
      try {
        saved = JSON.parse(localStorage.getItem(key) || "null");
      } catch {}
      let id =
        saved?.fingerprint === fingerprint && saved.workspace === workspace
          ? saved.id
          : null;
      const partSize = 8 * 1024 * 1024;
      if (!id) {
        const d = await api("meetings", {
          workspaceId: workspace,
          title: title || file.name,
          language,
          type: file.type.split(";")[0] || "application/octet-stream",
          size: file.size,
          consent: true,
        });
        id = d.id;
        localStorage.setItem(
          key,
          JSON.stringify({ id, fingerprint, workspace }),
        );
      }
      let completed = new Set<number>();
      try {
        completed = new Set(
          (await api(`meetings/${id}/parts`)).parts.map((p: any) => p.part),
        );
      } catch (e) {
        localStorage.removeItem(key);
        throw e;
      }
      for (let i = 0; i < Math.ceil(file.size / partSize); i++) {
        if (!completed.has(i + 1)) {
          const { url } = await api(`meetings/${id}/parts`, { part: i + 1 });
          const response = await fetch(url, {
            method: "PUT",
            body: file.slice(i * partSize, (i + 1) * partSize),
          });
          if (!response.ok)
            throw new Error(
              "Upload interrupted. Keep this file selected and retry to resume.",
            );
        }
        setProgress(
          Math.round(
            (Math.min(file.size, (i + 1) * partSize) / file.size) * 100,
          ),
        );
      }
      await api(`meetings/${id}/complete`, {});
      localStorage.removeItem(key);
      if (savedRecording) {
        await clearRecording();
        setRecoverable(false);
        setSavedRecording(false);
      }
      await refresh();
      setSelected(id);
      setModal("");
      setFile(null);
      setNotice(
        "Recording received. You can leave this page while AutoNote processes it.",
      );
    });
  }
  async function startRecording() {
    await run(async () => {
      if (!consent) throw new Error("Acknowledge the recording notice first.");
      if (recoverable)
        throw new Error("Recover or discard the saved recording first.");
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      )
        throw new Error(
          "Recording is not supported in this browser. Upload an audio file instead.",
        );
      await clearRecording();
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      const type = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find(
        (t) => MediaRecorder.isTypeSupported(t),
      );
      const r = new MediaRecorder(s, type ? { mimeType: type } : undefined);
      recorder.current = r;
      saveChain.current = Promise.resolve();
      saveFailed.current = false;
      r.ondataavailable = (e) => {
        if (e.data.size)
          saveChain.current = saveChain.current
            .then(() => saveChunk(e.data))
            .catch(() => {
              saveFailed.current = true;
              setError(
                "Device storage is full or unavailable. Stop recording and recover the saved audio.",
              );
              r.state !== "inactive" && r.stop();
            });
      };
      r.onstop = async () => {
        s.getTracks().forEach((t) => t.stop());
        setRecording(false);
        await saveChain.current;
        const chunks = await recordedChunks();
        setRecoverable(chunks.length > 0);
        const b = new Blob(chunks, { type: r.mimeType });
        setFile(
          new File(
            [b],
            r.mimeType.includes("mp4") ? "meeting.m4a" : "meeting.webm",
            {
              type: r.mimeType.split(";")[0],
              lastModified: Number(
                localStorage.getItem("autonote-recording-start") || 0,
              ),
            },
          ),
        );
        setSavedRecording(true);
        if (saveFailed.current)
          setNotice("Only the saved portion of this recording is available.");
      };
      r.onerror = () =>
        setError("Recording was interrupted. Recover saved audio below.");
      localStorage.setItem("autonote-recording-start", String(Date.now()));
      r.start(2000);
      setRecording(true);
      setElapsed(0);
      setPaused(false);
    });
  }
  function stopRecording() {
    if (recorder.current?.state !== "inactive") recorder.current?.stop();
  }
  async function recoverRecording() {
    await run(async () => {
      const chunks = await recordedChunks();
      if (!chunks.length) throw new Error("No saved audio was found.");
      const b = new Blob(chunks, { type: chunks[0].type || "audio/webm" });
      setFile(
        new File([b], b.type.includes("mp4") ? "meeting.m4a" : "meeting.webm", {
          type: b.type.split(";")[0],
          lastModified: Number(
            localStorage.getItem("autonote-recording-start") || 0,
          ),
        }),
      );
      setSavedRecording(true);
      setModal("upload");
    });
  }
  async function saveMeeting(patch: unknown, version = active?.version) {
    if (!active) return;
    if (demo) {
      setDemoData({
        ...demoData,
        ...(patch as any),
        version: demoData.version + 1,
      });
      return;
    }
    await api("meetings/" + active.id, { version, ...(patch as any) }, "PATCH");
    await refresh();
  }
  async function seek(s: number) {
    if (!active) return;
    if (demo) {
      setNotice(
        "This fictional demo has no recording. Upload a meeting to use playback.",
      );
      return;
    }
    await run(async () => {
      if (!audioUrl) {
        const d = await api(`meetings/${active.id}/audio`);
        setAudioUrl(d.url);
        setTimeout(() => {
          if (player.current) {
            player.current.currentTime = s;
            player.current.play().catch(() => {});
          }
        }, 150);
      } else if (player.current) {
        player.current.currentTime = s;
        await player.current.play();
      }
    });
  }
  async function exportFile(format: string) {
    if (!active) return;
    await run(async () => {
      if (demo)
        download(exportMeeting(active, format), `autonote-demo.${format}`);
      else {
        const response = await fetch(
          `/api/meetings/${active.id}/export?format=${format}`,
        );
        if (!response.ok) throw new Error((await response.json()).error);
        download(await response.text(), `autonote-${active.id}.${format}`);
      }
    });
  }
  const filtered = list.filter(
    (m) =>
      (filter === "all" ||
        (filter === "ready" ? m.status === "ready" : m.status !== "ready")) &&
      `${m.title} ${m.transcript.map((s) => s.text).join(" ")}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const allActions = list.flatMap((m) =>
    (m.notes?.actions || []).map((a) => ({ ...a, meeting: m })),
  );
  function evidence(ids: string[]) {
    return (
      <span className="evidence">
        {ids.map((id) => {
          const s = active?.transcript.find((s) => s.id === id);
          return s ? (
            <button
              key={id}
              onClick={() => {
                setTab("transcript");
                setTimeout(
                  () =>
                    document
                      .getElementById("segment-" + id)
                      ?.scrollIntoView({ block: "center", behavior: "smooth" }),
                  30,
                );
              }}
            >
              <LinkIcon size={12} />
              {stamp(s.start)}
            </button>
          ) : null;
        })}
      </span>
    );
  }
  function noteSection(key: keyof Omit<Notes, "summary">, label: string) {
    const items = (editingNotes ? notesDraft : active?.notes)?.[key] || [];
    return (
      <section className="note-section">
        <div className="section-label">
          <h3>{label}</h3>
          <span>{items.length}</span>
        </div>
        {items.length ? (
          items.map((n, i) => (
            <div
              className={
                "note-item " + (key === "actions" ? "action-item" : "")
              }
              key={n.id}
            >
              {key === "actions" && (
                <button
                  className={
                    "task-check " + (n.status === "completed" ? "checked" : "")
                  }
                  aria-label={
                    n.status === "completed"
                      ? "Reopen action"
                      : "Complete action"
                  }
                  disabled={readOnly || busy || editingNotes}
                  onClick={() =>
                    run(async () => {
                      const notes = structuredClone(active!.notes!);
                      notes.actions[i].status =
                        n.status === "completed" ? "accepted" : "completed";
                      await saveMeeting({ notes });
                    })
                  }
                >
                  {n.status === "completed" && <Check size={14} />}
                </button>
              )}
              <div className="grow">
                {editingNotes ? (
                  <textarea
                    aria-label={label + " text"}
                    value={n.text}
                    onChange={(e) =>
                      setNotesDraft((d) => ({
                        ...d!,
                        [key]: d![key].map((a, j) =>
                          j === i ? { ...a, text: e.target.value } : a,
                        ),
                      }))
                    }
                  />
                ) : (
                  <p>{n.text}</p>
                )}
                {key === "actions" && (
                  <div className="action-meta">
                    {editingNotes ? (
                      <>
                        <input
                          aria-label="Action owner"
                          placeholder="Unassigned"
                          value={n.owner || ""}
                          onChange={(e) =>
                            setNotesDraft((d) => ({
                              ...d!,
                              actions: d!.actions.map((a, j) =>
                                j === i
                                  ? { ...a, owner: e.target.value || null }
                                  : a,
                              ),
                            }))
                          }
                        />
                        <input
                          aria-label="Due date"
                          type="date"
                          value={n.dueDate || ""}
                          onChange={(e) =>
                            setNotesDraft((d) => ({
                              ...d!,
                              actions: d!.actions.map((a, j) =>
                                j === i
                                  ? { ...a, dueDate: e.target.value || null }
                                  : a,
                              ),
                            }))
                          }
                        />
                      </>
                    ) : (
                      <>
                        <span>{n.owner || "Unassigned"}</span>
                        <span>{n.dueDate || "No date stated"}</span>
                      </>
                    )}
                    <select
                      aria-label="Action status"
                      value={n.status}
                      disabled={readOnly || busy || editingNotes}
                      onChange={(e) =>
                        run(async () => {
                          const notes = structuredClone(active!.notes!);
                          notes.actions[i].status = e.target.value as any;
                          await saveMeeting({ notes });
                        })
                      }
                    >
                      {["proposed", "accepted", "completed", "dismissed"].map(
                        (s) => (
                          <option key={s}>{s}</option>
                        ),
                      )}
                    </select>
                  </div>
                )}
                {evidence(n.evidence)}
              </div>
            </div>
          ))
        ) : (
          <p className="muted">No {label.toLowerCase()} identified.</p>
        )}
      </section>
    );
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="AutoNote home">
          <span className="brand-mark">
            <Activity size={24} />
          </span>
          <span>
            autonote<small>by bittrees</small>
          </span>
        </a>
        <button
          className="workspace-button"
          onClick={() => (user ? openSettings() : signIn())}
        >
          <span className="workspace-avatar">
            {demo ? "B" : currentWorkspace?.name[0] || "A"}
          </span>
          <span>
            {demo ? "Bittrees demo" : currentWorkspace?.name || "My workspace"}
            <small>
              {demo ? "Fictional sample workspace" : currentWorkspace?.role}
            </small>
          </span>
          <ChevronRight size={16} />
        </button>
        {user && !demo && (
          <select
            aria-label="Switch workspace"
            className="workspace-select"
            value={workspace}
            onChange={(e) => {
              setSelected(null);
              setPage("meetings");
              refresh(e.target.value).catch((e) => setError(e.message));
            }}
          >
            {workspaces.map((w) => (
              <option value={w.id} key={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        )}
        <nav>
          <button
            className={page === "meetings" ? "active" : ""}
            onClick={() => {
              setPage("meetings");
              setSelected(null);
            }}
          >
            <FileAudio size={19} />
            Meetings<span>{list.length}</span>
          </button>
          <button
            className={page === "actions" ? "active" : ""}
            onClick={() => setPage("actions")}
          >
            <Check size={19} />
            Action items
            <span>
              {
                allActions.filter(
                  (a) => !["completed", "dismissed"].includes(a.status),
                ).length
              }
            </span>
          </button>
          <button
            className={page === "settings" ? "active" : ""}
            onClick={openSettings}
          >
            <Settings size={19} />
            Settings
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-note">
            <ShieldCheck size={19} />
            <div>
              Your conversations,
              <br />
              under your control.
            </div>
          </div>
          {user ? (
            <button
              className="profile"
              onClick={() =>
                run(async () => {
                  await api("auth/logout", {});
                  setUser(null);
                  setDemo(true);
                  setSelected("demo");
                  setPage("meetings");
                })
              }
            >
              <span className="avatar">{user.name[0]}</span>
              <span>{user.name}</span>
              <LogOut size={16} />
            </button>
          ) : (
            <button className="primary full" onClick={() => signIn()}>
              <KeyRound size={16} />
              Sign in
            </button>
          )}
        </div>
      </aside>
      <main>
        <div className="topbar">
          <span>
            <span className="status-dot" />{" "}
            {demo ? "Explore AutoNote" : "Your meeting workspace"}
          </span>
          <div>
            {demo && <span className="pill">DEMO</span>}
            <a href="/privacy">Privacy</a>
            <span className="beta">BETA</span>
          </div>
        </div>
        {demo && (
          <div className="demo-banner">
            <span>
              This is a fictional meeting. Sign in to record and save your own.
            </span>
            <button onClick={() => signIn()}>
              Use AutoNote <ChevronRight size={14} />
            </button>
          </div>
        )}
        {error && (
          <div className="message error" role="alert">
            {error}
            <button onClick={() => setError("")} aria-label="Dismiss error">
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="message" role="status">
            {notice}
            <button onClick={() => setNotice("")} aria-label="Dismiss notice">
              <X size={16} />
            </button>
          </div>
        )}
        {!loaded && (
          <div className="loading">
            <Loader2 className="spin" />
            Loading your workspace…
          </div>
        )}
        {page === "meetings" && (
          <>
            <div className="page-heading">
              <div>
                {active && (
                  <button className="back" onClick={() => setSelected(null)}>
                    <ArrowLeft size={15} />
                    All meetings
                  </button>
                )}
                <h1>{active ? active.title : "Your meetings"}</h1>
                <p>
                  {active ? (
                    <>
                      <span>
                        {new Date(active.created_at).toLocaleDateString(
                          undefined,
                          { month: "long", day: "numeric", year: "numeric" },
                        )}
                      </span>
                      <span className="separator">·</span>
                      <span>
                        {active.duration
                          ? Math.round(active.duration / 60) + " min"
                          : "Processing"}
                      </span>
                      <span className="separator">·</span>
                      <Lock size={13} />
                      {active.visibility === "private"
                        ? "Private"
                        : "Workspace shared"}
                    </>
                  ) : (
                    "Conversations become a clear next step."
                  )}
                </p>
              </div>
              <div className="heading-actions">
                <button
                  className="secondary"
                  disabled={readOnly}
                  onClick={() => {
                    if (!user || demo) {
                      signIn();
                      return;
                    }
                    setFile(null);
                    setTitle("");
                    setConsent(false);
                    setProgress(0);
                    setModal("upload");
                  }}
                >
                  <Upload size={17} />
                  Upload
                </button>
                <button
                  className="primary"
                  disabled={readOnly}
                  onClick={() => {
                    if (!user || demo) {
                      signIn();
                      return;
                    }
                    setFile(null);
                    setTitle("");
                    setConsent(false);
                    setModal("record");
                  }}
                >
                  <Mic size={17} />
                  Record
                </button>
              </div>
            </div>
            {recoverable && user && !recording && (
              <div className="message">
                A recording is saved on this device.
                <button onClick={recoverRecording}>Recover audio</button>
                <button onClick={() => setModal("discard")}>Discard</button>
              </div>
            )}
            {!active ? (
              <>
                <div className="library-toolbar">
                  <label className="search">
                    <Search size={18} />
                    <input
                      placeholder="Search meetings and transcripts"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <select
                    aria-label="Filter meetings"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="all">All meetings</option>
                    <option value="ready">Ready</option>
                    <option value="processing">
                      Processing / needs attention
                    </option>
                  </select>
                </div>
                <div className="meeting-list">
                  {filtered.map((m) => (
                    <button
                      className="meeting-row"
                      key={m.id}
                      onClick={() => {
                        setSelected(m.id);
                        setTab("overview");
                      }}
                    >
                      <span className="meeting-icon">
                        <FileAudio size={22} />
                      </span>
                      <span className="grow">
                        <strong>{m.title}</strong>
                        <small>
                          {new Date(m.created_at).toLocaleDateString()} ·{" "}
                          {m.duration
                            ? Math.round(m.duration / 60) + " min"
                            : "Awaiting transcript"}
                        </small>
                      </span>
                      <span
                        className={
                          "state " + (m.status === "ready" ? "ready" : "")
                        }
                      >
                        {m.status}
                      </span>
                      <ChevronRight size={18} />
                    </button>
                  ))}
                  {!filtered.length && (
                    <div className="empty">
                      <Headphones size={38} />
                      <h2>
                        {search
                          ? "No matching meetings"
                          : "A little less note-taking."}
                      </h2>
                      <p>
                        {search
                          ? "Try a different word from the conversation."
                          : "Upload your first recording or capture a conversation with your microphone."}
                      </p>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="meeting-toolbar">
                  <div
                    className="tabs"
                    role="tablist"
                    aria-label="Meeting view"
                  >
                    {["overview", "transcript", "actions"].map((t) => (
                      <button
                        role="tab"
                        aria-selected={tab === t}
                        key={t}
                        className={tab === t ? "active" : ""}
                        onClick={() => setTab(t)}
                      >
                        {t === "overview"
                          ? "Overview"
                          : t === "transcript"
                            ? "Transcript"
                            : "Action items"}
                      </button>
                    ))}
                  </div>
                  <div className="toolbar-buttons">
                    <button
                      className="text-button"
                      disabled={!active.canEdit}
                      onClick={() =>
                        run(async () => {
                          if (!demo) {
                            setSettings(await api("workspaces/" + workspace));
                            const sharing = await api(
                              `meetings/${active.id}/sharing`,
                            );
                            setShareMode(sharing.visibility);
                            setGrantIds(sharing.grantIds);
                          } else {
                            setShareMode(active.visibility);
                            setGrantIds([]);
                          }
                          draftVersion.current = active.version;
                          setModal("share");
                        })
                      }
                    >
                      <Users size={16} />
                      Share
                    </button>
                    <button
                      className="icon"
                      aria-label="Export meeting"
                      onClick={() => setModal("export")}
                    >
                      <ArrowDownToLine size={18} />
                    </button>
                    <button
                      className="icon"
                      aria-label="Meeting options"
                      onClick={() => setModal("options")}
                    >
                      <MoreHorizontal size={20} />
                    </button>
                  </div>
                </div>
                <div className="meeting-body">
                  <div className="notes-pane">
                    {active.error && (
                      <div className="message error">{active.error}</div>
                    )}
                    {active.status !== "ready" && (
                      <div className="processing">
                        <Loader2
                          size={18}
                          className={active.status === "failed" ? "" : "spin"}
                        />
                        <div>
                          <strong>
                            {active.status === "failed"
                              ? "Processing needs attention"
                              : active.status}
                          </strong>
                          <p>
                            {active.transcript.length
                              ? "Your transcript is available while notes are prepared."
                              : "You can leave this page. The recording is processed in the background."}
                          </p>
                        </div>
                      </div>
                    )}
                    {active.notes_stale && (
                      <div className="message">
                        The transcript was edited. Review or regenerate these
                        notes.
                      </div>
                    )}
                    {tab === "overview" && (
                      <>
                        {active.notes ? (
                          <>
                            <div className="summary-heading">
                              <span className="eyebrow">
                                <Activity size={15} />
                                MEETING NOTES
                              </span>
                              {active.canEdit && (
                                <button
                                  className="text-button"
                                  onClick={() => {
                                    draftVersion.current = active.version;
                                    setNotesDraft(
                                      structuredClone(active.notes),
                                    );
                                    setEditingNotes((v) => !v);
                                  }}
                                >
                                  {editingNotes ? "Cancel" : "Edit notes"}
                                </button>
                              )}
                            </div>
                            {editingNotes ? (
                              <textarea
                                className="summary-edit"
                                aria-label="Meeting summary"
                                value={notesDraft?.summary || ""}
                                onChange={(e) =>
                                  setNotesDraft((d) => ({
                                    ...d!,
                                    summary: e.target.value,
                                  }))
                                }
                              />
                            ) : (
                              <p className="summary">{active.notes.summary}</p>
                            )}
                            {noteSection("topics", "Discussion points")}
                            {noteSection("decisions", "Decisions")}
                            {noteSection("actions", "Next steps")}
                            {noteSection("questions", "Open questions")}
                            {noteSection(
                              "recommendations",
                              "Suggestions for next time",
                            )}
                            {editingNotes && (
                              <button
                                className="primary"
                                disabled={busy}
                                onClick={() =>
                                  run(async () => {
                                    await saveMeeting(
                                      { notes: notesDraft },
                                      draftVersion.current,
                                    );
                                    setEditingNotes(false);
                                  })
                                }
                              >
                                Save notes
                              </button>
                            )}
                          </>
                        ) : (
                          <div className="empty">
                            <FileText size={32} />
                            <h2>Notes will appear here</h2>
                            <p>
                              Your summary, decisions, and next steps will be
                              ready after processing.
                            </p>
                          </div>
                        )}
                      </>
                    )}
                    {tab === "transcript" && (
                      <>
                        <div className="summary-heading">
                          <span className="eyebrow">
                            TRANSCRIPT · {active.transcript.length} SEGMENTS
                          </span>
                          {active.canEdit && !!active.transcript.length && (
                            <button
                              className="text-button"
                              onClick={() => {
                                draftVersion.current = active.version;
                                setTranscriptDraft(
                                  structuredClone(active.transcript),
                                );
                                setEditTranscript((v) => !v);
                              }}
                            >
                              {editTranscript ? "Cancel" : "Edit transcript"}
                            </button>
                          )}
                        </div>
                        {(editTranscript
                          ? transcriptDraft
                          : active.transcript
                        ).map((s, i) => (
                          <div
                            className="transcript-segment"
                            id={"segment-" + s.id}
                            key={s.id}
                          >
                            <button
                              className="timestamp"
                              onClick={() => seek(s.start)}
                            >
                              {stamp(s.start)}
                              <Play size={11} />
                            </button>
                            <div className="grow">
                              {editTranscript ? (
                                <>
                                  <input
                                    aria-label="Speaker name"
                                    value={s.speaker}
                                    onChange={(e) =>
                                      setTranscriptDraft((d) =>
                                        d.map((v, j) =>
                                          i === j
                                            ? { ...v, speaker: e.target.value }
                                            : v,
                                        ),
                                      )
                                    }
                                  />
                                  <textarea
                                    aria-label={
                                      "Transcript at " + stamp(s.start)
                                    }
                                    value={s.text}
                                    onChange={(e) =>
                                      setTranscriptDraft((d) =>
                                        d.map((v, j) =>
                                          i === j
                                            ? { ...v, text: e.target.value }
                                            : v,
                                        ),
                                      )
                                    }
                                  />
                                </>
                              ) : (
                                <>
                                  <strong>{s.speaker}</strong>
                                  <p>{s.text}</p>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                        {editTranscript && (
                          <button
                            className="primary"
                            disabled={busy}
                            onClick={() =>
                              run(async () => {
                                await saveMeeting(
                                  { transcript: transcriptDraft },
                                  draftVersion.current,
                                );
                                setEditTranscript(false);
                              })
                            }
                          >
                            Save transcript
                          </button>
                        )}
                        {!active.transcript.length && (
                          <p className="muted">
                            Transcription has not completed yet.
                          </p>
                        )}
                      </>
                    )}
                    {tab === "actions" &&
                      noteSection("actions", "Action items")}
                  </div>
                  <aside className="meeting-aside">
                    <div className="audio-card">
                      <div className="audio-title">
                        <Headphones size={18} />
                        <strong>Recording</strong>
                      </div>
                      <div className="waveform" aria-hidden="true">
                        {Array.from({ length: 36 }, (_, i) => (
                          <i
                            key={i}
                            style={{ height: 12 + ((i * 37 + 17) % 55) + "px" }}
                          />
                        ))}
                      </div>
                      {audioUrl ? (
                        <audio
                          controls
                          src={audioUrl}
                          ref={player}
                          onError={() => {
                            setAudioUrl("");
                            setNotice(
                              "Playback link expired. Press play to refresh it.",
                            );
                          }}
                        />
                      ) : (
                        <button
                          className="play-recording"
                          onClick={() => seek(0)}
                          disabled={active.recording_deleted && !demo}
                        >
                          <Play size={17} />
                          {demo
                            ? "Demo recording"
                            : active.recording_deleted
                              ? "Recording expired"
                              : "Play recording"}
                          <span>
                            {active.duration ? stamp(active.duration) : "—"}
                          </span>
                        </button>
                      )}
                      <p>
                        {demo
                          ? "Fictional sample · no audio file"
                          : active.recording_deleted
                            ? "The transcript and notes are still available."
                            : "Private audio · short-lived playback access"}
                      </p>
                    </div>
                    <div className="aside-section">
                      <h3>In this conversation</h3>
                      {[
                        ...new Set(active.transcript.map((s) => s.speaker)),
                      ].map((s, i) => (
                        <div className="speaker" key={s}>
                          <span className={"avatar color-" + (i % 3)}>
                            {s[0]}
                          </span>
                          <span>{s}</span>
                        </div>
                      ))}
                      {!active.transcript.length && (
                        <p className="muted">
                          Speakers appear after transcription.
                        </p>
                      )}
                    </div>
                    <div className="aside-section">
                      <h3>A useful starting point</h3>
                      <p className="muted">
                        Review names, dates, and decisions before sharing.
                        Suggestions are drafts, with links to the conversation.
                      </p>
                    </div>
                    <div className="private-label">
                      <Lock size={14} />
                      {active.visibility === "private"
                        ? "Only you and people you choose"
                        : "Shared in your workspace"}
                    </div>
                  </aside>
                </div>
              </>
            )}
          </>
        )}
        {page === "actions" && (
          <>
            <div className="page-heading">
              <div>
                <h1>Action items</h1>
                <p>The next step, with the conversation behind it.</p>
              </div>
            </div>
            <div className="action-library">
              {allActions.map((a) => (
                <button
                  key={a.meeting.id + a.id}
                  className="meeting-row"
                  onClick={() => {
                    setPage("meetings");
                    setSelected(a.meeting.id);
                    setTab("actions");
                  }}
                >
                  <span className="meeting-icon">
                    <Check size={21} />
                  </span>
                  <span className="grow">
                    <strong>{a.text}</strong>
                    <small>
                      {a.meeting.title} · {a.owner || "Unassigned"} ·{" "}
                      {a.dueDate || "No date stated"}
                    </small>
                  </span>
                  <span className="state">{a.status}</span>
                </button>
              ))}
              {!allActions.length && (
                <div className="empty">
                  <Check size={35} />
                  <h2>No actions yet</h2>
                  <p>
                    Action items from your meetings will appear here for review.
                  </p>
                </div>
              )}
            </div>
          </>
        )}
        {page === "settings" && (
          <>
            <div className="page-heading">
              <div>
                <h1>Settings</h1>
                <p>Your identity, your workspace, your recordings.</p>
              </div>
            </div>
            <div className="settings-grid">
              <section>
                <h2>Sign-in methods</h2>
                <p className="muted">
                  Link verified email and Ethereum identities to one account.
                </p>
                {identities.map((i) => (
                  <div className="identity" key={i.value}>
                    <ShieldCheck size={18} />
                    <span>{i.value}</span>
                    <small>{i.kind === "email" ? "Email" : "Ethereum"}</small>
                  </div>
                ))}
                <button className="secondary" onClick={() => signIn(!!user)}>
                  Link a sign-in method
                </button>
                {user && (
                  <button
                    className="text-button"
                    onClick={() =>
                      run(async () => {
                        const r = await api("account/export");
                        download(
                          JSON.stringify(r, null, 2),
                          "autonote-account.json",
                          "application/json",
                        );
                      })
                    }
                  >
                    Export my data
                  </button>
                )}
              </section>
              <section>
                <h2>Workspace</h2>
                {demo ? (
                  <p className="muted">
                    Sign in to create your workspace and manage membership.
                  </p>
                ) : (
                  <>
                    <label>
                      Name
                      <input
                        value={workspaceName}
                        onChange={(e) => setWorkspaceName(e.target.value)}
                        disabled={settings?.role !== "owner"}
                      />
                    </label>
                    <label>
                      Keep recordings for
                      <select
                        value={retention}
                        disabled={settings?.role !== "owner"}
                        onChange={(e) => setRetention(Number(e.target.value))}
                      >
                        {[1, 7, 14, 30, 60, 90, 365].map((d) => (
                          <option value={d} key={d}>
                            {d} days
                          </option>
                        ))}
                      </select>
                    </label>
                    <p className="muted">
                      Transcripts and notes remain until deleted.{" "}
                      {Math.round(settings?.usage || 0)} of{" "}
                      {currentWorkspace?.monthly_minutes} transcription minutes
                      used this month.
                    </p>
                    {settings?.role === "owner" && (
                      <button
                        className="secondary"
                        onClick={() =>
                          run(async () => {
                            await api("workspaces/" + workspace, {
                              action: "settings",
                              name: workspaceName,
                              retentionDays: retention,
                            });
                            await refresh();
                            setNotice("Workspace settings saved.");
                          })
                        }
                      >
                        Save workspace settings
                      </button>
                    )}
                  </>
                )}
                <button
                  className="text-button"
                  onClick={() => (user ? setModal("workspace") : signIn())}
                >
                  <Plus size={15} />
                  New workspace
                </button>
              </section>
              <section>
                <h2>People</h2>
                {(settings?.members || []).map((m: any) => (
                  <div className="member" key={m.user_id}>
                    <span className="grow">{m.name}</span>
                    {settings.role === "owner" ? (
                      <select
                        aria-label={"Role for " + m.name}
                        value={m.role}
                        onChange={(e) =>
                          run(async () => {
                            await api("workspaces/" + workspace, {
                              action: "member",
                              userId: m.user_id,
                              role: e.target.value,
                            });
                            setSettings(await api("workspaces/" + workspace));
                            await refresh();
                          })
                        }
                      >
                        {["owner", "editor", "viewer", "remove"].map((r) => (
                          <option key={r}>{r}</option>
                        ))}
                      </select>
                    ) : (
                      <small>{m.role}</small>
                    )}
                  </div>
                ))}
                {settings?.role === "owner" && (
                  <>
                    <label>
                      Invite by verified email
                      <input
                        type="email"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="name@example.org"
                      />
                    </label>
                    <div className="row">
                      <select
                        aria-label="Invite role"
                        value={inviteRole}
                        onChange={(e) => setInviteRole(e.target.value)}
                      >
                        <option>viewer</option>
                        <option>editor</option>
                      </select>
                      <button
                        className="secondary"
                        onClick={() =>
                          run(async () => {
                            const d = await api("workspaces/" + workspace, {
                              action: "invite",
                              email: inviteEmail,
                              role: inviteRole,
                            });
                            setInviteUrl(d.inviteUrl);
                            setSettings(await api("workspaces/" + workspace));
                          })
                        }
                      >
                        Create invite link
                      </button>
                    </div>
                    {inviteUrl && (
                      <label>
                        Share this link with the invited person
                        <input
                          readOnly
                          value={inviteUrl}
                          onFocus={(e) => e.target.select()}
                        />
                      </label>
                    )}
                    {settings.invites
                      .filter((i: any) => !i.revoked_at && !i.accepted_at)
                      .map((i: any) => (
                        <div className="member" key={i.id}>
                          <span>{i.email}</span>
                          <button
                            className="text-button"
                            onClick={() =>
                              run(async () => {
                                await api("workspaces/" + workspace, {
                                  action: "revoke",
                                  inviteId: i.id,
                                });
                                setSettings(
                                  await api("workspaces/" + workspace),
                                );
                              })
                            }
                          >
                            Revoke
                          </button>
                        </div>
                      ))}
                  </>
                )}
                {user && (
                  <button
                    className="text-button"
                    onClick={() =>
                      run(async () => {
                        const token = new URLSearchParams(location.search).get(
                          "invite",
                        );
                        if (!token)
                          throw new Error(
                            "Open the invite link you received, then accept it here.",
                          );
                        const d = await api("invites", { token });
                        history.replaceState(null, "", "/");
                        await refresh(d.workspaceId);
                        setNotice("Invitation accepted.");
                        setPage("meetings");
                      })
                    }
                  >
                    Accept invitation from this page’s link
                  </button>
                )}
              </section>
              <section>
                <h2>Privacy and data</h2>
                <p className="muted">
                  Meetings start private. Workspace owners cannot read private
                  meetings unless they are shared with them. Processing requires
                  the configured transcription and notes services.
                </p>
                <a href="/privacy">Read the privacy details</a>
                {user && (
                  <button
                    className="danger text-button"
                    onClick={() => {
                      setDeleteText("");
                      setModal("delete-account");
                    }}
                  >
                    Delete my account
                  </button>
                )}
              </section>
            </div>
          </>
        )}
      </main>
      {["auth", "reauth"].includes(modal) && (
        <Dialog
          title={
            modal === "reauth"
              ? "Verify your current account"
              : authLink
                ? "Link a sign-in method"
                : "Welcome to AutoNote"
          }
          onClose={() => {
            abort.current?.abort();
            setModal("");
          }}
        >
          <p className="muted">
            {modal === "reauth"
              ? "Use an identity already linked to your current account."
              : "Sign in with email or your Ethereum wallet. Linking both keeps your meetings in one account."}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              challenge ? emailVerify() : emailStart();
            }}
          >
            <label>
              Email address
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                disabled={!!challenge || busy}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            {challenge && (
              <label>
                Eight-digit code
                <input
                  inputMode="numeric"
                  pattern="[0-9]{8}"
                  autoComplete="one-time-code"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  maxLength={8}
                />
              </label>
            )}
            <button className="primary full" disabled={busy}>
              {busy ? <Loader2 className="spin" size={16} /> : null}
              {challenge ? "Verify email" : "Send sign-in code"}
            </button>
            {challenge && (
              <button
                type="button"
                className="text-button"
                onClick={() => setChallenge("")}
              >
                Use a different email
              </button>
            )}
          </form>
          <div className="or">or</div>
          <button
            className="secondary full"
            disabled={busy}
            onClick={walletSign}
          >
            <Wallet size={18} />
            Continue with Ethereum
          </button>
          <p className="fine">
            Wallet sign-in verifies ownership. It does not authorize a
            transaction.
          </p>
          {authStep && (
            <p role="status" className="fine">
              {authStep.replaceAll("-", " ")}
            </p>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
        </Dialog>
      )}
      {modal === "recovery" && recovery && (
        <Dialog title="Review account recovery" onClose={() => setModal("")}>
          <p>
            These identities belong to separate accounts. Combining them moves
            meetings and workspace memberships into your current account.
          </p>
          <div className="recovery-accounts">
            {[recovery.current, recovery.other].map((a: any, i) => (
              <section key={i}>
                <strong>
                  {i === 0 ? "Keep: " : "Combine: "}
                  {a.name}
                </strong>
                {a.identities.map((v: any) => (
                  <p className="fine" key={v.value}>
                    {v.value}
                  </p>
                ))}
                <p>{a.workspaces.length} workspace(s)</p>
              </section>
            ))}
          </div>
          {!reauth ? (
            <button
              className="primary full"
              onClick={() => {
                setAuthLink(true);
                setChallenge("");
                setEmail("");
                setCode("");
                setModal("reauth");
              }}
            >
              Verify current account
            </button>
          ) : (
            <button
              className="primary full"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await authResult(
                    await api("auth/recover", { token: recovery.token }),
                  );
                  setRecovery(null);
                })
              }
            >
              Confirm and combine accounts
            </button>
          )}
          {error && <p role="alert">{error}</p>}
        </Dialog>
      )}
      {["upload", "record"].includes(modal) && (
        <Dialog
          title={
            modal === "record" ? "Record a conversation" : "Upload a recording"
          }
          onClose={() => {
            if (recording) {
              setError("Stop recording before closing this window.");
              return;
            }
            setModal("");
          }}
        >
          <label>
            Meeting title
            <input
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Weekly product check-in"
            />
          </label>
          <label>
            Spoken language
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              <option value="en">English</option>
              <option value="pt">Portuguese · pilot</option>
              <option value="auto">Detect language</option>
            </select>
          </label>
          <label className="consent">
            <input
              type="checkbox"
              checked={consent}
              disabled={recording}
              onChange={(e) => setConsent(e.target.checked)}
            />
            <span>
              I have informed participants and have permission to record and
              process this conversation.
            </span>
          </label>
          {modal === "upload" ? (
            <label className="dropzone">
              <Upload size={30} />
              <strong>{file ? file.name : "Choose audio or video"}</strong>
              <span>MP3, WAV, M4A, WebM, MP4 · up to 1 GB / 2 hours</span>
              <input
                type="file"
                accept=".mp3,.wav,.m4a,.webm,.mp4"
                disabled={busy}
                onChange={(e) => {
                  setFile(e.target.files?.[0] || null);
                  setSavedRecording(false);
                }}
              />
            </label>
          ) : (
            <>
              <p className="fine">
                Captures your microphone. Remote voices in headphones are not
                included. Keep this page open while recording.
              </p>
              {recording ? (
                <div className="record-controls">
                  <span className="record-dot" />
                  <strong>{stamp(elapsed)}</strong>
                  <button
                    className="secondary"
                    onClick={() => {
                      if (paused) recorder.current?.resume();
                      else recorder.current?.pause();
                      setPaused(!paused);
                    }}
                  >
                    {paused ? <Play size={16} /> : <Pause size={16} />}
                  </button>
                  <button className="secondary" onClick={stopRecording}>
                    <Square size={16} />
                    Stop
                  </button>
                </div>
              ) : !file ? (
                <button
                  className="primary full"
                  disabled={!consent || busy || recoverable}
                  onClick={startRecording}
                >
                  <Mic size={18} />
                  Start recording
                </button>
              ) : (
                <p>
                  <FileAudio size={18} />
                  Recording saved on this device ·{" "}
                  {Math.round(file.size / 1024)} KB
                </p>
              )}
            </>
          )}
          {file && !recording && (
            <>
              <button
                className="primary full"
                onClick={upload}
                disabled={!consent || busy}
              >
                {busy ? (
                  <Loader2 size={17} className="spin" />
                ) : (
                  <Upload size={17} />
                )}
                Upload and create notes
              </button>
              {savedRecording && (
                <button
                  className="text-button"
                  onClick={() => {
                    const u = URL.createObjectURL(file);
                    const a = document.createElement("a");
                    a.href = u;
                    a.download = file.name;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(u), 1000);
                  }}
                >
                  Download a local copy
                </button>
              )}
            </>
          )}
          {busy && progress > 0 && (
            <label>
              Uploading {progress}%<progress value={progress} max={100} />
            </label>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
        </Dialog>
      )}
      {modal === "share" && active && (
        <Dialog title="Share meeting" onClose={() => setModal("")}>
          <p>
            Sharing includes the transcript, notes, and recording while
            retained.
          </p>
          <label>
            Visibility
            <select
              value={shareMode}
              onChange={(e) => setShareMode(e.target.value)}
            >
              <option value="private">
                Private — only you and selected people
              </option>
              <option value="workspace">Everyone in this workspace</option>
            </select>
          </label>
          {shareMode === "private" &&
            (settings?.members || [])
              .filter((m: any) => m.user_id !== user?.id)
              .map((m: any) => (
                <label className="consent" key={m.user_id}>
                  <input
                    type="checkbox"
                    checked={grantIds.includes(m.user_id)}
                    onChange={(e) =>
                      setGrantIds(
                        e.target.checked
                          ? [...grantIds, m.user_id]
                          : grantIds.filter((v) => v !== m.user_id),
                      )
                    }
                  />
                  {m.name}
                </label>
              ))}
          <p className="fine">
            Saving replaces the current recipient list. Only current workspace
            members can receive access.
          </p>
          <button
            className="primary full"
            onClick={() =>
              run(async () => {
                await saveMeeting(
                  { visibility: shareMode, grantIds },
                  draftVersion.current,
                );
                setModal("");
              })
            }
          >
            Save sharing
          </button>
          {error && <p role="alert">{error}</p>}
        </Dialog>
      )}
      {modal === "export" && (
        <Dialog title="Export meeting" onClose={() => setModal("")}>
          <p className="muted">Download a copy you can keep or share.</p>
          {[
            ["md", "Notes and transcript · Markdown"],
            ["txt", "Plain text transcript"],
            ["json", "Complete meeting · JSON"],
            ["srt", "Subtitles · SRT"],
            ["vtt", "Subtitles · WebVTT"],
          ].map(([f, l]) => (
            <button
              className="export-option"
              key={f}
              onClick={() => exportFile(f)}
            >
              <ArrowDownToLine size={18} />
              {l}
            </button>
          ))}
        </Dialog>
      )}
      {modal === "options" && active && (
        <Dialog title="Meeting options" onClose={() => setModal("")}>
          <label>
            Title
            <input
              defaultValue={active.title}
              onBlur={(e) => {
                if (e.target.value !== active.title)
                  run(async () => saveMeeting({ title: e.target.value }));
              }}
              disabled={!active.canEdit}
            />
          </label>
          <button
            className="secondary full"
            disabled={!active.canEdit || busy || demo}
            onClick={() =>
              run(async () => {
                await api(`meetings/${active.id}/retry`, {});
                await refresh();
                setModal("");
              })
            }
          >
            Retry processing / regenerate notes
          </button>
          <p className="fine">
            Regeneration preserves accepted and completed actions. New
            suggestions remain drafts.
          </p>
          <button
            className="danger text-button"
            disabled={!active.canEdit}
            onClick={() => setModal("delete-meeting")}
          >
            Delete this meeting
          </button>
          {error && <p role="alert">{error}</p>}
        </Dialog>
      )}
      {modal === "delete-meeting" && active && (
        <Dialog title="Delete this meeting?" onClose={() => setModal("")}>
          <p>
            Access is removed immediately. The recording, transcript, notes, and
            revisions are then permanently removed by the cleanup worker.
          </p>
          <button
            className="danger-button full"
            onClick={() =>
              run(async () => {
                if (demo) {
                  setNotice(
                    "The fictional sample cannot be permanently deleted.",
                  );
                } else {
                  await api(
                    "meetings/" + active.id,
                    { confirm: true },
                    "DELETE",
                  );
                  await refresh();
                  setSelected(null);
                }
                setModal("");
              })
            }
          >
            Delete meeting
          </button>
          {error && <p role="alert">{error}</p>}
        </Dialog>
      )}
      {modal === "discard" && (
        <Dialog title="Discard saved recording?" onClose={() => setModal("")}>
          <p>This removes the recoverable audio stored on this device.</p>
          <button
            className="danger-button full"
            onClick={() =>
              run(async () => {
                await clearRecording();
                setRecoverable(false);
                setFile(null);
                setSavedRecording(false);
                setModal("");
              })
            }
          >
            Discard recording
          </button>
        </Dialog>
      )}
      {modal === "workspace" && (
        <Dialog title="Create workspace" onClose={() => setModal("")}>
          <label>
            Name
            <input
              value={newWorkspace}
              onChange={(e) => setNewWorkspace(e.target.value)}
            />
          </label>
          <button
            className="primary full"
            disabled={busy || !newWorkspace.trim()}
            onClick={() =>
              run(async () => {
                const d = await api("workspaces", { name: newWorkspace });
                await refresh(d.id);
                setPage("meetings");
                setSelected(null);
                setModal("");
              })
            }
          >
            Create workspace
          </button>
          {error && <p role="alert">{error}</p>}
        </Dialog>
      )}
      {modal === "delete-account" && (
        <Dialog title="Delete your account?" onClose={() => setModal("")}>
          <p>
            Your sign-in methods and sessions will be removed, and your meetings
            scheduled for deletion. Transfer ownership of shared workspaces
            first.
          </p>
          <label>
            Type DELETE to confirm
            <input
              value={deleteText}
              onChange={(e) => setDeleteText(e.target.value)}
            />
          </label>
          <button
            className="danger-button full"
            disabled={deleteText !== "DELETE" || busy}
            onClick={() =>
              run(async () => {
                await api("account", { confirm: deleteText }, "DELETE");
                setUser(null);
                setDemo(true);
                setSelected("demo");
                setPage("meetings");
                setModal("");
                setNotice(
                  "Account deleted. Your recordings are queued for removal.",
                );
              })
            }
          >
            Delete account
          </button>
          {error && <p role="alert">{error}</p>}
        </Dialog>
      )}
    </div>
  );
}
