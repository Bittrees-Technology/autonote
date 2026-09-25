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

test("connection routes separate source sessions from bearer reads and enforce bounded consent", async () => {
  const { GET, POST } =
      await import("../app/api/integrations/ai/[action]/route"),
    { hash, cookieName } = await import("../lib/auth"),
    f = await fixture();
  const session = "c".repeat(64);
  await pool().query(
    "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
    [hash(session), f.user],
  );
  const origin = process.env.APP_URL!,
    cookie = cookieName + "=" + session;
  const call = (
    action: string,
    method = "GET",
    body?: unknown,
    headers: Record<string, string> = {},
  ) =>
    (method === "GET" ? GET : POST)(
      new Request(origin + "/api/integrations/ai/" + action, {
        method,
        headers: {
          origin,
          cookie,
          "Content-Type": "application/json",
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      { params: Promise.resolve({ action }) },
    );
  assert.equal(
    (await call("options", "GET", undefined, { cookie: "" })).status,
    401,
  );
  const choices = await (await call("options")).json();
  assert.equal(
    choices.items.some((m: any) => m.id === f.id),
    true,
  );
  assert.equal(JSON.stringify(choices).includes("SYNTHETIC_TRANSCRIPT"), false);
  assert.equal(
    (
      await call(
        "authorize",
        "POST",
        { ...f.input, subjectId: f.user },
        { origin: "https://other.invalid" },
      )
    ).status,
    403,
  );
  assert.equal(
    (await call("authorize", "POST", { ...f.input, subjectId: f.other }))
      .status,
    409,
  );
  assert.equal(
    (
      await call("authorize", "POST", {
        ...f.input,
        subjectId: f.user,
        extra: "x".repeat(17000),
      })
    ).status,
    413,
  );
  const issuedResponse = await call("authorize", "POST", {
    ...f.input,
    subjectId: f.user,
  });
  assert.equal(issuedResponse.status, 201);
  assert.equal(
    issuedResponse.headers.get("cache-control"),
    "private, no-store",
  );
  const issued = await issuedResponse.json();
  const exchange = await call(
    "exchange",
    "POST",
    { code: issued.code, verifier: f.verifier },
    { cookie: "", origin: "" },
  );
  assert.equal(exchange.status, 200);
  const grant = await exchange.json();
  assert.equal((await call("read", "POST", { meetingId: f.id })).status, 401);
  const read = await call(
    "read",
    "POST",
    { meetingId: f.id },
    { cookie: "", origin: "", authorization: "Bearer " + grant.token },
  );
  assert.equal(read.status, 200);
  assert.equal(
    (
      await call(
        "authorize",
        "POST",
        { ...f.input, subjectId: f.user },
        { cookie: "", authorization: "Bearer " + grant.token },
      )
    ).status,
    401,
  );
  process.env.AI_CONNECTOR_ENABLED = "false";
  assert.equal(
    (
      await call(
        "read",
        "POST",
        { meetingId: f.id },
        { authorization: "Bearer " + grant.token },
      )
    ).status,
    404,
  );
  assert.equal(
    (await call("revoke", "POST", { grantId: grant.grantId })).status,
    200,
  );
  const disconnected = await call(
    "disconnect",
    "POST",
    {},
    { cookie: "", authorization: "Bearer " + grant.token },
  );
  assert.equal(disconnected.status, 200);
  assert.deepEqual(await disconnected.json(), { ok: true });
  process.env.AI_CONNECTOR_ENABLED = "true";
});

async function reviewFixture() {
  const reviews = await import("../lib/ai-reviews"),
    f = await fixture();
  const issued = await ai.authorize(f.user, f.input),
    grant = await ai.exchange({ code: issued.code, verifier: f.verifier });
  const source = await ai.read(grant.token, { meetingId: f.id });
  const proposal = {
    operationId: randomUUID(),
    meetingId: f.id,
    version: 1,
    projectionHash: source.projectionHash,
    summary: [{ text: "Synthetic summary", evidence: ["segment-1"] }],
    actions: [
      {
        text: "Prepare draft",
        evidence: ["segment-1"],
        owner: "Suggested owner",
        dueDate: null,
      },
    ],
  };
  return { ...f, reviews, grant, proposal };
}
test("AI reviewed saves require separate source permission and preserve existing notes with idempotent receipts", async () => {
  const f = await reviewFixture();
  await assert.rejects(f.reviews.prepareReview(f.grant.token, f.proposal));
  await assert.rejects(f.reviews.allowReviews(f.other, f.grant.grantId, true));
  await f.reviews.allowReviews(f.user, f.grant.grantId, true);
  const previous = {
    summary: "Existing summary",
    topics: [],
    decisions: [],
    actions: [
      {
        id: "existing",
        text: "Reviewed action",
        evidence: ["segment-1"],
        owner: null,
        dueDate: null,
        status: "completed",
      },
    ],
    questions: [],
    recommendations: [],
  };
  await pool().query("UPDATE meetings SET notes=$2 WHERE id=$1", [
    f.id,
    previous,
  ]);
  const prepared = await f.reviews.prepareReview(f.grant.token, f.proposal);
  assert.equal(
    (await f.reviews.prepareReview(f.grant.token, f.proposal)).reviewId,
    prepared.reviewId,
  );
  await assert.rejects(
    f.reviews.prepareReview(f.grant.token, {
      ...f.proposal,
      summary: [{ text: "Changed", evidence: ["segment-1"] }],
    }),
  );
  const detail = await f.reviews.reviewDetail(f.user, prepared.reviewId);
  assert.equal(detail.notes!.actions[0].status, "completed");
  assert.equal(detail.notes!.actions[1].status, "proposed");
  assert.match(detail.notes!.summary, /segment-1: 1–4s/);
  await assert.rejects(
    f.reviews.saveReview(f.other, prepared.reviewId, prepared.digest),
  );
  await assert.rejects(
    f.reviews.saveReview(f.user, prepared.reviewId, "0".repeat(64)),
  );
  const [one, two] = await Promise.all([
    f.reviews.saveReview(f.user, prepared.reviewId, prepared.digest),
    f.reviews.saveReview(f.user, prepared.reviewId, prepared.digest),
  ]);
  assert.deepEqual(one, two);
  assert.equal(one.version, 2);
  const record = (
    await pool().query("SELECT notes,version FROM meetings WHERE id=$1", [f.id])
  ).rows[0];
  assert.equal(record.version, 2);
  assert.equal(record.notes.actions.length, 2);
  assert.deepEqual(record.notes.actions[0], previous.actions[0]);
  assert.match(record.notes.summary, /Existing summary/);
  assert.equal(
    (
      await pool().query("SELECT payload FROM ai_reviews WHERE id=$1", [
        prepared.reviewId,
      ])
    ).rows[0].payload,
    null,
  );
  await pool().query("UPDATE meetings SET version=version+1 WHERE id=$1", [
    f.id,
  ]);
  assert.deepEqual(
    await f.reviews.saveReview(f.user, prepared.reviewId, prepared.digest),
    one,
  );
  assert.deepEqual(
    (await f.reviews.prepareReview(f.grant.token, f.proposal)).receipt,
    one,
  );
  assert.equal(
    (
      await pool().query(
        "SELECT count(*) n FROM crm_previews WHERE meeting_id=$1",
        [f.id],
      )
    ).rows[0].n,
    "0",
  );
});
test("AI review save rejects changed source, expired review, disabled permission, missing evidence and stale notes", async () => {
  for (const change of [
    "version",
    "projection",
    "expired",
    "permission",
    "revoke",
    "viewer",
    "deleted",
  ]) {
    const f = await reviewFixture();
    await f.reviews.allowReviews(f.user, f.grant.grantId, true);
    const prepared = await f.reviews.prepareReview(f.grant.token, f.proposal);
    if (change === "version")
      await pool().query("UPDATE meetings SET version=version+1 WHERE id=$1", [
        f.id,
      ]);
    if (change === "projection")
      await pool().query(
        "UPDATE meetings SET title='Changed without version' WHERE id=$1",
        [f.id],
      );
    if (change === "expired")
      await pool().query(
        "UPDATE ai_reviews SET expires_at=now()-interval '1 second' WHERE id=$1",
        [prepared.reviewId],
      );
    if (change === "permission") {
      await f.reviews.allowReviews(f.user, f.grant.grantId, false);
      await f.reviews.allowReviews(f.user, f.grant.grantId, true);
    }
    if (change === "revoke") await ai.revoke(f.user, f.grant.grantId);
    if (change === "viewer")
      await pool().query("UPDATE members SET role='viewer' WHERE user_id=$1", [
        f.user,
      ]);
    if (change === "deleted")
      await f.reviews.deleteReview(f.user, prepared.reviewId);
    await assert.rejects(
      f.reviews.saveReview(f.user, prepared.reviewId, prepared.digest),
      change,
    );
    assert.equal(
      (await pool().query("SELECT notes FROM meetings WHERE id=$1", [f.id]))
        .rows[0].notes,
      null,
    );
  }
  const f = await reviewFixture();
  await f.reviews.allowReviews(f.user, f.grant.grantId, true);
  await assert.rejects(
    f.reviews.prepareReview(f.grant.token, {
      ...f.proposal,
      actions: [{ ...f.proposal.actions[0], evidence: ["missing"] }],
    }),
  );
  await assert.rejects(
    f.reviews.prepareReview(f.grant.token, { ...f.proposal, approved: true }),
  );
  await pool().query("UPDATE meetings SET notes_stale=true WHERE id=$1", [
    f.id,
  ]);
  await assert.rejects(f.reviews.prepareReview(f.grant.token, f.proposal));
});
test("meeting and account cleanup erase pending review content, including rolling-deployment cleanup", async () => {
  const { removeMeeting } = await import("../lib/service"),
    { revokeAiForAccounts, clearAiMeetingReviews } =
      await import("../lib/ai-schema");
  for (const account of [false, true]) {
    const f = await reviewFixture();
    await f.reviews.allowReviews(f.user, f.grant.grantId, true);
    const prepared = await f.reviews.prepareReview(f.grant.token, f.proposal);
    if (account) {
      const db = await pool().connect();
      try {
        await revokeAiForAccounts(db, [f.user]);
      } finally {
        db.release();
      }
    } else await removeMeeting(f.user, f.id);
    assert.equal(
      (
        await pool().query("SELECT payload FROM ai_reviews WHERE id=$1", [
          prepared.reviewId,
        ])
      ).rows[0].payload,
      null,
    );
    await assert.rejects(
      f.reviews.saveReview(f.user, prepared.reviewId, prepared.digest),
    );
  }
  const db = await pool().connect();
  try {
    await db.query("BEGIN");
    await db.query(
      "ALTER TABLE ai_reviews RENAME TO temporarily_unmigrated_ai_reviews",
    );
    await clearAiMeetingReviews(db, [randomUUID()]);
    await revokeAiForAccounts(db, [randomUUID()]);
    await db.query("ROLLBACK");
  } finally {
    db.release();
  }
});

test("review receipt failure rolls back the meeting save and retry uses the same operation", async () => {
  const f = await reviewFixture();
  await f.reviews.allowReviews(f.user, f.grant.grantId, true);
  const prepared = await f.reviews.prepareReview(f.grant.token, f.proposal);
  await pool().query(
    `CREATE FUNCTION fail_review_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.receipt IS NOT NULL THEN RAISE EXCEPTION 'synthetic receipt failure'; END IF; RETURN NEW; END $$`,
  );
  await pool().query(
    "CREATE TRIGGER fail_review_receipt BEFORE UPDATE ON ai_reviews FOR EACH ROW EXECUTE FUNCTION fail_review_receipt()",
  );
  try {
    await assert.rejects(
      f.reviews.saveReview(f.user, prepared.reviewId, prepared.digest),
      /synthetic receipt failure/,
    );
    const record = (
      await pool().query("SELECT notes,version FROM meetings WHERE id=$1", [
        f.id,
      ])
    ).rows[0];
    assert.equal(record.notes, null);
    assert.equal(record.version, 1);
    assert.equal(
      (
        await pool().query(
          "SELECT count(*) n FROM revisions WHERE meeting_id=$1",
          [f.id],
        )
      ).rows[0].n,
      "0",
    );
  } finally {
    await pool().query("DROP TRIGGER fail_review_receipt ON ai_reviews");
    await pool().query("DROP FUNCTION fail_review_receipt()");
  }
  assert.equal(
    (await f.reviews.saveReview(f.user, prepared.reviewId, prepared.digest))
      .version,
    2,
  );
});

test("deleting a creator account clears another editor's pending meeting review", async () => {
  const f = await fixture(),
    reviews = await import("../lib/ai-reviews"),
    { deleteAccount } = await import("../lib/service");
  await pool().query("UPDATE members SET role='owner' WHERE user_id=$1", [
    f.other,
  ]);
  await pool().query("INSERT INTO meeting_grants VALUES($1,$2)", [
    f.id,
    f.other,
  ]);
  const issued = await ai.authorize(f.other, f.input),
    grant = await ai.exchange({ code: issued.code, verifier: f.verifier }),
    source = await ai.read(grant.token, { meetingId: f.id });
  await reviews.allowReviews(f.other, grant.grantId, true);
  const prepared = await reviews.prepareReview(grant.token, {
    operationId: randomUUID(),
    meetingId: f.id,
    version: 1,
    projectionHash: source.projectionHash,
    summary: [{ text: "Other editor draft", evidence: ["segment-1"] }],
    actions: [],
  });
  await deleteAccount(f.user);
  assert.equal(
    (
      await pool().query("SELECT payload FROM ai_reviews WHERE id=$1", [
        prepared.reviewId,
      ])
    ).rows[0].payload,
    null,
  );
  await assert.rejects(
    reviews.saveReview(f.other, prepared.reviewId, prepared.digest),
  );
});

test("review routes separate bearer staging from account-bound source approval and guarded receipt lookup", async () => {
  const f = await reviewFixture(),
    { GET, POST } = await import("../app/api/integrations/ai/[action]/route"),
    { hash, cookieName } = await import("../lib/auth");
  const session = "d".repeat(64);
  await pool().query(
    "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
    [hash(session), f.user],
  );
  const origin = process.env.APP_URL!;
  const call = (
    action: string,
    body?: unknown,
    headers: Record<string, string> = {},
    method = "POST",
  ) =>
    (method === "GET" ? GET : POST)(
      new Request(origin + "/api/integrations/ai/" + action, {
        method,
        headers: {
          origin,
          cookie: cookieName + "=" + session,
          "Content-Type": "application/json",
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      { params: Promise.resolve({ action }) },
    );
  const bearer = { cookie: "", authorization: "Bearer " + f.grant.token };
  assert.equal((await call("review-prepare", f.proposal, bearer)).status, 403);
  assert.equal(
    (
      await call(
        "review-enable",
        { subjectId: f.user, grantId: f.grant.grantId },
        bearer,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await call(
        "review-enable",
        { subjectId: f.user, grantId: f.grant.grantId },
        { origin: "https://evil.invalid" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call("review-enable", {
        subjectId: f.other,
        grantId: f.grant.grantId,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call("review-enable", {
        subjectId: f.user,
        grantId: f.grant.grantId,
      })
    ).status,
    200,
  );
  assert.equal(
    (await (await call("review-status", {}, bearer)).json()).enabled,
    true,
  );
  assert.equal(
    (
      await call(
        "review-prepare",
        { ...f.proposal, large: "x".repeat(66000) },
        bearer,
      )
    ).status,
    413,
  );
  const prepared = await (
    await call("review-prepare", f.proposal, bearer)
  ).json();
  assert.equal(
    (
      await call(
        "review-save",
        {
          subjectId: f.user,
          reviewId: prepared.reviewId,
          digest: prepared.digest,
        },
        bearer,
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await call(
        "review-detail",
        { subjectId: f.user, reviewId: prepared.reviewId },
        { origin: "https://evil.invalid" },
      )
    ).status,
    403,
  );
  const detail = await (
    await call("review-detail", {
      subjectId: f.user,
      reviewId: prepared.reviewId,
    })
  ).json();
  assert.equal(detail.proposal.operationId, f.proposal.operationId);
  assert.equal(
    (
      await call("review-save", {
        subjectId: f.other,
        reviewId: prepared.reviewId,
        digest: prepared.digest,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call("review-save", {
        subjectId: f.user,
        reviewId: prepared.reviewId,
        digest: prepared.digest,
        approved: true,
      })
    ).status,
    400,
  );
  const saved = await (
    await call("review-save", {
      subjectId: f.user,
      reviewId: prepared.reviewId,
      digest: prepared.digest,
    })
  ).json();
  assert.equal(saved.version, 2);
  const receipt = await (
    await call(
      "review-receipt",
      { operationId: f.proposal.operationId },
      bearer,
    )
  ).json();
  assert.deepEqual(receipt.receipt, saved);
  assert.equal(JSON.stringify(receipt).includes("Synthetic summary"), false);
  const listed = await (await call("reviews", undefined, {}, "GET")).json();
  assert.equal(listed.items.length, 1);
  assert.equal(JSON.stringify(listed).includes("Synthetic summary"), false);
  process.env.AI_CONNECTOR_ENABLED = "false";
  try {
    assert.equal(
      (
        await call("review-disable", {
          subjectId: f.user,
          grantId: f.grant.grantId,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call("review-delete", {
          subjectId: f.user,
          reviewId: prepared.reviewId,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call("review-save", {
          subjectId: f.user,
          reviewId: prepared.reviewId,
          digest: prepared.digest,
        })
      ).status,
      404,
    );
  } finally {
    process.env.AI_CONNECTOR_ENABLED = "true";
  }
});

test("grant listing stays available before the review permission column is migrated", async () => {
  const f = await reviewFixture();
  await pool().query(
    "ALTER TABLE ai_grants RENAME COLUMN review_epoch TO temporarily_unmigrated_review_epoch",
  );
  try {
    const rows = await ai.list(f.user);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].reviews_enabled, false);
    assert.equal(rows[0].id, f.grant.grantId);
  } finally {
    await pool().query(
      "ALTER TABLE ai_grants RENAME COLUMN temporarily_unmigrated_review_epoch TO review_epoch",
    );
  }
});

test("remote approval requires its own PKCE grant and saves the exact reviewed proposal once", async () => {
  const approval = await import("../lib/ai-approval"),
    f = await reviewFixture();
  const input = {
    grantId: f.grant.grantId,
    expectedReviewEpoch:
      (
        await pool().query("SELECT review_epoch FROM ai_grants WHERE id=$1", [
          f.grant.grantId,
        ])
      ).rows[0].review_epoch ?? randomUUID(),
    actions: ["approve_meeting_notes"],
    challenge: f.input.challenge,
    expiresInMinutes: 15,
  };
  delete process.env.AI_REMOTE_APPROVAL_ENABLED;
  await assert.rejects(approval.authorizeApproval(f.user, input));
  process.env.AI_REMOTE_APPROVAL_ENABLED = "true";
  await assert.rejects(approval.authorizeApproval(f.user, input));
  await f.reviews.allowReviews(f.user, f.grant.grantId, true);
  input.expectedReviewEpoch = (
    await pool().query("SELECT review_epoch FROM ai_grants WHERE id=$1", [
      f.grant.grantId,
    ])
  ).rows[0].review_epoch;
  await assert.rejects(approval.authorizeApproval(f.other, input));
  await assert.rejects(
    approval.authorizeApproval(f.user, {
      ...input,
      expectedReviewEpoch: randomUUID(),
    }),
  );
  const issued = await approval.authorizeApproval(f.user, input);
  await assert.rejects(
    approval.exchangeApproval({ code: issued.code, verifier: "z".repeat(64) }),
  );
  const permission = await approval.exchangeApproval({
    code: issued.code,
    verifier: f.verifier,
  });
  await assert.rejects(
    approval.exchangeApproval({ code: issued.code, verifier: f.verifier }),
  );
  const prepared = await f.reviews.prepareReview(f.grant.token, f.proposal);
  const save = {
    reviewId: prepared.reviewId,
    digest: prepared.digest,
    confirmed: true,
  };
  await assert.rejects(approval.approveReview(f.grant.token, save));
  await assert.rejects(ai.read(permission.token, { meetingId: f.id }));
  await assert.rejects(
    approval.approveReview(permission.token, {
      ...save,
      digest: "0".repeat(64),
    }),
  );
  const results = await Promise.all([
    approval.approveReview(permission.token, save),
    approval.approveReview(permission.token, save),
  ]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(results[0].version, 2);
  const stored = (
    await pool().query("SELECT * FROM ai_approval_grants WHERE id=$1", [
      issued.approvalId,
    ])
  ).rows[0];
  assert.equal(stored.code_hash, null);
  assert.notEqual(stored.token_hash, permission.token);
  assert.equal(
    (await pool().query("SELECT version FROM meetings WHERE id=$1", [f.id]))
      .rows[0].version,
    2,
  );
  await approval.revokeApproval(f.user, issued.approvalId);
  await assert.rejects(approval.approveReview(permission.token, save));
});

test("approval rejects changed source authority, epoch, expiry and replaced delegation without saving", async () => {
  const approval = await import("../lib/ai-approval");
  process.env.AI_REMOTE_APPROVAL_ENABLED = "true";
  for (const change of [
    "epoch",
    "expiry",
    "source",
    "replacement",
    "membership",
  ]) {
    const f = await reviewFixture();
    await f.reviews.allowReviews(f.user, f.grant.grantId, true);
    const input = {
      grantId: f.grant.grantId,
      expectedReviewEpoch:
        (
          await pool().query("SELECT review_epoch FROM ai_grants WHERE id=$1", [
            f.grant.grantId,
          ])
        ).rows[0].review_epoch ?? randomUUID(),
      actions: ["approve_meeting_notes"],
      challenge: f.input.challenge,
      expiresInMinutes: 15,
    };
    const issued = await approval.authorizeApproval(f.user, input);
    const permission = await approval.exchangeApproval({
      code: issued.code,
      verifier: f.verifier,
    });
    const prepared = await f.reviews.prepareReview(f.grant.token, f.proposal);
    if (change === "epoch")
      await f.reviews.allowReviews(f.user, f.grant.grantId, true);
    if (change === "expiry")
      await pool().query(
        "UPDATE ai_approval_grants SET expires_at=now()-interval '1 second' WHERE id=$1",
        [issued.approvalId],
      );
    if (change === "source")
      await pool().query("UPDATE meetings SET version=version+1 WHERE id=$1", [
        f.id,
      ]);
    if (change === "replacement")
      await approval.authorizeApproval(f.user, input);
    if (change === "membership")
      await pool().query(
        "DELETE FROM members WHERE workspace_id=$1 AND user_id=$2",
        [f.workspace, f.user],
      );
    await assert.rejects(
      approval.approveReview(permission.token, {
        reviewId: prepared.reviewId,
        digest: prepared.digest,
        confirmed: true,
      }),
      change,
    );
    assert.equal(
      (
        await pool().query("SELECT receipt FROM ai_reviews WHERE id=$1", [
          prepared.reviewId,
        ])
      ).rows[0].receipt,
      null,
    );
    assert.equal(
      (await pool().query("SELECT version FROM meetings WHERE id=$1", [f.id]))
        .rows[0].version,
      change === "source" ? 2 : 1,
    );
  }
});

test("approval routes require source-session consent and a distinct bearer for exact review and save", async () => {
  const { GET, POST } =
      await import("../app/api/integrations/ai/[action]/route"),
    { hash, cookieName, token } = await import("../lib/auth"),
    f = await reviewFixture();
  process.env.AI_REMOTE_APPROVAL_ENABLED = "true";
  await f.reviews.allowReviews(f.user, f.grant.grantId, true);
  const session = token(),
    origin = process.env.APP_URL!;
  await pool().query(
    "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
    [hash(session), f.user],
  );
  const call = (
    action: string,
    input?: unknown,
    headers: Record<string, string> = {},
  ) =>
    (input === undefined ? GET : POST)(
      new Request(origin + "/api/integrations/ai/" + action, {
        method: input === undefined ? "GET" : "POST",
        headers: {
          origin,
          cookie: cookieName + "=" + session,
          "Content-Type": "application/json",
          ...headers,
        },
        ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      }),
      { params: Promise.resolve({ action }) },
    );
  const input = {
    subjectId: f.user,
    grantId: f.grant.grantId,
    expectedReviewEpoch:
      (
        await pool().query("SELECT review_epoch FROM ai_grants WHERE id=$1", [
          f.grant.grantId,
        ])
      ).rows[0].review_epoch ?? randomUUID(),
    actions: ["approve_meeting_notes"],
    challenge: f.input.challenge,
    expiresInMinutes: 15,
    confirmed: true,
    acknowledged: true,
  };
  assert.equal(
    (await call("approval-authorize", input, { cookie: "" })).status,
    401,
  );
  assert.equal(
    (
      await call("approval-authorize", input, {
        origin: "https://foreign.invalid",
      })
    ).status,
    403,
  );
  assert.equal(
    (await call("approval-authorize", { ...input, subjectId: f.other })).status,
    409,
  );
  assert.equal(
    (await call("approval-authorize", { ...input, acknowledged: false }))
      .status,
    400,
  );
  const authorized = await call("approval-authorize", input);
  assert.equal(authorized.status, 201);
  const issued = await authorized.json();
  const exchanged = await call(
    "approval-exchange",
    { code: issued.code, verifier: f.verifier },
    { cookie: "" },
  );
  assert.equal(exchanged.status, 200);
  const permission = await exchanged.json();
  const prepared = await f.reviews.prepareReview(f.grant.token, f.proposal),
    save = {
      reviewId: prepared.reviewId,
      digest: prepared.digest,
      confirmed: true,
    };
  assert.equal(
    (
      await call("approval-save", save, {
        cookie: "",
        authorization: "Bearer " + f.grant.token,
      })
    ).status,
    401,
  );
  const bearer = { cookie: "", authorization: "Bearer " + permission.token };
  const detail = await call(
    "approval-review",
    { reviewId: prepared.reviewId },
    bearer,
  );
  assert.equal(detail.status, 200);
  const value = await detail.json();
  assert.equal(value.digest, prepared.digest);
  assert.equal(value.meetingId, f.id);
  assert.deepEqual(value.proposal, f.proposal);
  const saved = await call("approval-save", save, bearer);
  assert.equal(saved.status, 200);
  const receipt = await saved.json();
  assert.equal(receipt.version, 2);
  assert.deepEqual(
    await (await call("approval-save", save, bearer)).json(),
    receipt,
  );
  const listed = await call("approval-grants");
  assert.equal(listed.status, 200);
  const text = await listed.text();
  assert.ok(text.includes(issued.approvalId));
  assert.ok(!text.includes(permission.token));
  assert.ok(!text.includes("token_hash"));
  delete process.env.AI_REMOTE_APPROVAL_ENABLED;
  assert.equal((await call("approval-save", save, bearer)).status, 404);
  assert.equal(
    (
      await call("approval-revoke", {
        subjectId: f.user,
        approvalId: issued.approvalId,
      })
    ).status,
    200,
  );
  process.env.AI_REMOTE_APPROVAL_ENABLED = "true";
  assert.equal(
    (await call("approval-review", { reviewId: prepared.reviewId }, bearer))
      .status,
    401,
  );
});
