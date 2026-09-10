import { createHash } from "node:crypto";
import { z } from "zod";
import { transaction } from "./db";
import { HttpError, segmentSchema } from "./model";
import { extractiveNotes } from "./extractive-notes";

const inputSchema = z
  .object({
    id: z.uuid(),
    workspaceId: z.uuid(),
    title: z.string().trim().min(1).max(200),
    language: z.enum(["en", "pt", "auto"]),
    duration: z.number().positive().max(1800),
    transcript: z.array(segmentSchema).max(1500),
    consent: z.literal(true),
  })
  .strict();
export async function saveDeviceMeeting(user: string, input: unknown) {
  const data = inputSchema.parse(input);
  if (data.transcript.reduce((n, s) => n + s.text.length, 0) > 60000)
    throw new HttpError(
      413,
      "This transcript exceeds the beta limit. Split the recording into shorter parts.",
    );
  const ids = new Set<string>();
  let previous = 0;
  for (const s of data.transcript) {
    if (
      !s.id ||
      ids.has(s.id) ||
      s.start < previous ||
      s.end < s.start ||
      s.end > data.duration + 1 ||
      !s.text.trim()
    )
      throw new HttpError(
        400,
        "Transcript timing or segment identifiers are invalid.",
      );
    ids.add(s.id);
    previous = s.start;
  }
  const digest = createHash("sha256")
    .update(JSON.stringify(data))
    .digest("hex");
  return transaction(async (db) => {
    const account = (
      await db.query(
        "SELECT id FROM users WHERE id=$1 AND merged_into IS NULL FOR UPDATE",
        [user],
      )
    ).rows[0];
    if (!account) throw new HttpError(401, "Sign in again.");
    await db.query("SELECT id FROM workspaces WHERE id=$1 FOR UPDATE", [
      data.workspaceId,
    ]);
    const member = (
      await db.query(
        "SELECT role FROM members WHERE user_id=$1 AND workspace_id=$2",
        [user, data.workspaceId],
      )
    ).rows[0];
    if (!member || member.role === "viewer")
      throw new HttpError(403, "Only workspace editors can save meetings.");
    const existing = (
      await db.query(
        "SELECT id,creator_id,ingestion_hash,deleted_at FROM meetings WHERE id=$1",
        [data.id],
      )
    ).rows[0];
    if (existing) {
      if (existing.creator_id !== user || existing.ingestion_hash !== digest)
        throw new HttpError(
          409,
          "This recording has already been submitted with different details.",
        );
      if (existing.deleted_at)
        throw new HttpError(
          410,
          "This meeting was deleted. It will not be restored by a retry.",
        );
      return { id: existing.id };
    }
    const count = (
      await db.query(
        "SELECT count(*)::int n FROM meetings WHERE creator_id=$1 AND deleted_at IS NULL",
        [user],
      )
    ).rows[0].n;
    if (count >= 20)
      throw new HttpError(
        429,
        "The free beta holds 20 active meetings per account. Export and delete older meetings to make room.",
      );
    await db.query("SELECT pg_advisory_xact_lock(810032)");
    if (
      Number(
        (await db.query("SELECT pg_database_size(current_database()) bytes"))
          .rows[0].bytes,
      ) >
      300 * 1024 ** 2
    )
      throw new HttpError(
        507,
        "The free beta's storage is full. Existing meetings remain available to read and export.",
      );
    const notes = extractiveNotes(data.transcript);
    await db.query(
      "INSERT INTO meetings(id,workspace_id,creator_id,title,language,status,duration,transcript,notes,recording_deleted,processing_mode,ingestion_hash) VALUES($1,$2,$3,$4,$5,'ready',$6,$7,$8,true,'device',$9)",
      [
        data.id,
        data.workspaceId,
        user,
        data.title,
        data.language,
        data.duration,
        JSON.stringify(data.transcript),
        notes,
        digest,
      ],
    );
    await db.query(
      "INSERT INTO usage(workspace_id,meeting_id,minutes) VALUES($1,$2,$3)",
      [data.workspaceId, data.id, data.duration / 60],
    );
    await db.query(
      "INSERT INTO audit(workspace_id,actor_id,action,meeting_id) VALUES($1,$2,'Device transcript saved',$3)",
      [data.workspaceId, user, data.id],
    );
    return { id: data.id };
  });
}
