// Explicitly targeted synthetic API check. Creates and deletes its own wallet accounts.
import { Wallet } from "ethers";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const origin = process.env.AUTONOTE_SMOKE_URL;
if (!origin || !/^https?:\/\//.test(origin))
  throw new Error(
    "Set AUTONOTE_SMOKE_URL to the deployment you intend to test.",
  );
function client() {
  const cookies: Record<string, string> = {};
  if (process.env.AUTONOTE_SMOKE_COOKIE_FILE) {
    for (const line of readFileSync(
      process.env.AUTONOTE_SMOKE_COOKIE_FILE,
      "utf8",
    ).split("\n")) {
      const fields = line.replace(/^#HttpOnly_/, "").split("\t");
      if (
        fields.length === 7 &&
        fields[0].replace(/^\./, "") === new URL(origin!).host &&
        fields[5] === "_vercel_jwt"
      )
        cookies[fields[5]] = fields[6];
    }
  }
  return async (
    path: string,
    body?: unknown,
    method = body ? "POST" : "GET",
    expected = 200,
  ) => {
    const r = await fetch(origin + "/api/" + path, {
      method,
      headers: {
        origin,
        cookie: Object.entries(cookies)
          .map(([k, v]) => `${k}=${v}`)
          .join("; "),
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of r.headers.getSetCookie()) {
      const p = c.split(";")[0],
        i = p.indexOf("=");
      cookies[p.slice(0, i)] = p.slice(i + 1);
    }
    const d = await r.json();
    assert.equal(r.status, expected, `${path}: ${d.error || r.status}`);
    return d;
  };
}
const a = client(),
  b = client();
const signed: ReturnType<typeof client>[] = [];
try {
  for (const call of [a, b]) {
    const wallet = Wallet.createRandom();
    const c = await call("auth/challenge", {
      kind: "ethereum",
      value: wallet.address,
    });
    assert.ok(
      c.message.startsWith(new URL(origin).host + " wants you to sign in"),
    );
    await call("auth/verify", {
      id: c.id,
      proof: await wallet.signMessage(c.message),
    });
    signed.push(call);
  }
  const me = await a("me");
  assert.equal(me.processingMode, "device");
  const data = {
    id: randomUUID(),
    workspaceId: me.selected,
    title: "Synthetic release check",
    language: "en",
    consent: true,
    duration: 12,
    transcript: [
      {
        id: "s1",
        start: 0,
        end: 12,
        speaker: "Unlabeled speaker",
        text: "Maya will prepare the checklist. We agreed to keep the release free. The budget question remains open.",
      },
    ],
  };
  await a("device/meetings", data);
  await a("device/meetings", data);
  const m = (await a("me")).meetings.find((m: any) => m.id === data.id);
  assert.equal(m.notes.actions.length, 1);
  assert.equal(m.notes.decisions.length, 1);
  assert.equal(m.notes.questions.length, 1);
  assert.equal(m.recording_deleted, true);
  assert.ok(!(await b("me")).meetings.some((m: any) => m.id === data.id));
  await b(`meetings/${data.id}/export?format=json`, undefined, "GET", 404);
  await a("meetings", {}, "POST", 400);
  const exported = await a(`meetings/${data.id}/export?format=json`);
  assert.equal(exported.transcript.length, 1);
  await a(
    `meetings/${data.id}`,
    { version: m.version, title: "Reviewed synthetic release check" },
    "PATCH",
  );
  await a(`meetings/${data.id}`, { confirm: true }, "DELETE");
  await a("device/meetings", data, "POST", 410);
  console.log(
    "PASS: final-origin SIWE, private device save, idempotency, notes, isolation, audio-upload blocking, export, edit, deletion and retry fencing.",
  );
} finally {
  for (const call of signed)
    await call("account", { confirm: "DELETE" }, "DELETE");
  console.log("Synthetic accounts deleted.");
}
