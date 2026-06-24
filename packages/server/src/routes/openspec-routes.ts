/**
 * OpenSpec and Pi Resources REST API routes (localhost-only).
 */
import type { FastifyInstance } from "fastify";
import type { SessionManager } from "../memory-session-manager.js";
import type { PreferencesStore } from "../preferences-store.js";
import { hasOpenSpecRoot, type DirectoryService } from "../directory-service.js";
import type { ApiResponse, OpenSpecConfig } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import {
  configListOrAsync,
  configProfile,
  update as openspecUpdate,
  writeOpenSpecConfigFile,
  workflowSetSignature,
  openSpecConfigFilePath,
  EXPANDED_WORKFLOWS,
} from "@blackbelt-technology/pi-dashboard-shared/platform/openspec.js";
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
      // Profile/workflows are a single global value, so cwd is optional: when
      // omitted, run `openspec config list` in any known project (or process
      // cwd) so the Settings section can read the global config without a cwd.
      // See change: add-openspec-profile-settings.
      const cwd = request.query.cwd ?? knownCwds()[0] ?? process.cwd();
      const now = Date.now();
      const cached = configCache.get(cwd);
      if (cached && now - cached.ts < CONFIG_TTL_MS) {
        return { success: true, data: cached.data } satisfies ApiResponse;
      }
      // Async spawn so a cold read (openspec CLI ~1s) never blocks the event
      // loop / stalls concurrent requests. See change: fix-openspec-profile-load-race.
      const raw = (await configListOrAsync({ cwd }, null)) as Partial<OpenSpecConfig> | null;
      // Defensive normalisation: missing fields fall back to safe defaults
      // so the client always receives a well-formed OpenSpecConfig shape.
      const data: OpenSpecConfig = {
        profile: (raw?.profile as OpenSpecConfig["profile"]) ?? "custom",
        delivery: (raw?.delivery as OpenSpecConfig["delivery"]) ?? "both",
        workflows: Array.isArray(raw?.workflows) ? (raw!.workflows as string[]) : [],
      };
      // The openspec CLI cannot persist an "expanded" profile: it has no such
      // preset and `getProfileWorkflows` treats every non-"custom" profile as
      // core on `openspec update`, dropping the extra workflows. So the dashboard
      // stores "expanded" as custom + EXPANDED_WORKFLOWS. Re-surface the alias
      // here so the Settings radio reflects the user's actual choice.
      // See change: fix-openspec-expanded-profile-update.
      if (data.profile === "custom" && isExpandedWorkflowSet(data.workflows)) {
        data.profile = "expanded";
      }
      configCache.set(cwd, { ts: now, data });
      return { success: true, data } satisfies ApiResponse;
    },
  );

  // ── add-openspec-profile-settings ─────────────────────────────────────
  // The global OpenSpec config lives at `~/.config/openspec/config.json`, so
  // `~/.config` has an `openspec/` child and would otherwise pass the
  // root-existence check as a bogus "project". Exclude the cwd whose
  // `openspec/` IS that global config dir.
  // See change: add-openspec-profile-settings.
  const GLOBAL_OPENSPEC_DIR = path.dirname(openSpecConfigFilePath()); // ~/.config/openspec

  // True when `workflows` is exactly the EXPANDED_WORKFLOWS set (order-agnostic).
  // Used to re-surface a custom-persisted expanded profile as the "expanded"
  // alias on read. See change: fix-openspec-expanded-profile-update.
  const EXPANDED_SET = new Set(EXPANDED_WORKFLOWS);
  function isExpandedWorkflowSet(workflows: string[]): boolean {
    if (workflows.length !== EXPANDED_SET.size) return false;
    const seen = new Set(workflows);
    if (seen.size !== EXPANDED_SET.size) return false;
    for (const w of seen) if (!EXPANDED_SET.has(w)) return false;
    return true;
  }

  // openspec's `update` degrades a literal "expanded" profile to the 4 core
  // workflows (the CLI has no expanded preset). The dashboard now persists
  // expanded AS custom+EXPANDED_WORKFLOWS, but configs written by older builds
  // (or external tools) may still hold the literal "expanded" on disk — in which
  // case `openspec update` would silently regenerate only the 4 core skills.
  // Heal such a config in place before any update so the CLI honors all 11.
  // See change: fix-openspec-expanded-profile-update.
  async function healExpandedProfileConfig(cwd: string): Promise<void> {
    const raw = (await configListOrAsync({ cwd }, null)) as { profile?: string } | null;
    if (raw?.profile === "expanded") {
      writeOpenSpecConfigFile({ profile: "custom", workflows: [...EXPANDED_WORKFLOWS] });
      configCache.clear();
    }
  }

  // Known cwds = union(active session cwds, pinned dirs), filtered to only
  // OpenSpec-initialized projects (`<cwd>/openspec/` exists). Directories
  // where `openspec init` never ran are excluded: `openspec update` there is
  // meaningless and they must not clutter the project list. The global config
  // dir's parent (`~/.config`) is also excluded — its `openspec/` child is the
  // CLI config dir, not a project.
  // See change: add-openspec-profile-settings.
  function knownCwds(): string[] {
    const set = new Set<string>();
    for (const s of sessionManager.listAll()) if (s.cwd) set.add(s.cwd);
    for (const d of preferencesStore.getPinnedDirectories()) set.add(d);
    return [...set].filter(
      (cwd) => hasOpenSpecRoot(cwd) && path.join(cwd, "openspec") !== GLOBAL_OPENSPEC_DIR,
    );
  }

  /**
   * Current global workflow-set signature (drives staleness comparison).
   * Async (non-blocking spawn): the profile is machine-global, so the signature
   * is identical for every cwd — callers compute it ONCE per request rather than
   * spawning the CLI per project (which blocked the event loop ~1s×N and stalled
   * concurrent reads). See change: fix-openspec-profile-load-race.
   */
  async function currentGlobalSignature(cwd: string): Promise<string> {
    const raw = (await configListOrAsync({ cwd }, null)) as { workflows?: string[] } | null;
    return workflowSetSignature(Array.isArray(raw?.workflows) ? raw!.workflows! : []);
  }

  // POST /api/openspec/config — write the global OpenSpec workflow profile.
  // core → CLI preset; expanded/custom → atomic JSON write. Never mutates a
  // project repo and never runs `openspec update`.
  fastify.post<{ Body: { profile?: string; workflows?: string[]; cwd?: string } }>(
    "/api/openspec/config",
    { preHandler: networkGuard },
    async (request, reply) => {
      const body = request.body ?? {};
      const profile = body.profile;
      if (profile !== "core" && profile !== "expanded" && profile !== "custom") {
        reply.code(400);
        return { success: false, error: "invalid profile" } satisfies ApiResponse;
      }
      // cwd is only needed for the `core` preset invocation (CLI runs in a dir).
      const cwd = body.cwd ?? knownCwds()[0] ?? process.cwd();

      if (profile === "core") {
        const res = configProfile({ cwd, preset: "core" });
        if (!res.ok) {
          reply.code(500);
          return { success: false, error: "openspec config profile core failed" } satisfies ApiResponse;
        }
      } else {
        const workflows = profile === "expanded"
          ? [...EXPANDED_WORKFLOWS]
          : Array.isArray(body.workflows) ? body.workflows : [];
        // openspec's `getProfileWorkflows` only honors an explicit workflow list
        // when the persisted profile is "custom"; a literal "expanded" degrades
        // to the 4 core workflows on `openspec update`, so the expanded skills
        // never land in projects. Persist "expanded" AS custom + the full set so
        // `openspec update` materializes all 11 skills; the GET handler maps it
        // back to the "expanded" alias. See change: fix-openspec-expanded-profile-update.
        const persistedProfile = profile === "expanded" ? "custom" : profile;
        const res = writeOpenSpecConfigFile({ profile: persistedProfile, workflows });
        if (!res.success) {
          reply.code(500);
          return { success: false, error: res.error ?? "write failed" } satisfies ApiResponse;
        }
      }

      // Bust the 30s config cache so the next GET returns fresh data.
      configCache.clear();
      return { success: true } satisfies ApiResponse;
    },
  );

  // POST /api/openspec/update — run `openspec update` for one cwd or all.
  // Records the post-update workflow signature so staleness can be computed.
  fastify.post<{ Body: { cwd?: string; all?: boolean } }>(
    "/api/openspec/update",
    { preHandler: networkGuard },
    async (request, reply) => {
      const body = request.body ?? {};
      const targets = body.all ? knownCwds() : body.cwd ? [body.cwd] : [];
      if (targets.length === 0) {
        reply.code(400);
        return { success: false, error: "cwd or all required" } satisfies ApiResponse;
      }
      // Self-heal a stale literal "expanded" profile to custom+11 BEFORE running
      // the CLI, otherwise `openspec update` regenerates only the 4 core skills.
      // See change: fix-openspec-expanded-profile-update.
      await healExpandedProfileConfig(targets[0] ?? process.cwd());
      // Profile is global — the post-update signature is the same for every cwd.
      const sig = await currentGlobalSignature(targets[0] ?? process.cwd());
      const results: Array<{ cwd: string; success: boolean; error?: string }> = [];
      for (const cwd of targets) {
        const res = openspecUpdate({ cwd });
        if (res.ok) {
          preferencesStore.setOpenSpecUpdateSignature(cwd, sig);
          results.push({ cwd, success: true });
        } else {
          results.push({ cwd, success: false, error: "openspec update failed" });
        }
      }
      return { success: true, data: { results } } satisfies ApiResponse;
    },
  );

  // GET /api/openspec/update-status — per-cwd staleness vs current global config.
  fastify.get(
    "/api/openspec/update-status",
    { preHandler: networkGuard },
    async () => {
      const cwds = knownCwds();
      // One async spawn for the whole request: the signature is global, so it is
      // identical for every cwd. See change: fix-openspec-profile-load-race.
      const current = await currentGlobalSignature(cwds[0] ?? process.cwd());
      const statuses = cwds.map((cwd) => {
        const recorded = preferencesStore.getOpenSpecUpdateSignature(cwd);
        if (!recorded) return { cwd, status: "unknown" as const };
        return { cwd, status: recorded === current ? ("up-to-date" as const) : ("needs-update" as const) };
      });
      return { success: true, data: { statuses } } satisfies ApiResponse;
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
