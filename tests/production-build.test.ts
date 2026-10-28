import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

test("real build wrapper skips migration outside production and stops release on migration failure", () => {
  const dir = mkdtempSync(join(tmpdir(), "autonote-build-guard-"));
  try {
    mkdirSync(join(dir, "scripts"));
    mkdirSync(join(dir, "node_modules/tsx"), { recursive: true });
    mkdirSync(join(dir, "node_modules/next/dist/bin"), { recursive: true });
    writeFileSync(
      join(dir, "node_modules/tsx/package.json"),
      JSON.stringify({ type: "module", exports: "./index.mjs" }),
    );
    writeFileSync(join(dir, "node_modules/tsx/index.mjs"), "");
    writeFileSync(
      join(dir, "scripts/migrate-native-workflow.ts"),
      `import{writeFileSync}from'node:fs';writeFileSync('migration.json',JSON.stringify({approved:process.env.NATIVE_WORKFLOW_MIGRATION_APPROVED}));process.exit(Number(process.env.FIXTURE_MIGRATION_EXIT||0));`,
    );
    writeFileSync(
      join(dir, "node_modules/next/dist/bin/next"),
      `require('node:fs').writeFileSync('build.json',JSON.stringify(process.argv.slice(2)));`,
    );
    const wrapper = fileURLToPath(
      new URL("../scripts/build.mjs", import.meta.url),
    );
    const run = (vercel: string, environment: string, exit = "0") =>
      spawnSync(process.execPath, [wrapper, "--webpack"], {
        cwd: dir,
        env: {
          ...process.env,
          VERCEL: vercel,
          VERCEL_ENV: environment,
          FIXTURE_MIGRATION_EXIT: exit,
        },
        encoding: "utf8",
      });
    for (const [vercel, environment] of [
      ["", ""],
      ["1", "preview"],
      ["", "production"],
    ]) {
      const r = run(vercel, environment);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(existsSync(join(dir, "migration.json")), false);
      assert.deepEqual(
        JSON.parse(readFileSync(join(dir, "build.json"), "utf8")),
        ["build", "--webpack"],
      );
      rmSync(join(dir, "build.json"));
    }
    const good = run("1", "production");
    assert.equal(good.status, 0, good.stderr);
    assert.deepEqual(
      JSON.parse(readFileSync(join(dir, "migration.json"), "utf8")),
      { approved: "autonote" },
    );
    assert.equal(existsSync(join(dir, "build.json")), true);
    rmSync(join(dir, "build.json"));
    const failed = run("1", "production", "42");
    assert.equal(failed.status, 42, failed.stderr);
    assert.equal(existsSync(join(dir, "build.json")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("migration configuration failures do not print credential inputs", () => {
  const secret = "invalid connection synthetic-private-password";
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "scripts/migrate-native-workflow.ts"],
    {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env: {
        ...process.env,
        DATABASE_URL_UNPOOLED: secret,
        NATIVE_WORKFLOW_MIGRATION_APPROVED: "autonote",
      },
      encoding: "utf8",
      timeout: 5000,
    },
  );
  assert.equal(result.status, 1);
  assert.equal((result.stdout + result.stderr).includes(secret), false);
  assert.match(
    result.stderr,
    /Explicit AutoNote release approval and direct connection required/,
  );
});
