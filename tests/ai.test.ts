import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { Pool } from "pg";
import { pool, schema } from "../lib/db";
import * as ai from "../lib/ai";
const namespace = "ai_" + randomUUID().replaceAll("-", ""),
  base = process.env.DATABASE_URL!;
const admin = new Pool({ connectionString: base });
before(async () => {
  if (!base.endsWith("/autonote_test"))
    throw Error("Dedicated test database required");
  await admin.query(`CREATE SCHEMA ${namespace}`);
  const url = new URL(base);
  url.searchParams.set("options", "-c search_path=" + namespace);
  url.searchParams.set("application_name", namespace);
  process.env.DATABASE_URL = url.href;
  await pool().query(schema);
  process.env.AI_CONNECTOR_ENABLED = "true";
});
after(async () => {
  await pool().end();
  await admin.query(`DROP SCHEMA ${namespace} CASCADE`);
  await admin.end();
});
async function fixture() {
  const user = randomUUID(),
    other = randomUUID(),
    workspace = randomUUID(),
    id = randomUUID();
  await pool().query(
    "INSERT INTO users(id,name) VALUES($1,'Owner'),($2,'Other')",
    [user, other],
  );
  await pool().query(
    "INSERT INTO workspaces(id,name) VALUES($1,'Synthetic workspace')",
    [workspace],
  );
  await pool().query(
    "INSERT INTO members(workspace_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'viewer')",
    [workspace, user, other],
  );
  const transcript = [
    {
      id: "segment-1",
      start: 1,
      end: 4,
      speaker: "Speaker",
      text: "SYNTHETIC_TRANSCRIPT",
    },
  ];
  await pool().query(
    "INSERT INTO meetings(id,workspace_id,creator_id,title,status,transcript,object_key) VALUES($1,$2,$3,'Synthetic meeting','ready',$4,'PRIVATE_RECORDING_KEY')",
    [id, workspace, user, JSON.stringify(transcript)],
  );
  const verifier = "a".repeat(64),
    challenge = createHash("sha256").update(verifier).digest("base64url");
  const input = {
    workspaceId: workspace,
    meetingId: id,
    actions: ["read_transcript"],
    challenge,
    expiresInDays: 1,
  };
  return { user, other, workspace, id, transcript, input, verifier };
}
test("selected transcript grants use single-use PKCE and exclude recordings, notes and unrelated meetings", async () => {
  const f = await fixture();
  await assert.rejects(ai.authorize(f.other, f.input));
  await assert.rejects(
    ai.authorize(f.user, { ...f.input, actions: ["write"] }),
  );
  const issued = await ai.authorize(f.user, f.input);
  await assert.rejects(
    ai.exchange({ code: issued.code, verifier: "b".repeat(64) }),
  );
  const grant = await ai.exchange({ code: issued.code, verifier: f.verifier });
  await assert.rejects(
    ai.exchange({ code: issued.code, verifier: f.verifier }),
  );
  const data = await ai.read(grant.token, { meetingId: f.id });
  assert.deepEqual(data.meeting.segments, f.transcript);
  assert.equal(data.meeting.version, 1);
  assert.equal(data.publication.directCrm, false);
  assert.equal(
    data.projectionHash,
    createHash("sha256").update(JSON.stringify(data.meeting)).digest("hex"),
  );
  assert.equal(JSON.stringify(data).includes("PRIVATE_RECORDING_KEY"), false);
  assert.equal("notes" in data.meeting, false);
  await assert.rejects(ai.read(grant.token, { meetingId: randomUUID() }));
  await assert.rejects(
    ai.read(grant.token, { meetingId: f.id, includeRecording: true }),
  );
  const row = (
    await pool().query("SELECT * FROM ai_grants WHERE id=$1", [grant.grantId])
  ).rows[0];
  assert.equal(row.code_hash, null);
  assert.notEqual(row.token_hash, grant.token);
  assert.ok(row.last_used_at);
  assert.equal(
    JSON.stringify(await ai.list(f.user)).includes(grant.token),
    false,
  );
  assert.equal((await ai.list(f.other)).length, 0);
  await assert.rejects(ai.revoke(f.other, grant.grantId));
  await ai.revoke(f.user, grant.grantId);
  await assert.rejects(ai.read(grant.token, { meetingId: f.id }));
});
test("membership, private sharing, source deletion and disabled state fence transcript access", async () => {
  for (const kind of [
    "membership",
    "sharing",
    "deleted",
    "merged",
    "expired",
    "disabled",
  ]) {
    const f = await fixture();
    await pool().query("INSERT INTO meeting_grants VALUES($1,$2)", [
      f.id,
      f.other,
    ]);
    const issued = await ai.authorize(f.other, f.input),
      grant = await ai.exchange({ code: issued.code, verifier: f.verifier });
    if (kind === "membership")
      await pool().query("DELETE FROM members WHERE user_id=$1", [f.other]);
    if (kind === "sharing")
      await pool().query("DELETE FROM meeting_grants WHERE user_id=$1", [
        f.other,
      ]);
    if (kind === "deleted")
      await pool().query("UPDATE meetings SET deleted_at=now() WHERE id=$1", [
        f.id,
      ]);
    if (kind === "merged")
      await pool().query("UPDATE users SET merged_into=$2 WHERE id=$1", [
        f.other,
        f.user,
      ]);
    if (kind === "expired")
      await pool().query(
        "UPDATE ai_grants SET expires_at=now()-interval '1 second' WHERE id=$1",
        [grant.grantId],
      );
    if (kind === "disabled") process.env.AI_CONNECTOR_ENABLED = "false";
    await assert.rejects(ai.read(grant.token, { meetingId: f.id }), kind);
    assert.deepEqual(await ai.disconnect(grant.token), { revoked: true });
    assert.deepEqual(await ai.disconnect(grant.token), { revoked: true });
    process.env.AI_CONNECTOR_ENABLED = "true";
  }
});
test("invalid timestamps, duplicate segment IDs and oversized transcripts are rejected; content edits change provenance", async () => {
  const f = await fixture(),
    issued = await ai.authorize(f.user, f.input),
    grant = await ai.exchange({ code: issued.code, verifier: f.verifier });
  const before = await ai.read(grant.token, { meetingId: f.id });
  await pool().query(
    "UPDATE meetings SET transcript=$2,version=version+1 WHERE id=$1",
    [f.id, JSON.stringify([{ ...f.transcript[0], text: "Edited" }])],
  );
  const after = await ai.read(grant.token, { meetingId: f.id });
  assert.notEqual(before.projectionHash, after.projectionHash);
  assert.equal(after.meeting.version, 2);
  for (const transcript of [
    [{ ...f.transcript[0], end: 0 }],
    [f.transcript[0], f.transcript[0]],
    Array.from({ length: 110 }, (_, i) => ({
      ...f.transcript[0],
      id: String(i),
      text: "x".repeat(10000),
    })),
  ]) {
    await pool().query("UPDATE meetings SET transcript=$2 WHERE id=$1", [
      f.id,
      JSON.stringify(transcript),
    ]);
    await assert.rejects(ai.read(grant.token, { meetingId: f.id }));
  }
});
test("concurrent exchange consumes the code once and expired codes never exchange", async () => {
  const f = await fixture(),
    issued = await ai.authorize(f.user, f.input);
  const results = await Promise.allSettled([
    ai.exchange({ code: issued.code, verifier: f.verifier }),
    ai.exchange({ code: issued.code, verifier: f.verifier }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const expired = await ai.authorize(f.user, f.input);
  await pool().query(
    "UPDATE ai_grants SET code_expires=now()-interval '1 second' WHERE id=$1",
    [expired.grantId],
  );
  await assert.rejects(
    ai.exchange({ code: expired.code, verifier: f.verifier }),
  );
});

test("sharing revoked while a read waits for the meeting lock is rechecked before transcript release", async () => {
  const f = await fixture();
  await pool().query("INSERT INTO meeting_grants VALUES($1,$2)", [
    f.id,
    f.other,
  ]);
  const issued = await ai.authorize(f.other, f.input),
    grant = await ai.exchange({ code: issued.code, verifier: f.verifier });
  const editor = await pool().connect();
  await editor.query("BEGIN");
  try {
    await editor.query("UPDATE meetings SET version=version+1 WHERE id=$1", [
      f.id,
    ]);
    await editor.query(
      "DELETE FROM meeting_grants WHERE meeting_id=$1 AND user_id=$2",
      [f.id, f.other],
    );
    const reading = ai.read(grant.token, { meetingId: f.id });
    const denied = assert.rejects(reading);
    let waiting = false;
    for (let i = 0; i < 100; i++) {
      const result = await admin.query(
        "SELECT count(*) AS n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",
        [namespace],
      );
      if (Number(result.rows[0].n) > 0) {
        waiting = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    assert.equal(
      waiting,
      true,
      "read must actually overlap the sharing transaction",
    );
    await editor.query("COMMIT");
    await denied;
  } finally {
    await editor.query("ROLLBACK");
    editor.release();
  }
});

test("account cleanup revokes both linked identities and remains safe before the additive migration", async () => {
  const { revokeAiForAccounts } = await import("../lib/ai-schema"),
    f = await fixture();
  await pool().query("INSERT INTO meeting_grants VALUES($1,$2)", [
    f.id,
    f.other,
  ]);
  const grants = [];
  for (const user of [f.user, f.other]) {
    const issued = await ai.authorize(user, f.input);
    grants.push(await ai.exchange({ code: issued.code, verifier: f.verifier }));
  }
  const db = await pool().connect();
  try {
    await revokeAiForAccounts(db, [f.user, f.other]);
    for (const grant of grants)
      await assert.rejects(ai.read(grant.token, { meetingId: f.id }));
    await db.query("BEGIN");
    await db.query(
      "ALTER TABLE ai_grants RENAME TO temporarily_unmigrated_ai_grants",
    );
    await revokeAiForAccounts(db, [f.user]);
    await db.query("ROLLBACK");
  } finally {
    await db.query("ROLLBACK");
    db.release();
  }
});
