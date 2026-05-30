/**
 * File, directory browse, and README REST API routes (localhost-only).
 */
import type { FastifyInstance } from "fastify";
import type { SessionManager } from "../memory-session-manager.js";
import type { PreferencesStore } from "../preferences-store.js";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { NetworkGuard } from "./route-deps.js";
import { listDirectories, createDirectory, classifyPaths, parseFlagsQuery } from "../browse.js";
import path from "node:path";
import fs from "node:fs/promises";

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

  // README endpoint — read README.md from a directory
  fastify.get<{ Querystring: { cwd?: string; check?: string } }>(
    "/api/readme",
    { preHandler: networkGuard },
    async (request, reply) => {
      const cwd = request.query.cwd;
      if (!cwd) {
        reply.code(400);
        return { success: false, error: "cwd parameter required" } satisfies ApiResponse;
      }

      const allSessions = sessionManager.listAll();
      const knownCwds = new Set(allSessions.map((s) => s.cwd));
      for (const dir of preferencesStore.getPinnedDirectories()) knownCwds.add(dir);

      if (!knownCwds.has(cwd)) {
        reply.code(403);
        return { success: false, error: "unknown directory" } satisfies ApiResponse;
      }

      const readmePath = path.join(cwd, "README.md");
      try {
        if (request.query.check) {
          await fs.access(readmePath);
          return { success: true, data: { exists: true } } satisfies ApiResponse;
        }
        const content = await fs.readFile(readmePath, "utf-8");
        return { success: true, data: { content } } satisfies ApiResponse;
      } catch {
        reply.code(404);
        return { success: false, error: "README.md not found" } satisfies ApiResponse;
      }
    },
  );

  // Pinned directories endpoint
  fastify.get("/api/pinned-dirs", async () => {
    return { success: true, data: preferencesStore.getPinnedDirectories() } satisfies ApiResponse;
  });
}
