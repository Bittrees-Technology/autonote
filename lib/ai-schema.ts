import type { PoolClient } from "pg";
export const aiSchema = `
CREATE TABLE IF NOT EXISTS ai_grants(
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),workspace_id uuid NOT NULL REFERENCES workspaces(id),meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
 code_hash text UNIQUE,token_hash text UNIQUE,challenge text NOT NULL,code_expires timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),last_used_at timestamptz,revoked_at timestamptz
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
}
