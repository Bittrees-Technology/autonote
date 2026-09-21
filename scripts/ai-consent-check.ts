import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { createServer as createHttpsServer } from "node:https";
import { request as httpRequest } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { chromium, expect } from "@playwright/test";
import { pool, schema } from "../lib/db";
import { hash } from "../lib/auth";
const database = process.env.DATABASE_URL!;
if (!database.endsWith("/autonote_test"))
  throw Error("Dedicated browser test database required");
const namespace = "browser_" + randomUUID().replaceAll("-", ""),
  admin = new Pool({ connectionString: database });
await admin.query("CREATE SCHEMA " + namespace);
const url = new URL(database);
url.searchParams.set("options", "-c search_path=" + namespace);
process.env.DATABASE_URL = url.href;
const origin = "https://127.0.0.1:3051",
  backend = "http://127.0.0.1:3050",
  user = randomUUID(),
  workspace = randomUUID(),
  meeting = randomUUID(),
  session = "c".repeat(64);
const certificates = mkdtempSync(join(tmpdir(), "autonote-browser-tls-"));
let proxy: ReturnType<typeof createHttpsServer> | undefined;
let server: ReturnType<typeof spawn> | undefined,
  browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  await pool().query(schema);
  await pool().query(
    "INSERT INTO users(id,name) VALUES($1,'Synthetic AI reviewer')",
    [user],
  );
  await pool().query(
    "INSERT INTO workspaces(id,name) VALUES($1,'Synthetic workspace')",
    [workspace],
  );
  await pool().query(
    "INSERT INTO members(workspace_id,user_id,role) VALUES($1,$2,'owner')",
    [workspace, user],
  );
  await pool().query(
    "INSERT INTO meetings(id,workspace_id,creator_id,title,status,transcript) VALUES($1,$2,$3,'Consent fixture meeting','ready',$4)",
    [
      meeting,
      workspace,
      user,
      JSON.stringify([
        {
          id: "s1",
          start: 0,
          end: 4,
          speaker: "Speaker",
          text: "SYNTHETIC_TRANSCRIPT",
        },
      ]),
    ],
  );
  await pool().query(
    "INSERT INTO sessions(hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
    [hash(session), user],
  );
  server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3050",
    ],
    {
      env: {
        ...process.env,
        APP_URL: origin,
        AI_CONNECTOR_ENABLED: "true",
        AUTONOTE_MODE: "live",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let logs = "";
  server.stdout?.on("data", (chunk) => {
    logs = (logs + chunk).slice(-4000);
  });
  server.stderr?.on("data", (chunk) => {
    logs = (logs + chunk).slice(-4000);
  });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(backend + "/api/health")).ok) {
        ready = true;
        break;
      }
    } catch {}
    if (server.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.equal(ready, true, "Server did not start: " + logs);
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(certificates, "key.pem"),
      "-out",
      join(certificates, "cert.pem"),
      "-subj",
      "/CN=localhost",
      "-days",
      "1",
    ],
    { stdio: "ignore" },
  );
  proxy = createHttpsServer(
    {
      key: readFileSync(join(certificates, "key.pem")),
      cert: readFileSync(join(certificates, "cert.pem")),
    },
    (req, res) => {
      const upstream = httpRequest(
        backend + req.url,
        { method: req.method, headers: req.headers },
        (response) => {
          res.writeHead(response.statusCode ?? 502, response.headers);
          response.pipe(res);
        },
      );
      upstream.on("error", () => {
        res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
    },
  );
  await new Promise<void>((resolve) =>
    proxy!.listen(3051, "127.0.0.1", resolve),
  );
  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: true,
  });
  await context.addCookies([
    {
      name: "__Host-autonote-session",
      value: session,
      url: origin,
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const page = await context.newPage(),
    outgoing: string[] = [],
    errors: string[] = [];
  page.on("request", (req) => {
    if (!req.url().startsWith(origin)) outgoing.push(req.url());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  const verifier = "v".repeat(64),
    challenge = createHash("sha256").update(verifier).digest("base64url");
  const response = await page.goto(
    origin + "/connect/ai?challenge=" + challenge,
  );
  assert.match(response!.headers()["content-security-policy"], /nonce-/);
  assert.equal(response!.headers()["referrer-policy"], "no-referrer");
  assert.equal(
    (await response!.text()).includes("insights.bittrees.org"),
    false,
  );
  await expect(
    page.getByText("Signed in as Synthetic AI reviewer.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Load permitted meetings", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await page
    .getByLabel("One meeting transcript", { exact: true })
    .selectOption(meeting);
  await page
    .getByRole("button", { name: "Review connection", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Review transcript access",
      exact: true,
    }),
  ).toBeVisible();
  assert.equal(
    Number(
      (await pool().query("SELECT count(*) AS n FROM ai_grants")).rows[0].n,
    ),
    0,
  );
  await page
    .getByRole("button", {
      name: "Allow this transcript connection",
      exact: true,
    })
    .click();
  const output = page.getByLabel("Connection code", { exact: true });
  await expect(output).toBeVisible();
  const code = (await output.textContent())!;
  assert.match(code, /^[a-f0-9]{64}$/);
  assert.equal(page.url().includes(code), false);
  assert.equal(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }).includes(
        document.querySelector("output")!.textContent!,
      ),
    ),
    false,
  );
  const exchange = await fetch(backend + "/api/integrations/ai/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, verifier }),
  });
  assert.equal(exchange.status, 200);
  const grant = await exchange.json();
  const read = () =>
    fetch(backend + "/api/integrations/ai/read", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + grant.token,
      },
      body: JSON.stringify({ meetingId: meeting }),
    });
  assert.equal((await read()).status, 200);
  const source = await (await read()).json();
  await page
    .getByRole("button", { name: "Enable draft review uploads", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Disable draft review uploads",
      exact: true,
    }),
  ).toBeVisible();
  const staged = await fetch(backend + "/api/integrations/ai/review-prepare", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + grant.token,
    },
    body: JSON.stringify({
      operationId: randomUUID(),
      meetingId: meeting,
      version: source.meeting.version,
      projectionHash: source.projectionHash,
      summary: [{ text: "Synthetic summary addition", evidence: ["s1"] }],
      actions: [
        {
          text: "Synthetic suggested action",
          evidence: ["s1"],
          owner: null,
          dueDate: null,
        },
      ],
    }),
  });
  assert.equal(staged.status, 201);
  const stagedReview = await staged.json();
  // A link cannot disclose an unknown review or authorize a save.
  await page.goto(origin + "/connect/ai?review=" + randomUUID());
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Review exact additions", exact: true }),
  ).toHaveCount(0);
  await page.goto(origin + "/connect/ai?review=invalid");
  await expect(
    page.getByText(
      "This review link is invalid. Load your draft reviews below.",
    ),
  ).toBeVisible();
  await page.goto(
    origin +
      "/connect/ai?review=" +
      stagedReview.reviewId +
      "&review=" +
      stagedReview.reviewId,
  );
  await expect(
    page.getByText(
      "This review link is invalid. Load your draft reviews below.",
    ),
  ).toBeVisible();
  await page.goto(origin + "/connect/ai?review=" + stagedReview.reviewId);
  await expect(
    page.getByRole("heading", { name: "Review exact additions", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save reviewed additions", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("I reviewed these additions and the meeting audience.", {
      exact: true,
    })
    .check();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(
    page.getByRole("heading", { name: "Review exact additions", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Reopen linked review", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save reviewed additions", exact: true }),
  ).toBeDisabled();
  // The existing manual list remains usable alongside a direct link.
  await page
    .getByRole("button", { name: "Load draft reviews", exact: true })
    .click();
  await page.getByRole("button", { name: "Open review", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Review exact additions", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save reviewed additions", exact: true }),
  ).toBeDisabled();
  assert.equal(
    (await pool().query("SELECT notes FROM meetings WHERE id=$1", [meeting]))
      .rows[0].notes,
    null,
  );
  await page
    .getByText("Exact resulting notes and evidence", { exact: true })
    .click();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    ),
    false,
    "Exact review overflows on a narrow viewport",
  );
  await page
    .getByLabel("I reviewed these additions and the meeting audience.", {
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Save reviewed additions", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Saved to AutoNote", exact: true }),
  ).toBeVisible();
  const saved = (
    await pool().query("SELECT notes,version FROM meetings WHERE id=$1", [
      meeting,
    ])
  ).rows[0];
  assert.equal(saved.version, 2);
  assert.equal(saved.notes.actions[0].status, "proposed");
  assert.match(saved.notes.summary, /s1: 0–4s/);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Saved to AutoNote", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save reviewed additions", exact: true }),
  ).toHaveCount(0);

  await page
    .getByRole("button", { name: "Revoke connection", exact: true })
    .click();
  await expect(
    page.getByText("Revoked · Expires", { exact: false }),
  ).toBeVisible();
  assert.equal((await read()).status, 401);
  await page.reload();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Saved to AutoNote", exact: true }),
  ).toHaveCount(0);
  await page.goto(origin + "/connect/ai?challenge=" + challenge);
  await expect(
    page.getByText("Signed in as Synthetic AI reviewer.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Refresh signed-in account and connections",
      exact: true,
    })
    .focus();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Load permitted meetings", exact: true }),
  ).toBeFocused();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    ),
    false,
    "Narrow viewport overflows horizontally",
  );
  assert.deepEqual(outgoing, []);
  assert.deepEqual(errors, []);
  assert.equal(
    (await (await fetch(backend)).text()).includes("insights.bittrees.org"),
    true,
    "Ordinary app pages retain their existing analytics layout",
  );
  console.log("Private AutoNote consent browser checks passed.");
} finally {
  await browser?.close();
  if (proxy) {
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy!.close(() => resolve()));
  }
  rmSync(certificates, { recursive: true, force: true });
  if (server && server.exitCode === null) {
    const exited = new Promise<void>((resolve) =>
      server!.once("exit", () => resolve()),
    );
    server.kill("SIGTERM");
    await exited;
  }
  await pool().end();
  await admin.query("DROP SCHEMA " + namespace + " CASCADE");
  await admin.end();
}
