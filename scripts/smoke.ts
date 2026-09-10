import { Wallet } from "ethers";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const origin = process.env.APP_URL || "http://127.0.0.1:3050";
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(origin))
  throw new Error("Smoke tests are local-only.");
let cookies: Record<string, string> = {};
async function call(
  path: string,
  body?: unknown,
  method = body ? "POST" : "GET",
) {
  const r = await fetch(origin + "/api/" + path, {
    method,
    headers: {
      origin,
      cookie: Object.entries(cookies)
        .map(([k, v]) => k + "=" + v)
        .join("; "),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  for (const c of r.headers.getSetCookie()) {
    const p = c.split(";")[0],
      i = p.indexOf("=");
    cookies[p.slice(0, i)] = p.slice(i + 1);
  }
  const d = await r.json();
  if (!r.ok) throw new Error(d.error);
  return d;
}
const wallet = Wallet.createRandom();
const c = await call("auth/challenge", {
  kind: "ethereum",
  value: wallet.address,
});
await call("auth/verify", {
  id: c.id,
  proof: await wallet.signMessage(c.message),
});
const me = await call("me");
const bytes = await readFile(
  process.env.SMOKE_AUDIO || "/tmp/autonote-smoke.wav",
);
const { id } = await call("meetings", {
  workspaceId: me.selected,
  title: "Fictional end-to-end validation",
  language: "en",
  type: "audio/wav",
  size: bytes.length,
  consent: true,
});
const { url } = await call(`meetings/${id}/parts`, { part: 1 });
assert.equal((await fetch(url, { method: "PUT", body: bytes })).status, 200);
const parts = await call(`meetings/${id}/parts`);
assert.equal(parts.parts.length, 1);
await call(`meetings/${id}/complete`, {});
await call(`meetings/${id}/complete`, {});
console.log(
  "SIWE, signed upload, resume listing, and idempotent completion passed.",
);
let status = "";
const deadline = Date.now() + 10 * 60 * 1000;
let m: any;
while (Date.now() < deadline) {
  const d = await call("me");
  m = d.meetings.find((m: any) => m.id === id);
  if (m.status !== status) {
    status = m.status;
    console.log("Processing:", status);
  }
  if (status === "ready") break;
  if (status === "failed") throw new Error(m.error);
  await new Promise((r) => setTimeout(r, 3000));
}
assert.equal(status, "ready");
assert.ok(m.transcript.length > 0);
assert.ok(m.notes.summary.length > 0);
assert.ok(m.notes.actions.length > 0, "Sample contains explicit actions");
const audio = await call(`meetings/${id}/audio`);
assert.equal(
  (await fetch(audio.url, { headers: { range: "bytes=0-99" } })).status,
  206,
);
console.log(
  `Real Whisper and notes pipeline passed: ${m.transcript.length} segments, ${m.notes.actions.length} proposed actions.`,
);
await call(
  `meetings/${id}`,
  { version: m.version, title: "Reviewed smoke meeting" },
  "PATCH",
);
await call(`meetings/${id}`, { confirm: true }, "DELETE");
assert.ok(!(await call("me")).meetings.some((m: any) => m.id === id));
await call("account", { confirm: "DELETE" }, "DELETE");
console.log("Playback, editing, deletion, and account cleanup passed.");
