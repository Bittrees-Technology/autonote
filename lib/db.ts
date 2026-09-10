import { Pool, type PoolClient } from "pg";
const globalDb = globalThis as unknown as { autonotePool?: Pool };
export function pool() {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is not configured");
  return (globalDb.autonotePool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 10000,
  }));
}
export async function transaction<T>(fn: (db: PoolClient) => Promise<T>) {
  const db = await pool().connect();
  try {
    await db.query("BEGIN");
    const v = await fn(db);
    await db.query("COMMIT");
    return v;
  } catch (e) {
    await db.query("ROLLBACK");
    throw e;
  } finally {
    db.release();
  }
}
export const schema = `
CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY,name text NOT NULL,merged_into uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS identities(kind text NOT NULL,value text NOT NULL,user_id uuid NOT NULL REFERENCES users(id),verified_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(kind,value));
CREATE TABLE IF NOT EXISTS sessions(hash text PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS identity_recoveries(hash text PRIMARY KEY,target_id uuid NOT NULL REFERENCES users(id),source_id uuid NOT NULL REFERENCES users(id),session_hash text NOT NULL,fingerprint text NOT NULL,current_verified boolean NOT NULL DEFAULT false,consumed boolean NOT NULL DEFAULT false,expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS challenges(id uuid PRIMARY KEY,kind text NOT NULL,value text NOT NULL,secret_hash text NOT NULL,browser_hash text NOT NULL,user_id uuid REFERENCES users(id),payload text,expires_at timestamptz NOT NULL,attempts int NOT NULL DEFAULT 0,consumed boolean NOT NULL DEFAULT false,recovery_hash text REFERENCES identity_recoveries(hash));
CREATE TABLE IF NOT EXISTS rate_limits(key text PRIMARY KEY,hits int NOT NULL,resets_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS workspaces(id uuid PRIMARY KEY,name text NOT NULL,retention_days int NOT NULL DEFAULT 30 CHECK(retention_days BETWEEN 1 AND 365),monthly_minutes int NOT NULL DEFAULT 600 CHECK(monthly_minutes>0),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS members(workspace_id uuid REFERENCES workspaces(id),user_id uuid REFERENCES users(id),role text NOT NULL CHECK(role IN ('owner','editor','viewer')),PRIMARY KEY(workspace_id,user_id));
CREATE TABLE IF NOT EXISTS meetings(id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),creator_id uuid NOT NULL REFERENCES users(id),title text NOT NULL,language text NOT NULL DEFAULT 'en',visibility text NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','workspace')),status text NOT NULL DEFAULT 'uploading',duration float,version int NOT NULL DEFAULT 1,transcript jsonb NOT NULL DEFAULT '[]',notes jsonb,notes_stale boolean NOT NULL DEFAULT false,error text,object_key text,upload_id text,upload_bytes bigint NOT NULL DEFAULT 0,recording_deleted boolean NOT NULL DEFAULT false,consent_at timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),deleted_at timestamptz);
CREATE INDEX IF NOT EXISTS meetings_workspace ON meetings(workspace_id,created_at DESC);
CREATE TABLE IF NOT EXISTS meeting_grants(meeting_id uuid REFERENCES meetings(id) ON DELETE CASCADE,user_id uuid REFERENCES users(id),PRIMARY KEY(meeting_id,user_id));
CREATE TABLE IF NOT EXISTS revisions(id bigserial PRIMARY KEY,meeting_id uuid REFERENCES meetings(id) ON DELETE CASCADE,version int NOT NULL,kind text NOT NULL,payload jsonb NOT NULL,actor_id uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS jobs(id bigserial PRIMARY KEY,meeting_id uuid REFERENCES meetings(id) ON DELETE CASCADE,stage text NOT NULL DEFAULT 'transcribe',generation int NOT NULL,state text NOT NULL DEFAULT 'queued',attempts int NOT NULL DEFAULT 0,lease_token uuid,leased_until timestamptz,available_at timestamptz NOT NULL DEFAULT now(),last_error text,UNIQUE(meeting_id,generation,stage));
CREATE TABLE IF NOT EXISTS invites(id uuid PRIMARY KEY,hash text UNIQUE NOT NULL,workspace_id uuid REFERENCES workspaces(id),email text NOT NULL,role text NOT NULL CHECK(role IN ('editor','viewer')),expires_at timestamptz NOT NULL,accepted_at timestamptz,revoked_at timestamptz);
CREATE TABLE IF NOT EXISTS audit(id bigserial PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id),actor_id uuid REFERENCES users(id),action text NOT NULL,meeting_id uuid,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS usage(id bigserial PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id),meeting_id uuid,minutes float NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS crm_pending(state_hash text PRIMARY KEY,user_id uuid REFERENCES users(id),session_hash text NOT NULL,verifier text NOT NULL,expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS crm_connections(id uuid PRIMARY KEY,user_id uuid REFERENCES users(id),token_ciphertext text NOT NULL,workspace_name text NOT NULL,target_name text NOT NULL,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS crm_previews(hash text PRIMARY KEY,user_id uuid REFERENCES users(id),connection_id uuid REFERENCES crm_connections(id) ON DELETE CASCADE,meeting_id uuid REFERENCES meetings(id) ON DELETE CASCADE,version int NOT NULL,payload jsonb NOT NULL,result jsonb,expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS google_pending(state_hash text PRIMARY KEY,user_id uuid REFERENCES users(id),session_hash text NOT NULL,verifier text NOT NULL,expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS google_connections(user_id uuid PRIMARY KEY REFERENCES users(id),refresh_ciphertext text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS google_selections(user_id uuid REFERENCES google_connections(user_id) ON DELETE CASCADE,event_id text NOT NULL,title text NOT NULL,meet_url text NOT NULL,starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,selected_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,event_id));
`;
