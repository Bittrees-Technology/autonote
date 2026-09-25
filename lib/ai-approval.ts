import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { transaction, pool } from "./db";
import { token, hash } from "./auth";
import { requireAiEnabled } from "./ai";
import { HttpError } from "./model";
import {
  ownedReviewGrant,
  saveReviewInTransaction,
  reviewDetailInTransaction,
} from "./ai-reviews";
import type { PoolClient } from "pg";
const credential = z.string().regex(/^[a-f0-9]{64}$/);
const challenge = (value: string) =>
  createHash("sha256").update(value).digest("base64url");
function enabled() {
  requireAiEnabled();
  if (process.env.AI_REMOTE_APPROVAL_ENABLED !== "true")
    throw new HttpError(404, "Remote approval is unavailable.");
}
const scope = "approve_meeting_notes" as const;
/** Called only by a source-session route after explicit independent consent. */
export async function authorizeApproval(user: string, raw: unknown) {
  enabled();
  const input = z
    .strictObject({
      grantId: z.uuid(),
      actions: z.tuple([z.literal(scope)]),
      challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      expiresInMinutes: z.number().int().min(1).max(60),
    })
    .parse(raw);
  return transaction(async (db) => {
    const { grant } = await ownedReviewGrant(db, user, input.grantId);
    if (!grant.review_epoch)
      throw new HttpError(409, "Enable draft reviews before remote approval.");
    // One current delegation per source grant. Issuance and use share source locks.
    await db.query(
      "UPDATE ai_approval_grants SET revoked_at=COALESCE(revoked_at,now()),code_hash=NULL,token_hash=NULL WHERE grant_id=$1 AND revoked_at IS NULL",
      [grant.id],
    );
    const count = (
      await db.query(
        "SELECT count(*) n FROM ai_approval_grants WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now()",
        [user],
      )
    ).rows[0];
    if (Number(count.n) >= 50)
      throw new HttpError(429, "Revoke unused approval connections first.");
    const id = randomUUID(),
      code = token(),
      expiry = new Date(
        Math.min(
          Date.now() + input.expiresInMinutes * 60000,
          new Date(grant.expires_at).getTime(),
        ),
      );
    const row = (
      await db.query(
        "INSERT INTO ai_approval_grants(id,user_id,grant_id,epoch,code_hash,challenge,code_expires,expires_at) VALUES($1,$2,$3,$4,$5,$6,LEAST(now()+interval '60 seconds',$7),$7) RETURNING code_expires,expires_at",
        [
          id,
          user,
          grant.id,
          grant.review_epoch,
          hash(code),
          input.challenge,
          expiry,
        ],
      )
    ).rows[0];
    return {
      approvalId: id,
      grantId: grant.id,
      meetingId: grant.meeting_id,
      actions: [scope],
      code,
      codeExpiresAt: row.code_expires,
      expiresAt: row.expires_at,
    };
  });
}
async function lookup(
  db: PoolClient,
  secret: string,
  field: "code_hash" | "token_hash",
) {
  credential.parse(secret);
  const row = (
    await db.query(`SELECT * FROM ai_approval_grants WHERE ${field}=$1`, [
      hash(secret),
    ])
  ).rows[0];
  if (!row) throw new HttpError(401, "Approval credential required.");
  return row;
}
async function locked(
  db: PoolClient,
  secret: string,
  field: "code_hash" | "token_hash",
  source: any,
) {
  const row = (
    await db.query(
      `SELECT * FROM ai_approval_grants WHERE ${field}=$1 FOR UPDATE`,
      [hash(secret)],
    )
  ).rows[0];
  if (
    !row ||
    row.user_id !== source.user_id ||
    row.grant_id !== source.id ||
    row.epoch !== source.review_epoch ||
    row.revoked_at ||
    source.revoked_at ||
    new Date(row.expires_at).getTime() <= Date.now() ||
    new Date(source.expires_at).getTime() <= Date.now()
  )
    throw new HttpError(401, "Approval permission expired or revoked.");
  return row;
}
export async function exchangeApproval(raw: unknown) {
  enabled();
  const input = z
    .strictObject({
      code: credential,
      verifier: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
    })
    .parse(raw);
  return transaction(async (db) => {
    const initial = await lookup(db, input.code, "code_hash");
    const { grant } = await ownedReviewGrant(
      db,
      initial.user_id,
      initial.grant_id,
    );
    const row = await locked(db, input.code, "code_hash", grant);
    if (
      new Date(row.code_expires).getTime() <= Date.now() ||
      challenge(input.verifier) !== row.challenge
    )
      throw new HttpError(401, "Approval exchange expired or invalid.");
    const secret = token();
    await db.query(
      "UPDATE ai_approval_grants SET code_hash=NULL,token_hash=$2 WHERE id=$1",
      [row.id, hash(secret)],
    );
    return {
      approvalId: row.id,
      grantId: grant.id,
      meetingId: grant.meeting_id,
      actions: [scope],
      token: secret,
      expiresAt: row.expires_at,
    };
  });
}
/** Separate bearer, never a read/upload/conversation grant. Exact source digest is mandatory. */
export async function approveReview(secret: string, raw: unknown) {
  enabled();
  const input = z
    .strictObject({
      reviewId: z.uuid(),
      digest: credential,
      confirmed: z.literal(true),
    })
    .parse(raw);
  return transaction(async (db) => {
    const initial = await lookup(db, secret, "token_hash");
    return saveReviewInTransaction(
      db,
      initial.user_id,
      input.reviewId,
      input.digest,
      async ({ grant }) => {
        // Source rights, review grant and meeting were locked first by the shared save path.
        await locked(db, secret, "token_hash", grant);
      },
    );
  });
}
/** Revocation remains available without feature flags or current source membership. */
export async function revokeApproval(user: string, id: string) {
  const row = await pool().query(
    "UPDATE ai_approval_grants SET revoked_at=COALESCE(revoked_at,now()),code_hash=NULL,token_hash=NULL WHERE id=$1 AND user_id=$2 RETURNING id",
    [z.uuid().parse(id), user],
  );
  if (!row.rowCount) throw new HttpError(404, "Approval connection not found.");
  return { revoked: true };
}

/** Approval includes reviewing the exact notes to be saved, never transcript/recording reads. */
export async function inspectApprovalReview(secret: string, raw: unknown) {
  enabled();
  const input = z.strictObject({ reviewId: z.uuid() }).parse(raw);
  return transaction(async (db) => {
    const initial = await lookup(db, secret, "token_hash");
    return reviewDetailInTransaction(
      db,
      initial.user_id,
      input.reviewId,
      async ({ grant }) => {
        await locked(db, secret, "token_hash", grant);
      },
    );
  });
}
export async function listApprovals(user: string) {
  if (
    !(
      await pool().query(
        "SELECT to_regclass('ai_approval_grants') IS NOT NULL AS present",
      )
    ).rows[0].present
  )
    return [];
  return (
    await pool().query(
      "SELECT a.id,a.grant_id,a.created_at,a.expires_at,a.revoked_at,g.meeting_id,(a.revoked_at IS NULL AND a.expires_at>now() AND g.revoked_at IS NULL AND g.expires_at>now() AND a.epoch=g.review_epoch) AS permission_current FROM ai_approval_grants a JOIN ai_grants g ON g.id=a.grant_id WHERE a.user_id=$1 ORDER BY a.created_at DESC LIMIT 100",
      [user],
    )
  ).rows;
}
