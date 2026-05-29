/**
 * OpenSpec and Pi Resources REST API routes (localhost-only).
 */
import type { FastifyInstance } from "fastify";
import type { SessionManager } from "../memory-session-manager.js";
import type { PreferencesStore } from "../preferences-store.js";
import type { DirectoryService } from "../directory-service.js";
import type { ApiResponse, OpenSpecConfig } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { configListOr } from "@blackbelt-technology/pi-dashboard-shared/platform/openspec.js";
import type { NetworkGuard } from "./route-deps.js";
import { scanOpenSpecArchive } from "../openspec-archive.js";
import {
  readTasks,
  toggleTask,
  NotFoundError,
  LineMismatchError,
  NotACheckboxError,
} from "../openspec-tasks.js";
import path from "node:path";
import fs from "node:fs/promises";

/** Callback to broadcast an openspec_update after a successful toggle. */
export type OpenSpecBroadcaster = (cwd: string) => void;

export function registerOpenSpecRoutes(
  fastify: FastifyInstance,
  deps: {
    sessionManager: SessionManager;
    preferencesStore: PreferencesStore;
    directoryService: DirectoryService;
    networkGuard: NetworkGuard;
    /** Optional — called after a successful toggle to trigger openspec_update. */
    onOpenSpecChanged?: OpenSpecBroadcaster;
  },
) {
  const { sessionManager, preferencesStore, directoryService, networkGuard, onOpenSpecChanged } = deps;

  // OpenSpec workflow config endpoint — returns the user's enabled
  // workflow commands so the client can render only the buttons /
  // stepper nodes whose backing command is enabled.
  // See change: redesign-session-card-and-composer (config-driven-workflow).
  const configCache = new Map<string, { ts: number; data: OpenSpecConfig }>();
  const CONFIG_TTL_MS = 30_000;

  fastify.get<{ Querystring: { cwd?: string } }>(
    "/api/openspec/config",
    { preHandler: networkGuard },
    async (request, reply) => {
      const cwd = request.query.cwd;
      if (!cwd) {
        reply.code(400);
        return { success: false, error: "Missing cwd" } satisfies ApiResponse;
      }
      const now = Date.now();
      const cached = configCache.get(cwd);
      if (cached && now - cached.ts < CONFIG_TTL_MS) {
        return { success: true, data: cached.data } satisfies ApiResponse;
      }
      const raw = configListOr({ cwd }, null) as Partial<OpenSpecConfig> | null;
      // Defensive normalisation: missing fields fall back to safe defaults
      // so the client always receives a well-formed OpenSpecConfig shape.
      const data: OpenSpecConfig = {
        profile: (raw?.profile as OpenSpecConfig["profile"]) ?? "custom",
        delivery: (raw?.delivery as OpenSpecConfig["delivery"]) ?? "both",
        workflows: Array.isArray(raw?.workflows) ? (raw!.workflows as string[]) : [],
      };
      configCache.set(cwd, { ts: now, data });
      return { success: true, data } satisfies ApiResponse;
    },
  );

  // OpenSpec archive listing endpoint
  fastify.get<{ Querystring: { cwd?: string } }>(
    "/api/openspec-archive",
    { preHandler: networkGuard },
    async (request, reply) => {
      const cwd = request.query.cwd;
      if (!cwd) {
        reply.code(400);
        return { success: false, error: "Missing cwd" } satisfies ApiResponse;
      }
      const data = await scanOpenSpecArchive(cwd);
      return { success: true, data } satisfies ApiResponse;
    },
  );

  // Pi Resources endpoint — returns discovered extensions, skills, prompts
  fastify.get<{ Querystring: { cwd?: string; refresh?: string } }>(
    "/api/pi-resources",
    { preHandler: networkGuard },
    async (request, reply) => {
      const cwd = request.query.cwd;
      if (!cwd) {
        reply.code(400);
        return { success: false, error: "cwd parameter required" } satisfies ApiResponse;
      }
      // Bootstrap gate removed under change: eliminate-electron-runtime-install
      // (task 3.5). pi/openspec/tsx ship as regular npm deps; pi-resources
      // endpoint is unconditionally available.
      const forceRefresh = request.query.refresh === "true" || request.query.refresh === "1";
      let data = forceRefresh ? undefined : directoryService.getPiResources(cwd);
      if (!data) {
        data = await directoryService.refreshPiResources(cwd);
      }
      return { success: true, data } satisfies ApiResponse;
    },
  );

  // Pi Resource file endpoint — reads files from allowed pi resource locations
  fastify.get<{ Querystring: { path?: string } }>(
    "/api/pi-resource-file",
    { preHandler: networkGuard },
    async (request, reply) => {
      const filePath = request.query.path;
      if (!filePath) {
        reply.code(400);
        return { success: false, error: "path parameter required" } satisfies ApiResponse;
      }

      const homeDir = process.env.HOME || process.env.USERPROFILE || "";
      const globalPiDir = path.join(homeDir, ".pi", "agent");
      const allSessions = sessionManager.listAll();
      const knownCwds = new Set(allSessions.map((s) => s.cwd));
      for (const dir of preferencesStore.getPinnedDirectories()) knownCwds.add(dir);

      const normalizedPath = path.resolve(filePath);
      const isAllowed =
        normalizedPath.startsWith(globalPiDir + path.sep) ||
        [...knownCwds].some(
          (cwd) => normalizedPath.startsWith(path.join(cwd, ".pi") + path.sep),
        ) ||
        normalizedPath.includes(path.join(".pi", "git") + path.sep) ||
        normalizedPath.includes("node_modules" + path.sep);

      if (!isAllowed) {
        reply.code(403);
        return { success: false, error: "path not in allowed resource location" } satisfies ApiResponse;
      }

      try {
        const content = await fs.readFile(normalizedPath, "utf-8");
        return { success: true, data: { type: "file", content } } satisfies ApiResponse;
      } catch {
        reply.code(404);
        return { success: false, error: "not found" } satisfies ApiResponse;
      }
    },
  );

  // --- Tasks.md list + toggle ---

  fastify.get<{ Querystring: { cwd?: string; change?: string } }>(
    "/api/openspec/tasks",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { cwd, change } = request.query;
      if (!cwd || !change) {
        reply.code(400);
        return { success: false, error: "cwd and change query params required" } satisfies ApiResponse;
      }
      try {
        const tasks = await readTasks(cwd, change);
        const groups = Array.from(new Set(tasks.map((t) => t.group).filter((g) => g.length > 0)));
        return { success: true, data: { tasks, groups } } satisfies ApiResponse;
      } catch (err: any) {
        if (err instanceof NotFoundError) {
          reply.code(404);
          return { success: false, error: "tasks.md not found" } satisfies ApiResponse;
        }
        reply.code(500);
        return { success: false, error: err?.message ?? "read error" } satisfies ApiResponse;
      }
    },
  );

  fastify.post<{
    Body: { cwd?: string; change?: string; id?: string; done?: boolean; line?: number };
  }>(
    "/api/openspec/tasks/toggle",
    { preHandler: networkGuard },
    async (request, reply) => {
      const body = request.body ?? {};
      const { cwd, change, id, done, line } = body;
      if (
        typeof cwd !== "string" ||
        typeof change !== "string" ||
        typeof id !== "string" ||
        typeof done !== "boolean" ||
        typeof line !== "number"
      ) {
        reply.code(400);
        return { success: false, error: "invalid body" } satisfies ApiResponse;
      }
      try {
        const task = await toggleTask(cwd, change, id, done, line);
        // Fire-and-forget: refresh cache + broadcast openspec_update.
        directoryService.refreshOpenSpec(cwd).then(() => {
          onOpenSpecChanged?.(cwd);
        }).catch(() => {});
        return { success: true, data: { task } } satisfies ApiResponse;
      } catch (err: any) {
        if (err instanceof NotFoundError) {
          reply.code(404);
          return { success: false, error: "tasks.md not found" } satisfies ApiResponse;
        }
        if (err instanceof LineMismatchError) {
          reply.code(409);
          return { success: false, error: "line mismatch" } satisfies ApiResponse;
        }
        if (err instanceof NotACheckboxError) {
          reply.code(400);
          return { success: false, error: "target line is not a checkbox" } satisfies ApiResponse;
        }
        reply.code(500);
        return { success: false, error: err?.message ?? "toggle error" } satisfies ApiResponse;
      }
    },
  );
}
