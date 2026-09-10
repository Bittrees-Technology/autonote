import { encrypt, decrypt } from "./secrets";
import { createHash } from "node:crypto";
import { z } from "zod";
import { pool, transaction } from "./db";
import { cookie, cookieName, hash, token } from "./auth";
import { meeting } from "./service";
import { HttpError } from "./model";
const base = () => process.env.CRM_URL || "https://crm.bittrees.org";
async function remote(path: string, body: unknown, bearer?: string) {
  const r = await fetch(base() + "/api/integrations/autonote/" + path, {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: {
      "Content-Type": "application/json",
      ...(bearer ? { Authorization: "Bearer " + bearer } : {}),
    },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({
    error: "CRM is temporarily unavailable. Try again shortly.",
  }));
  if (!r.ok) throw new HttpError(r.status, d.error || "CRM request failed.");
  return d;
}
export async function start(req: Request, user: string) {
  const state = token(),
    verifier = token();
  await pool().query(
    "INSERT INTO crm_pending(state_hash,user_id,session_hash,verifier,expires_at) VALUES($1,$2,$3,$4,now()+interval '10 minutes')",
    [hash(state), user, hash(cookie(req, cookieName)), encrypt(verifier)],
  );
  const url = new URL("/connect/autonote", base());
  url.searchParams.set("state", state);
  url.searchParams.set(
    "challenge",
    createHash("sha256").update(verifier).digest("base64url"),
  );
  return { url: url.href };
}
export async function callback(
  req: Request,
  user: string,
  code: string,
  state: string,
) {
  z.string().length(64).parse(code);
  z.string().length(64).parse(state);
  return transaction(async (db) => {
    const active = (
      await db.query(
        "SELECT id FROM users WHERE id=$1 AND merged_into IS NULL AND name<>'Deleted account' FOR UPDATE",
        [user],
      )
    ).rows[0];
    if (!active) throw new HttpError(401, "Sign in again.");
    const p = (
      await db.query(
        "SELECT * FROM crm_pending WHERE state_hash=$1 AND user_id=$2 FOR UPDATE",
        [hash(state), user],
      )
    ).rows[0];
    if (
      !p ||
      p.session_hash !== hash(cookie(req, cookieName)) ||
      new Date(p.expires_at).getTime() < Date.now()
    )
      throw new HttpError(400, "Connection expired. Start again in Settings.");
    const d = await remote("exchange", { code, verifier: decrypt(p.verifier) });
    await db.query(
      "INSERT INTO crm_connections(id,user_id,token_ciphertext,workspace_name,target_name,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
      [
        d.grantId,
        user,
        encrypt(d.token),
        d.workspaceName,
        d.targetName,
        d.expiresAt,
      ],
    );
    await db.query("DELETE FROM crm_pending WHERE state_hash=$1", [
      hash(state),
    ]);
    return { ok: true };
  });
}
export async function list(user: string) {
  return (
    await pool().query(
      "SELECT id,workspace_name,target_name,expires_at FROM crm_connections WHERE user_id=$1 ORDER BY created_at DESC",
      [user],
    )
  ).rows;
}
export async function disconnect(user: string, id: string) {
  const c = (
    await pool().query(
      "SELECT * FROM crm_connections WHERE id=$1 AND user_id=$2",
      [z.uuid().parse(id), user],
    )
  ).rows[0];
  if (!c) throw new HttpError(404, "Connection not found.");
  await remote("disconnect", {}, decrypt(c.token_ciphertext));
  await pool().query("DELETE FROM crm_connections WHERE id=$1 AND user_id=$2", [
    id,
    user,
  ]);
  return { ok: true };
}
const selection = z.object({
  connectionId: z.uuid(),
  meetingId: z.uuid(),
  version: z.number().int().positive(),
  summary: z.string().max(3800),
  actionIds: z.array(z.string().max(100)).max(30),
});
export async function preview(user: string, input: unknown) {
  const d = selection.parse(input);
  if (!d.summary.trim() && !d.actionIds.length)
    throw new HttpError(
      400,
      "Choose a summary or at least one accepted action.",
    );
  const m = await meeting(user, d.meetingId, true);
  if (m.creator_id !== user)
    throw new HttpError(403, "Only the meeting creator can export it to CRM.");
  if (m.notes_stale)
    throw new HttpError(
      409,
      "The transcript changed. Regenerate and review the notes before publishing.",
    );
  if (m.version !== d.version)
    throw new HttpError(409, "Meeting changed. Review the latest version.");
  const c = (
    await pool().query(
      "SELECT id,workspace_name,target_name FROM crm_connections WHERE id=$1 AND user_id=$2 AND expires_at>now()",
      [d.connectionId, user],
    )
  ).rows[0];
  if (!c) throw new HttpError(404, "Connection expired or missing.");
  const actions = (m.notes?.actions || []).filter((a: any) =>
    d.actionIds.includes(a.id),
  );
  if (
    actions.length !== new Set(d.actionIds).size ||
    actions.some((a: any) => a.status !== "accepted")
  )
    throw new HttpError(400, "Select only accepted action items for CRM.");
  const payload = {
    meetingId: m.id,
    title: m.title,
    summary: d.summary,
    actions: actions.map((a: any) => ({
      id: a.id,
      text: a.text,
      dueDate: a.dueDate,
    })),
  };
  const raw = token();
  await pool().query(
    "INSERT INTO crm_previews(hash,user_id,connection_id,meeting_id,version,payload,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '10 minutes')",
    [hash(raw), user, c.id, m.id, m.version, payload],
  );
  return { token: raw, destination: c, payload };
}
export async function publish(user: string, raw: string) {
  return transaction(async (db) => {
    const initial = (
      await db.query(
        "SELECT * FROM crm_previews WHERE hash=$1 AND user_id=$2",
        [hash(z.string().length(64).parse(raw)), user],
      )
    ).rows[0];
    if (!initial || new Date(initial.expires_at).getTime() < Date.now())
      throw new HttpError(400, "Review expired. Preview the content again.");
    const m = await meeting(user, initial.meeting_id, true, db, true);
    // Match deletion's meeting-before-preview lock order.
    const preview = (
      await db.query(
        "SELECT * FROM crm_previews WHERE hash=$1 AND user_id=$2 FOR UPDATE",
        [initial.hash, user],
      )
    ).rows[0];
    if (!preview || new Date(preview.expires_at).getTime() < Date.now())
      throw new HttpError(400, "Review expired. Preview the content again.");
    if (m.creator_id !== user || m.version !== preview.version)
      throw new HttpError(409, "Meeting changed. Review it again.");
    if (preview.result) return preview.result;
    const c = (
      await db.query(
        "SELECT * FROM crm_connections WHERE id=$1 AND user_id=$2 AND expires_at>now() FOR UPDATE",
        [preview.connection_id, user],
      )
    ).rows[0];
    if (!c) throw new HttpError(404, "CRM connection unavailable.");
    const result = await remote(
      "publish",
      preview.payload,
      decrypt(c.token_ciphertext),
    );
    await db.query("UPDATE crm_previews SET result=$2 WHERE hash=$1", [
      preview.hash,
      result,
    ]);
    return result;
  });
}
