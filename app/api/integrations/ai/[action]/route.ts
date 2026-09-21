import { z, ZodError } from "zod";
import * as ai from "../../../../../lib/ai";
import { currentUser, checkOrigin, rateLimit } from "../../../../../lib/auth";
import { HttpError } from "../../../../../lib/model";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
async function body(req: Request) {
  if (Number(req.headers.get("content-length") ?? 0) > 16384)
    throw new HttpError(413, "Request too large.");
  const reader = req.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 16384) throw new HttpError(413, "Request too large.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}
async function handle(
  req: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  try {
    const { action } = await params;
    if (!process.env.DATABASE_URL)
      throw new HttpError(503, "AutoNote accounts are not configured.");
    const reducing = ["grants", "revoke", "disconnect"].includes(action);
    if (
      !reducing &&
      (process.env.AUTONOTE_MODE === "demo" ||
        (!!process.env.VERCEL && process.env.AUTONOTE_MODE !== "live"))
    )
      throw new HttpError(
        503,
        "AI connections are unavailable in preview mode.",
      );
    if (["exchange", "read", "disconnect"].includes(action)) {
      if (req.method !== "POST") throw new HttpError(405, "Use POST.");
      const input = await body(req);
      if (action === "exchange") {
        ai.requireAiEnabled();
        const exchange = z
          .strictObject({
            code: z.string().regex(/^[a-f0-9]{64}$/),
            verifier: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
          })
          .parse(input);
        await rateLimit("ai-exchange:" + exchange.code, 10);
        return json(await ai.exchange(exchange));
      }
      const authorization = req.headers.get("authorization") ?? "";
      if (!/^Bearer [a-f0-9]{64}$/.test(authorization))
        throw new HttpError(401, "AI credential required.");
      const bearer = authorization.slice(7);
      await rateLimit("ai-bearer:" + bearer, 100);
      if (action === "disconnect") {
        z.strictObject({}).parse(input);
        return json(await ai.disconnect(bearer));
      }
      return json(await ai.read(bearer, input));
    }
    const user = await currentUser(req);
    if (req.method !== "GET") checkOrigin(req);
    if (action === "grants" && req.method === "GET")
      return json({
        user: { id: user!.id, name: user!.name },
        items: await ai.list(user!.id),
        enabled: process.env.AI_CONNECTOR_ENABLED === "true",
      });
    if (action === "options" && req.method === "GET")
      return json(await ai.choices(user!.id));
    if (action === "authorize" && req.method === "POST") {
      await rateLimit("ai-authorize:" + user!.id, 20);
      const raw = await body(req),
        { subjectId, ...input } = z
          .object({ subjectId: z.uuid() })
          .passthrough()
          .parse(raw);
      if (subjectId !== user!.id)
        throw new HttpError(
          409,
          "Signed-in account changed. Review the connection again.",
        );
      return json(await ai.authorize(user!.id, input), 201);
    }
    if (action === "revoke" && req.method === "POST") {
      const input = z
        .strictObject({ grantId: z.uuid() })
        .parse(await body(req));
      return json(await ai.revoke(user!.id, input.grantId));
    }
    throw new HttpError(404, "Not found.");
  } catch (error) {
    return json(
      {
        error:
          error instanceof HttpError
            ? error.message
            : error instanceof ZodError
              ? "Invalid AI connection request."
              : "AI connection is temporarily unavailable.",
      },
      error instanceof HttpError
        ? error.status
        : error instanceof ZodError
          ? 400
          : 500,
    );
  }
}
export const GET = handle;
export const POST = handle;
