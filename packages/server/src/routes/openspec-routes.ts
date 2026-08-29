/**
 * OpenSpec and Pi Resources REST API routes (localhost-only).
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  configListAsync,
  configListOrAsync,
  configProfile,
  EXPANDED_WORKFLOWS,
  initAsync as openspecInitAsync,
  initHelpAsync as openspecInitHelpAsync,
  openSpecConfigFilePath,
  update as openspecUpdate,
  workflowSetSignature,
  writeOpenSpecConfigFile,
} from "@blackbelt-technology/pi-dashboard-shared/platform/openspec.js";
import { getDefaultRegistry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import { currentGlobalWorkflowSignature } from "../openspec/global-signature.js";
import type { ApiResponse, OpenSpecConfig } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FastifyInstance } from "fastify";
import { type DirectoryService, hasOpenSpecRoot } from "../directory-service.js";
import { scanOpenSpecArchive } from "../openspec/openspec-archive.js";
import {
  LineMismatchError,
  NotACheckboxError,
  NotFoundError,
  readTasks,
  toggleTask,
} from "../openspec/openspec-tasks.js";
import type { PreferencesStore } from "../persistence/preferences-store.js";
import { isWithinFolder, joinSkillProvenance, type SkillReporter, sessionCommandRegistry } from "../pi/session-skill-registry.js";
import type { SessionManager } from "../session/memory-session-manager.js";
import type { NetworkGuard } from "./route-deps.js";

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
      //
      // Use the Result-returning variant (not `configListOrAsync`) so a CLI
      // spawn/exit failure (e.g. exit 127 when the bundled Electron server's
      // stripped PATH can't run the `#!/usr/bin/env node` shebang) surfaces as
      // a distinct error state instead of silently degrading to an empty
      // `{ profile:"custom", workflows:[] }` that the Settings panel renders as
      // "not found." The client throws on this 502 and shows a retry state.
      // See change: fix-openspec-config-read-bundled-node.
      const result = await configListAsync({ cwd });
      if (!result.ok) {
        reply.code(502);
        return { success: false, error: "openspec config read failed" } satisfies ApiResponse;
      }
      const raw = result.value as Partial<OpenSpecConfig> | null;
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

  // POST /api/openspec/init — run `openspec init <cwd> --tools pi --force`.
  // See change: add-openspec-init-affordances.
  //
  // Validation uses the UN-filtered known-directory set: `knownCwds()` filters
  // to hasOpenSpecRoot (initialized projects only) and so excludes exactly
  // the directories init exists to target.
  function knownInitTargets(): string[] {
    const set = new Set<string>();
    for (const s of sessionManager.listAll()) if (s.cwd) set.add(s.cwd);
    for (const d of preferencesStore.getPinnedDirectories()) set.add(d);
    return [...set].filter((cwd) => path.join(cwd, "openspec") !== GLOBAL_OPENSPEC_DIR);
  }

  // Process-lifetime cache of the `init --help` support probe (X6: two init
  // requests probe once). Undefined until the first probe. Only SUCCESS is
  // memoized — a transient probe failure must not brick init until restart
  // (review round 1). See change: add-openspec-init-affordances.
  let initSupportProbe: Promise<boolean> | undefined;

  // ── Legacy-artifact detection for the overwrite-confirm gate ──
  // Coarse mirror of the pinned CLI's `legacy-cleanup.js`: `--tools` alone
  // authorizes cleanup, and cleanup REMOVES marker blocks from root config
  // files and DELETES legacy slash-command dirs/files without further
  // prompting — so `<cwd>/openspec/` presence alone misses legacy projects
  // (AGENTS.md markers + .claude/commands/openspec/, no openspec/ dir) that
  // would be destructively edited on a plain Initialize. Markers + path list
  // mirror @fission-ai/openspec@1.6.0 dist/core/legacy-cleanup.js; version
  // drift degrades to fewer confirmations, never to a wrong refusal. See
  // change: add-openspec-init-affordances (review round 1).
  const LEGACY_CONFIG_FILES = [
    "CLAUDE.md", "CLINE.md", "CODEBUDDY.md", "COSTRICT.md",
    "QODER.md", "IFLOW.md", "AGENTS.md", "QWEN.md",
  ];
  const OPENSPEC_MARKER_START = "<!-- OPENSPEC:START -->";
  const OPENSPEC_MARKER_END = "<!-- OPENSPEC:END -->";
  const LEGACY_COMMAND_DIRS = [
    ".claude/commands/openspec", ".codebuddy/commands/openspec",
    ".qoder/commands/openspec", ".lingma/commands/openspec",
    ".crush/commands/openspec", ".gemini/commands/openspec",
    ".cospec/openspec/commands",
  ];
  const LEGACY_COMMAND_FILE_DIRS = [
    ".cursor/commands", ".windsurf/workflows", ".kilocode/workflows",
    ".kiro/prompts", ".github/prompts", ".amazonq/prompts",
    ".clinerules/workflows", ".roo/commands", ".augment/commands",
    ".factory/commands", ".continue/prompts", ".agent/workflows",
    ".iflow/commands", ".qwen/commands", ".codex/prompts",
    // opencode + junie are the only `opsx-*` producers — without these two
    // entries the opsx- prefix check below is dead code (review round 2).
    ".opencode/command", ".junie/commands",
  ];

  async function hasLegacyOpenSpecArtifacts(cwd: string): Promise<boolean> {
    for (const f of LEGACY_CONFIG_FILES) {
      try {
        const content = await fs.readFile(path.join(cwd, f), "utf-8");
        if (content.includes(OPENSPEC_MARKER_START) && content.includes(OPENSPEC_MARKER_END)) return true;
      } catch { /* absent */ }
    }
    for (const d of LEGACY_COMMAND_DIRS) {
      try {
        await fs.stat(path.join(cwd, d));
        return true;
      } catch { /* absent */ }
    }
    for (const dir of LEGACY_COMMAND_FILE_DIRS) {
      try {
        const entries = await fs.readdir(path.join(cwd, dir));
        if (entries.some((e) => e.startsWith("openspec-") || e.startsWith("opsx-"))) return true;
      } catch { /* absent */ }
    }
    return false;
  }

  // Per-cwd serialization (X4): while an invocation is in flight for a cwd,
  // a second request is rejected 409 without spawning. The lock is released
  // on every exit path, including the 60s timeout (X3).
  const inFlightInits = new Set<string>();

  fastify.post<{ Body: { cwd?: string; confirm?: boolean } }>(
    "/api/openspec/init",
    { preHandler: networkGuard },
    async (request, reply) => {
      const cwd = request.body?.cwd;
      if (!cwd) {
        reply.code(400);
        return { success: false, error: "cwd required" } satisfies ApiResponse;
      }
      if (!knownInitTargets().includes(cwd)) {
        reply.code(400);
        return { success: false, error: "cwd is not a known session or pinned directory" } satisfies ApiResponse;
      }

      // Overwrite confirmation. Two coarse triggers, both deliberate:
      //   1. <cwd>/openspec/ presence — the spec's minimum contract.
      //   2. legacy OpenSpec artifacts (marker-bearing root config files,
      //      legacy command dirs/files) — the CLI's cleanup removes these
      //      without prompting once --tools is present (review round 1).
      // The CLI's internal detection is not reachable through public exports;
      // by the time the CLI runs, cleanup is already authorized.
      const hasOpenspecRootAlready = await fs
        .stat(path.join(cwd, "openspec"))
        .then(() => true)
        .catch(() => false);
      const legacyArtifacts = hasOpenspecRootAlready ? false : await hasLegacyOpenSpecArtifacts(cwd);
      if ((hasOpenspecRootAlready || legacyArtifacts) && request.body?.confirm !== true) {
        reply.code(400);
        return {
          success: false,
          error: `refusing to overwrite existing OpenSpec files in ${cwd} without confirmation`,
          code: "confirm_required",
        } satisfies ApiResponse & { code?: string };
      }

      // CLI support probe: refuse BEFORE spawning a CLI whose init does not
      // register --tools (commander is strict — the invocation would fail
      // anyway, but the refusal can name the resolved binary).
      initSupportProbe ??= openspecInitHelpAsync().then(
        (r) => {
          if (r.ok) return r.value.includes("--tools");
          // Failure is NOT memoized: a transient probe failure (CLI briefly
          // unavailable) must not brick init until restart (review round 1).
          initSupportProbe = undefined;
          return false;
        },
        () => {
          initSupportProbe = undefined;
          return false;
        },
      );
      if (!(await initSupportProbe)) {
        const resolved = getDefaultRegistry().resolve("openspec");
        reply.code(400);
        return {
          success: false,
          error: `resolved OpenSpec CLI does not support non-interactive init (--tools): ${resolved.path ?? "unresolved"}`,
        } satisfies ApiResponse;
      }

      if (inFlightInits.has(cwd)) {
        reply.code(409);
        return { success: false, error: "an init is already in flight for this directory" } satisfies ApiResponse;
      }
      inFlightInits.add(cwd);

      try {
        // Heal a stale literal "expanded" profile BEFORE the spawn — init
        // reads the global config, and --profile cannot carry the alias
        // (F3b). Mirrors /api/openspec/update. See change:
        // fix-openspec-expanded-profile-update.
        await healExpandedProfileConfig(cwd);

        const res = await openspecInitAsync({ cwd });
        if (!res.ok) {
          const err = res.error;
          const partialStderr = err.kind === "exit" || err.kind === "timeout"
            ? [err.stderr, err.stdout].filter(Boolean).join("\n")
            : err.kind === "spawn-failure"
              ? err.message
              : undefined;
          const message = err.kind === "timeout"
            ? `openspec init timed out after ${err.timeoutMs}ms and was killed`
            : err.kind === "exit"
              ? `openspec init exited with code ${err.code ?? "signal " + err.signal}`
              : err.kind === "not-found"
                ? "OpenSpec CLI could not be resolved"
                : err.message;
          reply.code(500);
          return {
            success: false,
            error: message,
            ...(partialStderr ? { stderr: partialStderr } : {}),
          } satisfies ApiResponse & { stderr?: string };
        }

        // Record the post-init signature (mirrors update) so a freshly
        // initialized project is `up-to-date`, not `unknown` forever. Uses the
        // hardened shared provider: when the CLI read fails the signature is
        // UNKNOWN and is deliberately NOT recorded — recording a fabricated
        // empty-set signature would present the fresh project as
        // `STALE · profile-stale` on the next healthy tick (review round 1).
        // Then force a poll refresh so the new READY readiness broadcasts
        // without waiting for the poll interval.
        const sig = await currentGlobalWorkflowSignature(cwd);
        if (sig !== undefined) {
          preferencesStore.setOpenSpecUpdateSignature(cwd, sig);
        }
        directoryService.invalidateOpenSpecSignatureCache();
        try {
          const data = await directoryService.refreshOpenSpec(cwd);
          onOpenSpecChanged?.(cwd);
          return { success: true, data: { cwd, stdout: res.value, readiness: data.readiness } } satisfies ApiResponse;
        } catch {
          // Refresh is best-effort; init itself succeeded.
          onOpenSpecChanged?.(cwd);
          return { success: true, data: { cwd, stdout: res.value } } satisfies ApiResponse;
        }
      } finally {
        inFlightInits.delete(cwd);
      }
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
      // cwd optional: the global Settings resource pages read only the
      // global scope (cwd-independent), so they omit it and the server scans
      // relative to its own cwd. See change: resources-card-tabs.
      const cwd = request.query.cwd ?? process.cwd();
      // Bootstrap gate removed under change: eliminate-electron-runtime-install
      // (task 3.5). pi/openspec/tsx ship as regular npm deps; pi-resources
      // endpoint is unconditionally available.
      const forceRefresh = request.query.refresh === "true" || request.query.refresh === "1";
      let data = forceRefresh ? undefined : directoryService.getPiResources(cwd);
      if (!data) {
        data = await directoryService.refreshPiResources(cwd);
      }
      // Join the scan against what a session attached to this folder actually
      // loaded, so a skill can be told apart from one merely present on disk.
      // See change: fix-skill-discovery-parity.
      // A session attached to this folder card may run in a worktree or a
      // subdirectory of it, so membership is "at or beneath", canonicalized —
      // an exact compare would exclude it and silently degrade to scan-only,
      // making the `differsFromFolder` state unreachable.
      // Ended sessions are excluded: the registry is pruned on
      // `session_unregister`, which a crashed or expired session never sends,
      // and a stale entry would collide with the live one and force scan-only.
      const reporters: SkillReporter[] = sessionManager
        .listAll()
        .filter((s) => s.status !== "ended" && isWithinFolder(s.cwd, cwd) && sessionCommandRegistry.hasReported(s.id))
        .map((s) => ({ sessionId: s.id, cwd: s.cwd, commands: sessionCommandRegistry.get(s.id) ?? [] }));
      return { success: true, data: joinSkillProvenance(data, reporters, cwd) } satisfies ApiResponse;
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
