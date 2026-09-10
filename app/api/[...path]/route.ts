import { z, ZodError } from "zod";
import { pool } from "../../../lib/db";
import {
  startChallenge,
  verifyChallenge,
  currentUser,
  checkOrigin,
  cookie,
  cookieName,
  hash,
  setCookie,
  rateLimit,
} from "../../../lib/auth";
import { completeRecovery } from "../../../lib/recovery";
import { HttpError } from "../../../lib/model";
import { exportMeeting } from "../../../lib/export";
import * as service from "../../../lib/service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (data: unknown, cookie?: string) =>
  Response.json(data, {
    headers: {
      "Cache-Control": "no-store",
      ...(cookie ? { "Set-Cookie": cookie } : {}),
    },
  });
async function handle(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const path = (await params).path;
    const method = req.method;
    if (!process.env.DATABASE_URL && path[0] !== "health")
      throw new HttpError(
        503,
        "AutoNote is in preview. Account and recording services are awaiting production setup. You can explore the fictional demo.",
      );
    const url = new URL(req.url);
    if (method !== "GET") checkOrigin(req);
    let data: any = {};
    if (method !== "GET") {
      if (Number(req.headers.get("content-length") || 0) > 3_500_000)
        throw new HttpError(413, "Request is too large.");
      data = await req.json();
    }
    if (path.join("/") === "health")
      return json({
        ok: true,
        configured: !!process.env.DATABASE_URL,
        storage: !!process.env.S3_BUCKET,
      });
    if (!process.env.DATABASE_URL)
      throw new HttpError(
        503,
        "AutoNote is in preview. Account and recording services are awaiting production setup. You can explore the fictional demo.",
      );
    if (path.join("/") === "auth/challenge" && method === "POST") {
      const d = z
        .object({
          kind: z.enum(["email", "ethereum"]),
          value: z.string().min(1).max(254),
          link: z.boolean().optional(),
          chainId: z.number().int().positive().optional(),
          recoveryToken: z.string().max(100).optional(),
        })
        .parse(data);
      const r = await startChallenge(req, d);
      return json(r.body, r.cookie);
    }
    if (path.join("/") === "auth/verify" && method === "POST") {
      const r = await verifyChallenge(
        req,
        z
          .object({
            id: z.uuid(),
            proof: z.string().max(1000),
            recover: z.boolean().optional(),
          })
          .parse(data),
      );
      return json(r.body, r.cookie);
    }
    if (path.join("/") === "auth/recover" && method === "POST") {
      const r = await completeRecovery(
        req,
        z.string().length(64).parse(data.token),
      );
      return json(r.body, r.cookie);
    }
    if (path.join("/") === "auth/logout" && method === "POST") {
      await pool().query("DELETE FROM sessions WHERE hash=$1", [
        hash(cookie(req, cookieName)),
      ]);
      return json({ ok: true }, setCookie(cookieName, "", 0));
    }
    const user = await currentUser(req, path[0] !== "me");
    if (path[0] === "me") {
      if (!user) return json({ user: null });
      return json({
        user,
        identities: (
          await pool().query(
            "SELECT kind,value FROM identities WHERE user_id=$1",
            [user.id],
          )
        ).rows,
        ...(await service.snapshot(
          user.id,
          url.searchParams.get("workspace") || undefined,
          url.searchParams.get("q") || "",
        )),
      });
    }
    const u = user!;
    if (method !== "GET") await rateLimit(`api:${u.id}`, 300);
    if (path[0] === "workspaces") {
      if (path.length === 1 && method === "POST")
        return json(await service.createWorkspace(u.id, data.name));
      if (path.length === 2 && method === "GET")
        return json(await service.workspaceSettings(u.id, path[1]));
      if (path.length === 2 && method === "POST")
        return json(await service.workspaceAction(u.id, path[1], data));
    }
    if (path[0] === "invites" && method === "POST")
      return json(
        await service.acceptInvite(
          u.id,
          z.string().length(64).parse(data.token),
        ),
      );
    if (path[0] === "account" && path[1] === "export" && method === "GET")
      return json(await service.accountExport(u.id));
    if (path[0] === "account" && method === "DELETE") {
      if (data.confirm !== "DELETE")
        throw new HttpError(400, "Type DELETE to confirm.");
      return json(
        await service.deleteAccount(u.id),
        setCookie(cookieName, "", 0),
      );
    }
    if (path[0] === "meetings") {
      if (path.length === 1 && method === "POST")
        return json(await service.createMeeting(u.id, data));
      const id = path[1];
      if (path[2] === "parts" && method === "GET")
        return json(await service.uploadedParts(u.id, id));
      if (path[2] === "parts" && method === "POST")
        return json(await service.uploadPart(u.id, id, data.part));
      if (path[2] === "complete" && method === "POST")
        return json(await service.completeUpload(u.id, id));
      if (path[2] === "sharing" && method === "GET")
        return json(await service.sharing(u.id, id));
      if (path[2] === "audio" && method === "GET")
        return json(await service.audio(u.id, id));
      if (path[2] === "retry" && method === "POST")
        return json(await service.retryMeeting(u.id, id));
      if (path[2] === "export" && method === "GET") {
        const m = await service.meeting(u.id, id);
        const format = z
          .enum(["md", "txt", "json", "srt", "vtt"])
          .parse(url.searchParams.get("format") || "md");
        return new Response(exportMeeting(m, format), {
          headers: {
            "Cache-Control": "no-store",
            "Content-Type":
              format === "json"
                ? "application/json"
                : "text/plain; charset=utf-8",
            "Content-Disposition": `attachment; filename="autonote-${id}.${format}"`,
          },
        });
      }
      if (path.length === 2 && method === "PATCH")
        return json(await service.editMeeting(u.id, id, data));
      if (path.length === 2 && method === "DELETE") {
        if (data.confirm !== true)
          throw new HttpError(400, "Confirm deletion.");
        return json(await service.removeMeeting(u.id, id));
      }
    }
    throw new HttpError(404, "Not found.");
  } catch (e) {
    if (e instanceof ZodError)
      return jsonError(
        400,
        "Check the submitted fields. " + e.issues[0]?.message,
      );
    if (e instanceof HttpError) return jsonError(e.status, e.message);
    console.error(
      "AutoNote API failure",
      e instanceof Error ? e.name : "Unknown",
    );
    return jsonError(
      503,
      "The service could not complete this request. Please retry.",
    );
  }
}
function jsonError(status: number, error: string) {
  return Response.json(
    { error },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
