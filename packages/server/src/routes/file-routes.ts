/**
 * File and directory browse REST API routes (localhost-only).
 */

import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileKind } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FastifyInstance } from "fastify";
import { classifyPaths, createDirectory, listDirectories, parseFlagsQuery } from "../browse.js";
import { isImageUnderArtifactRoot } from "../lib/artifact-roots.js";
import { decodeFileUri } from "../lib/decode-file-uri.js";
import { enumerateMdCandidates } from "../lib/md-candidates.js";
import { extToContentType } from "../lib/mime-types.js";
import { isAllowed } from "../lib/path-containment.js";
import { isWritableMdTarget } from "../lib/writable-md-target.js";
import type { SessionManager } from "../memory-session-manager.js";
import type { PreferencesStore } from "../preferences-store.js";
import type { NetworkGuard } from "./route-deps.js";

// Per-target write serialization. The optimistic mtime check + atomic rename
// must run as one critical section per file, else two concurrent writes can
// both read the same mtime, both pass, and the later rename clobbers the earlier
// write instead of returning 409. Keyed by resolved path; the chain swallows
// errors so one failed write does not poison the next. See change:
// directory-settings-page-and-scoped-md-editing.
const fileWriteLocks = new Map<string, Promise<unknown>>();
function serializeWrite<T>(key: string, task: () => Promise<T>): Promise<T> {
  const run = (fileWriteLocks.get(key) ?? Promise.resolve()).then(task, task);
  const tail = run.then(
    () => {},
    () => {},
  );
  fileWriteLocks.set(key, tail);
  void tail.then(() => {
    if (fileWriteLocks.get(key) === tail) fileWriteLocks.delete(key);
  });
  return run;
}

// Resolve + scope-validate a markdown target shared by the write + md-read
// endpoints. Directory scope (cwd present) requires a known session; global
// scope requires an absolute path. Returns the resolved abs path, or {code,error}
// to map to a reply. Authorization (`isWritableMdTarget`) is applied by callers.
// See change: directory-settings-page-and-scoped-md-editing.
function resolveScopedMdPath(
  cwd: string | undefined,
  rawPath: string,
  sessionManager: SessionManager,
): { resolved: string } | { code: number; error: string } {
  if (cwd && !sessionManager.listAll().some((s) => s.cwd === cwd)) {
    return { code: 403, error: "unknown session path" };
  }
  const decoded = decodeFileUri(rawPath);
  if (!cwd && !path.isAbsolute(decoded)) {
    return { code: 400, error: "global scope requires an absolute path" };
  }
  return { resolved: cwd ? path.resolve(cwd, decoded) : path.resolve(decoded) };
}

/** Discriminated outcome of an atomic markdown write. */
type MdWriteOutcome = { code: 200; mtime: number } | { code: 404 | 409 | 500; error: string };

/** Parsed + authorized write request, or a {code,error} reply mapping. */
type MdWritePrep = { resolved: string; content: string; mtime: number } | { code: number; error: string };

// Parse, scope-validate, and authorize a `POST /api/file/write` body. Keeps the
// route handler trivial. Authorization is the `isWritableMdTarget` security
// boundary. See change: directory-settings-page-and-scoped-md-editing.
async function prepareMdWrite(
  body: { cwd?: unknown; path?: unknown; content?: unknown; mtime?: unknown },
  sessionManager: SessionManager,
): Promise<MdWritePrep> {
  const cwd = typeof body.cwd === "string" && body.cwd ? body.cwd : undefined;
  const rawPath = typeof body.path === "string" ? body.path : "";
  const content = typeof body.content === "string" ? body.content : undefined;
  const mtime = typeof body.mtime === "number" ? body.mtime : undefined;
  if (!rawPath || content === undefined || mtime === undefined) {
    return { code: 400, error: "path, content and mtime are required" };
  }
  const target = resolveScopedMdPath(cwd, rawPath, sessionManager);
  if ("code" in target) return target;
  if (!(await isWritableMdTarget(target.resolved, { cwd }))) {
    return { code: 403, error: "target is not a writable markdown file in scope" };
  }
  return { resolved: target.resolved, content, mtime };
}

// Atomic markdown write with optimistic-concurrency. Caller MUST run this inside
// `serializeWrite(resolved, …)` so the stat→write→rename is a per-target critical
// section. The tmp name is unpredictable and opened O_EXCL (`wx`), so a planted
// symlink at the tmp path cannot redirect the write outside the allowlist before
// rename. See change: directory-settings-page-and-scoped-md-editing.
async function performAtomicMdWrite(
  resolved: string,
  content: string,
  mtime: number,
): Promise<MdWriteOutcome> {
  // Canonicalize to the realpath target: an in-scope symlink to an allowed
  // markdown file is authorized by `isWritableMdTarget` on its realpath, so we
  // persist to the real file and leave the symlink intact (rename does not
  // follow symlinks). Missing file → 404.
  let real: string;
  let current: import("node:fs").Stats;
  try {
    real = await fs.realpath(resolved);
    current = await fs.stat(real);
  } catch {
    return { code: 404, error: "file not found" };
  }
  // Full-precision mtime token: rounding could collapse two fast saves into one
  // token and let a stale write pass the 409 check.
  if (current.mtimeMs !== mtime) {
    return { code: 409, error: "file changed on disk since it was loaded" };
  }
  const tmpPath = path.join(
    path.dirname(real),
    `.${path.basename(real)}.${randomBytes(8).toString("hex")}.tmp`,
  );
  try {
    await fs.writeFile(tmpPath, content, { encoding: "utf-8", flag: "wx" });
    // Preserve the original file mode so a private (e.g. 0600) instruction file
    // is not widened to the umask default on replace.
    await fs.chmod(tmpPath, current.mode & 0o777);
    await fs.rename(tmpPath, real);
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => {});
    return { code: 500, error: err instanceof Error ? err.message : "write failed" };
  }
  const after = await fs.stat(real);
  return { code: 200, mtime: after.mtimeMs };
}

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
      if (!(await isAllowed(resolved, { anchors: [cwd] }))) {
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
        // Classify by extension + a bounded sniff (first 1024 bytes) so binary
        // files are not slurped whole just to discriminate. Content is returned
        // only for text-renderable kinds (monaco / markdown viewers); image /
        // pdf / binary tabs fetch raw bytes via `/api/file/raw`.
        // See change: add-internal-monaco-editor-pane.
        const fh = await fs.open(resolved, "r");
        let kindResult;
        let content: string | undefined;
        try {
          const sniffLen = Math.min(1024, stat.size);
          const sniff = Buffer.alloc(sniffLen);
          if (sniffLen > 0) await fh.read(sniff, 0, sniffLen, 0);
          kindResult = fileKind(resolved, sniff);
          if (kindResult.viewer === "monaco" || kindResult.viewer === "markdown") {
            content = await fh.readFile("utf-8");
          }
        } finally {
          await fh.close();
        }
        return {
          success: true,
          data: {
            type: "file",
            kind: kindResult.kind,
            mimeType: kindResult.mimeType,
            size: stat.size,
            // mtime drives the editor's optimistic-concurrency check on write.
            // See change: directory-settings-page-and-scoped-md-editing.
            mtime: Math.round(stat.mtimeMs),
            ...(content !== undefined ? { content } : {}),
          },
        } satisfies ApiResponse;
      } catch {
        reply.code(404);
        return { success: false, error: "not found" } satisfies ApiResponse;
      }
    },
  );

  // Markdown write endpoint — the dashboard's first user-facing write surface.
  //
  // Body: { cwd?, path, content, mtime }.
  //   - cwd present  → directory scope: `path` resolves against cwd; the cwd
  //     must be a known session path (mirrors the read gate).
  //   - cwd absent   → global scope: `path` must be absolute under ~/.pi/agent.
  //
  // Authorization is delegated entirely to `isWritableMdTarget` (the security
  // boundary): realpath-normalized, markdown-only, scope-bounded. Failure → 403.
  // Optimistic concurrency: the on-disk mtime must equal the buffer's loaded
  // mtime, else 409 and the file is left untouched. Success writes atomically
  // (tmp + rename) and returns the new mtime.
  // See change: directory-settings-page-and-scoped-md-editing.
  fastify.post<{ Body: { cwd?: unknown; path?: unknown; content?: unknown; mtime?: unknown } }>(
    "/api/file/write",
    { preHandler: networkGuard },
    async (request, reply) => {
      const prep = await prepareMdWrite(request.body ?? {}, sessionManager);
      if ("code" in prep) {
        reply.code(prep.code);
        return { success: false, error: prep.error } satisfies ApiResponse;
      }
      // Critical section: stat → mtime check → write → rename runs serialized per
      // target so the optimistic check is atomic w.r.t. a concurrent write.
      const outcome = await serializeWrite(prep.resolved, () =>
        performAtomicMdWrite(prep.resolved, prep.content, prep.mtime),
      );
      if (outcome.code !== 200) {
        reply.code(outcome.code);
        return { success: false, error: outcome.error } satisfies ApiResponse;
      }
      return { success: true, data: { mtime: outcome.mtime } } satisfies ApiResponse;
    },
  );

  // Scoped markdown candidate list for the Instructions file picker.
  //   - `cwd` present → directory scope (must be a known session path).
  //   - `cwd` absent  → global scope (~/.pi/agent).
  // Every candidate passes `isWritableMdTarget`, so the picker is a strict
  // subset of what the write guard authorizes (picker ⊆ guard).
  // See change: directory-settings-page-and-scoped-md-editing.
  fastify.get<{ Querystring: { cwd?: string } }>(
    "/api/file/md-candidates",
    { preHandler: networkGuard },
    async (request, reply) => {
      const cwd = request.query.cwd || undefined;
      if (cwd) {
        const allSessions = sessionManager.listAll();
        if (!allSessions.some((s) => s.cwd === cwd)) {
          reply.code(403);
          return { success: false, error: "unknown session path" } satisfies ApiResponse;
        }
      }
      const candidates = await enumerateMdCandidates({ cwd });
      return { success: true, data: { candidates } } satisfies ApiResponse;
    },
  );

  // Scoped markdown read for the Instructions editor. Gated by the SAME
  // `isWritableMdTarget` guard as the write + candidate endpoints, so read /
  // write / list stay in lockstep (picker ⊆ guard). Unlike `/api/file`, this
  // serves the global scope (no session cwd) for `~/.pi/agent/**/*.md`.
  //   - `cwd` present → directory scope (must be a known session path).
  //   - `cwd` absent  → global scope; `path` must be absolute.
  // Returns `{ content, mtime }`. See change: directory-settings-page-and-scoped-md-editing.
  fastify.get<{ Querystring: { cwd?: string; path?: string } }>(
    "/api/file/md-read",
    { preHandler: networkGuard },
    async (request, reply) => {
      const cwd = request.query.cwd || undefined;
      const rawPath = request.query.path;
      if (!rawPath) {
        reply.code(400);
        return { success: false, error: "path parameter required" } satisfies ApiResponse;
      }
      const target = resolveScopedMdPath(cwd, rawPath, sessionManager);
      if ("code" in target) {
        reply.code(target.code);
        return { success: false, error: target.error } satisfies ApiResponse;
      }
      const resolved = target.resolved;
      if (!(await isWritableMdTarget(resolved, { cwd }))) {
        reply.code(403);
        return { success: false, error: "target is not a readable markdown file in scope" } satisfies ApiResponse;
      }
      try {
        const stat = await fs.stat(resolved);
        const content = await fs.readFile(resolved, "utf-8");
        // Full-precision mtime token (matches the write-side conflict check).
        return {
          success: true,
          data: { content, mtime: stat.mtimeMs },
        } satisfies ApiResponse;
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
      // Anti-traversal: probePath MUST be inside cwd (or a pinned dir / repo
      // git root). Pinned-dir anchor is exists-only; not folded onto read/raw/render.
      // Reject relative probes up front: `path.resolve(relative)` would anchor
      // on the SERVER process cwd, not the request cwd — with git-root widening
      // that could turn a malformed probe into an existence check under the
      // server's launch repo. The endpoint contract takes an absolute path.
      if (!path.isAbsolute(probePath)) {
        reply.code(403);
        return { success: false, error: "path outside cwd" } satisfies ApiResponse;
      }
      const resolved = path.resolve(probePath);
      const anchors = [cwd, ...preferencesStore.getPinnedDirectories()];
      if (!(await isAllowed(resolved, { anchors }))) {
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
      // Layers ①/② (cwd + git common root) serve any type. Layer ③ — artifact
      // roots — is image-only and real-path contained; it covers agent
      // screenshots that live outside every cwd and git root.
      // See change: serve-agent-artifact-previews.
      if (
        !(await isAllowed(resolved, { anchors: [cwd] })) &&
        !(await isImageUnderArtifactRoot(resolved))
      ) {
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
      if (!(await isAllowed(resolved, { anchors: [cwd] }))) {
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
