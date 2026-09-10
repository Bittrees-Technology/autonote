import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarMeeting } from "../lib/google";
import { encrypt, decrypt } from "../lib/secrets";
const event = {
  id: "meeting123",
  summary: "Planning",
  status: "confirmed",
  hangoutLink: "https://meet.google.com/abc-defg-hij",
  start: { dateTime: "2026-09-15T10:00:00+01:00" },
  end: { dateTime: "2026-09-15T11:00:00+01:00" },
};
test("Calendar accepts Meet events and normalizes time zones", () => {
  assert.equal(calendarMeeting(event)?.startsAt, "2026-09-15T09:00:00.000Z");
  assert.equal(
    calendarMeeting({
      ...event,
      hangoutLink: undefined,
      conferenceData: {
        entryPoints: [{ entryPointType: "video", uri: event.hangoutLink }],
      },
    })?.meetUrl,
    event.hangoutLink,
  );
});
test("Calendar excludes cancelled, declined, all-day and unsafe links", () => {
  for (const change of [
    { status: "cancelled" },
    { attendees: [{ self: true, responseStatus: "declined" }] },
    { start: { date: "2026-09-15" } },
    { hangoutLink: "https://meet.google.com.attacker.invalid/" },
    { hangoutLink: "javascript:alert(1)" },
    { hangoutLink: "https://attacker@meet.google.com/abc" },
    { end: event.start },
  ])
    assert.equal(calendarMeeting({ ...event, ...change }), null);
});
test("Integration secrets are authenticated and randomized", () => {
  const a = encrypt("synthetic-token"),
    b = encrypt("synthetic-token");
  assert.notEqual(a, b);
  assert.equal(decrypt(a), "synthetic-token");
  const bytes = Buffer.from(a, "base64url");
  bytes[13] ^= 1;
  assert.throws(() => decrypt(bytes.toString("base64url")));
});
