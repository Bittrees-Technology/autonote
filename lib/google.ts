import { createHash } from "node:crypto";
import { z } from "zod";
import { pool, transaction } from "./db";
import { cookie, cookieName, hash, token } from "./auth";
import { encrypt, decrypt } from "./secrets";
import { HttpError } from "./model";

const scope = "https://www.googleapis.com/auth/calendar.events.readonly";
export const configured = () =>
  !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.APP_URL
  );
function config() {
  if (!configured())
    throw new HttpError(503, "Google Calendar setup is not complete yet.");
  return {
    client_id: process.env.GOOGLE_CLIENT_ID!,
    client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    redirect_uri: new URL(
      "/api/integrations/google/callback",
      process.env.APP_URL!,
    ).href,
  };
}
async function tokenRequest(fields: Record<string, string>) {
  const c = config();
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({ ...c, ...fields }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok)
    throw new HttpError(
      401,
      "Google connection needs attention. Disconnect and connect again.",
    );
  return r.json();
}
export async function start(req: Request, user: string) {
  const c = config(),
    state = token(),
    verifier = token();
  await pool().query(
    "INSERT INTO google_pending VALUES($1,$2,$3,$4,now()+interval '10 minutes')",
    [hash(state), user, hash(cookie(req, cookieName)), encrypt(verifier)],
  );
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: c.client_id,
    redirect_uri: c.redirect_uri,
    response_type: "code",
    scope,
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return { url: url.href };
}
export async function callback(
  req: Request,
  user: string,
  code: string,
  state: string,
  cancelled = false,
) {
  if (!cancelled) z.string().min(1).max(4096).parse(code);
  z.string().length(64).parse(state);
  return transaction(async (db) => {
    // Serialize connection changes with account deletion/recovery.
    const active = (
      await db.query(
        "SELECT id FROM users WHERE id=$1 AND merged_into IS NULL AND name<>'Deleted account' FOR UPDATE",
        [user],
      )
    ).rows[0];
    if (!active) throw new HttpError(401, "Sign in again.");
    const p = (
      await db.query(
        "SELECT * FROM google_pending WHERE state_hash=$1 AND user_id=$2 FOR UPDATE",
        [hash(state), user],
      )
    ).rows[0];
    if (
      !p ||
      p.session_hash !== hash(cookie(req, cookieName)) ||
      new Date(p.expires_at).getTime() <= Date.now()
    )
      throw new HttpError(400, "Connection expired. Start again in Settings.");
    if (cancelled) {
      await db.query("DELETE FROM google_pending WHERE state_hash=$1", [
        hash(state),
      ]);
      return { ok: true, cancelled: true };
    }
    const d = await tokenRequest({
      code,
      code_verifier: decrypt(p.verifier),
      grant_type: "authorization_code",
    });
    if (
      !d.refresh_token ||
      !String(d.scope || "")
        .split(" ")
        .includes(scope)
    )
      throw new HttpError(
        400,
        "Calendar permission was not granted. Start again and allow read access.",
      );
    await db.query(
      "INSERT INTO google_connections(user_id,refresh_ciphertext) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET refresh_ciphertext=$2,created_at=now()",
      [user, encrypt(d.refresh_token)],
    );
    // A reconnect can select a different Google account; never retain its predecessor's selections.
    await db.query("DELETE FROM google_selections WHERE user_id=$1", [user]);
    await db.query("DELETE FROM google_pending WHERE user_id=$1", [user]);
    return { ok: true };
  });
}
export type CalendarMeeting = {
  id: string;
  title: string;
  meetUrl: string;
  startsAt: string;
  endsAt: string;
};
export function calendarMeeting(raw: any): CalendarMeeting | null {
  if (
    !raw ||
    raw.status === "cancelled" ||
    raw.attendees?.some((a: any) => a.self && a.responseStatus === "declined")
  )
    return null;
  const link =
    raw.hangoutLink ||
    raw.conferenceData?.entryPoints?.find(
      (p: any) => p.entryPointType === "video",
    )?.uri;
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "meet.google.com" ||
    url.port ||
    url.username ||
    url.password
  )
    return null;
  const start = Date.parse(raw.start?.dateTime),
    end = Date.parse(raw.end?.dateTime);
  if (
    !raw.id ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start
  )
    return null;
  return {
    id: String(raw.id),
    title: String(raw.summary || "Untitled meeting").slice(0, 200),
    meetUrl: url.href,
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(end).toISOString(),
  };
}
async function access(user: string, db: any) {
  const c = (
    await db.query(
      "SELECT * FROM google_connections WHERE user_id=$1 FOR UPDATE",
      [user],
    )
  ).rows[0];
  if (!c) throw new HttpError(404, "Connect Google Calendar first.");
  const result = await tokenRequest({
    refresh_token: decrypt(c.refresh_ciphertext),
    grant_type: "refresh_token",
  });
  if (typeof result.access_token !== "string" || !result.access_token)
    throw new HttpError(
      502,
      "Google could not renew access. Reconnect your calendar.",
    );
  return result.access_token as string;
}
async function eventsWithToken(bearer: string, eventId?: string) {
  const url = new URL(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events" +
      (eventId ? "/" + encodeURIComponent(eventId) : ""),
  );
  const fields =
    "id,summary,status,start,end,hangoutLink,conferenceData(entryPoints),attendees(self,responseStatus)";
  url.searchParams.set(
    "fields",
    eventId ? fields : `items(${fields}),nextPageToken`,
  );
  if (!eventId) {
    url.searchParams.set("timeMin", new Date().toISOString());
    url.searchParams.set(
      "timeMax",
      new Date(Date.now() + 14 * 86400000).toISOString(),
    );
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "100");
  }
  const r = await fetch(url, {
    headers: { Authorization: "Bearer " + bearer },
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!r.ok)
    throw new HttpError(
      r.status === 401 ? 401 : 502,
      "Could not read Google Calendar. Reconnect or try again.",
    );
  return r.json();
}
export async function status(user: string) {
  const c = await pool().query(
    "SELECT 1 FROM google_connections WHERE user_id=$1",
    [user],
  );
  return {
    configured: configured(),
    verificationPending: process.env.GOOGLE_OAUTH_VERIFIED !== "true",
    connected: !!c.rowCount,
    captureAvailable: false,
    selections: (
      await pool().query(
        "SELECT event_id,title,meet_url,starts_at,ends_at FROM google_selections WHERE user_id=$1 AND ends_at>now() ORDER BY starts_at",
        [user],
      )
    ).rows,
  };
}
export async function events(user: string) {
  return transaction(async (db) => {
    const d = await eventsWithToken(await access(user, db));
    const events = (d.items || [])
      .map(calendarMeeting)
      .filter(Boolean) as CalendarMeeting[];
    for (const e of events)
      await db.query(
        "UPDATE google_selections SET title=$3,meet_url=$4,starts_at=$5,ends_at=$6 WHERE user_id=$1 AND event_id=$2",
        [user, e.id, e.title, e.meetUrl, e.startsAt, e.endsAt],
      );
    if (!d.nextPageToken)
      await db.query(
        "DELETE FROM google_selections WHERE user_id=$1 AND NOT(event_id=ANY($2::text[]))",
        [user, events.map((e) => e.id)],
      );
    else {
      const invalid = (d.items || [])
        .filter((e: any) => !calendarMeeting(e))
        .map((e: any) => e.id)
        .filter(Boolean);
      await db.query(
        "DELETE FROM google_selections WHERE user_id=$1 AND event_id=ANY($2::text[])",
        [user, invalid],
      );
    }
    return { events, truncated: !!d.nextPageToken };
  });
}
export async function select(user: string, input: unknown) {
  const d = z
    .object({ eventId: z.string().min(1).max(1024), selected: z.boolean() })
    .parse(input);
  return transaction(async (db) => {
    if (!d.selected) {
      await db.query(
        "DELETE FROM google_selections WHERE user_id=$1 AND event_id=$2",
        [user, d.eventId],
      );
      return { ok: true };
    }
    const e = calendarMeeting(
      await eventsWithToken(await access(user, db), d.eventId),
    );
    if (
      !e ||
      e.id !== d.eventId ||
      Date.parse(e.endsAt) <= Date.now() ||
      Date.parse(e.startsAt) > Date.now() + 14 * 86400000
    )
      throw new HttpError(
        400,
        "Choose an upcoming Google Meet event within 14 days.",
      );
    const count = (
      await db.query(
        "SELECT count(*)::int n FROM google_selections WHERE user_id=$1 AND event_id<>$2",
        [user, e.id],
      )
    ).rows[0].n;
    if (count >= 20)
      throw new HttpError(
        429,
        "Select up to 20 meetings. Remove a saved meeting before adding another.",
      );
    await db.query(
      "INSERT INTO google_selections(user_id,event_id,title,meet_url,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,event_id) DO UPDATE SET title=$3,meet_url=$4,starts_at=$5,ends_at=$6,selected_at=now()",
      [user, e.id, e.title, e.meetUrl, e.startsAt, e.endsAt],
    );
    return { ok: true, captureAvailable: false };
  });
}
export async function disconnect(user: string) {
  return transaction(async (db) => {
    await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [user]);
    const c = (
      await db.query(
        "SELECT * FROM google_connections WHERE user_id=$1 FOR UPDATE",
        [user],
      )
    ).rows[0];
    if (c) {
      const r = await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        body: new URLSearchParams({ token: decrypt(c.refresh_ciphertext) }),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok && r.status !== 400)
        throw new HttpError(
          502,
          "Google could not revoke access. Try disconnecting again.",
        );
    }
    await db.query("DELETE FROM google_connections WHERE user_id=$1", [user]);
    await db.query("DELETE FROM google_pending WHERE user_id=$1", [user]);
    return { ok: true };
  });
}
