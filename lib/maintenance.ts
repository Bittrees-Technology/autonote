import { pool, transaction } from "./db";
import { HttpError } from "./model";
export async function reserveEmail() {
  if (process.env.PROCESSING_MODE !== "device") return;
  const date = new Date().toISOString();
  await transaction(async (db) => {
    for (const [period, max] of [
      [date.slice(0, 7), 500],
      [date.slice(0, 10), 50],
    ] as const) {
      const row = (
        await db.query(
          "INSERT INTO email_budget(period,hits) VALUES($1,1) ON CONFLICT(period) DO UPDATE SET hits=email_budget.hits+1 RETURNING hits",
          [period],
        )
      ).rows[0];
      if (row.hits > max)
        throw new HttpError(
          429,
          "The free beta's email allowance is full. Use a linked Ethereum wallet or try again after the allowance resets.",
        );
    }
  });
}
export async function cleanup() {
  await pool().query(
    "DELETE FROM challenges WHERE expires_at<now()-interval '1 day'",
  );
  await pool().query("DELETE FROM sessions WHERE expires_at<now()");
  await pool().query(
    "DELETE FROM identity_recoveries WHERE expires_at<now()-interval '1 day' AND NOT EXISTS(SELECT 1 FROM challenges WHERE recovery_hash=identity_recoveries.hash)",
  );
  await pool().query(
    "DELETE FROM rate_limits WHERE resets_at<now()-interval '1 day'",
  );
  await pool().query("DELETE FROM google_pending WHERE expires_at<now()");
  await pool().query("DELETE FROM crm_pending WHERE expires_at<now()");
  await pool().query("DELETE FROM crm_previews WHERE expires_at<now()");
  await pool().query(
    "DELETE FROM google_selections WHERE ends_at<now()-interval '1 day'",
  );
  await pool().query(
    "DELETE FROM email_budget WHERE period<to_char(now()-interval '2 months','YYYY-MM')",
  );
  return { ok: true };
}
