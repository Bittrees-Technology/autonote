import type { PoolClient } from "pg";
export const aiSchema = `
CREATE TABLE IF NOT EXISTS ai_grants(
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),workspace_id uuid NOT NULL REFERENCES workspaces(id),meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
 code_hash text UNIQUE,token_hash text UNIQUE,challenge text NOT NULL,code_expires timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),last_used_at timestamptz,revoked_at timestamptz
);
ALTER TABLE ai_grants ADD COLUMN IF NOT EXISTS review_epoch uuid;
CREATE TABLE IF NOT EXISTS ai_reviews(
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,grant_id uuid NOT NULL REFERENCES ai_grants(id),operation_id uuid NOT NULL,epoch uuid NOT NULL,version int NOT NULL,projection_hash text NOT NULL,digest text NOT NULL,payload jsonb,expires_at timestamptz NOT NULL,receipt jsonb,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,operation_id)
);
CREATE INDEX IF NOT EXISTS ai_grants_user ON ai_grants(user_id,created_at);
`;

/** Account cleanup must remain compatible with a deployment before the additive migration. */
export async function revokeAiForAccounts(db: PoolClient, users: string[]) {
  const present = (
    await db.query("SELECT to_regclass('ai_grants') IS NOT NULL AS present")
  ).rows[0].present;
  if (present)
    await db.query(
      "UPDATE ai_grants SET revoked_at=COALESCE(revoked_at,now()),code_hash=NULL,token_hash=NULL WHERE user_id=ANY($1::uuid[])",
      [users],
    );
  if (
    (await db.query("SELECT to_regclass('ai_reviews') IS NOT NULL AS present"))
      .rows[0].present
  )
    await db.query(
      "UPDATE ai_reviews SET payload=NULL WHERE user_id=ANY($1::uuid[]) OR meeting_id IN (SELECT id FROM meetings WHERE creator_id=ANY($1::uuid[]))",
      [users],
    );
}

export async function clearAiMeetingReviews(db: PoolClient, ids: string[]) {
  if (
    (await db.query("SELECT to_regclass('ai_reviews') IS NOT NULL AS present"))
      .rows[0].present
  )
    await db.query(
      "UPDATE ai_reviews SET payload=NULL WHERE meeting_id=ANY($1::uuid[])",
      [ids],
    );
}
