import type { PoolClient } from "pg";
import { transaction } from "./db";
import {
  checkOrigin,
  cookie,
  cookieName,
  currentUser,
  hash,
  setCookie,
  token,
} from "./auth";
import { HttpError } from "./model";
export async function accountSummary(db: PoolClient, id: string) {
  const user = (
    await db.query("SELECT name,merged_into FROM users WHERE id=$1", [id])
  ).rows[0];
  if (!user || user.merged_into)
    throw new HttpError(409, "This account changed. Start linking again.");
  return {
    name: user.name,
    identities: (
      await db.query(
        "SELECT kind,value FROM identities WHERE user_id=$1 ORDER BY kind,value",
        [id],
      )
    ).rows,
    workspaces: (
      await db.query(
        "SELECT w.id,w.name,m.role FROM workspaces w JOIN members m ON m.workspace_id=w.id WHERE m.user_id=$1 ORDER BY w.id",
        [id],
      )
    ).rows,
  };
}
const fingerprint = (s: Awaited<ReturnType<typeof accountSummary>>) =>
  hash(JSON.stringify(s));
export async function createRecovery(
  db: PoolClient,
  req: Request,
  target: string,
  source: string,
) {
  const current = await accountSummary(db, target),
    other = await accountSummary(db, source),
    raw = token();
  await db.query(
    "INSERT INTO identity_recoveries(hash,target_id,source_id,session_hash,fingerprint,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes')",
    [
      hash(raw),
      target,
      source,
      hash(cookie(req, cookieName)),
      fingerprint(current) + fingerprint(other),
    ],
  );
  return { token: raw, current, other };
}
export async function recoveryForSession(
  db: PoolClient,
  req: Request,
  h: string,
  user: string,
) {
  const r = (
    await db.query(
      "SELECT * FROM identity_recoveries WHERE hash=$1 FOR UPDATE",
      [h],
    )
  ).rows[0];
  if (
    !r ||
    r.consumed ||
    new Date(r.expires_at).getTime() < Date.now() ||
    r.target_id !== user ||
    r.session_hash !== hash(cookie(req, cookieName))
  )
    throw new HttpError(400, "Recovery expired. Start again.");
  return r;
}
export async function completeRecovery(req: Request, raw: string) {
  checkOrigin(req);
  const u = (await currentUser(req))!,
    session = token();
  await transaction(async (db) => {
    const r = await recoveryForSession(db, req, hash(raw), u.id);
    if (!r.current_verified)
      throw new HttpError(403, "Verify your current account first.");
    await db.query(
      "SELECT id FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [[r.target_id, r.source_id]],
    );
    const a = await accountSummary(db, r.target_id),
      b = await accountSummary(db, r.source_id);
    if (r.fingerprint !== fingerprint(a) + fingerprint(b))
      throw new HttpError(
        409,
        "Account access changed. Review a fresh recovery.",
      );
    await db.query(
      "INSERT INTO members(workspace_id,user_id,role) SELECT workspace_id,$1,role FROM members WHERE user_id=$2 ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=CASE WHEN members.role='owner' OR EXCLUDED.role='owner' THEN 'owner' WHEN members.role='editor' AND EXCLUDED.role='editor' THEN 'editor' ELSE 'viewer' END",
      [u.id, r.source_id],
    );
    await db.query("UPDATE meetings SET creator_id=$1 WHERE creator_id=$2", [
      u.id,
      r.source_id,
    ]);
    await db.query(
      "INSERT INTO meeting_grants(meeting_id,user_id) SELECT meeting_id,$1 FROM meeting_grants WHERE user_id=$2 ON CONFLICT DO NOTHING",
      [u.id, r.source_id],
    );
    await db.query("DELETE FROM meeting_grants WHERE user_id=$1", [
      r.source_id,
    ]);
    await db.query("UPDATE identities SET user_id=$1 WHERE user_id=$2", [
      u.id,
      r.source_id,
    ]);
    await db.query(
      "DELETE FROM google_connections WHERE user_id=ANY($1::uuid[])",
      [[u.id, r.source_id]],
    );
    await db.query("DELETE FROM google_pending WHERE user_id=ANY($1::uuid[])", [
      [u.id, r.source_id],
    ]);
    await db.query("UPDATE crm_connections SET user_id=$1 WHERE user_id=$2", [
      u.id,
      r.source_id,
    ]);
    await db.query("DELETE FROM crm_pending WHERE user_id=ANY($1::uuid[])", [
      [u.id, r.source_id],
    ]);
    await db.query("DELETE FROM crm_previews WHERE user_id=ANY($1::uuid[])", [
      [u.id, r.source_id],
    ]);
    await db.query("DELETE FROM members WHERE user_id=$1", [r.source_id]);
    await db.query("UPDATE users SET merged_into=$1 WHERE id=$2", [
      u.id,
      r.source_id,
    ]);
    await db.query("DELETE FROM sessions WHERE user_id=ANY($1::uuid[])", [
      [u.id, r.source_id],
    ]);
    await db.query(
      "UPDATE identity_recoveries SET consumed=true WHERE target_id=ANY($1::uuid[]) OR source_id=ANY($1::uuid[])",
      [[u.id, r.source_id]],
    );
    await db.query(
      "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')",
      [hash(session), u.id],
    );
  });
  return { body: { ok: true }, cookie: setCookie(cookieName, session, 604800) };
}
