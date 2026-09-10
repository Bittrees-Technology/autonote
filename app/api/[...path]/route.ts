import { timingSafeEqual } from "node:crypto";
import { cleanup } from "../../../lib/maintenance";
import { saveDeviceMeeting } from "../../../lib/device-service";
import * as google from "../../../lib/google";
import * as crm from "../../../lib/crm";
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
    const demoMode =
      process.env.AUTONOTE_MODE === "demo" ||
      (!!process.env.VERCEL && process.env.AUTONOTE_MODE !== "live");
    if ((demoMode || !process.env.DATABASE_URL) && path[0] !== "health")
      throw new HttpError(
        503,
        "AutoNote is in preview. Account and recording services are awaiting production setup. You can explore the fictional demo.",
      );
    const url = new URL(req.url);
    if (path.join("/") === "cron/cleanup" && method === "GET") {
      const expected = process.env.CRON_SECRET,
        actual = req.headers.get("authorization") || "";
      if (
        !expected ||
        actual.length !== ("Bearer " + expected).length ||
        !timingSafeEqual(Buffer.from(actual), Buffer.from("Bearer " + expected))
      )
        throw new HttpError(401, "Not authorized.");
      return json(await cleanup());
    }
    if (method !== "GET") checkOrigin(req);
    let data: any = {};
    if (method !== "GET") {
      if (Number(req.headers.get("content-length") || 0) > 3_500_000)
        throw new HttpError(413, "Request is too large.");
      const raw = await req.text();
      if (raw.length > 750_000)
        throw new HttpError(413, "Request is too large.");
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        throw new HttpError(400, "The request contains invalid JSON.");
      }
    }
    if (path.join("/") === "health")
      return json({
        ok: true,
        configured: !demoMode && !!process.env.DATABASE_URL,
        mode: demoMode ? "demo" : "live",
        processingMode: process.env.PROCESSING_MODE || "server",
        storage:
          process.env.PROCESSING_MODE === "device"
            ? "browser"
            : !!process.env.S3_BUCKET,
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
      if (!user)
        return json({
          user: null,
          processingMode: process.env.PROCESSING_MODE || "server",
        });
      let selectedWorkspace = url.searchParams.get("workspace") || undefined;
      let linkUnavailable = false;
      const linkedMeeting = url.searchParams.get("meeting");
      if (!selectedWorkspace && linkedMeeting) {
        if (!z.uuid().safeParse(linkedMeeting).success) linkUnavailable = true;
        else
          try {
            selectedWorkspace = (await service.meeting(user.id, linkedMeeting))
              .workspace_id;
          } catch (e) {
            if (e instanceof HttpError && [403, 404].includes(e.status))
              linkUnavailable = true;
            else throw e;
          }
      }
      return json({
        user,
        linkUnavailable,
        processingMode: process.env.PROCESSING_MODE || "server",
        identities: (
          await pool().query(
            "SELECT kind,value FROM identities WHERE user_id=$1",
            [user.id],
          )
        ).rows,
        ...(await service.snapshot(
          user.id,
          selectedWorkspace,
          url.searchParams.get("q") || "",
        )),
      });
    }
    const u = user!;
    if (method !== "GET") await rateLimit(`api:${u.id}`, 300);
    if (path[0] === "integrations" && path[1] === "google") {
      await rateLimit(`google:${u.id}`, 60);
      if (path[2] === "callback" && method === "GET") {
        const result = await google.callback(
          req,
          u.id,
          url.searchParams.get("code") || "",
          url.searchParams.get("state") || "",
          url.searchParams.has("error"),
        );
        return Response.redirect(
          new URL(
            result.cancelled ? "/?google=cancelled" : "/?connected=google",
            process.env.APP_URL!,
          ),
          303,
        );
      }
      if (path.length === 2 && method === "GET")
        return json(await google.status(u.id));
      if (path[2] === "events" && method === "GET")
        return json(await google.events(u.id));
      if (path[2] === "start" && method === "POST")
        return json(await google.start(req, u.id));
      if (path[2] === "select" && method === "POST")
        return json(await google.select(u.id, data));
      if (path[2] === "disconnect" && method === "POST")
        return json(await google.disconnect(u.id));
    }
    if (path[0] === "integrations" && path[1] === "crm") {
      if (path[2] === "callback" && method === "GET") {
        await crm.callback(
          req,
          u.id,
          url.searchParams.get("code") || "",
          url.searchParams.get("state") || "",
        );
        return Response.redirect(
          new URL("/?connected=crm", process.env.APP_URL || url.origin),
          303,
        );
      }
      if (method === "GET") return json(await crm.list(u.id));
      if (path[2] === "start" && method === "POST")
        return json(await crm.start(req, u.id));
      if (path[2] === "disconnect" && method === "POST")
        return json(await crm.disconnect(u.id, data.id));
      if (path[2] === "preview" && method === "POST")
        return json(await crm.preview(u.id, data));
      if (path[2] === "publish" && method === "POST")
        return json(await crm.publish(u.id, data.token));
    }

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
    if (path.join("/") === "device/meetings" && method === "POST") {
      if (process.env.PROCESSING_MODE !== "device")
        throw new HttpError(404, "Device processing is not enabled.");
      return json(await saveDeviceMeeting(u.id, data));
    }
    if (path[0] === "meetings") {
      if (
        process.env.PROCESSING_MODE === "device" &&
        method === "POST" &&
        (path.length === 1 || ["parts", "complete"].includes(path[2]))
      )
        throw new HttpError(
          400,
          "This deployment processes recordings on your device.",
        );
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
    const callback =
      req.method === "GET" &&
      new URL(req.url).pathname.match(
        /^\/api\/integrations\/(google|crm)\/callback$/,
      );
    if (callback && process.env.APP_URL) {
      const destination = new URL("/", process.env.APP_URL);
      destination.searchParams.set("integration_error", callback[1]);
      return new Response(null, {
        status: 303,
        headers: {
          Location: destination.href,
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      });
    }
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
