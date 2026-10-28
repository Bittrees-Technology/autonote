import { Client } from "pg";
import {
  nativeWorkflowSchema,
  nativeWorkflowSchemaReady,
} from "../lib/native-workflow-schema";

// A release operator supplies only AutoNote's existing direct connection in
// memory. No application signing keys are needed for this bounded migration.
const connectionString = process.env.DATABASE_URL_UNPOOLED;
let directConnection = false;
try {
  const url = new URL(connectionString || "");
  directConnection =
    ["postgres:", "postgresql:"].includes(url.protocol) &&
    !url.hostname.includes("-pooler");
} catch {
  // URL parsing errors can include their input; never log the credential.
}
if (
  process.env.NATIVE_WORKFLOW_MIGRATION_APPROVED !== "autonote" ||
  !connectionString ||
  !directConnection
) {
  throw Error(
    "Explicit AutoNote release approval and direct connection required.",
  );
}
const client = new Client({ connectionString, connectionTimeoutMillis: 10000 });
await client.connect();
try {
  const verifyOnly = process.env.NATIVE_WORKFLOW_VERIFY_ONLY === "1";
  await client.query(verifyOnly ? "BEGIN READ ONLY" : "BEGIN");
  await client.query("SET LOCAL lock_timeout='3s'");
  await client.query("SET LOCAL statement_timeout='10s'");
  const alreadyCurrent = await nativeWorkflowSchemaReady(client);
  if (!alreadyCurrent) {
    if (verifyOnly)
      throw Error(
        "Native workflow generation migration requires the existing schema owner.",
      );
    await client.query(nativeWorkflowSchema);
  }
  const columns = await client.query(
    "SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema=current_schema() AND table_name IN ('members','identities') AND column_name='authority_generation'",
  );
  const triggers = await client.query(
    "SELECT tgname,tgenabled FROM pg_catalog.pg_trigger WHERE tgrelid IN ('members'::regclass,'identities'::regclass) AND tgname IN ('autonote_membership_generation','autonote_identity_generation') AND NOT tgisinternal",
  );
  if (
    columns.rows.length !== 2 ||
    columns.rows.some(
      (c) => c.data_type !== "uuid" || c.is_nullable !== "NO",
    ) ||
    triggers.rows.length !== 2 ||
    triggers.rows.some((t) => t.tgenabled !== "O")
  )
    throw Error("Migration verification failed.");
  if (!(await nativeWorkflowSchemaReady(client)))
    throw Error("Generation trigger verification failed.");
  const transactionId = alreadyCurrent
    ? null
    : (await client.query("SELECT txid_current()::text AS id")).rows[0].id;
  await client.query("COMMIT");
  console.log(
    JSON.stringify({
      migration: "autonote-native-workflow-v1",
      status: alreadyCurrent ? "verified-existing" : "committed",
      transactionId,
      verifiedColumns: 2,
      enabledTriggers: 2,
      verifiedFunctions: 2,
      verifyOnly,
    }),
  );
} catch (e) {
  await client.query("ROLLBACK");
  throw e;
} finally {
  await client.end();
}
