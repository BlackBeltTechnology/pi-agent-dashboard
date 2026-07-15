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
import { EML_SIZE_CAP, loadParsedEml, toParseResult } from "../lib/eml.js";
import { enumerateMdCandidates } from "../lib/md-candidates.js";
import { extToContentType } from "../lib/mime-types.js";
import {
  createDefaultDocxPdfEngine,
  type DocxPdfEngine,
  type DocxRenderMode,
  OFFICE_CAPS,
  type OfficeCaps,
  parseSheet,
  pdfCachePath,
  renderDocx,
  resolveRowLimit,
} from "../lib/office-preview.js";
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

// Shared anti-traversal gate for the EML routes — the SAME check as
// `/api/file/raw` (known session + `isAllowed` against the cwd anchor), factored
// so both new routes CALL it rather than re-implementing the containment logic
// (design D5). Returns the resolved abs path or a {code,error} reply mapping.
async function gateFilePath(
  cwd: string | undefined,
  relPath: string | undefined,
  sessionManager: SessionManager,
): Promise<{ resolved: string } | { code: number; error: string }> {
  if (!cwd || !relPath) return { code: 400, error: "cwd and path parameters required" };
  if (!sessionManager.listAll().some((s) => s.cwd === cwd)) {
    return { code: 403, error: "unknown session path" };
  }
  const resolved = path.resolve(cwd, relPath);
  if (!(await isAllowed(resolved, { anchors: [cwd] }))) {
    return { code: 403, error: "path outside working directory" };
  }
  return { resolved };
}

export function registerFileRoutes(
  fastify: FastifyInstance,
  deps: {
    sessionManager: SessionManager;
    preferencesStore: PreferencesStore;
    networkGuard: NetworkGuard;
    // Office-preview seams (change: render-office-previews). Injectable for
    // tests; production uses the document-converter-backed default + fixed caps.
    docxPdfEngine?: DocxPdfEngine;
    officeCaps?: OfficeCaps;
    docxRenderMode?: DocxRenderMode;
  },
) {
  const { sessionManager, preferencesStore, networkGuard } = deps;
  const officeCaps = deps.officeCaps ?? OFFICE_CAPS;
  const docxRenderMode = deps.docxRenderMode ?? "auto";
  const docxPdfEngine = deps.docxPdfEngine ?? createDefaultDocxPdfEngine();

  // Shared office-file gate (change: render-office-previews). Reuses the
  // `/api/file/raw` anti-traversal posture (known cwd + containment) and adds
  // an extension allowlist (else 400) plus a `stat.size` cap (>cap → 413
  // BEFORE any read). Returns the resolved path + stat, or a {code,error}.
  async function gateOfficeFile(
    cwd: string | undefined,
    relPath: string | undefined,
    allowedExts: string[],
    sizeCap: number,
  ): Promise<
    | { resolved: string; ext: string; stat: import("node:fs").Stats }
    | { code: number; error: string }
  > {
    if (!cwd || !relPath) return { code: 400, error: "cwd and path parameters required" };
    const ext = path.extname(relPath).toLowerCase();
    if (!allowedExts.includes(ext)) return { code: 400, error: "renderer not supported for extension" };
    if (!sessionManager.listAll().some((s) => s.cwd === cwd)) {
      return { code: 403, error: "unknown session path" };
    }
    const resolved = path.resolve(cwd, relPath);
    if (!(await isAllowed(resolved, { anchors: [cwd] }))) {
      return { code: 403, error: "path outside working directory" };
    }
    let stat: import("node:fs").Stats;
    try {
      stat = await fs.stat(resolved);
    } catch {
      return { code: 404, error: "not found" };
    }
    if (stat.size > sizeCap) return { code: 413, error: "file too large to preview" };
    return { resolved, ext, stat };
  }

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

  // Tree-listing endpoint — single source of truth for the editor-pane file
  // rail. Returns `{ entries: {name,isDir}[] }` from ONE
  // `readdir(withFileTypes)`, hidden entries INCLUDED, behind the same gate as
  // `/api/file` (known-cwd + containment). Replaces the old
  // `/api/file`(names)+`/api/browse`(dirs, hidden-stripped) merge that
  // mislabelled hidden directories (`.git`, `.pi`) as files.
  // See change: improve-content-editor.
  fastify.get<{ Querystring: { cwd?: string; path?: string } }>(
    "/api/file/tree",
    { preHandler: networkGuard },
    async (request, reply) => {
      const cwd = request.query.cwd;
      const relPath = request.query.path ? decodeFileUri(request.query.path) : request.query.path;
      if (!cwd || !relPath) {
        reply.code(400);
        return { success: false, error: "cwd and path parameters required" } satisfies ApiResponse;
      }

      if (!sessionManager.listAll().some((s) => s.cwd === cwd)) {
        reply.code(403);
        return { success: false, error: "unknown session path" } satisfies ApiResponse;
      }

      const resolved = path.resolve(cwd, relPath);
      if (!(await isAllowed(resolved, { anchors: [cwd] }))) {
        reply.code(403);
        return { success: false, error: "path outside working directory" } satisfies ApiResponse;
      }

      try {
        const dirents = await fs.readdir(resolved, { withFileTypes: true });
        // `Dirent.isDirectory()` reflects the entry itself, so a symlink → dir
        // reports `false` (isSymbolicLink true). Follow symlinks with a bounded
        // `stat` so symlinked directories still render + expand as folders. Only
        // symlink entries pay the extra stat; normal entries stay single-readdir.
        const entries = await Promise.all(
          dirents.map(async (d) => {
            let isDir = d.isDirectory();
            if (!isDir && d.isSymbolicLink()) {
              try {
                isDir = (await fs.stat(path.join(resolved, d.name))).isDirectory();
              } catch {
                isDir = false; // dangling symlink → treat as a (broken) file
              }
            }
            return { name: d.name, isDir };
          }),
        );
        entries.sort((a, b) =>
          a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1,
        );
        return { success: true, data: { entries } } satisfies ApiResponse;
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

  // Server-side render endpoint (change: render-file-previews;
  // render-office-previews). `.adoc`/`.asciidoc` → asciidoctor `safe:"secure"`
  // HTML. `.docx` → two-tier (design D8): a document-converter PDF render when
  // the engine is available (`{mode:"pdf"}` + companion `/api/file/rendered-pdf`),
  // else an in-process mammoth HTML baseline with the hyperlink-guard (D2),
  // DOMPurify sanitize, and bounded-preview image cap (D3). Non-supported
  // extensions → 400. Same anti-traversal gate as `/api/file/raw`.
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
      const isAdoc = ext === ".adoc" || ext === ".asciidoc";
      const isDocx = ext === ".docx";
      if (!isAdoc && !isDocx) {
        reply.code(400);
        return { success: false, error: "renderer not supported for extension" } satisfies ApiResponse;
      }

      // docx: gate (incl. size cap → 413 before read) then two-tier render.
      if (isDocx) {
        const gate = await gateOfficeFile(cwd, relPath, [".docx"], officeCaps.docxSizeCap);
        if ("code" in gate) {
          reply.code(gate.code);
          return { success: false, error: gate.error } satisfies ApiResponse;
        }
        const result = await renderDocx(
          gate.resolved,
          { mtimeMs: gate.stat.mtimeMs, size: gate.stat.size },
          { mode: docxRenderMode, engine: docxPdfEngine, caps: officeCaps },
        );
        if (!result.success) {
          // Unrenderable tail (corrupt/password/library bug) → 200 + success:false
          // so the client maps it to FallbackPreview (design D5).
          return { success: false, error: result.error } satisfies ApiResponse;
        }
        const { success: _s, ...data } = result;
        return { success: true, data } satisfies ApiResponse;
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

  // Cached docx→PDF byte stream (change: render-office-previews, design D8).
  // Companion to `/api/file/render` `mode:"pdf"`. Serves the cached PDF
  // (path+mtime+size key); regenerates via the engine on cache miss/stale.
  // `.docx`-only; same gate + size cap as the render route.
  fastify.get<{ Querystring: { cwd?: string; path?: string } }>(
    "/api/file/rendered-pdf",
    { preHandler: networkGuard },
    async (request, reply) => {
      const gate = await gateOfficeFile(
        request.query.cwd,
        request.query.path,
        [".docx"],
        officeCaps.docxSizeCap,
      );
      if ("code" in gate) {
        reply.code(gate.code);
        return { success: false, error: gate.error } satisfies ApiResponse;
      }
      const out = pdfCachePath(gate.resolved, gate.stat.mtimeMs, gate.stat.size);
      try {
        await fs.access(out);
      } catch {
        try {
          await fs.mkdir(path.dirname(out), { recursive: true });
          await docxPdfEngine.toPdf(gate.resolved, out);
        } catch (err) {
          reply.code(500);
          return {
            success: false,
            error: err instanceof Error ? err.message : "failed to render pdf",
          } satisfies ApiResponse;
        }
      }
      reply.header("Content-Type", "application/pdf");
      reply.header("Content-Disposition", "inline");
      reply.header("Cache-Control", "private, max-age=60");
      return reply.send(createReadStream(out));
    },
  );

  // Spreadsheet parse endpoint (change: render-office-previews). Parses
  // `.xlsx`/`.csv` to bounded structured JSON with SheetJS (no Docker). `.csv`
  // encoding is detected (chardet) + decoded (iconv-lite) so CP1250 renders
  // correctly (design D6). `.xlsx`/`.csv`-only → 400; size cap → 413 before read;
  // corrupt/password-protected → 200 + success:false (design D5).
  fastify.get<{ Querystring: { cwd?: string; path?: string; limit?: string } }>(
    "/api/file/sheet",
    { preHandler: networkGuard },
    async (request, reply) => {
      const gate = await gateOfficeFile(
        request.query.cwd,
        request.query.path,
        [".xlsx", ".csv"],
        officeCaps.sheetSizeCap,
      );
      if ("code" in gate) {
        reply.code(gate.code);
        return { success: false, error: gate.error } satisfies ApiResponse;
      }
      let buffer: Buffer;
      try {
        buffer = await fs.readFile(gate.resolved);
      } catch {
        reply.code(404);
        return { success: false, error: "not found" } satisfies ApiResponse;
      }
      const limit = request.query.limit ? Number(request.query.limit) : undefined;
      const rowLimit = resolveRowLimit(limit, officeCaps);
      const result = await parseSheet(buffer, gate.ext, { rowLimit, colCap: officeCaps.colCap });
      if (!result.success) {
        return { success: false, error: result.error } satisfies ApiResponse;
      }
      const { success: _s, ...data } = result;
      return { success: true, data } satisfies ApiResponse;
    },
  );

  // Server-side EML (message/rfc822) parse (change: add-eml-preview).
  // Parses with `mailparser`, sanitizes the HTML body with DOMPurify, and
  // returns metadata-only JSON (headers, sanitized html, text, attachment
  // metadata) — the raw ~15 MB base64 never reaches the client. Non-`.eml` →
  // 400; over the size cap → 413 BEFORE read; malformed MIME → 400 (no crash).
  // `allowRemote=1` preserves remote resource refs (the browser fetches them,
  // never the server — no SSRF). Shares the `/api/file/raw` anti-traversal gate.
  fastify.get<{ Querystring: { cwd?: string; path?: string; allowRemote?: string } }>(
    "/api/file/eml",
    { preHandler: networkGuard },
    async (request, reply) => {
      const gate = await gateFilePath(request.query.cwd, request.query.path, sessionManager);
      if ("code" in gate) {
        reply.code(gate.code);
        return { success: false, error: gate.error } satisfies ApiResponse;
      }
      const ext = path.extname(request.query.path ?? "").toLowerCase();
      if (ext !== ".eml") {
        reply.code(400);
        return { success: false, error: "renderer not supported for extension" } satisfies ApiResponse;
      }
      let stat;
      try {
        stat = await fs.stat(gate.resolved);
      } catch {
        reply.code(404);
        return { success: false, error: "not found" } satisfies ApiResponse;
      }
      if (!stat.isFile()) {
        reply.code(404);
        return { success: false, error: "not a file" } satisfies ApiResponse;
      }
      if (stat.size > EML_SIZE_CAP) {
        reply.code(413);
        return { success: false, error: "file too large" } satisfies ApiResponse;
      }
      try {
        const parsed = await loadParsedEml(gate.resolved, stat);
        const data = toParseResult(parsed, { allowRemote: request.query.allowRemote === "1" });
        return { success: true, data } satisfies ApiResponse;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "failed to parse EML";
        reply.code(400);
        return { success: false, error: msg } satisfies ApiResponse;
      }
    },
  );

  // EML attachment streaming (change: add-eml-preview).
  // Streams ONE decoded attachment part by 0-based `index`. ALWAYS sends
  // `Content-Disposition: attachment` (never inline) + `X-Content-Type-Options:
  // nosniff`, so an attacker-declared `text/html`/SVG part cannot execute in the
  // dashboard origin — inline previews consume the bytes as a `blob:` URL, not by
  // navigating to this route. Non-integer/negative index → 400; out-of-range →
  // 404. Shares the `/api/file/raw` anti-traversal gate + the parse cache.
  fastify.get<{ Querystring: { cwd?: string; path?: string; index?: string } }>(
    "/api/file/eml-attachment",
    { preHandler: networkGuard },
    async (request, reply) => {
      const gate = await gateFilePath(request.query.cwd, request.query.path, sessionManager);
      if ("code" in gate) {
        reply.code(gate.code);
        return { success: false, error: gate.error } satisfies ApiResponse;
      }
      if (path.extname(request.query.path ?? "").toLowerCase() !== ".eml") {
        reply.code(400);
        return { success: false, error: "renderer not supported for extension" } satisfies ApiResponse;
      }
      const rawIndex = request.query.index ?? "";
      const index = Number(rawIndex);
      if (rawIndex === "" || !Number.isInteger(index) || index < 0) {
        reply.code(400);
        return { success: false, error: "index must be a non-negative integer" } satisfies ApiResponse;
      }
      let stat;
      try {
        stat = await fs.stat(gate.resolved);
      } catch {
        reply.code(404);
        return { success: false, error: "not found" } satisfies ApiResponse;
      }
      if (stat.size > EML_SIZE_CAP) {
        reply.code(413);
        return { success: false, error: "file too large" } satisfies ApiResponse;
      }
      let parsed;
      try {
        parsed = await loadParsedEml(gate.resolved, stat);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "failed to parse EML";
        reply.code(400);
        return { success: false, error: msg } satisfies ApiResponse;
      }
      const att = parsed.attachments?.[index];
      if (!att) {
        reply.code(404);
        return { success: false, error: "attachment index out of range" } satisfies ApiResponse;
      }
      // Header-safe filename: strip CR/LF/quote (anti-injection), fold non-ASCII
      // to `_` for the legacy `filename=`, and carry the exact name via RFC 5987
      // `filename*` so UTF-8 names (e.g. Hungarian) survive.
      const rawName = (att.filename || `attachment-${index}`).replace(/["\r\n]/g, "");
      const asciiName = rawName.replace(/[^\x20-\x7e]/g, "_");
      reply.header("Content-Type", att.contentType || "application/octet-stream");
      reply.header(
        "Content-Disposition",
        `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(rawName)}`,
      );
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("Cache-Control", "private, max-age=60");
      reply.header("Content-Length", String(att.content.length));
      return reply.send(att.content);
    },
  );
}
