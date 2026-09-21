import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { transaction, pool } from "./db";
import { token, hash } from "./auth";
import { meeting } from "./service";
import { HttpError, segmentSchema } from "./model";
export function requireAiEnabled() {
  if (process.env.AI_CONNECTOR_ENABLED !== "true")
    throw new HttpError(404, "Not found.");
}
const credential = z.string().regex(/^[a-f0-9]{64}$/);
const challenge = (value: string) =>
  createHash("sha256").update(value).digest("base64url");
const segments = z
  .array(segmentSchema.strict())
  .min(1)
  .max(10000)
  .refine(
    (items) =>
      new Set(items.map((item) => item.id)).size === items.length &&
      items.every((item) => item.id.length > 0 && item.end >= item.start),
  );
type Grant = {
  id: string;
  user_id: string;
  workspace_id: string;
  meeting_id: string;
  challenge: string;
  code_expires: Date;
  expires_at: Date;
  revoked_at: Date | null;
};
async function authority(
  db: PoolClient,
  user: string,
  workspace: string,
  meetingId: string,
) {
  const account = (
    await db.query(
      "SELECT id FROM users WHERE id=$1 AND merged_into IS NULL AND name<>'Deleted account' FOR SHARE",
      [user],
    )
  ).rows[0];
  if (!account) throw new HttpError(401, "Account unavailable.");
  await db.query("SELECT id FROM workspaces WHERE id=$1 FOR SHARE", [
    workspace,
  ]);
  await meeting(user, meetingId, false, db, true);
  // Refresh permission subqueries after any row-lock wait; the original statement
  // snapshot may predate a concurrent sharing change.
  const record = await meeting(user, meetingId, false, db, false);
  if (record.workspace_id !== workspace)
    throw new HttpError(404, "Selected meeting unavailable.");
  return record;
}
function projection(record: Record<string, any>) {
  if (record.status !== "ready")
    throw new HttpError(409, "Wait for the selected transcript to be ready.");
  const parsed = segments.safeParse(record.transcript);
  if (!parsed.success)
    throw new HttpError(
      409,
      "The selected transcript is unavailable or invalid.",
    );
  const value = {
    id: record.id,
    title: z.string().max(200).parse(record.title),
    language: z.string().max(32).parse(record.language),
    version: z.number().int().positive().parse(record.version),
    segments: parsed.data,
  };
  if (Buffer.byteLength(JSON.stringify(value)) > 1024 * 1024)
    throw new HttpError(
      413,
      "The selected transcript exceeds the local AI transfer limit.",
    );
  return value;
}
export async function authorize(user: string, raw: unknown) {
  requireAiEnabled();
  const input = z
    .strictObject({
      workspaceId: z.uuid(),
      meetingId: z.uuid(),
      actions: z.tuple([z.literal("read_transcript")]),
      challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      expiresInDays: z.number().int().min(1).max(30),
    })
    .parse(raw);
  return transaction(async (db) => {
    // Serialize grant creation per account, including concurrent capacity checks.
    await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user]);
    projection(await authority(db, user, input.workspaceId, input.meetingId));
    const count = (
      await db.query(
        "SELECT count(*) AS n FROM ai_grants WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now()",
        [user],
      )
    ).rows[0];
    if (Number(count.n) >= 50)
      throw new HttpError(
        429,
        "Revoke unused AI connections before adding another.",
      );
    const id = randomUUID(),
      code = token();
    const row = (
      await db.query(
        "INSERT INTO ai_grants(id,user_id,workspace_id,meeting_id,code_hash,challenge,code_expires,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '60 seconds',now()+($7*interval '1 day')) RETURNING code_expires,expires_at",
        [
          id,
          user,
          input.workspaceId,
          input.meetingId,
          hash(code),
          input.challenge,
          input.expiresInDays,
        ],
      )
    ).rows[0];
    return {
      grantId: id,
      code,
      codeExpiresAt: row.code_expires,
      expiresAt: row.expires_at,
    };
  });
}
async function locked(
  db: PoolClient,
  bearer: string,
  field: "code_hash" | "token_hash",
) {
  credential.parse(bearer);
  const lookup = (
    await db.query(`SELECT * FROM ai_grants WHERE ${field}=$1`, [hash(bearer)])
  ).rows[0] as Grant | undefined;
  if (!lookup) throw new HttpError(401, "Invalid AI connection.");
  const record = await authority(
    db,
    lookup.user_id,
    lookup.workspace_id,
    lookup.meeting_id,
  );
  const grant = (
    await db.query(
      `SELECT * FROM ai_grants WHERE id=$1 AND ${field}=$2 FOR UPDATE`,
      [lookup.id, hash(bearer)],
    )
  ).rows[0] as Grant | undefined;
  if (
    !grant ||
    grant.revoked_at ||
    new Date(grant.expires_at).getTime() <= Date.now()
  )
    throw new HttpError(401, "AI connection expired or revoked.");
  return { grant, record };
}
export async function exchange(raw: unknown) {
  requireAiEnabled();
  const input = z
    .strictObject({
      code: credential,
      verifier: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
    })
    .parse(raw);
  return transaction(async (db) => {
    const { grant, record } = await locked(db, input.code, "code_hash");
    if (
      new Date(grant.code_expires).getTime() <= Date.now() ||
      challenge(input.verifier) !== grant.challenge
    )
      throw new HttpError(401, "Invalid or expired connection code.");
    projection(record);
    const bearer = token();
    await db.query(
      "UPDATE ai_grants SET code_hash=NULL,token_hash=$2 WHERE id=$1",
      [grant.id, hash(bearer)],
    );
    return {
      token: bearer,
      grantId: grant.id,
      subjectId: grant.user_id,
      workspaceId: grant.workspace_id,
      meetingId: grant.meeting_id,
      actions: ["read_transcript"] as const,
      expiresAt: grant.expires_at,
      policyRevision: "autonote-ai-transcript-v1",
    };
  });
}
export async function read(bearer: string, raw: unknown) {
  requireAiEnabled();
  const input = z.strictObject({ meetingId: z.uuid() }).parse(raw);
  return transaction(async (db) => {
    const { grant, record } = await locked(db, bearer, "token_hash");
    if (input.meetingId !== grant.meeting_id)
      throw new HttpError(
        403,
        "This connection does not include that meeting.",
      );
    const transcript = projection(record);
    await db.query("UPDATE ai_grants SET last_used_at=now() WHERE id=$1", [
      grant.id,
    ]);
    return {
      contractVersion: "1.0.0",
      grantId: grant.id,
      subjectId: grant.user_id,
      workspaceId: grant.workspace_id,
      policyRevision: "autonote-ai-transcript-v1",
      meeting: transcript,
      projectionHash: createHash("sha256")
        .update(JSON.stringify(transcript))
        .digest("hex"),
      publication: {
        mode: "autonote_review_only" as const,
        directCrm: false as const,
      },
    };
  });
}
export async function list(user: string) {
  return (
    await pool().query(
      "SELECT id,workspace_id,meeting_id,created_at,expires_at,last_used_at,revoked_at FROM ai_grants WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100",
      [user],
    )
  ).rows;
}
export async function revoke(user: string, id: string) {
  z.uuid().parse(id);
  const result = await pool().query(
    "UPDATE ai_grants SET revoked_at=COALESCE(revoked_at,now()),code_hash=NULL,token_hash=NULL WHERE id=$1 AND user_id=$2 RETURNING id",
    [id, user],
  );
  if (!result.rowCount) throw new HttpError(404, "Connection not found.");
  return { revoked: true };
}
export async function disconnect(bearer: string) {
  credential.parse(bearer);
  await pool().query(
    "UPDATE ai_grants SET revoked_at=COALESCE(revoked_at,now()),code_hash=NULL,token_hash=NULL WHERE token_hash=$1",
    [hash(bearer)],
  );
  return { revoked: true };
}
