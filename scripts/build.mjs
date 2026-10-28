import { spawnSync } from "node:child_process";

function run(args, env = process.env) {
  const result = spawnSync(process.execPath, args, { env, stdio: "inherit" });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
// The existing direct database credential stays inside Vercel. Preview/local/CI
// builds never migrate production; a failed production migration stops release.
if (process.env.VERCEL === "1" && process.env.VERCEL_ENV === "production") {
  run(["--import", "tsx", "scripts/migrate-native-workflow.ts"], {
    ...process.env,
    NATIVE_WORKFLOW_MIGRATION_APPROVED: "autonote",
  });
}
run(["node_modules/next/dist/bin/next", "build", ...process.argv.slice(2)]);
