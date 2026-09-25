import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { pool, transaction } from "./db";
import {
  aiAuthority,
  aiProjection,
  lockedAiGrant,
  requireAiEnabled,
} from "./ai";
import { editMeeting, meeting } from "./service";
import { HttpError, notesSchema, type Notes } from "./model";
import type { PoolClient } from "pg";
const hash = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
const evidence = z
  .array(z.string().min(1).max(100))
  .min(1)
  .max(30)
  .refine((v) => new Set(v).size === v.length);
const claim = z.strictObject({
  text: z.string().trim().min(1).max(4000),
  evidence,
});
const proposalSchema = z.strictObject({
  operationId: z.uuid(),
  meetingId: z.uuid(),
  version: z.number().int().positive(),
  projectionHash: z.string().regex(/^[a-f0-9]{64}$/),
  summary: z.array(claim).min(1).max(20),
  actions: z
    .array(
      z.strictObject({
        text: z.string().trim().min(1).max(4000),
        evidence,
        owner: z.string().max(150).nullable(),
        dueDate: z.iso.date().nullable(),
      }),
    )
    .max(30),
});
type Proposal = z.infer<typeof proposalSchema>;
export async function ownedReviewGrant(
  db: PoolClient,
  user: string,
  id: string,
) {
  const lookup = (
    await db.query("SELECT * FROM ai_grants WHERE id=$1 AND user_id=$2", [
      z.uuid().parse(id),
      user,
    ])
  ).rows[0];
  if (!lookup) throw new HttpError(404, "Connection not found.");
  await aiAuthority(db, user, lookup.workspace_id, lookup.meeting_id);
  const record = await meeting(user, lookup.meeting_id, true, db);
  const grant = (
    await db.query(
      "SELECT * FROM ai_grants WHERE id=$1 AND user_id=$2 FOR UPDATE",
      [id, user],
    )
  ).rows[0];
  if (
    !grant ||
    grant.revoked_at ||
    new Date(grant.expires_at).getTime() <= Date.now()
  )
    throw new HttpError(401, "Connection expired or revoked.");
  return { grant, record };
}
/** Session-only permission; the read bearer cannot enable review uploads or approve a save. */
export async function allowReviews(
  user: string,
  grantId: string,
  enabled: boolean,
) {
  if (enabled) requireAiEnabled();
  return transaction(async (db) => {
    if (!enabled) {
      const result = await db.query(
        "UPDATE ai_grants SET review_epoch=NULL WHERE id=$1 AND user_id=$2 RETURNING id",
        [z.uuid().parse(grantId), user],
      );
      if (!result.rowCount) throw new HttpError(404, "Connection not found.");
      return { enabled: false, epoch: null };
    }
    const { grant } = await ownedReviewGrant(db, user, grantId),
      epoch = randomUUID();
    await db.query("UPDATE ai_grants SET review_epoch=$2 WHERE id=$1", [
      grant.id,
      epoch,
    ]);
    return { enabled: true, epoch };
  });
}
function merged(record: any, proposal: Proposal): Notes {
  if (record.notes_stale)
    throw new HttpError(
      409,
      "Review or regenerate the existing stale notes first.",
    );
  const projection = aiProjection(record);
  if (
    record.id !== proposal.meetingId ||
    record.version !== proposal.version ||
    hash(projection) !== proposal.projectionHash
  )
    throw new HttpError(
      409,
      "Transcript or meeting changed. Create a fresh draft.",
    );
  const segments = new Map(projection.segments.map((s) => [s.id, s]));
  for (const item of [...proposal.summary, ...proposal.actions])
    for (const id of item.evidence)
      if (!segments.has(id))
        throw new HttpError(400, "Draft cites a missing segment.");
  const previous = record.notes
    ? notesSchema.parse(record.notes)
    : {
        summary: "",
        topics: [],
        decisions: [],
        actions: [],
        questions: [],
        recommendations: [],
      };
  if (
    proposal.actions.some((_item, index) =>
      previous.actions.some(
        (item) => item.id === proposal.operationId + ":" + index,
      ),
    )
  )
    throw new HttpError(
      409,
      "An action identifier already exists. Create a fresh draft.",
    );
  const summary = proposal.summary
    .map(
      (item) =>
        item.text +
        " " +
        item.evidence
          .map((id) => {
            const s = segments.get(id)!;
            return `[${id}: ${s.start}–${s.end}s]`;
          })
          .join(" "),
    )
    .join("\n");
  return notesSchema.parse({
    ...previous,
    summary: [previous.summary, summary].filter(Boolean).join("\n\n"),
    actions: [
      ...previous.actions,
      ...proposal.actions.map((item, i) => ({
        ...item,
        id: proposal.operationId + ":" + i,
        status: "proposed" as const,
      })),
    ],
  });
}
export async function prepareReview(bearer: string, raw: unknown) {
  requireAiEnabled();
  const proposal = proposalSchema.parse(raw);
  if (Buffer.byteLength(JSON.stringify(proposal)) > 64000)
    throw new HttpError(413, "Draft is too large.");
  return transaction(async (db) => {
    const { grant, record } = await lockedAiGrant(db, bearer, "token_hash");
    await meeting(grant.user_id, grant.meeting_id, true, db);
    const permission = (
      await db.query("SELECT review_epoch FROM ai_grants WHERE id=$1", [
        grant.id,
      ])
    ).rows[0].review_epoch;
    if (!permission)
      throw new HttpError(403, "Enable draft review in AutoNote first.");
    // Serialize per-account capacity and operation identity across different meetings.
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 810034))",
      [grant.user_id],
    );
    const prior = (
      await db.query(
        "SELECT * FROM ai_reviews WHERE user_id=$1 AND operation_id=$2",
        [grant.user_id, proposal.operationId],
      )
    ).rows[0];
    const digest = hash(proposal);
    if (prior) {
      if (prior.digest !== digest || prior.meeting_id !== grant.meeting_id)
        throw new HttpError(409, "Operation already used for another draft.");
      return {
        reviewId: prior.id,
        digest: prior.digest,
        expiresAt: prior.expires_at,
        receipt: prior.receipt,
      };
    }
    if (proposal.meetingId !== grant.meeting_id)
      throw new HttpError(403, "Wrong meeting.");
    merged(record, proposal);
    const count = (
      await db.query(
        "SELECT count(*) AS n FROM ai_reviews WHERE user_id=$1 AND receipt IS NULL AND payload IS NOT NULL",
        [grant.user_id],
      )
    ).rows[0];
    if (Number(count.n) >= 30)
      throw new HttpError(429, "Delete unused reviews before adding another.");
    const id = randomUUID(),
      expires = new Date(
        Math.min(Date.now() + 600000, new Date(grant.expires_at).getTime()),
      );
    await db.query(
      "INSERT INTO ai_reviews(id,user_id,meeting_id,grant_id,operation_id,epoch,version,projection_hash,digest,payload,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [
        id,
        grant.user_id,
        grant.meeting_id,
        grant.id,
        proposal.operationId,
        permission,
        proposal.version,
        proposal.projectionHash,
        digest,
        proposal,
        expires,
      ],
    );
    return { reviewId: id, digest, expiresAt: expires, receipt: null };
  });
}
export async function lockedReview(db: PoolClient, user: string, id: string) {
  const lookup = (
    await db.query(
      "SELECT grant_id FROM ai_reviews WHERE id=$1 AND user_id=$2",
      [z.uuid().parse(id), user],
    )
  ).rows[0];
  if (!lookup) throw new HttpError(404, "Review not found.");
  const { grant, record } = await ownedReviewGrant(db, user, lookup.grant_id);
  const review = (
    await db.query(
      "SELECT * FROM ai_reviews WHERE id=$1 AND user_id=$2 FOR UPDATE",
      [id, user],
    )
  ).rows[0];
  if (!review) throw new HttpError(404, "Review not found.");
  return { grant, record, review };
}
export async function reviewDetail(user: string, id: string) {
  requireAiEnabled();
  return transaction((db) => reviewDetailInTransaction(db, user, id));
}
export async function reviewDetailInTransaction(
  db: PoolClient,
  user: string,
  id: string,
  authority?: (
    current: Awaited<ReturnType<typeof lockedReview>>,
  ) => Promise<void>,
) {
  const current = await lockedReview(db, user, id);
  await authority?.(current);
  const { grant, record, review } = current;
  if (review.receipt) return { id: review.id, receipt: review.receipt };
  if (
    !review.payload ||
    review.epoch !== grant.review_epoch ||
    new Date(review.expires_at).getTime() <= Date.now()
  )
    throw new HttpError(409, "Review expired, deleted or disabled.");
  const proposal = proposalSchema.parse(review.payload),
    notes = merged(record, proposal);
  return {
    id: review.id,
    digest: review.digest,
    expiresAt: review.expires_at,
    meetingId: record.id,
    title: record.title,
    visibility: record.visibility,
    proposal,
    notes,
  };
}

/** Exact source-session review and save in one transaction; no bearer approval or CRM dispatch. */
export async function saveReview(user: string, id: string, digest: string) {
  requireAiEnabled();
  z.string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(digest);
  return transaction((db) => saveReviewInTransaction(db, user, id, digest));
}
/** Internal shared write path. Remote delegation must supply a fresh authority check;
 * source-session callers retain their existing route authentication. */
export async function saveReviewInTransaction(
  db: PoolClient,
  user: string,
  id: string,
  digest: string,
  authority?: (
    current: Awaited<ReturnType<typeof lockedReview>>,
  ) => Promise<void>,
) {
  const current = await lockedReview(db, user, id);
  const { grant, record, review } = current;
  await authority?.(current);
  if (review.digest !== digest) throw new HttpError(409, "Review changed.");
  if (review.receipt) return review.receipt;
  if (
    !review.payload ||
    review.epoch !== grant.review_epoch ||
    new Date(review.expires_at).getTime() <= Date.now()
  )
    throw new HttpError(409, "Review expired, deleted or disabled.");
  const notes = merged(record, proposalSchema.parse(review.payload));
  await editMeeting(user, record.id, { version: record.version, notes }, db);
  await authority?.(current);
  if (
    new Date(review.expires_at).getTime() <= Date.now() ||
    new Date(grant.expires_at).getTime() <= Date.now()
  )
    throw new HttpError(409, "Review expired before save completed.");
  const receipt = {
    meetingId: record.id,
    version: record.version + 1,
    operationId: review.operation_id,
  };
  await db.query("UPDATE ai_reviews SET receipt=$2,payload=NULL WHERE id=$1", [
    review.id,
    receipt,
  ]);
  return receipt;
}

export async function deleteReview(user: string, id: string) {
  const result = await pool().query(
    "UPDATE ai_reviews SET payload=NULL WHERE id=$1 AND user_id=$2 RETURNING id",
    [z.uuid().parse(id), user],
  );
  if (!result.rowCount) throw new HttpError(404, "Review not found.");
  return { deleted: true };
}

export async function reviewStatus(bearer: string) {
  requireAiEnabled();
  return transaction(async (db) => {
    const { grant } = await lockedAiGrant(db, bearer, "token_hash");
    await meeting(grant.user_id, grant.meeting_id, true, db);
    const row = (
      await db.query("SELECT review_epoch FROM ai_grants WHERE id=$1", [
        grant.id,
      ])
    ).rows[0];
    return {
      grantId: grant.id,
      meetingId: grant.meeting_id,
      enabled: !!row.review_epoch,
      expiresAt: grant.expires_at,
    };
  });
}
export async function reviewReceipt(bearer: string, operationId: string) {
  requireAiEnabled();
  z.uuid().parse(operationId);
  return transaction(async (db) => {
    const { grant } = await lockedAiGrant(db, bearer, "token_hash");
    const row = (
      await db.query(
        "SELECT id,digest,expires_at,receipt,payload IS NULL AS cleared FROM ai_reviews WHERE user_id=$1 AND meeting_id=$2 AND operation_id=$3",
        [grant.user_id, grant.meeting_id, operationId],
      )
    ).rows[0];
    if (!row) throw new HttpError(404, "Review not found.");
    return {
      reviewId: row.id,
      digest: row.digest,
      expiresAt: row.expires_at,
      receipt: row.receipt,
      deleted: row.cleared && !row.receipt,
    };
  });
}
export async function listReviews(user: string) {
  if (
    !(
      await pool().query(
        "SELECT to_regclass('ai_reviews') IS NOT NULL AS present",
      )
    ).rows[0].present
  )
    return [];
  return (
    await pool().query(
      "SELECT id,meeting_id,created_at,expires_at,receipt,payload IS NULL AS cleared FROM ai_reviews WHERE user_id=$1 ORDER BY (payload IS NOT NULL AND receipt IS NULL) DESC,created_at DESC LIMIT 100",
      [user],
    )
  ).rows;
}
