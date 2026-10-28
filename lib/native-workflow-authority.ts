import { createHash, createHmac, createPrivateKey, sign } from "node:crypto";
import { transaction } from "./db";
import { nativeWorkflowSchemaReady } from "./native-workflow-schema";
import { canonical } from "../shared/signed-action.mjs";
import { PERSONAL_WORKFLOW_ENDPOINT } from "../shared/personal-workflow-authority.mjs";
import {
  nativeWorkflowDecisionMessage,
  nativeWorkflowEndpoint,
  nativeWorkflowScopeId,
  verifyNativeWorkflowDecision,
  verifyNativeWorkflowRequest,
} from "../shared/native-workflow-authority.mjs";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
};
const error = (status: number) =>
  Response.json(
    { error: "Native workflow verification unavailable." },
    { status, headers },
  );
// Only a confirmed conflict in the durable nonce store is a replay. Database,
// configuration and downstream authority failures remain unavailable (503).
class ReplayConflict extends Error {}
const restrictionsDigest = createHash("sha256")
  .update(canonical(null))
  .digest("hex");

// The single statement uses a consistent current snapshot. Owner generations
// invalidate every workspace scope on transfer (including transfer back), without
// revealing owner identities. This is eligibility, never meeting authorization.
const membershipQuery = `SELECT i.user_id, i.authority_generation AS identity_generation, m.workspace_id, m.role, m.authority_generation,
  (SELECT jsonb_agg(jsonb_build_array(o.user_id,o.authority_generation) ORDER BY o.user_id)
   FROM members o WHERE o.workspace_id=m.workspace_id AND o.role='owner') AS owners
  FROM identities i JOIN users u ON u.id=i.user_id AND u.merged_into IS NULL
  JOIN members m ON m.user_id=u.id JOIN workspaces w ON w.id=m.workspace_id
  WHERE i.kind=$1 AND i.value=$2 AND i.verified_at IS NOT NULL
  ORDER BY m.workspace_id LIMIT 101`;

async function boundedBody(req: Request) {
  if (
    !req.body ||
    !req.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw Error("Invalid body");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 16384) {
        await reader.cancel();
        throw Error("Body limit");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function nativeWorkflowAuthority(req: Request) {
  if (req.method !== "POST" || req.url !== nativeWorkflowEndpoint("autonote"))
    return error(403);
  const env = process.env;
  let key: ReturnType<typeof createPrivateKey>;
  try {
    if (
      !env.ROLES_FEED_SUBJECT_SECRET ||
      env.ROLES_FEED_SUBJECT_SECRET.length < 32
    )
      throw Error("Configuration");
    key = createPrivateKey(env.ROLES_ECOSYSTEM_REQUEST_PRIVATE_KEY || "");
    if (
      key.asymmetricKeyType !== "ed25519" ||
      !env.ROLES_ECOSYSTEM_DECISION_PUBLIC_KEY
    )
      throw Error("Configuration");
  } catch {
    return error(503);
  }
  let request: ReturnType<typeof verifyNativeWorkflowRequest>;
  try {
    request = verifyNativeWorkflowRequest(
      await boundedBody(req),
      "autonote",
      env.ROLES_ECOSYSTEM_DECISION_PUBLIC_KEY,
    );
  } catch {
    return error(403);
  }
  try {
    await transaction(async (db) => {
      await db.query("SET LOCAL statement_timeout='1500ms'");
      await db.query("SET LOCAL lock_timeout='1000ms'");
      // A dedicated namespace in the existing durable store, not the rate-limit
      // increment helper. Conflicts are denied even during concurrent requests.
      const claimed = await db.query(
        "INSERT INTO rate_limits(key,hits,resets_at) VALUES($1,1,$2) ON CONFLICT(key) DO NOTHING RETURNING key",
        [
          "native-workflow:" +
            createHash("sha256").update(request.requestId).digest("hex"),
          new Date(request.expiresAt),
        ],
      );
      if (claimed.rowCount === 0) throw new ReplayConflict();
      if (claimed.rowCount !== 1) throw Error("Replay claim unavailable");
    });
    // The replay claim is already committed and survives downstream errors.
    // Resolve only the exact attested native identity. Verified email membership
    // grants the same personal eligibility, never wallet proof or elevation.
    const rows = await transaction(async (db) => {
      await db.query("SET LOCAL statement_timeout='1500ms'");
      await db.query("SET LOCAL lock_timeout='1000ms'");
      if (!(await nativeWorkflowSchemaReady(db)))
        throw Error("Authority generations unavailable");
      return (
        await db.query(membershipQuery, [
          request.workflowRequest.identity.kind === "wallet"
            ? "ethereum"
            : "email",
          request.workflowRequest.identity.value,
        ])
      ).rows;
    });
    if (rows.length > 100) throw Error("Scope limit");
    const checkedAt = Date.now(),
      expiresAt = Math.min(checkedAt + 5000, request.expiresAt);
    if (expiresAt <= checkedAt) throw Error("Expired");
    const opaque = (purpose: string, value: unknown) =>
      createHmac("sha256", env.ROLES_FEED_SUBJECT_SECRET!)
        .update(
          canonical([
            "autonote-native-workflow-v1",
            purpose,
            request.workflowRequest.identity,
            value,
          ]),
        )
        .digest("hex");
    const allScopes = rows.map((row) => {
      if (
        !row.authority_generation ||
        !row.identity_generation ||
        !Array.isArray(row.owners) ||
        !row.owners.length ||
        row.owners.some((v: unknown) => !Array.isArray(v) || !v[0] || !v[1])
      )
        throw Error("Authority generation unavailable");
      const scope = {
        roleId: "workspace." + row.role,
        resourceId: opaque("resource", row.workspace_id),
        membershipId: opaque("membership", [
          row.user_id,
          row.identity_generation,
          row.workspace_id,
          row.authority_generation,
          row.owners,
        ]),
        restrictionsDigest,
        expiresAt,
      };
      return {
        id: nativeWorkflowScopeId(
          "autonote",
          request.workflowRequest.identity,
          scope,
        ),
        ...scope,
      };
    });
    const scopes =
      request.workflowRequest.action === "list"
        ? allScopes
        : allScopes.filter(
            (scope) => scope.id === request.workflowRequest.scopeId,
          );
    const decision = {
      version: 1,
      issuer: "https://autonote.bittrees.org",
      audience: PERSONAL_WORKFLOW_ENDPOINT,
      project: "autonote",
      identity: request.workflowRequest.identity,
      request,
      status: "current",
      checkedAt,
      expiresAt,
      scopes,
      readOnly: true,
      grantsSourceAuthority: false,
    };
    const envelope = {
      decision,
      signature: sign(
        null,
        Buffer.from(nativeWorkflowDecisionMessage(decision)),
        key,
      ).toString("base64"),
    };
    // Recheck expiry at send time and validate our output against the frozen wire
    // contract. No result is usable after the signed request's original expiry.
    verifyNativeWorkflowDecision(envelope, request, key);
    return Response.json(envelope, { headers });
  } catch (caught) {
    return error(caught instanceof ReplayConflict ? 409 : 503);
  }
}
