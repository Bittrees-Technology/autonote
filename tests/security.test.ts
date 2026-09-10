import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Wallet } from "ethers";
import { pool, schema } from "../lib/db";
import {
  startChallenge,
  verifyChallenge,
  currentUser,
  checkOrigin,
  hash,
  cookieName,
} from "../lib/auth";
import { completeRecovery } from "../lib/recovery";
import {
  meeting,
  snapshot,
  editMeeting,
  removeMeeting,
  workspaceAction,
  acceptInvite,
  deleteAccount,
} from "../lib/service";
import { demoMeeting } from "../lib/demo";
import { exportMeeting } from "../lib/export";
import { notesSchema, validateEvidence } from "../lib/model";
const origin = process.env.APP_URL!;
const req = (cookies = "") =>
  new Request(origin + "/api/test", {
    method: "POST",
    headers: { origin, cookie: cookies },
  });
const pair = (s: string) => s.split(";")[0];
async function login(
  wallet = Wallet.createRandom(),
  cookies = "",
  link = false,
) {
  const c = await startChallenge(req(cookies), {
    kind: "ethereum",
    value: wallet.address,
    link,
  });
  const proof = await wallet.signMessage(c.body.message!);
  const r = await verifyChallenge(
    req([pair(c.cookie), cookies].filter(Boolean).join("; ")),
    { id: c.body.id, proof, recover: link },
  );
  return { c, proof, r, wallet, session: pair(r.cookie) };
}
let a: Awaited<ReturnType<typeof login>>,
  b: Awaited<ReturnType<typeof login>>,
  owner: string,
  other: string,
  ws: string,
  mid: string;
before(async () => {
  if (!process.env.DATABASE_URL?.endsWith("/autonote_test"))
    throw new Error("Dedicated test database required");
  await pool().query(schema);
  await pool().query("TRUNCATE users CASCADE");
  await pool().query("TRUNCATE rate_limits");
  a = await login();
  b = await login();
  owner = (await currentUser(req(a.session)))!.id;
  other = (await currentUser(req(b.session)))!.id;
  ws = (
    await pool().query("SELECT workspace_id FROM members WHERE user_id=$1", [
      owner,
    ])
  ).rows[0].workspace_id;
  mid = randomUUID();
  await pool().query(
    "INSERT INTO meetings(id,workspace_id,creator_id,title,status,transcript,notes) VALUES($1,$2,$3,'Private sample','ready',$4,$5)",
    [mid, ws, owner, JSON.stringify(demoMeeting.transcript), demoMeeting.notes],
  );
});
after(() => pool().end());
test("SIWE challenges are single-use and browser-bound", async () => {
  await assert.rejects(
    verifyChallenge(req(pair(a.c.cookie)), { id: a.c.body.id, proof: a.proof }),
  );
  const w = Wallet.createRandom();
  const c = await startChallenge(req(), { kind: "ethereum", value: w.address });
  await assert.rejects(
    verifyChallenge(req(), {
      id: c.body.id,
      proof: await w.signMessage(c.body.message!),
    }),
  );
});
test("origin validation rejects cross-site changes", () =>
  assert.throws(() =>
    checkOrigin(
      new Request(origin, { headers: { origin: "https://attacker.invalid" } }),
    ),
  ));
test("private meetings are hidden even from workspace owners", async () => {
  await pool().query("INSERT INTO members VALUES($1,$2,'owner')", [ws, other]);
  await assert.rejects(meeting(other, mid));
  assert.equal((await snapshot(other, ws)).meetings.length, 0);
});
test("explicit recipient access works and revocation removes it", async () => {
  await editMeeting(owner, mid, { version: 1, grantIds: [other] });
  assert.equal((await meeting(other, mid)).id, mid);
  await editMeeting(owner, mid, { version: 2, grantIds: [] });
  await assert.rejects(meeting(other, mid));
});
test("workspace-shared viewer cannot edit or delete", async () => {
  await pool().query(
    "UPDATE members SET role='viewer' WHERE workspace_id=$1 AND user_id=$2",
    [ws, other],
  );
  await editMeeting(owner, mid, { version: 3, visibility: "workspace" });
  assert.equal((await meeting(other, mid)).id, mid);
  await assert.rejects(
    editMeeting(other, mid, { version: 4, title: "Unauthorized" }),
  );
  await assert.rejects(removeMeeting(other, mid));
});
test("stale writes rejected and transcript edits preserve evidence timing", async () => {
  await assert.rejects(editMeeting(owner, mid, { version: 1, title: "Stale" }));
  const transcript = structuredClone(demoMeeting.transcript);
  transcript[0].start = 100;
  await assert.rejects(editMeeting(owner, mid, { version: 4, transcript }));
  transcript[0].start = 0;
  transcript[0].text = "Corrected text";
  await editMeeting(owner, mid, { version: 4, transcript });
  assert.equal((await meeting(owner, mid)).notes_stale, true);
});
test("unknown citations fail validation", () => {
  const n = structuredClone(demoMeeting.notes!);
  n.actions[0].evidence = ["missing"];
  assert.throws(() =>
    validateEvidence(notesSchema.parse(n), demoMeeting.transcript),
  );
});
test("invites require the matching verified email", async () => {
  const d = await workspaceAction(owner, ws, {
    action: "invite",
    email: "invited@example.org",
    role: "editor",
  });
  const raw = new URL(d.inviteUrl!).searchParams.get("invite")!;
  await assert.rejects(acceptInvite(other, raw));
  await pool().query(
    "INSERT INTO identities VALUES('email','invited@example.org',$1,now())",
    [other],
  );
  await acceptInvite(other, raw);
  await assert.rejects(acceptInvite(other, raw));
  assert.equal(
    (
      await pool().query(
        "SELECT role FROM members WHERE workspace_id=$1 AND user_id=$2",
        [ws, other],
      )
    ).rows[0].role,
    "viewer",
  );
});
test("last workspace owner cannot be removed", async () => {
  await assert.rejects(
    workspaceAction(owner, ws, {
      action: "member",
      userId: owner,
      role: "remove",
    }),
  );
});
test("exports include notes, evidence and valid subtitle timing", () => {
  assert.match(exportMeeting(demoMeeting, "srt"), /00:00:18,000/);
  assert.match(exportMeeting(demoMeeting, "vtt"), /^WEBVTT/);
  assert.equal(
    JSON.parse(exportMeeting(demoMeeting, "json")).transcript.length,
    5,
  );
  assert.match(exportMeeting(demoMeeting, "md"), /No date stated/);
});
test("deletion hides the meeting and cancels leased work immediately", async () => {
  await pool().query(
    "INSERT INTO jobs(meeting_id,generation,state,lease_token) VALUES($1,5,'running',$2)",
    [mid, randomUUID()],
  );
  await removeMeeting(owner, mid);
  await assert.rejects(meeting(owner, mid));
  const j = (
    await pool().query("SELECT * FROM jobs WHERE meeting_id=$1", [mid])
  ).rows[0];
  assert.equal(j.state, "cancelled");
  assert.equal(j.lease_token, null);
});
test("linking separate accounts requires fresh proof of both identities", async () => {
  const d = await login(b.wallet, a.session, true);
  const recovery = (d.r.body as any).recovery;
  assert.ok(recovery);
  await assert.rejects(completeRecovery(req(a.session), recovery.token));
  const c = await startChallenge(req(a.session), {
    kind: "ethereum",
    value: a.wallet.address,
    link: true,
    recoveryToken: recovery.token,
  });
  await verifyChallenge(req(a.session + "; " + pair(c.cookie)), {
    id: c.body.id,
    proof: await a.wallet.signMessage(c.body.message!),
  });
  const merged = await completeRecovery(req(a.session), recovery.token);
  assert.equal((await currentUser(req(pair(merged.cookie))))!.id, owner);
  await assert.rejects(currentUser(req(b.session)));
  assert.equal(
    (
      await pool().query("SELECT user_id FROM identities WHERE value=$1", [
        b.wallet.address.toLowerCase(),
      ])
    ).rows[0].user_id,
    owner,
  );
});

test("email codes authenticate once and expire after five failed proofs", async () => {
  const lines: string[] = [];
  const original = console.info;
  console.info = (...v: unknown[]) => {
    lines.push(v.join(" "));
  };
  try {
    const c = await startChallenge(req(), {
      kind: "email",
      value: "codes@example.org",
    });
    const code = lines.at(-1)!.match(/: (\d{8})$/)![1];
    const signed = await verifyChallenge(req(pair(c.cookie)), {
      id: c.body.id,
      proof: code,
    });
    assert.ok(await currentUser(req(pair(signed.cookie))));
    await assert.rejects(
      verifyChallenge(req(pair(c.cookie)), { id: c.body.id, proof: code }),
    );
    const failed = await startChallenge(req(), {
      kind: "email",
      value: "attempts@example.org",
    });
    const valid = lines.at(-1)!.match(/: (\d{8})$/)![1];
    for (let i = 0; i < 5; i++)
      await assert.rejects(
        verifyChallenge(req(pair(failed.cookie)), {
          id: failed.body.id,
          proof: "00000000",
        }),
      );
    await assert.rejects(
      verifyChallenge(req(pair(failed.cookie)), {
        id: failed.body.id,
        proof: valid,
      }),
    );
  } finally {
    console.info = original;
  }
});

test("account deletion revokes identities, sessions, and owned content", async () => {
  const account = await login();
  const id = (await currentUser(req(account.session)))!.id;
  await deleteAccount(id);
  await assert.rejects(currentUser(req(account.session)));
  assert.equal(
    (await pool().query("SELECT 1 FROM identities WHERE user_id=$1", [id]))
      .rowCount,
    0,
  );
  assert.equal(
    (await pool().query("SELECT name FROM users WHERE id=$1", [id])).rows[0]
      .name,
    "Deleted account",
  );
});

test("Google connection is session-bound, single-use and private", async () => {
  const google = await import("../lib/google");
  const account = await login(),
    outsider = await login();
  const uid = (await currentUser(req(account.session)))!.id;
  const otherId = (await currentUser(req(outsider.session)))!.id;
  process.env.GOOGLE_CLIENT_ID = "synthetic-client";
  process.env.GOOGLE_CLIENT_SECRET = "synthetic-secret";
  const fetchOriginal = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input, init) => {
    calls++;
    assert.equal(String(input), "https://oauth2.googleapis.com/token");
    assert.equal(
      new URLSearchParams(init!.body as URLSearchParams).get("grant_type"),
      "authorization_code",
    );
    return Response.json({
      refresh_token: "synthetic-refresh",
      scope: "https://www.googleapis.com/auth/calendar.events.readonly",
    });
  };
  try {
    const start = await google.start(req(account.session), uid);
    const url = new URL(start.url),
      state = url.searchParams.get("state")!;
    assert.equal(
      url.searchParams.get("scope"),
      "https://www.googleapis.com/auth/calendar.events.readonly",
    );
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    await assert.rejects(
      google.callback(req(outsider.session), uid, "synthetic-code", state),
    );
    await assert.rejects(
      google.callback(req(outsider.session), otherId, "synthetic-code", state),
    );
    assert.equal(calls, 0);
    await google.callback(req(account.session), uid, "synthetic-code", state);
    await assert.rejects(
      google.callback(req(account.session), uid, "synthetic-code", state),
    );
    assert.equal(calls, 1);
    assert.equal((await google.status(uid)).connected, true);
    assert.equal((await google.status(otherId)).connected, false);
    const row = (
      await pool().query(
        "SELECT refresh_ciphertext FROM google_connections WHERE user_id=$1",
        [uid],
      )
    ).rows[0];
    assert.ok(!row.refresh_ciphertext.includes("synthetic-refresh"));
    await deleteAccount(uid);
    assert.equal((await google.status(uid)).connected, false);
  } finally {
    globalThis.fetch = fetchOriginal;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  }
});

test("CRM publication requires an accepted selection and unchanged reviewed meeting", async () => {
  const crm = await import("../lib/crm"),
    { encrypt } = await import("../lib/secrets");
  const account = await login(),
    outsider = await login();
  const uid = (await currentUser(req(account.session)))!.id,
    otherId = (await currentUser(req(outsider.session)))!.id;
  const ws = (
    await pool().query("SELECT workspace_id FROM members WHERE user_id=$1", [
      uid,
    ])
  ).rows[0].workspace_id;
  const meetingId = randomUUID(),
    connectionId = randomUUID(),
    notes = structuredClone(demoMeeting.notes!);
  notes.actions[0].status = "accepted";
  await pool().query(
    "INSERT INTO meetings(id,workspace_id,creator_id,title,status,notes) VALUES($1,$2,$3,'Synthetic CRM meeting','ready',$4)",
    [meetingId, ws, uid, notes],
  );
  await pool().query(
    "INSERT INTO crm_connections(id,user_id,token_ciphertext,workspace_name,target_name,expires_at) VALUES($1,$2,$3,'Synthetic workspace','Synthetic target',now()+interval '1 day')",
    [connectionId, uid, encrypt("synthetic-bearer")],
  );
  const selection = {
    connectionId,
    meetingId,
    version: 1,
    summary: "Reviewed summary",
    actionIds: [notes.actions[0].id],
  };
  await assert.rejects(crm.preview(otherId, selection));
  await assert.rejects(
    crm.preview(uid, { ...selection, actionIds: ["not-accepted"] }),
  );
  const preview = await crm.preview(uid, selection);
  const fetchOriginal = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_input, init) => {
    calls++;
    assert.equal(JSON.parse(init!.body as string).summary, "Reviewed summary");
    return Response.json({ items: [] });
  };
  try {
    await assert.rejects(crm.publish(otherId, preview.token));
    await editMeeting(uid, meetingId, { version: 1, title: "Changed title" });
    await assert.rejects(crm.publish(uid, preview.token));
    assert.equal(calls, 0);
    const fresh = await crm.preview(uid, { ...selection, version: 2 });
    await crm.publish(uid, fresh.token);
    await crm.publish(uid, fresh.token);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test("device saves are private, idempotent, bounded, and deleted without a worker", async () => {
  const { saveDeviceMeeting } = await import("../lib/device-service");
  const account = await login(),
    outsider = await login();
  const uid = (await currentUser(req(account.session)))!.id;
  const oid = (await currentUser(req(outsider.session)))!.id;
  const workspaceId = (
    await pool().query("SELECT workspace_id FROM members WHERE user_id=$1", [
      uid,
    ])
  ).rows[0].workspace_id;
  await pool().query("INSERT INTO members VALUES($1,$2,'viewer')", [
    workspaceId,
    oid,
  ]);
  const data = {
    id: randomUUID(),
    workspaceId,
    title: "Fictional device meeting",
    language: "en",
    consent: true,
    duration: 12,
    transcript: [
      {
        id: "s1",
        start: 0,
        end: 12,
        speaker: "Unlabeled speaker",
        text: "Maya will prepare the checklist. We agreed to keep the release free.",
      },
    ],
  };
  await assert.rejects(saveDeviceMeeting(oid, data));
  await assert.rejects(saveDeviceMeeting(uid, { ...data, duration: 1801 }));
  await assert.rejects(
    saveDeviceMeeting(uid, {
      ...data,
      transcript: [{ ...data.transcript[0], end: 20 }],
    }),
  );
  await assert.rejects(
    saveDeviceMeeting(uid, {
      ...data,
      transcript: [data.transcript[0], data.transcript[0]],
    }),
  );
  const saved = await saveDeviceMeeting(uid, data);
  assert.equal(saved.id, data.id);
  assert.equal((await saveDeviceMeeting(uid, data)).id, data.id);
  assert.equal(
    (
      await pool().query(
        "SELECT count(*)::int n FROM usage WHERE meeting_id=$1",
        [data.id],
      )
    ).rows[0].n,
    1,
  );
  await assert.rejects(meeting(oid, data.id));
  await assert.rejects(
    saveDeviceMeeting(uid, { ...data, title: "Changed retry" }),
  );
  const value = await meeting(uid, data.id);
  assert.equal(value.processing_mode, "device");
  assert.equal(value.recording_deleted, true);
  assert.equal(value.notes?.actions[0].owner, null);
  assert.equal(value.notes?.decisions.length, 1);
  assert.equal(
    (
      await pool().query("SELECT object_key FROM meetings WHERE id=$1", [
        data.id,
      ])
    ).rows[0].object_key,
    null,
  );
  assert.equal(
    (await pool().query("SELECT 1 FROM jobs WHERE meeting_id=$1", [data.id]))
      .rowCount,
    0,
  );
  await editMeeting(uid, data.id, { version: 1, grantIds: [oid] });
  assert.equal((await meeting(oid, data.id)).id, data.id);
  await removeMeeting(uid, data.id);
  await assert.rejects(saveDeviceMeeting(uid, data));
  const deleted = (
    await pool().query("SELECT transcript,notes FROM meetings WHERE id=$1", [
      data.id,
    ])
  ).rows[0];
  assert.deepEqual(deleted.transcript, []);
  assert.equal(deleted.notes, null);
  assert.equal(
    (
      await pool().query("SELECT 1 FROM revisions WHERE meeting_id=$1", [
        data.id,
      ])
    ).rowCount,
    0,
  );
});

test("free email budget rejects excess sends without consuming the monthly allowance", async () => {
  const { reserveEmail } = await import("../lib/maintenance");
  const original = process.env.PROCESSING_MODE;
  process.env.PROCESSING_MODE = "device";
  const day = new Date().toISOString().slice(0, 10),
    month = day.slice(0, 7);
  try {
    await pool().query("DELETE FROM email_budget");
    await pool().query("INSERT INTO email_budget VALUES($1,49),($2,100)", [
      day,
      month,
    ]);
    await reserveEmail();
    await assert.rejects(reserveEmail());
    assert.equal(
      (
        await pool().query("SELECT hits FROM email_budget WHERE period=$1", [
          month,
        ])
      ).rows[0].hits,
      101,
    );
    assert.equal(
      (
        await pool().query("SELECT hits FROM email_budget WHERE period=$1", [
          day,
        ])
      ).rows[0].hits,
      50,
    );
  } finally {
    if (original === undefined) delete process.env.PROCESSING_MODE;
    else process.env.PROCESSING_MODE = original;
    await pool().query("DELETE FROM email_budget");
  }
});
