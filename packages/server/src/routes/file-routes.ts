/**
 * File and directory browse REST API routes (localhost-only).
 */
import type { FastifyInstance } from "fastify";
import type { SessionManager } from "../memory-session-manager.js";
import type { PreferencesStore } from "../preferences-store.js";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { NetworkGuard } from "./route-deps.js";
import { listDirectories, createDirectory, classifyPaths, parseFlagsQuery } from "../browse.js";
import { decodeFileUri } from "../lib/decode-file-uri.js";
import path from "node:path";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { extToContentType } from "../lib/mime-types.js";

// Lazy asciidoctor singleton. First call cost ~Opal init; the server is
// long-running so we eat it once. See change: render-file-previews.
let asciidoctorInstance: any | null = null;
function getAsciidoctor(): any {
  if (!asciidoctorInstance) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const factory = require("asciidoctor");
    asciidoctorInstance = factory();
  }
  return asciidoctorInstance;
}

export function registerFileRoutes(
  fastify: FastifyInstance,
  deps: {
    sessionManager: SessionManager;
    preferencesStore: PreferencesStore;
    networkGuard: NetworkGuard;
  },
) {
  const { sessionManager, preferencesStore, networkGuard } = deps;

  // Directory browse endpoint.
  // `detect=1` opts into eager `.git` / `.pi` classification on every entry
  // (anything other than the literal string `"1"` is treated as falsy).
  // Without `detect`, this is a single-readdir enumeration with no filesystem
  // probes — use `GET /api/browse/flags` to classify lazily.
  // See change: split-browse-flags.
  fastify.get<{ Querystring: { path?: string; q?: string; detect?: string } }>(
    "/api/browse",
    { preHandler: networkGuard },
    async (request) => {
      try {
        const result = await listDirectories(
          request.query.path || undefined,
          request.query.q || undefined,
          { detect: request.query.detect === "1" },
        );
        return { success: true, data: result } satisfies ApiResponse;
      } catch {
        return { success: false, error: "directory not found" } satisfies ApiResponse;
      }
    },
  );

  // Bulk directory flag classifier. Accepts `paths=<json-array>` (URL-encoded
  // JSON array of absolute path strings, length ≤ 100). Returns
  // `{ flags: { [path]: { isGit, isPi } } }`. Per-path probe failures map to
  // `{ isGit: false, isPi: false }` — only malformed input or over-cap
  // requests produce a top-level error (HTTP 400).
  // See change: split-browse-flags.
  fastify.get<{ Querystring: { paths?: string } }>(
    "/api/browse/flags",
    { preHandler: networkGuard },
    async (request, reply) => {
      const parsed = parseFlagsQuery(request.query.paths);
      if (!parsed.ok) {
        reply.code(400);
        return { success: false, error: parsed.error } satisfies ApiResponse;
      }
      const flags = await classifyPaths(parsed.paths);
      return { success: true, data: { flags } } satisfies ApiResponse;
    },
  );

  // Directory create endpoint
  fastify.post<{ Body: { parent?: unknown; name?: unknown } }>(
    "/api/browse/mkdir",
    { preHandler: networkGuard },
    async (request, reply) => {
      const body = request.body ?? {};
      const parent = typeof body.parent === "string" ? body.parent : "";
      const name = typeof body.name === "string" ? body.name : "";
      try {
        const newPath = await createDirectory(parent, name);
        return { success: true, data: { path: newPath } } satisfies ApiResponse;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "mkdir failed";
        // Map known errors to status codes; unknown → 500
        if (msg === "invalid name") reply.code(400);
        else if (msg === "parent not found") reply.code(404);
        else if (msg === "parent is not a directory") reply.code(400);
        else if (msg === "already exists") reply.code(409);
        else reply.code(500);
        return { success: false, error: msg } satisfies ApiResponse;
      }
    },
  );

  // File read endpoint — read file content or list directory
  fastify.get<{ Querystring: { cwd?: string; path?: string } }>(
    "/api/file",
    { preHandler: networkGuard },
    async (request, reply) => {
      const cwd = request.query.cwd;
      const relPath = request.query.path ? decodeFileUri(request.query.path) : request.query.path;
      if (!cwd || !relPath) {
        reply.code(400);
        return { success: false, error: "cwd and path parameters required" } satisfies ApiResponse;
      }

      const allSessions = sessionManager.listAll();
      if (!allSessions.some((s) => s.cwd === cwd)) {
        reply.code(403);
        return { success: false, error: "unknown session path" } satisfies ApiResponse;
      }

      const resolved = path.resolve(cwd, relPath);
      if (!resolved.startsWith(cwd + path.sep) && resolved !== cwd) {
        reply.code(403);
        return { success: false, error: "path outside working directory" } satisfies ApiResponse;
      }

      try {
        const stat = await fs.stat(resolved);
        if (stat.isDirectory()) {
          const entries = await fs.readdir(resolved);
          entries.sort();
          return { success: true, data: { type: "directory", entries } } satisfies ApiResponse;
        }
        const content = await fs.readFile(resolved, "utf-8");
        return { success: true, data: { type: "file", content } } satisfies ApiResponse;
      } catch {
        reply.code(404);
        return { success: false, error: "not found" } satisfies ApiResponse;
      }
    },
  );

  // Lightweight path-existence probe (change: openspec-worktree-spawn-button).
  //
  // Returns 200 when the absolute `path` query param exists on disk
  // (file or directory), 404 otherwise. Used by WorktreeSpawnDialog to
  // detect orphan-path collisions before submit. Gated on `cwd` being a
  // known session or pinned directory to avoid arbitrary filesystem
  // probes from an authenticated browser.
  fastify.get<{ Querystring: { cwd?: string; path?: string } }>(
    "/api/file/exists",
    { preHandler: networkGuard },
    async (request, reply) => {
      const cwd = request.query.cwd;
      const probePath = request.query.path;
      if (!cwd || !probePath) {
        reply.code(400);
        return { success: false, error: "cwd and path parameters required" } satisfies ApiResponse;
      }
      const allSessions = sessionManager.listAll();
      const knownCwds = new Set(allSessions.map((s) => s.cwd));
      for (const dir of preferencesStore.getPinnedDirectories()) knownCwds.add(dir);
      if (!knownCwds.has(cwd)) {
        reply.code(403);
        return { success: false, error: "unknown cwd" } satisfies ApiResponse;
      }
      // Anti-traversal: probePath MUST be inside cwd.
      const resolved = path.resolve(probePath);
      const cwdWithSep = cwd.endsWith(path.sep) ? cwd : cwd + path.sep;
      if (resolved !== cwd && !resolved.startsWith(cwdWithSep)) {
        reply.code(403);
        return { success: false, error: "path outside cwd" } satisfies ApiResponse;
      }
      try {
        await fs.access(resolved);
        return { success: true, data: { exists: true } } satisfies ApiResponse;
      } catch {
        reply.code(404);
        return { success: false, error: "not found" } satisfies ApiResponse;
      }
    },
  );

  // Pinned directories endpoint
  fastify.get("/api/pinned-dirs", async () => {
    return { success: true, data: preferencesStore.getPinnedDirectories() } satisfies ApiResponse;
  });

  // Favorite models endpoint (cold-load for the selector).
  // See change: enrich-model-selector-capabilities-favorites.
  fastify.get("/api/favorite-models", async () => {
    return { success: true, data: { labels: preferencesStore.getFavoriteModels() } } satisfies ApiResponse;
  });

  // Binary-safe file streaming endpoint (change: render-file-previews).
  // Streams the file bytes with `Content-Type` from extension, supports
  // HTTP Range so `<video>` seek works. Same cwd-allowlist + anti-traversal
  // gate as `/api/file`. Sets `Content-Disposition: inline` and a short
  // private cache.
  fastify.get<{ Querystring: { cwd?: string; path?: string } }>(
    "/api/file/raw",
    { preHandler: networkGuard },
    async (request, reply) => {
      const cwd = request.query.cwd;
      const relPath = request.query.path;
      if (!cwd || !relPath) {
        reply.code(400);
        return { success: false, error: "cwd and path parameters required" } satisfies ApiResponse;
      }

      const allSessions = sessionManager.listAll();
      if (!allSessions.some((s) => s.cwd === cwd)) {
        reply.code(403);
        return { success: false, error: "unknown session path" } satisfies ApiResponse;
      }

      const resolved = path.resolve(cwd, relPath);
      if (!resolved.startsWith(cwd + path.sep) && resolved !== cwd) {
        reply.code(403);
        return { success: false, error: "path outside working directory" } satisfies ApiResponse;
      }

      let stat;
      try {
        stat = await fs.stat(resolved);
      } catch {
        reply.code(404);
        return { success: false, error: "not found" } satisfies ApiResponse;
      }
      if (!stat.isFile()) {
        reply.code(404);
        return { success: false, error: "not a file" } satisfies ApiResponse;
      }

      const ext = path.extname(resolved);
      const contentType = extToContentType(ext);
      const size = stat.size;

      reply.header("Content-Type", contentType);
      reply.header("Content-Disposition", "inline");
      reply.header("Cache-Control", "private, max-age=60");
      reply.header("Accept-Ranges", "bytes");

      // Range support — required for video seek. Parse a single
      // `bytes=start-end` range; reject multipart/syntax errors with 416.
      const rangeHeader = request.headers.range;
      if (rangeHeader && /^bytes=/.test(rangeHeader)) {
        const spec = rangeHeader.slice("bytes=".length).trim();
        const m = /^(\d*)-(\d*)$/.exec(spec);
        if (!m) {
          reply.code(416);
          reply.header("Content-Range", `bytes */${size}`);
          return reply.send();
        }
        const startStr = m[1];
        const endStr = m[2];
        let start: number;
        let end: number;
        if (startStr === "" && endStr === "") {
          reply.code(416);
          reply.header("Content-Range", `bytes */${size}`);
          return reply.send();
        } else if (startStr === "") {
          // Suffix range: last N bytes
          const suffix = parseInt(endStr, 10);
          if (suffix <= 0) {
            reply.code(416);
            reply.header("Content-Range", `bytes */${size}`);
            return reply.send();
          }
          start = Math.max(0, size - suffix);
          end = size - 1;
        } else {
          start = parseInt(startStr, 10);
          end = endStr === "" ? size - 1 : parseInt(endStr, 10);
        }
        if (start > end || start >= size || end >= size) {
          reply.code(416);
          reply.header("Content-Range", `bytes */${size}`);
          return reply.send();
        }
        reply.code(206);
        reply.header("Content-Range", `bytes ${start}-${end}/${size}`);
        reply.header("Content-Length", String(end - start + 1));
        return reply.send(createReadStream(resolved, { start, end }));
      }

      reply.header("Content-Length", String(size));
      return reply.send(createReadStream(resolved));
    },
  );

  // Server-side AsciiDoc rendering (change: render-file-previews).
  // Runs `asciidoctor` in `safe: "secure"` mode so include directives /
  // dangerous attributes are neutralized. Rejects non-`.adoc`/`.asciidoc`
  // extensions with HTTP 400. Same anti-traversal gate as `/api/file/raw`.
  fastify.get<{ Querystring: { cwd?: string; path?: string } }>(
    "/api/file/render",
    { preHandler: networkGuard },
    async (request, reply) => {
      const cwd = request.query.cwd;
      const relPath = request.query.path;
      if (!cwd || !relPath) {
        reply.code(400);
        return { success: false, error: "cwd and path parameters required" } satisfies ApiResponse;
      }

      const ext = path.extname(relPath).toLowerCase();
      if (ext !== ".adoc" && ext !== ".asciidoc") {
        reply.code(400);
        return { success: false, error: "renderer not supported for extension" } satisfies ApiResponse;
      }

      const allSessions = sessionManager.listAll();
      if (!allSessions.some((s) => s.cwd === cwd)) {
        reply.code(403);
        return { success: false, error: "unknown session path" } satisfies ApiResponse;
      }

      const resolved = path.resolve(cwd, relPath);
      if (!resolved.startsWith(cwd + path.sep) && resolved !== cwd) {
        reply.code(403);
        return { success: false, error: "path outside working directory" } satisfies ApiResponse;
      }

      let source: string;
      try {
        source = await fs.readFile(resolved, "utf-8");
      } catch {
        reply.code(404);
        return { success: false, error: "not found" } satisfies ApiResponse;
      }

      try {
        const adoc = getAsciidoctor();
        const html = adoc.convert(source, { safe: "secure", standalone: false });
        return { success: true, data: { html: String(html) } } satisfies ApiResponse;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "render failed";
        reply.code(500);
        return { success: false, error: msg } satisfies ApiResponse;
      }
    },
  );
}
