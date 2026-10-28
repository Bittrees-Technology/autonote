import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { pool, schema, transaction } from "../lib/db";
import {
  nativeWorkflowSchema,
  nativeWorkflowSchemaReady,
} from "../lib/native-workflow-schema";
import { POST } from "../app/api/roles/workflow-authority/route";
import { canonical } from "../shared/signed-action.mjs";
import {
  nativeWorkflowEndpoint,
  nativeWorkflowRequestMessage,
  nativeWorkflowScopeId,
  verifyNativeWorkflowDecision,
} from "../shared/native-workflow-authority.mjs";
import { PERSONAL_WORKFLOW_ENDPOINT } from "../shared/personal-workflow-authority.mjs";

const roles = generateKeyPairSync("ed25519"),
  source = generateKeyPairSync("ed25519");
const wallet = "0x" + "a".repeat(40),
  user = randomUUID(),
  owner = randomUUID(),
  workspace = randomUUID();
const isolated = "native_workflow_" + randomUUID().replaceAll("-", "");
const originalURL = process.env.DATABASE_URL!;
function packet(
  action = "list",
  scopeId: string | null = null,
  overrides: Record<string, unknown> = {},
) {
  const now = Date.now();
  const request = {
    version: 1,
    issuer: "https://roles.bittrees.org",
    audience: nativeWorkflowEndpoint("autonote"),
    project: "autonote",
    workflowRequest: {
      version: 1,
      source: "workflow.bittrees.org",
      audience: PERSONAL_WORKFLOW_ENDPOINT,
      identity: { kind: "wallet", value: wallet },
      project: "autonote",
      action,
      scopeId,
      workflowId: ["list", "create"].includes(action) ? null : "own-workflow",
      operationId: randomUUID(),
      parametersDigest: "b".repeat(64),
      issuedAt: now,
      requestId: randomUUID(),
    },
    policyDigest: "c".repeat(64),
    requestId: randomUUID(),
    issuedAt: now,
    expiresAt: now + 5000,
    ...overrides,
  };
  return {
    request,
    signature: sign(
      null,
      Buffer.from(nativeWorkflowRequestMessage(request)),
      roles.privateKey,
    ).toString("base64"),
  };
}
const send = (p = packet(), url = nativeWorkflowEndpoint("autonote")) =>
  POST(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(p),
    }),
  );
async function decision(p = packet()) {
  const response = await send(p);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const envelope = await response.json();
  return verifyNativeWorkflowDecision(
    envelope,
    p.request,
    source.publicKey.export({ type: "spki", format: "pem" }),
  );
}
before(async () => {
  const url = new URL(originalURL);
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.pathname !== "/autonote_test"
  )
    throw Error("Dedicated local test database required");
  const { Client } = await import("pg");
  const admin = new Client({ connectionString: originalURL });
  await admin.connect();
  try {
    await admin.query(`CREATE SCHEMA ${isolated}`);
  } finally {
    await admin.end();
  }
  url.searchParams.set("options", "-csearch_path=" + isolated);
  process.env.DATABASE_URL = url.toString();
  Object.assign(process.env, {
    ROLES_ECOSYSTEM_DECISION_PUBLIC_KEY: roles.publicKey.export({
      type: "spki",
      format: "pem",
    }),
    ROLES_ECOSYSTEM_REQUEST_PRIVATE_KEY: source.privateKey.export({
      type: "pkcs8",
      format: "pem",
    }),
    ROLES_FEED_SUBJECT_SECRET: "synthetic-native-workflow-subject-secret-only",
  });
  await pool().query(schema);
  await pool().query(schema);
  await pool().query(
    "INSERT INTO users(id,name) VALUES($1,'Private attendee'),($2,'Private owner')",
    [user, owner],
  );
  await pool().query(
    "INSERT INTO identities(kind,value,user_id) VALUES('ethereum',$1,$2)",
    [wallet, user],
  );
  await pool().query(
    "INSERT INTO workspaces(id,name) VALUES($1,'Secret workspace name')",
    [workspace],
  );
  await pool().query(
    "INSERT INTO members(workspace_id,user_id,role) VALUES($1,$2,'viewer'),($1,$3,'owner')",
    [workspace, user, owner],
  );
});
after(async () => {
  await pool().query(`DROP SCHEMA ${isolated} CASCADE`);
  await pool().end();
  process.env.DATABASE_URL = originalURL;
});

test("signed current subject-only eligibility has opaque provenance and exact scope filtering", async () => {
  const d = await decision();
  assert.equal(d.scopes.length, 1);
  const s = d.scopes[0];
  assert.equal(s.roleId, "workspace.viewer");
  assert.equal(s.id, nativeWorkflowScopeId("autonote", d.identity, s));
  assert.equal(
    s.restrictionsDigest,
    createHash("sha256").update(canonical(null)).digest("hex"),
  );
  for (const secret of [
    workspace,
    user,
    owner,
    "Private attendee",
    "Private owner",
    "Secret workspace name",
  ])
    assert.equal(JSON.stringify(d).includes(secret), false);
  assert.equal(d.grantsSourceAuthority, false);
  assert.equal(d.readOnly, true);
  assert.ok(d.expiresAt - d.checkedAt <= 5000);
  assert.equal((await decision(packet("create", s.id))).scopes.length, 1);
  assert.equal(
    (await decision(packet("execute", "scope:" + "0".repeat(64)))).scopes
      .length,
    0,
  );
});
test("anonymous, tampered, expired, wrong project/audience/host, oversized and extra-field requests fail closed", async () => {
  assert.equal(
    (
      await POST(
        new Request(nativeWorkflowEndpoint("autonote"), {
          method: "POST",
          body: "{}",
        }),
      )
    ).status,
    403,
  );
  const changed = packet();
  changed.request.workflowRequest.parametersDigest = "d".repeat(64);
  assert.equal((await send(changed)).status, 403);
  for (const change of [
    { expiresAt: Date.now() - 1 },
    { project: "crm" },
    { audience: nativeWorkflowEndpoint("crm") },
    { extra: true },
  ])
    assert.equal((await send(packet("list", null, change))).status, 403);
  assert.equal(
    (
      await send(
        packet(),
        "https://attacker.invalid/api/roles/workflow-authority",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await POST(
        new Request(nativeWorkflowEndpoint("autonote"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: " ".repeat(16385),
        }),
      )
    ).status,
    403,
  );
});
test("durable replay claim denies sequential and concurrent replay", async () => {
  const p = packet();
  assert.equal((await send(p)).status, 200);
  const replay = await send(p);
  assert.equal(replay.status, 409);
  assert.equal(replay.headers.get("cache-control"), "private, no-store");
  assert.equal(replay.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.deepEqual(await replay.json(), {
    error: "Native workflow verification unavailable.",
  });
  const concurrent = packet();
  const statuses = await Promise.all(
    [send(concurrent), send(concurrent)].map(async (r) => (await r).status),
  );
  assert.deepEqual(statuses.sort(), [200, 409]);
  const forged = { ...p, signature: "invalid" };
  assert.equal((await send(forged)).status, 403);
  const expired = packet("list", null, {
    requestId: p.request.requestId,
    issuedAt: Date.now() - 6000,
    expiresAt: Date.now() - 1000,
  });
  assert.equal((await send(expired)).status, 403);
});
test("role changes and revoke/recreate never revive an old scope", async () => {
  const old = (await decision()).scopes[0];
  await pool().query(
    "UPDATE members SET role='editor' WHERE workspace_id=$1 AND user_id=$2",
    [workspace, user],
  );
  const changed = (await decision()).scopes[0];
  assert.notEqual(changed.membershipId, old.membershipId);
  await pool().query(
    "DELETE FROM members WHERE workspace_id=$1 AND user_id=$2",
    [workspace, user],
  );
  assert.equal((await decision(packet("manage", changed.id))).scopes.length, 0);
  await pool().query(
    "INSERT INTO members(workspace_id,user_id,role) VALUES($1,$2,'editor')",
    [workspace, user],
  );
  const recreated = (await decision()).scopes[0];
  assert.notEqual(recreated.membershipId, changed.membershipId);
  assert.equal(
    (await decision(packet("execute", changed.id))).scopes.length,
    0,
  );
});
test("ownership transfer away and back invalidates scopes of unchanged members", async () => {
  const extra = randomUUID();
  await pool().query("INSERT INTO users(id,name) VALUES($1,'Other owner')", [
    extra,
  ]);
  const old = (await decision()).scopes[0];
  await transaction(async (db) => {
    await db.query(
      "UPDATE members SET role='editor' WHERE workspace_id=$1 AND user_id=$2",
      [workspace, owner],
    );
    await db.query(
      "INSERT INTO members(workspace_id,user_id,role) VALUES($1,$2,'owner')",
      [workspace, extra],
    );
  });
  const transferred = (await decision()).scopes[0];
  assert.notEqual(transferred.membershipId, old.membershipId);
  await transaction(async (db) => {
    await db.query("DELETE FROM members WHERE workspace_id=$1 AND user_id=$2", [
      workspace,
      extra,
    ]);
    await db.query(
      "UPDATE members SET role='owner' WHERE workspace_id=$1 AND user_id=$2",
      [workspace, owner],
    );
  });
  const returned = (await decision()).scopes[0];
  assert.notEqual(returned.membershipId, old.membershipId);
  assert.equal((await decision(packet("execute", old.id))).scopes.length, 0);
});
test("no-op, repeat migration and rolled-back role changes preserve current generation", async () => {
  const old = (await decision()).scopes[0];
  await pool().query(nativeWorkflowSchema);
  await pool().query(
    "UPDATE members SET role=role,authority_generation=pg_catalog.gen_random_uuid() WHERE workspace_id=$1 AND user_id=$2",
    [workspace, user],
  );
  await assert.rejects(
    transaction(async (db) => {
      await db.query(
        "UPDATE members SET role='viewer' WHERE workspace_id=$1 AND user_id=$2",
        [workspace, user],
      );
      throw Error("rollback");
    }),
  );
  assert.equal((await decision()).scopes[0].id, old.id);
});
test("removed, reassigned, merged identities and email cannot inherit linked wallet membership", async () => {
  // Schema verified_at is NOT NULL; removal/reassignment/merge are the native revocation paths.
  const old = (await decision()).scopes[0];
  await pool().query(
    "DELETE FROM identities WHERE kind='ethereum' AND value=$1",
    [wallet],
  );
  assert.equal((await decision()).scopes.length, 0);
  await pool().query(
    "INSERT INTO identities(kind,value,user_id) VALUES('ethereum',$1,$2)",
    [wallet, user],
  );
  assert.notEqual((await decision()).scopes[0].membershipId, old.membershipId);
  assert.equal((await decision(packet("execute", old.id))).scopes.length, 0);
  const reverified = (await decision()).scopes[0];
  await pool().query(
    "UPDATE identities SET verified_at=clock_timestamp() WHERE kind='ethereum' AND value=$1",
    [wallet],
  );
  assert.notEqual(
    (await decision()).scopes[0].membershipId,
    reverified.membershipId,
  );
  await pool().query("UPDATE users SET merged_into=$1 WHERE id=$2", [
    owner,
    user,
  ]);
  assert.equal((await decision()).scopes.length, 0);
  await pool().query("UPDATE users SET merged_into=NULL WHERE id=$1", [user]);
  await pool().query(
    "UPDATE identities SET user_id=$1 WHERE kind='ethereum' AND value=$2",
    [owner, wallet],
  );
  assert.equal((await decision(packet("execute", old.id))).scopes.length, 0);
  await pool().query(
    "UPDATE identities SET user_id=$1 WHERE kind='ethereum' AND value=$2",
    [user, wallet],
  );
  const p = packet();
  p.request.workflowRequest.identity = {
    kind: "email",
    value: "synthetic@example.invalid",
  };
  p.signature = sign(
    null,
    Buffer.from(nativeWorkflowRequestMessage(p.request)),
    roles.privateKey,
  ).toString("base64");
  assert.equal((await decision(p)).scopes.length, 0);
});
test("exact native verified email role holders qualify without inheriting wallet proof", async () => {
  const email = "synthetic@example.invalid";
  await pool().query(
    "INSERT INTO identities(kind,value,user_id) VALUES('email',$1,$2)",
    [email, user],
  );
  const emailPacket = () => {
    const p = packet();
    p.request.workflowRequest.identity = { kind: "email", value: email };
    p.signature = sign(
      null,
      Buffer.from(nativeWorkflowRequestMessage(p.request)),
      roles.privateKey,
    ).toString("base64");
    return p;
  };
  for (const role of ["owner", "editor", "viewer"]) {
    await pool().query(
      "UPDATE members SET role=$3 WHERE workspace_id=$1 AND user_id=$2",
      [workspace, user, role],
    );
    const d = await decision(emailPacket());
    assert.equal(d.scopes.length, 1);
    assert.equal(d.scopes[0].roleId, "workspace." + role);
    assert.equal(JSON.stringify(d).includes(wallet), false);
    assert.equal(d.grantsSourceAuthority, false);
  }
  const old = (await decision(emailPacket())).scopes[0];
  await pool().query("DELETE FROM identities WHERE kind='email' AND value=$1", [
    email,
  ]);
  assert.equal((await decision(emailPacket())).scopes.length, 0);
  await pool().query(
    "INSERT INTO identities(kind,value,user_id) VALUES('email',$1,$2)",
    [email, user],
  );
  assert.notEqual(
    (await decision(emailPacket())).scopes[0].membershipId,
    old.membershipId,
  );
});
test("more than 100 memberships fails closed instead of truncating", async () => {
  const ids = Array.from({ length: 100 }, () => randomUUID());
  await pool().query(
    "INSERT INTO workspaces(id,name) SELECT unnest($1::uuid[]),'Private'",
    [ids],
  );
  await pool().query(
    "INSERT INTO members(workspace_id,user_id,role) SELECT unnest($1::uuid[]),$2,'owner'",
    [ids, user],
  );
  assert.equal((await send()).status, 503);
  await pool().query("DELETE FROM members WHERE workspace_id=ANY($1::uuid[])", [
    ids,
  ]);
  await pool().query("DELETE FROM workspaces WHERE id=ANY($1::uuid[])", [ids]);
});
test("missing configuration or database authority never returns eligibility", async () => {
  const secret = process.env.ROLES_FEED_SUBJECT_SECRET;
  delete process.env.ROLES_FEED_SUBJECT_SECRET;
  assert.equal((await send()).status, 503);
  process.env.ROLES_FEED_SUBJECT_SECRET = secret;
  const failed = packet();
  await pool().query(`ALTER TABLE members RENAME TO temporarily_unavailable`);
  try {
    assert.equal((await send(failed)).status, 503);
    // The known committed nonce is distinct from the still-unavailable source.
    assert.equal((await send(failed)).status, 409);
  } finally {
    await pool().query("ALTER TABLE temporarily_unavailable RENAME TO members");
  }
  const key =
    "native-workflow:" +
    createHash("sha256").update(failed.request.requestId).digest("hex");
  assert.equal(
    (await pool().query("SELECT hits FROM rate_limits WHERE key=$1", [key]))
      .rows[0].hits,
    1,
  );
  assert.equal((await send(failed)).status, 409);
});
test("migration backfills distinct generations on populated legacy memberships", async () => {
  const { Client } = await import("pg");
  const client = new Client({ connectionString: originalURL });
  await client.connect();
  const legacy = isolated + "_legacy";
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA ${legacy}`);
    await client.query(`SET LOCAL search_path=${legacy}`);
    await client.query(
      "CREATE TABLE members(workspace_id uuid,user_id uuid,role text,PRIMARY KEY(workspace_id,user_id))",
    );
    await client.query(
      "CREATE TABLE identities(kind text,value text,user_id uuid,verified_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(kind,value))",
    );
    await client.query("INSERT INTO identities VALUES('ethereum',$1,$2)", [
      wallet,
      user,
    ]);
    await client.query(
      "INSERT INTO members VALUES($1,$2,'owner'),($1,$3,'viewer')",
      [workspace, owner, user],
    );
    await client.query(nativeWorkflowSchema);
    await client.query(nativeWorkflowSchema);
    assert.match(
      (await client.query("SELECT authority_generation FROM identities"))
        .rows[0].authority_generation,
      /^[a-f0-9-]{36}$/,
    );
    const found = await client.query(
      "SELECT authority_generation FROM members",
    );
    assert.equal(found.rows.length, 2);
    assert.equal(
      new Set(found.rows.map((r) => r.authority_generation)).size,
      2,
    );
    assert.ok(
      found.rows.every((r) => /^[a-f0-9-]{36}$/.test(r.authority_generation)),
    );
    await client.query("INSERT INTO members VALUES($1,$2,'editor')", [
      workspace,
      randomUUID(),
    ]);
    assert.equal(
      (
        await client.query(
          "SELECT count(*)::int n FROM members WHERE authority_generation IS NOT NULL",
        )
      ).rows[0].n,
      3,
    );
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
});
test("read-only readiness and live eligibility reject disabled or replaced generation triggers", async () => {
  const client = await pool().connect();
  try {
    await client.query("BEGIN READ ONLY");
    assert.equal(await nativeWorkflowSchemaReady(client), true);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  await pool().query(
    "ALTER TABLE members DISABLE TRIGGER autonote_membership_generation",
  );
  try {
    assert.equal(await nativeWorkflowSchemaReady(pool()), false);
    assert.equal((await send()).status, 503);
  } finally {
    await pool().query(
      "ALTER TABLE members ENABLE TRIGGER autonote_membership_generation",
    );
  }
  await pool().query(
    `CREATE OR REPLACE FUNCTION ${isolated}.autonote_identity_generation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS 'BEGIN RETURN NEW; END;'`,
  );
  try {
    assert.equal(await nativeWorkflowSchemaReady(pool()), false);
    assert.equal((await send()).status, 503);
  } finally {
    await pool().query(nativeWorkflowSchema);
  }
  assert.equal(await nativeWorkflowSchemaReady(pool()), true);
});
