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
