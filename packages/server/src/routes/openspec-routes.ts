/**
 * OpenSpec and Pi Resources REST API routes (localhost-only).
 */

import { realpathSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { DEFAULT_OPENSPEC_POLL, type OpenSpecPollConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import {
  type AdmitCwdOptions,
  admissionAllows,
  releaseAdmission,
} from "@blackbelt-technology/pi-dashboard-shared/cwd-guard.js";
import {
  type DeclaredDependencies,
  type FileStat,
  KEBAB_ID_REGEX,
  MAX_DEPENDENCIES_BYTES,
  MAX_REASON_CHARS,
  serializeDependencies,
} from "@blackbelt-technology/pi-dashboard-shared/openspec-dependencies.js";
import {
  configListAsync,
  configListOrAsync,
  configProfile,
  EXPANDED_WORKFLOWS,
  openSpecConfigFilePath,
  initAsync as openspecInitAsync,
  initHelpAsync as openspecInitHelpAsync,
  update as openspecUpdate,
  workflowSetSignature,
  writeOpenSpecConfigFile,
} from "@blackbelt-technology/pi-dashboard-shared/platform/openspec.js";
import { isPortableProjectName } from "@blackbelt-technology/pi-dashboard-shared/project-name.js";
import type { Semaphore } from "@blackbelt-technology/pi-dashboard-shared/semaphore.js";
import { inferPlatform, pathKey } from "@blackbelt-technology/pi-dashboard-shared/session-group-path.js";
import { getDefaultRegistry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import type { ApiResponse, OpenSpecConfig } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { FastifyInstance, FastifyReply } from "fastify";
import { type DirectoryService, hasOpenSpecRoot } from "../directory-service.js";
import { DashboardStateRefused, dashboardStateRefuses, readFileStateChecked } from "../lib/dashboard-state-guard.js";
import {
  admitRouteCwd,
  listKnownFolderCwds,
  type RouteAdmissionDeps,
  sendAdmissionUnavailable,
} from "../lib/route-admission.js";
import { readDeclared, writeDependenciesFile } from "../openspec/dependencies-file.js";
import { currentGlobalWorkflowSignature } from "../openspec/global-signature.js";
import { scanOpenSpecArchive } from "../openspec/openspec-archive.js";
import {
  LineMismatchError,
  NotACheckboxError,
  NotFoundError,
  readTasks,
  toggleTask,
} from "../openspec/openspec-tasks.js";
import {
  inspectSchema,
  resolveDeps,
  runWorkflowSchemaAction,
  type WorkflowSchemaAction,
  type WorkflowSchemaDeps,
  type WorkflowSchemaRequest,
  type WorkflowSchemaResult,
  type WorkflowSchemaStamp,
  writeGuard,
} from "../openspec/workflow-schema.js";
import type { PreferencesStore } from "../persistence/preferences-store.js";
import { type FolderCommandsResult, resolveFolderCommands } from "../pi/folder-commands.js";
import { isWithinFolder, joinSkillProvenance, type SkillReporter, sessionCommandRegistry } from "../pi/session-skill-registry.js";
import { safeRealpathSync } from "../resolve-path.js";
import type { SessionManager } from "../session/memory-session-manager.js";
import type { NetworkGuard } from "./route-deps.js";

/** Callback to broadcast an openspec_update after a successful toggle. */
export type OpenSpecBroadcaster = (cwd: string) => void;

/** The slice of `openspec.*` config the workflow-schema gates read (live, per request). */
export type OpenSpecGateConfig = Pick<OpenSpecPollConfig, "enabled" | "optOutDirectories" | "workflowSchema">;

const WORKFLOW_SCHEMA_ACTIONS: ReadonlySet<string> = new Set<WorkflowSchemaAction>([
  "enable",
  "disable",
  "update",
  "adopt",
  "pin",
  "remove",
]);

// ── Legacy-artifact detection for the overwrite-confirm gate ──
// Coarse mirror of the pinned CLI's `legacy-cleanup.js`: `--tools` alone
// authorizes cleanup, and cleanup REMOVES marker blocks from root config
// files and DELETES legacy slash-command dirs/files without further
// prompting — so `<cwd>/openspec/` presence alone misses legacy projects
// (AGENTS.md markers + .claude/commands/openspec/, no openspec/ dir) that
// would be destructively edited on a plain Initialize. Markers + path list
// mirror @fission-ai/openspec@1.14.3 dist/core/legacy-cleanup.js; version
// drift degrades to fewer confirmations, never to a wrong refusal. See
// change: add-openspec-init-affordances (review round 1).
export const LEGACY_CONFIG_FILES = [
  "CLAUDE.md", "CLINE.md", "CODEBUDDY.md", "COSTRICT.md",
  "QODER.md", "IFLOW.md", "AGENTS.md", "QWEN.md",
];
const OPENSPEC_MARKER_START = "<!-- OPENSPEC:START -->";
const OPENSPEC_MARKER_END = "<!-- OPENSPEC:END -->";
export const LEGACY_COMMAND_DIRS = [
  ".claude/commands/openspec", ".codebuddy/commands/openspec",
  ".qoder/commands/openspec", ".lingma/commands/openspec",
  ".crush/commands/openspec", ".gemini/commands/openspec",
];
/**
 * Filename prefixes that mark a file in a file-dir as legacy. Default is both; CoStrict's
 * adapter writes LIVE `opsx-*.md` into its directory, and 1.14.3 only cleans `openspec-*.md`
 * there, so an `opsx-` file alone must not force an overwrite confirmation.
 */
const LEGACY_FILE_PREFIXES: Record<string, string[]> = {
  ".cospec/openspec/commands": ["openspec-"],
};
export const LEGACY_COMMAND_FILE_DIRS = [
  ".cursor/commands", ".windsurf/workflows", ".kilocode/workflows",
  ".kiro/prompts", ".github/prompts", ".amazonq/prompts",
  ".clinerules/workflows", ".roo/commands", ".augment/commands",
  ".factory/commands", ".continue/prompts", ".agent/workflows",
  ".iflow/commands", ".qwen/commands", ".codex/prompts",
  // opencode + junie are the only `opsx-*` producers — without these two
  // entries the opsx- prefix check below is dead code (review round 2).
  ".opencode/command", ".junie/commands",
  // 1.14.3 scopes CoStrict cleanup to `openspec-*.md` files (a directory entry
  // would delete the live `opsx-*.md` commands), so it is a file dir here too.
  ".cospec/openspec/commands",
];

/** `realpathSync.native(cwd)`, or `cwd` itself when it does not resolve (lock key only). */
function canonicalPath(cwd: string): string {
  try {
    return realpathSync.native(cwd);
  } catch {
    return cwd;
  }
}

/** Opt-out by exact `pathKey`, on the request spelling AND the canonical cwd (a symlink spelling cannot slip past). */
function isOptedOut(cwd: string, canonCwd: string, optOutDirectories: readonly string[]): boolean {
  if (optOutDirectories.length === 0) return false;
  const platform = inferPlatform([cwd, canonCwd, ...optOutDirectories]);
  const keys = new Set(optOutDirectories.flatMap((d) => [pathKey(d, platform), pathKey(safeRealpathSync(d), platform)]));
  return keys.has(pathKey(cwd, platform)) || keys.has(pathKey(canonCwd, platform));
}

type OpenSpecAdmission =
  | { kind: "ok"; cwd: string; canonCwd: string }
  | { kind: "refused" }
  | { kind: "unavailable"; body: unknown };

/**
 * Core cwd admission for the openspec routes (change: core-cwd-admission, D1/D4):
 * `admitRouteCwd`, then the branch on `admissionAllows(admission, cwd)` right here, on the
 * UNMODIFIED request value, so static analysis keeps its modelled barrier. The helpers hand back
 * that guarded raw `cwd` (openspec signatures, broadcasts and opt-out keys stay raw) and the
 * canonical cwd for the symlink-proof comparisons. The token is released when the response
 * closes (success, error, throw or disconnect).
 */
export function createOpenSpecAdmission(routeAdmission: RouteAdmissionDeps, globalOpenSpecDir: string) {
  /** Whether `cwd` (raw or canonical) is the directory whose `openspec/` is the global OpenSpec config dir. */
  function isGlobalOpenSpecParent(cwd: string, canonCwd: string): boolean {
    const canonGlobal = path.join(safeRealpathSync(path.dirname(globalOpenSpecDir)), path.basename(globalOpenSpecDir));
    return (
      path.join(cwd, "openspec") === globalOpenSpecDir ||
      path.join(canonCwd, "openspec") === globalOpenSpecDir ||
      path.join(canonCwd, "openspec") === canonGlobal
    );
  }

  /** Admit `raw`. `refused` leaves the reply untouched (the caller answers); `unavailable` has set the 503. */
  async function admitOpenSpecCwd(raw: string, reply: FastifyReply): Promise<OpenSpecAdmission> {
    const admission = await admitRouteCwd(raw, routeAdmission);
    if (admission.kind === "indeterminate") return { kind: "unavailable", body: sendAdmissionUnavailable(reply) };
    if (admission.kind !== "admit" || !admissionAllows(admission, raw)) return { kind: "refused" };
    const token = admission.token;
    reply.raw.once("close", () => releaseAdmission(token));
    // The client may have gone while admission ran (`close` already fired): release at once.
    if (reply.raw.destroyed) releaseAdmission(token);
    return { kind: "ok", cwd: raw, canonCwd: token.canonCwd };
  }

  /**
   * Admission for a site that did NOT refuse unknown cwds before this change: not admitted, or the
   * global OpenSpec config dir → 403 `cwd_unknown` (design D4).
   */
  async function admitUngatedCwd(
    raw: string,
    reply: FastifyReply,
  ): Promise<{ ok: true; cwd: string } | { ok: false; body: unknown }> {
    const adm = await admitOpenSpecCwd(raw, reply);
    if (adm.kind === "unavailable") return { ok: false, body: adm.body };
    if (adm.kind === "refused" || isGlobalOpenSpecParent(raw, adm.canonCwd)) {
      reply.code(403);
      return {
        ok: false,
        body: {
          success: false,
          code: "cwd_unknown",
          error: "cwd not allowed",
          reason: "cwd is not a known session or pinned directory.",
          hint: "Pin this directory to allow it, or open a session rooted in it.",
        },
      };
    }
    return { ok: true, cwd: adm.cwd };
  }

  return { admitOpenSpecCwd, admitUngatedCwd, isGlobalOpenSpecParent };
}

export function registerOpenSpecRoutes(
  fastify: FastifyInstance,
  deps: {
    sessionManager: SessionManager;
    preferencesStore: PreferencesStore;
    directoryService: DirectoryService;
    networkGuard: NetworkGuard;
    /**
     * Bridge-connection probe for `GET /api/pi-resources/commands`. A session's
     * registry entry or status alone is not "live": a crashed pi never
     * unregisters. Absent → no session counts as live (scan only).
     */
    piGateway?: { isSessionConnected(sessionId: string): boolean };
    /** Optional — called after a successful toggle to trigger openspec_update. */
    onOpenSpecChanged?: OpenSpecBroadcaster;
    /** Live `openspec.*` config (gates + `workflowSchema.defaultForNewProjects`). Absent → defaults (enabled, no opt-outs, default off). */
    getOpenSpecConfig?: () => OpenSpecGateConfig;
    /** Spawn semaphore for the workflow-schema `newer`/`conflict` validate. Absent → pass-through. */
    spawnSemaphore?: Semaphore;
    /** Test seam: overrides for the workflow-schema module's collaborators (CLI, fs, clock…). */
    workflowSchemaDeps?: Partial<WorkflowSchemaDeps>;
    /**
     * Live known-folder set (session cwds ∪ pinned directories, unfiltered) every caller-supplied
     * `cwd` is admitted against. Absent → the same set from `sessionManager` + `preferencesStore`.
     * See change: core-cwd-admission.
     */
    knownFolderCwds?: () => string[];
    /** `admitCwd` options: the host's throttled `onIndeterminate` logger + test seams. */
    admitOptions?: AdmitCwdOptions;
  },
) {
  const { sessionManager, preferencesStore, directoryService, networkGuard, onOpenSpecChanged, piGateway } = deps;
  const gateConfig = (): OpenSpecGateConfig => deps.getOpenSpecConfig?.() ?? DEFAULT_OPENSPEC_POLL;

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
      const resolved = await resolveConfigCwd(request.query.cwd, reply);
      if (!resolved.ok) return resolved.body;
      const cwd = resolved.cwd;
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

  // Core cwd admission (change: core-cwd-admission, D1/D4): see `createOpenSpecAdmission`.
  const { admitOpenSpecCwd, admitUngatedCwd, isGlobalOpenSpecParent } = createOpenSpecAdmission(
    {
      knownCwds: deps.knownFolderCwds ?? (() => listKnownFolderCwds({ sessionManager, preferencesStore })),
      admitOptions: deps.admitOptions,
    },
    GLOBAL_OPENSPEC_DIR,
  );

  /**
   * The cwd of the global-config routes: a caller-supplied cwd is admitted; with none, the
   * server-chosen fallback (`knownCwds()[0] ?? process.cwd()`) is kept and not re-admitted.
   */
  async function resolveConfigCwd(
    requested: unknown,
    reply: FastifyReply,
  ): Promise<{ ok: true; cwd: string } | { ok: false; body: unknown }> {
    if (typeof requested === "string" && requested.length > 0) return admitUngatedCwd(requested, reply);
    return { ok: true, cwd: knownCwds()[0] ?? process.cwd() };
  }

  /** A request path segment (a change name) joined under the cwd by a lib: a single portable segment only. */
  const invalidName = (reply: FastifyReply) => {
    reply.code(400);
    return { success: false, code: "invalid_name", error: "invalid change name" };
  };

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
      const resolved = await resolveConfigCwd(body.cwd, reply);
      if (!resolved.ok) return resolved.body;
      const cwd = resolved.cwd;

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
      let targets: string[];
      if (body.all) {
        targets = knownCwds(); // server-chosen list: not re-admitted
      } else if (typeof body.cwd === "string" && body.cwd.length > 0) {
        const admitted = await admitUngatedCwd(body.cwd, reply);
        if (!admitted.ok) return admitted.body;
        targets = [admitted.cwd];
      } else {
        targets = [];
      }
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
        const prefixes = LEGACY_FILE_PREFIXES[dir] ?? ["openspec-", "opsx-"];
        if (entries.some((e) => prefixes.some((p) => e.startsWith(p)))) return true;
      } catch { /* absent */ }
    }
    return false;
  }

  // Per-cwd serialization (X4): while an invocation is in flight for a cwd,
  // a second request is rejected 409 without spawning. The lock is released
  // on every exit path, including the 60s timeout (X3).
  // Keyed by `realpathSync.native(cwd)`; shared with POST /api/openspec/workflow-schema.
  const inFlightInits = new Set<string>();

  /** Stamp of the managed schema dir, or null (no/unreadable/unmanaged). */
  async function readSchemaStamp(root: string): Promise<WorkflowSchemaStamp | null> {
    try {
      return (await inspectSchema(root, { localVersion: "" })).stamp;
    } catch {
      return null;
    }
  }

  /**
   * One workflow-schema action with the real spawn semaphore, the forced
   * refresh (skipped when the caller refreshes right after), and the
   * structured log line. The caller holds the per-cwd lock.
   */
  async function runLoggedWorkflowAction(
    log: { info(obj: object, msg: string): void },
    cwd: string,
    root: string,
    req: WorkflowSchemaRequest,
    refresh: boolean,
  ): Promise<WorkflowSchemaResult> {
    const stampBefore = await readSchemaStamp(root);
    const result = await runWorkflowSchemaAction(req, {
      ...(deps.spawnSemaphore ? { semaphore: deps.spawnSemaphore } : {}),
      refresh: refresh
        ? async (c) => {
            await directoryService.refreshOpenSpec(c);
            onOpenSpecChanged?.(c);
          }
        : async () => undefined,
      ...deps.workflowSchemaDeps,
    });
    const stampAfter = await readSchemaStamp(root);
    log.info(
      { event: "openspec.workflow-schema", cwd, action: req.action, ok: result.ok, written: result.written, stampBefore, stampAfter },
      "openspec workflow-schema action",
    );
    return result;
  }

  // POST /api/openspec/workflow-schema — enable|disable|update|adopt|pin|remove
  // the dashboard-managed `pi-spec-driven` schema for one project.
  // Gate order: shape → tracked-or-pinned (membership, NO fs) → OpenSpec
  // enabled → not opted out → fs (realpath + `<cwd>/openspec/`) → per-cwd lock.
  // The allowed-state table + all name/containment checks live in
  // `runWorkflowSchemaAction`. See change: add-pi-spec-driven-schema.
  fastify.post<{ Body: Partial<Record<keyof WorkflowSchemaRequest, unknown>> }>(
    "/api/openspec/workflow-schema",
    { preHandler: networkGuard },
    async (request, reply) => {
      const b = request.body ?? {};
      const fail = (code: number, error: string, errCode?: string) => {
        reply.code(code);
        return { success: false, error, ...(errCode ? { code: errCode } : {}) } satisfies ApiResponse & { code?: string };
      };

      if (typeof b.cwd !== "string" || !b.cwd) return fail(400, "cwd required");
      if (typeof b.action !== "string" || !WORKFLOW_SCHEMA_ACTIONS.has(b.action)) {
        return fail(400, "action must be one of enable, disable, update, adopt, pin, remove");
      }
      if (b.confirm !== undefined && typeof b.confirm !== "boolean") return fail(400, "confirm must be a boolean");
      if (b.pinTo !== undefined && typeof b.pinTo !== "string") return fail(400, "pinTo must be a string");
      if (b.previousDefault !== undefined && typeof b.previousDefault !== "string") {
        return fail(400, "previousDefault must be a string");
      }
      if (b.changes !== undefined && !(Array.isArray(b.changes) && b.changes.every((c) => typeof c === "string"))) {
        return fail(400, "changes must be an array of strings");
      }
      // Admission first (the modelled guard; indeterminate → 503), then the EXISTING exact
      // membership / opt-out / global-dir gates with their existing refusals — no widening.
      const adm = await admitOpenSpecCwd(b.cwd, reply);
      if (adm.kind === "unavailable") return adm.body;
      if (adm.kind === "refused" || !knownInitTargets().includes(adm.cwd) || isGlobalOpenSpecParent(adm.cwd, adm.canonCwd)) {
        return fail(400, "cwd is not a known session or pinned directory", "untracked");
      }
      const cwd = adm.cwd;
      const cfg = gateConfig();
      if (cfg.enabled === false) return fail(400, "OpenSpec is disabled", "openspec_disabled");
      if (isOptedOut(cwd, adm.canonCwd, cfg.optOutDirectories)) {
        return fail(400, "OpenSpec is opted out for this directory", "opted_out");
      }

      // Only now touch the filesystem.
      let real: string;
      try {
        real = realpathSync.native(cwd);
      } catch {
        return fail(400, "cwd does not exist", "no_openspec");
      }
      const hasOpenspec = await fs
        .stat(path.join(real, "openspec"))
        .then((st) => st.isDirectory())
        .catch(() => false);
      if (!hasOpenspec) return fail(400, "no openspec/ directory in cwd", "no_openspec");

      if (inFlightInits.has(real)) return fail(409, "an OpenSpec init or workflow-schema action is already in flight for this directory");
      inFlightInits.add(real);
      try {
        const req: WorkflowSchemaRequest = {
          cwd,
          action: b.action as WorkflowSchemaAction,
          ...(b.confirm !== undefined ? { confirm: b.confirm as boolean } : {}),
          ...(b.pinTo !== undefined ? { pinTo: b.pinTo as string } : {}),
          ...(b.changes !== undefined ? { changes: b.changes as string[] } : {}),
          ...(b.previousDefault !== undefined ? { previousDefault: b.previousDefault as string } : {}),
        };
        const result = await runLoggedWorkflowAction(request.log, cwd, real, req, true);
        if (result.ok) return { success: true, data: result } satisfies ApiResponse;
        // Refusals (state table, validation, guard) carry the current status in `data`.
        reply.code(result.partial ? 500 : 422);
        return { success: false, error: result.error ?? "workflow-schema action failed", data: result } satisfies ApiResponse;
      } finally {
        inFlightInits.delete(real);
      }
    },
  );

  // ── Change dependencies (add-openspec-change-dependencies) ───────────
  //
  // GET/PUT /api/openspec/dependencies?cwd=&change= — one change's
  // `dependencies.yaml`. Gate order (answers carry `reason`): request shape →
  // tracked → enabled → not opted out → `openspec/` exists → not on the
  // fallback path → a cached `status --all` result → change in that result.
  // PUT then: write guard + containment → per-cwd lock → `expected` precondition
  // → atomic write.
  type DepGate = { ok: true; cwd: string; real: string; change: string } | { ok: false };

  const depFail = (reply: import("fastify").FastifyReply, code: number, reason: string, error: string) => {
    reply.code(code);
    return { success: false, error, reason } satisfies ApiResponse & { reason: string };
  };

  /** Gates 2–8 of the dependencies endpoints (gate 1, request validity, runs before). */
  async function depGates(requestCwd: string, change: string, reply: import("fastify").FastifyReply): Promise<DepGate | { ok: false; body: unknown }> {
    const respond = (code: number, reason: string, error: string) => ({ ok: false as const, body: depFail(reply, code, reason, error) });
    // Admission is the modelled guard (indeterminate → 503); the exact membership / opt-out
    // gates and their refusals are unchanged. The gate hands back the guarded raw cwd.
    const adm = await admitOpenSpecCwd(requestCwd, reply);
    if (adm.kind === "unavailable") return { ok: false, body: adm.body };
    if (adm.kind === "refused" || !knownInitTargets().includes(adm.cwd) || isGlobalOpenSpecParent(adm.cwd, adm.canonCwd)) {
      return respond(403, "cwd-not-tracked", "cwd is not a known session or pinned directory");
    }
    const cwd = adm.cwd;
    const cfg = gateConfig();
    if (cfg.enabled === false) return respond(403, "openspec-disabled", "OpenSpec is disabled");
    if (isOptedOut(cwd, adm.canonCwd, cfg.optOutDirectories)) {
      return respond(403, "opted-out", "OpenSpec is opted out for this directory");
    }
    let real: string;
    try {
      real = realpathSync.native(cwd);
    } catch {
      return respond(404, "no-openspec-dir", "cwd does not exist");
    }
    const hasOpenspec = await fs
      .stat(path.join(real, "openspec"))
      .then((st) => st.isDirectory())
      .catch(() => false);
    if (!hasOpenspec) return respond(404, "no-openspec-dir", "no openspec/ directory in cwd");
    if (directoryService.getOpenSpecPollMode(cwd) === "fallback") {
      return respond(409, "status-all-unsupported", "this OpenSpec CLI has no `status --all`; dependencies are not computed");
    }
    const data = directoryService.getOpenSpecData(cwd);
    if (!data || !data.initialized || directoryService.getOpenSpecPollMode(cwd) !== "all") {
      return respond(503, "pending", "no OpenSpec status result is cached for this directory yet");
    }
    if (!data.changes.some((c) => c.name === change)) return respond(404, "unknown-change", `no active change named ${change}`);
    return { ok: true, cwd, real, change };
  }

  fastify.get<{ Querystring: { cwd?: string; change?: string } }>(
    "/api/openspec/dependencies",
    { preHandler: networkGuard },
    async (request, reply) => {
      const { cwd, change } = request.query ?? {};
      if (typeof cwd !== "string" || !cwd || typeof change !== "string" || !KEBAB_ID_REGEX.test(change) || !isPortableProjectName(change)) {
        return depFail(reply, 400, "invalid-request", "cwd and a valid change name are required");
      }
      const gate = await depGates(cwd, change, reply);
      if (!gate.ok) return "body" in gate ? gate.body : undefined;
      const entry = directoryService.getOpenSpecData(gate.cwd)?.changes.find((c) => c.name === change);
      const read = await readDeclared(gate.real, change);
      return {
        success: true,
        data: {
          dependencies: entry?.dependencies ?? null,
          declared: read.declared,
          declaredError: read.declaredError,
          file: read.file,
        },
      } satisfies ApiResponse;
    },
  );

  /** Whole-body validation of the PUT (gate 1). Returns the parsed declaration or an error message. */
  function parseDependenciesPut(
    body: unknown,
  ): { ok: true; cwd: string; change: string; declared: DeclaredDependencies; expected: FileStat | null } | { ok: false; error: string } {
    if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "JSON object body required" };
    if (Buffer.byteLength(JSON.stringify(body), "utf8") > MAX_DEPENDENCIES_BYTES) return { ok: false, error: "body exceeds 64 KiB" };
    const b = body as Record<string, unknown>;
    if (typeof b.cwd !== "string" || !b.cwd) return { ok: false, error: "cwd required" };
    if (typeof b.change !== "string" || !KEBAB_ID_REGEX.test(b.change) || !isPortableProjectName(b.change)) return { ok: false, error: "change must be a valid change name" };
    const change = b.change;
    const names = (v: unknown, key: string): string[] | string => {
      if (!Array.isArray(v)) return `${key} must be a list`;
      const out: string[] = [];
      for (const n of v) {
        if (typeof n !== "string" || !KEBAB_ID_REGEX.test(n)) return `${key} has an invalid change name`;
        if (n === change) return `${key} must not name the change itself`;
        if (!out.includes(n)) out.push(n);
      }
      return out;
    };
    if (!Array.isArray(b.blockedBy)) return { ok: false, error: "blockedBy must be a list" };
    const blockedBy: DeclaredDependencies["blockedBy"] = [];
    for (const item of b.blockedBy) {
      const rec = typeof item === "string" ? { change: item } : (item as { change?: unknown; reason?: unknown } | null);
      if (!rec || typeof rec !== "object" || typeof rec.change !== "string" || !KEBAB_ID_REGEX.test(rec.change)) {
        return { ok: false, error: "blockedBy has an invalid change name" };
      }
      if (rec.change === change) return { ok: false, error: "blockedBy must not name the change itself" };
      const reason = (rec as { reason?: unknown }).reason;
      if (reason !== undefined && reason !== null && (typeof reason !== "string" || reason.length > MAX_REASON_CHARS)) {
        return { ok: false, error: `reason must be a string of at most ${MAX_REASON_CHARS} characters` };
      }
      if (blockedBy.some((x) => x.change === rec.change)) continue;
      blockedBy.push(typeof reason === "string" && reason !== "" ? { change: rec.change, reason } : { change: rec.change });
    }
    const notBlockedBy = names(b.notBlockedBy, "notBlockedBy");
    if (typeof notBlockedBy === "string") return { ok: false, error: notBlockedBy };
    const related = names(b.related, "related");
    if (typeof related === "string") return { ok: false, error: related };
    if (!("expected" in b)) return { ok: false, error: "expected is required (null or { mtimeMs, size })" };
    let expected: FileStat | null = null;
    if (b.expected !== null) {
      const e = b.expected as { mtimeMs?: unknown; size?: unknown };
      if (!e || typeof e !== "object" || typeof e.mtimeMs !== "number" || typeof e.size !== "number") {
        return { ok: false, error: "expected must be null or { mtimeMs, size }" };
      }
      expected = { mtimeMs: e.mtimeMs, size: e.size };
    }
    return { ok: true, cwd: b.cwd, change, declared: { blockedBy, notBlockedBy, related }, expected };
  }

  fastify.put<{ Body: unknown }>(
    "/api/openspec/dependencies",
    { preHandler: networkGuard },
    async (request, reply) => {
      const parsed = parseDependenciesPut(request.body);
      if (!parsed.ok) return depFail(reply, 400, "invalid-request", parsed.error);
      const { change, declared, expected } = parsed;
      const gate = await depGates(parsed.cwd, change, reply);
      if (!gate.ok) return "body" in gate ? gate.body : undefined;
      const cwd = gate.cwd; // the admission-bound request value

      // Same root verification as every workflow-schema write.
      // The guard spawns `status --all`; bound it by the shared spawn semaphore like every other CLI spawn.
      const guard = () => writeGuard(cwd, resolveDeps(deps.workflowSchemaDeps));
      const guarded = await (deps.spawnSemaphore ? deps.spawnSemaphore.run(guard) : guard());
      if ("error" in guarded) return depFail(reply, 403, "write-refused", guarded.error);

      // Shared per-cwd lock (keyed by the canonical cwd, so symlinked spellings collide).
      const lockKey = gate.real; // canonical cwd from the gates; never re-resolved after they answered
      if (inFlightInits.has(lockKey)) {
        return depFail(reply, 409, "locked", "an OpenSpec init or workflow-schema action is already in flight for this directory");
      }
      inFlightInits.add(lockKey);
      try {
        const out = await writeDependenciesFile({
          root: guarded.root,
          change,
          content: serializeDependencies(declared),
          expected,
        });
        if (!out.ok) return depFail(reply, out.status, out.reason, out.error);
        request.log.info(
          {
            event: "openspec.dependencies",
            cwd,
            change,
            blockedBy: declared.blockedBy.length,
            notBlockedBy: declared.notBlockedBy.length,
            related: declared.related.length,
          },
          "openspec dependencies written",
        );
        // The watcher would pick the write up; refresh now so the board updates promptly.
        void directoryService
          .refreshOpenSpec(cwd)
          .then(() => onOpenSpecChanged?.(cwd))
          .catch(() => undefined);
        return { success: true, data: { file: out.file } } satisfies ApiResponse;
      } finally {
        inFlightInits.delete(lockKey);
      }
    },
  );

  fastify.post<{ Body: { cwd?: string; confirm?: boolean } }>(
    "/api/openspec/init",
    { preHandler: networkGuard },
    async (request, reply) => {
      const requestCwd = request.body?.cwd;
      if (!requestCwd) {
        reply.code(400);
        return { success: false, error: "cwd required" } satisfies ApiResponse;
      }
      // Admission (modelled guard; indeterminate → 503), then the existing exact membership.
      const adm = await admitOpenSpecCwd(requestCwd, reply);
      if (adm.kind === "unavailable") return adm.body;
      if (adm.kind === "refused" || !knownInitTargets().includes(adm.cwd) || isGlobalOpenSpecParent(adm.cwd, adm.canonCwd)) {
        reply.code(400);
        return { success: false, error: "cwd is not a known session or pinned directory" } satisfies ApiResponse;
      }
      const cwd = adm.cwd;

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

      // The tracked check has passed: key the lock by the canonical path so
      // two spellings of one directory (symlink) share it, and so does the
      // workflow-schema endpoint. See change: add-pi-spec-driven-schema (D7).
      const lockKey = canonicalPath(cwd);
      if (inFlightInits.has(lockKey)) {
        reply.code(409);
        return { success: false, error: "an init is already in flight for this directory" } satisfies ApiResponse;
      }
      inFlightInits.add(lockKey);

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

        // Chain `enable` for a project that had no `openspec/` before this init,
        // when the global default is on. Runs inside THIS lock (no re-acquire);
        // a failure never fails init and is reported in the response. The
        // refresh below covers enable's forced refresh. See change:
        // add-pi-spec-driven-schema (D7).
        const chained: { workflowSchema?: WorkflowSchemaResult; workflowSchemaError?: string } = {};
        if (!hasOpenspecRootAlready && gateConfig().workflowSchema.defaultForNewProjects) {
          try {
            const r = await runLoggedWorkflowAction(request.log, cwd, lockKey, { cwd, action: "enable" }, false);
            if (r.ok) chained.workflowSchema = r;
            else chained.workflowSchemaError = r.error ?? "enable failed";
          } catch (err) {
            chained.workflowSchemaError = err instanceof Error ? err.message : String(err);
          }
        }

        try {
          const data = await directoryService.refreshOpenSpec(cwd);
          onOpenSpecChanged?.(cwd);
          return { success: true, data: { cwd, stdout: res.value, readiness: data.readiness, ...chained } } satisfies ApiResponse;
        } catch {
          // Refresh is best-effort; init itself succeeded.
          onOpenSpecChanged?.(cwd);
          return { success: true, data: { cwd, stdout: res.value, ...chained } } satisfies ApiResponse;
        }
      } finally {
        inFlightInits.delete(lockKey);
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
      const requestCwd = request.query.cwd;
      if (!requestCwd) {
        reply.code(400);
        return { success: false, error: "Missing cwd" } satisfies ApiResponse;
      }
      const admitted = await admitUngatedCwd(requestCwd, reply);
      if (!admitted.ok) return admitted.body;
      const data = await scanOpenSpecArchive(admitted.cwd);
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
      let cwd: string;
      if (typeof request.query.cwd === "string" && request.query.cwd.length > 0) {
        const admitted = await admitUngatedCwd(request.query.cwd, reply);
        if (!admitted.ok) return admitted.body;
        cwd = admitted.cwd;
      } else {
        cwd = process.cwd();
      }
      // Bootstrap gate removed under change: eliminate-electron-runtime-install
      // (task 3.5). pi/openspec/tsx ship as regular npm deps; pi-resources
      // endpoint is unconditionally available.
      const forceRefresh = request.query.refresh === "true" || request.query.refresh === "1";
      // Stale-while-revalidate: a cold miss (or `refresh=true`) scans and
      // awaits; a stale entry is served at once while one background rescan
      // runs (deduped per cwd, never an unhandled rejection). See change:
      // optimize-polling-hot-paths (D9).
      const cached = forceRefresh ? undefined : directoryService.getPiResources(cwd);
      let data = cached?.data;
      if (cached?.stale) void directoryService.refreshPiResources(cwd).catch(() => { /* next request retries */ });
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

  // Folder command list WITHOUT a live session: the latest list of a connected
  // session in exactly this cwd, else the enabled skills/prompts from the scan.
  // See change: redesign-directory-home-split (D3).
  fastify.get<{ Querystring: { cwd?: string } }>(
    "/api/pi-resources/commands",
    { preHandler: networkGuard },
    async (request, reply) => {
      const requestCwd = request.query.cwd;
      // Shape check BEFORE admission: a relative cwd is never resolved against the server's cwd.
      if (typeof requestCwd !== "string" || requestCwd.length === 0 || !path.isAbsolute(requestCwd)) {
        reply.code(400);
        return { success: false, error: "cwd must be an absolute path" } satisfies ApiResponse;
      }
      const admitted = await admitUngatedCwd(requestCwd, reply);
      if (!admitted.ok) return admitted.body;
      const cwd = admitted.cwd;
      let scan: Awaited<ReturnType<typeof directoryService.refreshPiResources>> | undefined;
      try {
        const cached = directoryService.getPiResources(cwd);
        if (cached?.stale) void directoryService.refreshPiResources(cwd).catch(() => { /* next request retries */ });
        scan = cached?.data ?? (await directoryService.refreshPiResources(cwd));
      } catch {
        scan = undefined; // unreadable folder → live list or `none`, never a 500
      }
      const data: FolderCommandsResult = resolveFolderCommands({
        cwd,
        scan,
        sessions: sessionManager.listAll(),
        registry: sessionCommandRegistry,
        isSessionConnected: (id) => piGateway?.isSessionConnected(id) ?? false,
      });
      return { success: true, data } satisfies ApiResponse;
    },
  );

  // Pi Resource file endpoint — reads files from allowed pi resource locations.
  // The prefix allowlist below is deliberately loose (`includes(".pi/git/")`, `includes("node_modules/")`
  // match anywhere in the path: recorded residual); the dashboard-state / pi-agent-credential refusal
  // (real path, both tiers) runs after it, and the read goes through the post-open (dev, ino) recheck.
  // See change: close-security-map-high-findings (D1, G1).
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

      if (await dashboardStateRefuses(normalizedPath)) {
        reply.code(403);
        return { success: false, error: "path not in allowed resource location" } satisfies ApiResponse;
      }

      try {
        const content = await readFileStateChecked(normalizedPath, "utf-8");
        return { success: true, data: { type: "file", content } } satisfies ApiResponse;
      } catch (err) {
        if (err instanceof DashboardStateRefused) {
          reply.code(403);
          return { success: false, error: "path not in allowed resource location" } satisfies ApiResponse;
        }
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
      const { cwd: requestCwd, change } = request.query;
      if (!requestCwd || typeof change !== "string") {
        reply.code(400);
        return { success: false, error: "cwd and change query params required" } satisfies ApiResponse;
      }
      const admitted = await admitUngatedCwd(requestCwd, reply);
      if (!admitted.ok) return admitted.body;
      const cwd = admitted.cwd;
      if (!isPortableProjectName(change)) return invalidName(reply);
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
      const { cwd: requestCwd, change, id, done, line } = body;
      if (
        typeof requestCwd !== "string" ||
        typeof change !== "string" ||
        typeof id !== "string" ||
        typeof done !== "boolean" ||
        typeof line !== "number"
      ) {
        reply.code(400);
        return { success: false, error: "invalid body" } satisfies ApiResponse;
      }
      const admitted = await admitUngatedCwd(requestCwd, reply);
      if (!admitted.ok) return admitted.body;
      const cwd = admitted.cwd;
      if (!isPortableProjectName(change)) return invalidName(reply);
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
