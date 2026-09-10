import { randomUUID } from "node:crypto";
import { z } from "zod";
import { pool, transaction } from "./db";
import { hash, token } from "./auth";
import {
  HttpError,
  notesSchema,
  segmentSchema,
  validateEvidence,
} from "./model";
import * as storage from "./storage";
import type { PoolClient } from "pg";
const uuid = z.uuid();
const title = z.string().trim().min(1).max(200);
const publicColumns =
  "m.id,m.workspace_id,m.creator_id,m.title,m.status,m.visibility,m.language,m.duration,m.created_at,m.version,m.transcript,m.notes,m.notes_stale,m.error,m.recording_deleted";
export async function member(user: string, workspace: string, db = pool()) {
  const row = (
    await db.query(
      "SELECT * FROM members WHERE workspace_id=$1 AND user_id=$2",
      [uuid.parse(workspace), user],
    )
  ).rows[0];
  if (!row) throw new HttpError(404, "Workspace not found.");
  return row;
}
export async function meeting(
  user: string,
  id: string,
  edit = false,
  db: Pick<PoolClient, "query"> = pool(),
  lock = false,
) {
  const row = (
    await db.query(
      `SELECT m.*,b.role FROM meetings m JOIN members b ON b.workspace_id=m.workspace_id AND b.user_id=$1 WHERE m.id=$2 AND m.deleted_at IS NULL AND (m.creator_id=$1 OR m.visibility='workspace' OR EXISTS(SELECT 1 FROM meeting_grants g WHERE g.meeting_id=m.id AND g.user_id=$1)) ${lock ? "FOR UPDATE OF m" : ""}`,
      [user, uuid.parse(id)],
    )
  ).rows[0];
  if (!row) throw new HttpError(404, "Meeting not found.");
  if (edit && row.role === "viewer")
    throw new HttpError(403, "This workspace is read-only for your account.");
  return row;
}
export async function snapshot(user: string, workspace?: string, query = "") {
  const workspaces = (
    await pool().query(
      "SELECT w.*,b.role FROM workspaces w JOIN members b ON b.workspace_id=w.id WHERE b.user_id=$1 ORDER BY w.created_at",
      [user],
    )
  ).rows;
  const selected = workspace || workspaces[0]?.id;
  if (!selected) return { workspaces, meetings: [], selected: null };
  const b = await member(user, selected);
  const meetings = (
    await pool().query(
      `SELECT ${publicColumns} FROM meetings m WHERE m.workspace_id=$1 AND m.deleted_at IS NULL AND (m.creator_id=$2 OR m.visibility='workspace' OR EXISTS(SELECT 1 FROM meeting_grants g WHERE g.meeting_id=m.id AND g.user_id=$2)) AND ($3='' OR m.title ILIKE '%'||$3||'%' OR to_tsvector('simple',m.transcript::text) @@ plainto_tsquery('simple',$3)) ORDER BY m.created_at DESC LIMIT 200`,
      [selected, user, query.slice(0, 200)],
    )
  ).rows.map((m) => ({ ...m, canEdit: b.role !== "viewer" }));
  return { workspaces, meetings, selected };
}
export async function createMeeting(user: string, input: unknown) {
  const data = z
    .object({
      workspaceId: uuid,
      title,
      language: z.enum(["en", "pt", "auto"]),
      type: z.enum([
        "audio/mpeg",
        "audio/wav",
        "audio/x-wav",
        "audio/mp4",
        "audio/x-m4a",
        "audio/webm",
        "video/webm",
        "video/mp4",
        "application/octet-stream",
      ]),
      size: z
        .number()
        .int()
        .positive()
        .max(1024 ** 3),
      consent: z.literal(true),
    })
    .parse(input);
  return transaction(async (db) => {
    const b = await member(user, data.workspaceId, db as any);
    if (b.role === "viewer")
      throw new HttpError(403, "Only editors can add meetings.");
    const w = (
      await db.query("SELECT * FROM workspaces WHERE id=$1 FOR UPDATE", [
        data.workspaceId,
      ])
    ).rows[0];
    const used = Number(
      (
        await db.query(
          "SELECT COALESCE(sum(minutes),0) n FROM usage WHERE workspace_id=$1 AND created_at>=date_trunc('month',now())",
          [w.id],
        )
      ).rows[0].n,
    );
    const reserved =
      Number(
        (
          await db.query(
            "SELECT count(*) n FROM meetings WHERE workspace_id=$1 AND deleted_at IS NULL AND status IN ('uploading','queued','transcribing')",
            [w.id],
          )
        ).rows[0].n,
      ) * 120;
    if (used + reserved + 120 > w.monthly_minutes)
      throw new HttpError(
        429,
        "Workspace transcription allowance is full. Each pending upload reserves two hours.",
      );
    const id = randomUUID(),
      key = `${w.id}/${id}/recording`;
    const uploadId = await storage.beginUpload(key, data.type);
    try {
      await db.query(
        "INSERT INTO meetings(id,workspace_id,creator_id,title,language,object_key,upload_id,upload_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [id, w.id, user, data.title, data.language, key, uploadId, data.size],
      );
    } catch (e) {
      await storage.abortUpload(key, uploadId);
      throw e;
    }
    return { id, partSize: 8 * 1024 * 1024 };
  });
}
export async function uploadPart(user: string, id: string, part: number) {
  return transaction(async (db) => {
    const m = await meeting(user, id, true, db, true);
    if (m.creator_id !== user || m.status !== "uploading" || !m.upload_id)
      throw new HttpError(409, "This upload is unavailable.");
    if (
      !Number.isInteger(part) ||
      part < 1 ||
      part > Math.ceil(Number(m.upload_bytes) / (8 * 1024 * 1024))
    )
      throw new HttpError(400, "Invalid part number.");
    return {
      url: await storage.partUrl(
        m.object_key,
        m.upload_id,
        part,
        Math.min(
          8 * 1024 * 1024,
          Number(m.upload_bytes) - (part - 1) * 8 * 1024 * 1024,
        ),
      ),
    };
  });
}
export async function uploadedParts(user: string, id: string) {
  const m = await meeting(user, id, true);
  if (m.creator_id !== user || !m.upload_id || m.status !== "uploading")
    throw new HttpError(409, "Upload is unavailable.");
  return {
    parts: (await storage.listParts(m.object_key, m.upload_id)).map((p) => ({
      part: p.PartNumber,
      size: p.Size,
    })),
  };
}
export async function completeUpload(user: string, id: string) {
  return transaction(async (db) => {
    const m = await meeting(user, id, true, db, true);
    if (m.creator_id !== user)
      throw new HttpError(
        403,
        "Only the uploader can complete this recording.",
      );
    if (m.status !== "uploading") return { ok: true };
    let info;
    try {
      info = await storage.objectInfo(m.object_key);
    } catch {
      const parts = await storage.listParts(m.object_key, m.upload_id);
      if (
        parts.length !==
          Math.ceil(Number(m.upload_bytes) / (8 * 1024 * 1024)) ||
        parts.reduce((a, p) => a + (p.Size || 0), 0) !== Number(m.upload_bytes)
      )
        throw new HttpError(
          400,
          "Upload is incomplete. Resume the missing parts.",
        );
      await storage.finishUpload(
        m.object_key,
        m.upload_id,
        parts.map((p) => ({ PartNumber: p.PartNumber!, ETag: p.ETag! })),
      );
      info = await storage.objectInfo(m.object_key);
    }
    if (info.ContentLength !== Number(m.upload_bytes))
      throw new HttpError(400, "Recording size does not match the upload.");
    await db.query(
      "UPDATE meetings SET status='queued',upload_id=NULL WHERE id=$1",
      [id],
    );
    await db.query(
      "INSERT INTO jobs(meeting_id,generation) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [id, m.version],
    );
    return { ok: true };
  });
}
export async function editMeeting(user: string, id: string, input: unknown) {
  const data = z
    .object({
      version: z.number().int().positive(),
      title: title.optional(),
      transcript: z.array(segmentSchema).max(30000).optional(),
      notes: notesSchema.optional(),
      visibility: z.enum(["private", "workspace"]).optional(),
      grantIds: z.array(uuid).max(100).optional(),
    })
    .parse(input);
  return transaction(async (db) => {
    const m = await meeting(user, id, true, db, true);
    if (m.version !== data.version)
      throw new HttpError(409, "This meeting changed. Refresh before saving.");
    if (
      ["uploading", "queued", "transcribing", "generating notes"].includes(
        m.status,
      )
    )
      throw new HttpError(409, "Wait for processing before editing.");
    if ((data.visibility || data.grantIds) && m.creator_id !== user)
      throw new HttpError(403, "Only the creator can change sharing.");
    if (data.transcript) {
      const old = m.transcript as { id: string; start: number; end: number }[];
      if (
        data.transcript.length !== old.length ||
        data.transcript.some(
          (s, i) =>
            s.id !== old[i].id ||
            s.start !== old[i].start ||
            s.end !== old[i].end,
        )
      )
        throw new HttpError(
          400,
          "Transcript editing preserves segment IDs and timing.",
        );
    }
    if (data.notes)
      validateEvidence(data.notes, data.transcript || m.transcript);
    await db.query(
      "INSERT INTO revisions(meeting_id,version,kind,payload,actor_id) VALUES($1,$2,'user-edit',$3,$4)",
      [id, m.version, { transcript: m.transcript, notes: m.notes }, user],
    );
    if (data.grantIds) {
      const n = (
        await db.query(
          "SELECT user_id FROM members WHERE workspace_id=$1 AND user_id=ANY($2::uuid[])",
          [m.workspace_id, data.grantIds],
        )
      ).rowCount;
      if (n !== new Set(data.grantIds).size)
        throw new HttpError(400, "Share only with current workspace members.");
      await db.query("DELETE FROM meeting_grants WHERE meeting_id=$1", [id]);
      for (const u of new Set(data.grantIds))
        await db.query("INSERT INTO meeting_grants VALUES($1,$2)", [id, u]);
    }
    await db.query(
      "UPDATE meetings SET title=$2,transcript=$3,notes=$4,visibility=$5,notes_stale=$6,version=version+1,updated_at=now() WHERE id=$1",
      [
        id,
        data.title || m.title,
        JSON.stringify(data.transcript || m.transcript),
        data.notes || m.notes,
        data.visibility || m.visibility,
        data.transcript ? true : m.notes_stale,
      ],
    );
    await db.query(
      "INSERT INTO audit(workspace_id,actor_id,action,meeting_id) VALUES($1,$2,'Meeting updated',$3)",
      [m.workspace_id, user, id],
    );
    return { ok: true };
  });
}
export async function retryMeeting(user: string, id: string) {
  return transaction(async (db) => {
    const m = await meeting(user, id, true, db, true);
    if (
      ["uploading", "queued", "transcribing", "generating notes"].includes(
        m.status,
      )
    )
      throw new HttpError(409, "Processing is already underway.");
    if (!m.transcript.length && m.recording_deleted)
      throw new HttpError(400, "The recording has expired. Upload it again.");
    const stage = m.transcript.length ? "notes" : "transcribe";
    await db.query(
      "UPDATE meetings SET version=version+1,status=$2,error=NULL WHERE id=$1",
      [id, stage === "notes" ? "generating notes" : "queued"],
    );
    await db.query(
      "INSERT INTO jobs(meeting_id,generation,stage) VALUES($1,$2,$3)",
      [id, m.version + 1, stage],
    );
    return { ok: true };
  });
}
export async function removeMeeting(user: string, id: string) {
  return transaction(async (db) => {
    const m = await meeting(user, id, true, db, true);
    if (m.creator_id !== user)
      throw new HttpError(403, "Only the creator can delete this meeting.");
    await db.query(
      "UPDATE meetings SET deleted_at=now(),status='deleting',version=version+1 WHERE id=$1",
      [id],
    );
    await db.query(
      "UPDATE jobs SET state='cancelled',lease_token=NULL WHERE meeting_id=$1",
      [id],
    );
    return { ok: true };
  });
}
export async function sharing(user: string, id: string) {
  const m = await meeting(user, id);
  if (m.creator_id !== user)
    throw new HttpError(403, "Only the creator can manage sharing.");
  return {
    visibility: m.visibility,
    grantIds: (
      await pool().query(
        "SELECT user_id FROM meeting_grants WHERE meeting_id=$1",
        [id],
      )
    ).rows.map((r) => r.user_id),
  };
}
export async function audio(user: string, id: string) {
  const m = await meeting(user, id);
  if (m.recording_deleted || m.status === "uploading")
    throw new HttpError(404, "Recording is not available.");
  return { url: await storage.playbackUrl(m.object_key) };
}
export async function workspaceSettings(user: string, id: string) {
  const b = await member(user, id);
  return {
    role: b.role,
    members: (
      await pool().query(
        "SELECT m.user_id,m.role,u.name FROM members m JOIN users u ON u.id=m.user_id WHERE workspace_id=$1",
        [id],
      )
    ).rows,
    invites:
      b.role === "owner"
        ? (
            await pool().query(
              "SELECT id,email,role,expires_at,accepted_at,revoked_at FROM invites WHERE workspace_id=$1",
              [id],
            )
          ).rows
        : [],
    usage: Number(
      (
        await pool().query(
          "SELECT COALESCE(sum(minutes),0) n FROM usage WHERE workspace_id=$1 AND created_at>=date_trunc('month',now())",
          [id],
        )
      ).rows[0].n,
    ),
  };
}
export async function workspaceAction(
  user: string,
  id: string,
  input: unknown,
) {
  const d = z
    .discriminatedUnion("action", [
      z.object({
        action: z.literal("invite"),
        email: z.email().max(254),
        role: z.enum(["editor", "viewer"]),
      }),
      z.object({ action: z.literal("revoke"), inviteId: uuid }),
      z.object({
        action: z.literal("member"),
        userId: uuid,
        role: z.enum(["owner", "editor", "viewer", "remove"]),
      }),
      z.object({
        action: z.literal("settings"),
        name: title,
        retentionDays: z.number().int().min(1).max(365),
      }),
    ])
    .parse(input);
  return transaction(async (db) => {
    await db.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
      uuid.parse(id),
    ]);
    const b = await member(user, id, db as any);
    if (b.role !== "owner")
      throw new HttpError(403, "Only workspace owners can manage membership.");
    if (d.action === "invite") {
      const raw = token();
      await db.query(
        "INSERT INTO invites(id,hash,workspace_id,email,role,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '7 days')",
        [randomUUID(), hash(raw), id, d.email.toLowerCase(), d.role],
      );
      return { inviteUrl: `${process.env.APP_URL}/?invite=${raw}` };
    }
    if (d.action === "revoke")
      await db.query(
        "UPDATE invites SET revoked_at=now() WHERE id=$1 AND workspace_id=$2",
        [d.inviteId, id],
      );
    if (d.action === "settings")
      await db.query(
        "UPDATE workspaces SET name=$2,retention_days=$3 WHERE id=$1",
        [id, d.name, d.retentionDays],
      );
    if (d.action === "member") {
      const old = (
        await db.query(
          "SELECT role FROM members WHERE workspace_id=$1 AND user_id=$2",
          [id, d.userId],
        )
      ).rows[0];
      if (!old) throw new HttpError(404, "Member not found.");
      if (
        old.role === "owner" &&
        d.role !== "owner" &&
        Number(
          (
            await db.query(
              "SELECT count(*) n FROM members WHERE workspace_id=$1 AND role='owner'",
              [id],
            )
          ).rows[0].n,
        ) === 1
      )
        throw new HttpError(400, "Keep at least one workspace owner.");
      if (d.role === "remove") {
        await db.query(
          "DELETE FROM meeting_grants WHERE user_id=$1 AND meeting_id IN (SELECT id FROM meetings WHERE workspace_id=$2)",
          [d.userId, id],
        );
        await db.query(
          "DELETE FROM members WHERE workspace_id=$1 AND user_id=$2",
          [id, d.userId],
        );
      } else
        await db.query(
          "UPDATE members SET role=$3 WHERE workspace_id=$1 AND user_id=$2",
          [id, d.userId, d.role],
        );
    }
    await db.query(
      "INSERT INTO audit(workspace_id,actor_id,action) VALUES($1,$2,$3)",
      [id, user, `Workspace ${d.action}`],
    );
    return { ok: true };
  });
}
export async function acceptInvite(user: string, raw: string) {
  return transaction(async (db) => {
    const i = (
      await db.query("SELECT * FROM invites WHERE hash=$1 FOR UPDATE", [
        hash(raw),
      ])
    ).rows[0];
    if (
      !i ||
      i.accepted_at ||
      i.revoked_at ||
      new Date(i.expires_at).getTime() < Date.now()
    )
      throw new HttpError(400, "This invitation expired or was already used.");
    if (
      !(
        await db.query(
          "SELECT 1 FROM identities WHERE user_id=$1 AND kind='email' AND value=$2",
          [user, i.email],
        )
      ).rowCount
    )
      throw new HttpError(
        403,
        "Link and verify the invited email in Settings first.",
      );
    await db.query(
      "INSERT INTO members VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [i.workspace_id, user, i.role],
    );
    await db.query("UPDATE invites SET accepted_at=now() WHERE id=$1", [i.id]);
    return { workspaceId: i.workspace_id };
  });
}
export async function createWorkspace(user: string, name: string) {
  const id = randomUUID();
  await transaction(async (db) => {
    await db.query("INSERT INTO workspaces(id,name) VALUES($1,$2)", [
      id,
      title.parse(name),
    ]);
    await db.query("INSERT INTO members VALUES($1,$2,'owner')", [id, user]);
  });
  return { id };
}
export async function accountExport(user: string) {
  return {
    calendarSelections: (
      await pool().query(
        "SELECT event_id,title,meet_url,starts_at,ends_at,selected_at FROM google_selections WHERE user_id=$1",
        [user],
      )
    ).rows,
    crmConnections: (
      await pool().query(
        "SELECT id,workspace_name,target_name,expires_at,created_at FROM crm_connections WHERE user_id=$1",
        [user],
      )
    ).rows,
    profile: (
      await pool().query("SELECT id,name,created_at FROM users WHERE id=$1", [
        user,
      ])
    ).rows[0],
    identities: (
      await pool().query(
        "SELECT kind,value,verified_at FROM identities WHERE user_id=$1",
        [user],
      )
    ).rows,
    meetings: (
      await pool().query(
        `SELECT ${publicColumns} FROM meetings m JOIN members b ON b.workspace_id=m.workspace_id AND b.user_id=$1 WHERE m.creator_id=$1 AND m.deleted_at IS NULL`,
        [user],
      )
    ).rows,
  };
}
export async function deleteAccount(user: string) {
  return transaction(async (db) => {
    await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user]);
    const ws = (
      await db.query(
        "SELECT workspace_id FROM members WHERE user_id=$1 ORDER BY workspace_id",
        [user],
      )
    ).rows.map((r) => r.workspace_id);
    await db.query(
      "SELECT id FROM workspaces WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE",
      [ws],
    );
    if (
      (
        await db.query(
          "SELECT 1 FROM members m WHERE m.user_id=$1 AND m.role='owner' AND EXISTS(SELECT 1 FROM members b WHERE b.workspace_id=m.workspace_id AND b.user_id<>$1) AND NOT EXISTS(SELECT 1 FROM members o WHERE o.workspace_id=m.workspace_id AND o.user_id<>$1 AND o.role='owner')",
          [user],
        )
      ).rowCount
    )
      throw new HttpError(
        400,
        "Transfer ownership of shared workspaces before deleting your account.",
      );
    await db.query(
      "UPDATE meetings SET deleted_at=now(),status='deleting',version=version+1 WHERE creator_id=$1 AND deleted_at IS NULL",
      [user],
    );
    await db.query(
      "UPDATE jobs SET state='cancelled',lease_token=NULL WHERE meeting_id IN (SELECT id FROM meetings WHERE creator_id=$1)",
      [user],
    );
    await db.query("DELETE FROM meeting_grants WHERE user_id=$1", [user]);
    await db.query("DELETE FROM members WHERE user_id=$1", [user]);
    await db.query(
      "UPDATE challenges SET consumed=true,payload=NULL WHERE user_id=$1 OR value IN (SELECT value FROM identities WHERE user_id=$1)",
      [user],
    );
    await db.query("DELETE FROM google_connections WHERE user_id=$1", [user]);
    await db.query("DELETE FROM google_pending WHERE user_id=$1", [user]);
    await db.query("DELETE FROM crm_connections WHERE user_id=$1", [user]);
    await db.query("DELETE FROM crm_pending WHERE user_id=$1", [user]);
    await db.query("DELETE FROM identities WHERE user_id=$1", [user]);
    await db.query("DELETE FROM sessions WHERE user_id=$1", [user]);
    await db.query(
      "UPDATE identity_recoveries SET consumed=true WHERE target_id=$1 OR source_id=$1",
      [user],
    );
    await db.query(
      "UPDATE challenges SET consumed=true,payload=NULL WHERE user_id=$1 OR value IN (SELECT value FROM identities WHERE user_id=$1)",
      [user],
    );
    await db.query(
      "UPDATE users SET name='Deleted account',merged_into=id WHERE id=$1",
      [user],
    );
    return { ok: true };
  });
}
