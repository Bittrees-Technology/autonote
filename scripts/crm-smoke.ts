// Local, synthetic cross-product verification. Never targets public services.
import assert from "node:assert/strict";
import { Wallet } from "ethers";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import pg from "pg";
const an = "http://127.0.0.1:3050",
  cr = "http://127.0.0.1:3040";
const env = parseEnv(
  readFileSync(new URL("../../crm/.env.local", import.meta.url), "utf8"),
);
assert.equal(process.env.APP_URL, an);
assert.equal(process.env.CRM_URL, cr);
assert.equal(env.APP_URL, cr);
assert.equal(env.AUTONOTE_URL, an);
assert.ok(env.DATABASE_URL);
assert.equal(new URL(env.DATABASE_URL).hostname, "127.0.0.1");
function client(origin: string) {
  const cookies: Record<string, string> = {};
  return async (
    path: string,
    body?: unknown,
    method = body ? "POST" : "GET",
  ) => {
    const r = await fetch(origin + "/api/" + path, {
      method,
      redirect: "manual",
      headers: {
        origin,
        "content-type": "application/json",
        cookie: Object.entries(cookies)
          .map(([k, v]) => k + "=" + v)
          .join("; "),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of r.headers.getSetCookie()) {
      const [name, ...value] = c.split(";")[0].split("=");
      cookies[name] = value.join("=");
    }
    if (r.status === 303) return { redirect: r.headers.get("location") };
    const d = await r.json();
    assert.ok(r.ok, path + ": " + (d.error || r.status));
    return d;
  };
}
const a = client(an),
  c = client(cr),
  wallet = Wallet.createRandom();
let accountA = false,
  userC = "",
  workspaceC = "";
try {
  for (const call of [a, c]) {
    const challenge = await call("auth/challenge", {
      kind: "ethereum",
      value: wallet.address,
    });
    await call("auth/verify", {
      id: challenge.id,
      proof: await wallet.signMessage(challenge.message),
    });
    if (call === a) accountA = true;
  }
  const cm = await c("me");
  userC = cm.user.id;
  workspaceC = cm.workspaces[0].id;
  const target = await c(`workspaces/${workspaceC}/records`, {
    kind: "organizations",
    data: { name: "Synthetic AutoNote integration" },
  });
  const pending = new URL((await a("integrations/crm/start", {})).url);
  assert.equal(pending.origin, cr);
  const authorization = new URL(
    (
      await c("integrations/autonote/authorize", {
        workspaceId: workspaceC,
        targetId: target.id,
        state: pending.searchParams.get("state"),
        challenge: pending.searchParams.get("challenge"),
      })
    ).url,
  );
  assert.equal(authorization.origin, an);
  assert.equal(
    (await a(authorization.pathname.slice(5) + authorization.search)).redirect,
    an + "/?connected=crm",
  );
  const connection = (await a("integrations/crm"))[0];
  assert.equal(connection.target_name, "Synthetic AutoNote integration");
  const ws = await a("workspaces", { name: "Synthetic second workspace" });
  const meetingId = randomUUID();
  await a("device/meetings", {
    id: meetingId,
    workspaceId: ws.id,
    title: "Synthetic linked meeting",
    language: "en",
    consent: true,
    duration: 8,
    transcript: [
      {
        id: "s1",
        start: 0,
        end: 8,
        speaker: "Unlabeled speaker",
        text: "We agreed to keep the release free. Maya will prepare the checklist.",
      },
    ],
  });
  const linked = await a("me?meeting=" + meetingId);
  assert.equal(linked.selected, ws.id);
  let meeting = linked.meetings.find((m: any) => m.id === meetingId);
  const notes = meeting.notes;
  notes.actions[0].status = "accepted";
  await a(
    "meetings/" + meetingId,
    { version: meeting.version, notes },
    "PATCH",
  );
  meeting = (await a("me?meeting=" + meetingId)).meetings.find(
    (m: any) => m.id === meetingId,
  );
  const preview = await a("integrations/crm/preview", {
    connectionId: connection.id,
    meetingId,
    version: meeting.version,
    summary: "Reviewed synthetic summary",
    actionIds: [notes.actions[0].id],
  });
  const result = await a("integrations/crm/publish", { token: preview.token });
  assert.equal(result.items.length, 2);
  assert.deepEqual(
    await a("integrations/crm/publish", { token: preview.token }),
    result,
  );
  const records = (await c("workspaces/" + workspaceC)).records;
  assert.equal(records.length, 3);
  for (const item of result.items) {
    const record = records.find((r: any) => r.id === item.recordId);
    assert.equal(record.data.organizationId, target.id);
    assert.ok(
      JSON.stringify(record.data).includes(an + "/?meeting=" + meetingId),
    );
  }
  await a("integrations/crm/disconnect", { id: connection.id });
  assert.equal((await a("integrations/crm")).length, 0);
  console.log(
    "PASS: cross-product SIWE, PKCE connection, private destination, second-workspace deep link, reviewed summary + accepted action, idempotent publish, source links and revocation.",
  );
} finally {
  if (accountA) await a("account", { confirm: "DELETE" }, "DELETE");
  if (userC) {
    const db = new pg.Client({ connectionString: env.DATABASE_URL });
    await db.connect();
    try {
      await db.query("BEGIN");
      assert.equal(
        (
          await db.query("SELECT user_id FROM identities WHERE value=$1", [
            wallet.address.toLowerCase(),
          ])
        ).rows[0]?.user_id,
        userC,
      );
      await db.query("DELETE FROM autonote_receipts WHERE user_id=$1", [userC]);
      await db.query("DELETE FROM autonote_grants WHERE user_id=$1", [userC]);
      await db.query("DELETE FROM audit WHERE workspace_id=$1", [workspaceC]);
      await db.query("DELETE FROM records WHERE workspace_id=$1", [workspaceC]);
      await db.query("DELETE FROM members WHERE user_id=$1", [userC]);
      await db.query("DELETE FROM workspaces WHERE id=$1", [workspaceC]);
      await db.query("DELETE FROM sessions WHERE user_id=$1", [userC]);
      await db.query("DELETE FROM challenges WHERE user_id=$1", [userC]);
      await db.query("DELETE FROM identities WHERE user_id=$1", [userC]);
      await db.query("DELETE FROM users WHERE id=$1", [userC]);
      await db.query("COMMIT");
    } finally {
      await db.end();
    }
  }
  console.log("Synthetic integration accounts cleaned up.");
}
