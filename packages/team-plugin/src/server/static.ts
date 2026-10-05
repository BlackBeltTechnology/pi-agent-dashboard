/**
 * Same-origin app delivery (D14): `/apps/team` → 308, `/apps/team/*` → file
 * under `dist/app/` (realpath-confined) or `index.html` for deep links.
 * See change: add-team-plugin.
 */
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";

const APP_PREFIX = "/apps/team";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

export function mountAppRoutes(fastify: FastifyInstance, distDir: string, logger: { warn(msg: string): void }): void {
  let warned = false;
  const send = (reply: FastifyReply, file: string, immutable: boolean) => {
    const ext = path.extname(file).toLowerCase();
    return reply
      .header("Content-Type", TYPES[ext] ?? "application/octet-stream")
      .header("Cache-Control", immutable ? "public, max-age=31536000, immutable" : "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .send(fs.readFileSync(file));
  };

  fastify.get(APP_PREFIX, async (_req, reply) => reply.redirect(`${APP_PREFIX}/`, 308));

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: many small independent branches (field / state rendering); splitting would scatter one linear flow
  fastify.get(`${APP_PREFIX}/*`, async (req, reply) => {
    let root: string;
    try {
      root = fs.realpathSync(distDir);
      if (!fs.existsSync(path.join(root, "index.html"))) throw new Error("no index");
    } catch {
      if (!warned) {
        warned = true;
        logger.warn("team.app_build_missing");
      }
      return reply.code(503).header("Content-Type", "text/plain; charset=utf-8").send("team app build missing");
    }
    const rawUrl = req.raw.url ?? "";
    const pathname = rawUrl.split("?")[0].slice(APP_PREFIX.length + 1);
    let rel: string;
    try {
      rel = decodeURIComponent(pathname);
    } catch {
      rel = "";
    }
    // Traversal / NUL ⇒ treat as a deep link (index.html), never a file outside root.
    if (rel && !rel.includes("\0")) {
      const candidate = path.resolve(root, rel);
      try {
        const real = fs.realpathSync(candidate);
        const within = real === root || real.startsWith(root + path.sep);
        if (within && fs.statSync(real).isFile()) return send(reply, real, rel.startsWith("assets/"));
      } catch {
        /* fall through to index */
      }
    }
    return send(reply, path.join(root, "index.html"), false);
  });
}
