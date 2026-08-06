import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, describe, expect, it } from "vitest";
import type { SessionManager } from "../../session/memory-session-manager.js";
import { registerAttachmentRoutes } from "../attachment-routes.js";

const cleanup: string[] = [];
afterAll(() => { for (const r of cleanup) rmSync(r, { recursive: true, force: true }); });

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const PNG_B64 = Buffer.from("\x89PNG\r\n\x1a\nORIGINALBYTES").toString("base64");

function transcriptWith(images: Array<{ data: string; mimeType: string }>): string {
  const root = mkdtempSync(join(tmpdir(), "att-route-"));
  cleanup.push(root);
  const file = join(root, "session.jsonl");
  writeFileSync(
    file,
    JSON.stringify({
      type: "message",
      message: {
        role: "user",
        content: [{ type: "text", text: "hi" }, ...images.map((i) => ({ type: "image", ...i }))],
      },
    }) + "\n",
  );
  return file;
}

/** `guard` lets a test simulate an unauthorised caller (X1). */
function buildApp(
  sessions: Record<string, { sessionFile?: string }>,
  guard: (req: any, reply: any) => Promise<void> = async () => {},
): FastifyInstance {
  const app = Fastify();
  const sessionManager = {
    get: (id: string) => sessions[id],
  } as unknown as SessionManager;
  registerAttachmentRoutes(app, { sessionManager, networkGuard: guard });
  return app;
}

describe("GET /api/sessions/:sessionId/attachments/:attachmentId", () => {
  it("serves the original bytes with an allow-listed content type", async () => {
    const file = transcriptWith([{ data: PNG_B64, mimeType: "image/png" }]);
    const app = buildApp({ s1: { sessionFile: file } });
    const res = await app.inject({ url: `/api/sessions/s1/attachments/${sha(PNG_B64)}` });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    // F5: byte-identical to what the user attached.
    expect(res.rawPayload.toString("base64")).toBe(PNG_B64);
    await app.close();
  });

  it("E15: hardening headers make the response non-executable", async () => {
    const file = transcriptWith([{ data: PNG_B64, mimeType: "image/png" }]);
    const app = buildApp({ s1: { sessionFile: file } });
    const res = await app.inject({ url: `/api/sessions/s1/attachments/${sha(PNG_B64)}` });

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(String(res.headers["content-security-policy"])).toContain("default-src 'none'");
    await app.close();
  });

  it("CWE-524: user image bytes are never written to a browser/proxy cache", async () => {
    // This endpoint is authenticated and serves private user screenshots.
    // A long-lived `max-age` persisted those bytes to disk, readable after
    // the session ended and by anyone with access to the cache.
    const file = transcriptWith([{ data: PNG_B64, mimeType: "image/png" }]);
    const app = buildApp({ s1: { sessionFile: file } });
    const res = await app.inject({ url: `/api/sessions/s1/attachments/${sha(PNG_B64)}` });

    const cc = String(res.headers["cache-control"]);
    expect(cc).toContain("no-store");
    // `private` is load-bearing too: without it a SHARED proxy may cache the
    // response for other users even while the browser honours no-store.
    expect(cc).toContain("private");
    expect(cc).not.toMatch(/max-age=(?!0)\d+/);
    expect(cc).not.toContain("immutable");
    await app.close();
  });

  it("X1: an unauthorised caller is refused and no bytes are returned", async () => {
    const file = transcriptWith([{ data: PNG_B64, mimeType: "image/png" }]);
    const app = buildApp({ s1: { sessionFile: file } }, async (_req, reply) => {
      reply.code(403).send({ success: false, error: "forbidden" });
    });
    const res = await app.inject({ url: `/api/sessions/s1/attachments/${sha(PNG_B64)}` });

    expect(res.statusCode).toBe(403);
    expect(res.rawPayload.toString("base64")).not.toBe(PNG_B64);
    await app.close();
  });

  it("X2: a valid hash from ANOTHER session is not served", async () => {
    const mine = transcriptWith([{ data: PNG_B64, mimeType: "image/png" }]);
    const theirsData = Buffer.from("SOMEONE-ELSES-IMAGE").toString("base64");
    const theirs = transcriptWith([{ data: theirsData, mimeType: "image/png" }]);
    const app = buildApp({ s1: { sessionFile: mine }, s2: { sessionFile: theirs } });

    // Ask session s1 for a digest that only exists in s2.
    const res = await app.inject({ url: `/api/sessions/s1/attachments/${sha(theirsData)}` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("X3: traversal and non-hex ids are rejected as 400 before any lookup", async () => {
    const file = transcriptWith([{ data: PNG_B64, mimeType: "image/png" }]);
    const app = buildApp({ s1: { sessionFile: file } });
    // Assert 400 specifically for route-matched malformed ids: accepting 404 too
    // would let a regression that bypasses isValidAttachmentId slip through.
    for (const bad of ["not-hex", "A".repeat(64), "a".repeat(63), `${"a".repeat(64)}x`]) {
      const res = await app.inject({ url: `/api/sessions/s1/attachments/${encodeURIComponent(bad)}` });
      expect(res.statusCode, `id ${bad}`).toBe(400);
      expect(res.rawPayload.toString("base64")).not.toBe(PNG_B64);
    }
    await app.close();
  });

  it("X6: an unknown session yields a clean 404, not a crash", async () => {
    const app = buildApp({});
    const res = await app.inject({ url: `/api/sessions/ghost/attachments/${sha(PNG_B64)}` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("X6c: an unknown session yields 404 whatever the id shape, leaking nothing", async () => {
    // Gate order is session-then-shape: a malformed id must NOT earn a 400 on a
    // session that does not exist, or the status code distinguishes "real
    // session, bad id" from "no such session" and turns the endpoint into a
    // session-id oracle.
    const app = buildApp({});
    for (const bad of ["not-hex", "A".repeat(64), `${"a".repeat(64)}x`]) {
      const res = await app.inject({ url: `/api/sessions/ghost/attachments/${encodeURIComponent(bad)}` });
      expect(res.statusCode, `id ${bad}`).toBe(404);
    }
    await app.close();
  });

  it("X6b: a session whose transcript file is gone yields a clean 404", async () => {
    const app = buildApp({ s1: { sessionFile: "/tmp/definitely-not-here-9f2b.jsonl" } });
    const res = await app.inject({ url: `/api/sessions/s1/attachments/${sha(PNG_B64)}` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("E15: a blob claiming text/html is never served, even on a hash match", async () => {
    const evil = Buffer.from("<script>alert(1)</script>").toString("base64");
    const file = transcriptWith([{ data: evil, mimeType: "text/html" }]);
    const app = buildApp({ s1: { sessionFile: file } });
    const res = await app.inject({ url: `/api/sessions/s1/attachments/${sha(evil)}` });

    expect(res.statusCode).toBe(404);
    expect(String(res.headers["content-type"])).not.toContain("text/html");
    await app.close();
  });
});
