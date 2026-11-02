/**
 * REST routes for the automation-plugin, mounted under
 * `/api/plugins/automation/*`. Route registration is synchronous (required
 * before `fastify.listen`); handler bodies lazy-import the heavy modules
 * (`yaml`, scanner, run-store) so plugin load stays cheap.
 *
 *   GET    /api/plugins/automation/list?cwd=<repo>          → automations (folder+global)
 *   GET    /api/plugins/automation/runs?cwd=&scope=&name=   → run records
 *   GET    /api/plugins/automation/result?cwd=&scope=&runId= → result.md text
 *   GET    /api/plugins/automation/result?cwd=&scope=&sessionId= → { status, runId, name, result? } (run-store lookup)
 *   GET    /api/plugins/automation/trigger-kinds            → trigger taxonomy descriptors
 *   POST   /api/plugins/automation/create                   → write automation.yaml (+prompt.md), reject collision
 *   POST   /api/plugins/automation/update                   → overwrite an existing automation in place
 *   GET    /api/plugins/automation/definition?cwd=&scope=&name= → load config + prompt body for edit
 *   POST   /api/plugins/automation/run                      → trigger a single run now
 *   DELETE /api/plugins/automation?cwd=&scope=&name=        → remove an automation
 *
 * Auth gating is handled by the dashboard's onRequest hook on `fastify`.
 * Every supplied `cwd` is admitted (403 / 503) before any fs access; folder-scope routes
 * (create, update, delete, definition, runs, result) answer 400 `cwd_required` without one,
 * and a non-string cwd is 400 `invalid_cwd` — there is no `process.cwd()` fallback.
 * See change: add-automation-plugin; harden-git-terminal-plugin-boundaries (S1r).
 */
import os from "node:os";
import path from "node:path";
import type { AdmitCwdOptions } from "@blackbelt-technology/pi-dashboard-shared/cwd-guard.js";
import {
  admitRouteCwdParam,
  sendRouteCwdRefusal,
} from "@blackbelt-technology/pi-dashboard-shared/plugin-route-cwd.js";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { ActionDescriptor, AutomationConfig, AutomationScope } from "../shared/automation-types.js";
import { BUILTIN_ACTION_ALIASES } from "../shared/automation-types.js";

/**
 * Fallback trigger kinds, used ONLY when the engine supplies no live registry
 * (e.g. a bare route mount in a test). The engine is the source of truth: it
 * registers `schedule` AND `schedule.batch`, so a frozen constant here silently
 * marks a valid `schedule.batch` automation invalid in `/list` + `/definition`
 * while the scheduler happily fires it. Prefer `hooks.triggerKinds()`.
 */
const FALLBACK_KINDS = new Set(["schedule"]);

/**
 * Resolve the scope base dir for a (scope, cwd) pair. Global scope is the home dir;
 * folder scope is the ADMITTED request cwd. There is deliberately no `process.cwd()`
 * fallback: the server cwd is not a user folder, so a folder-scope route without a cwd
 * is refused (`cwd_required`) before it gets here. See change: harden-git-terminal-plugin-boundaries (S1r).
 */
function scopeBaseFor(scope: AutomationScope, cwd: string | undefined): string {
  if (scope === "global") return os.homedir();
  if (!cwd) throw new Error("scopeBaseFor: folder scope reached without an admitted cwd");
  return cwd;
}

/** Built-in action kinds always accepted (aliased to core.* at read time). */
const BUILTIN_ACTION_KINDS = new Set(Object.keys(BUILTIN_ACTION_ALIASES));

/**
 * Reject an automation whose `action.kind` is neither a built-in alias nor a
 * registered action id, BEFORE it is written to disk. Mirrors the read-path
 * validation so `/create` + `/update` cannot persist a config that `/list`
 * would later mark invalid. See change: register-plugin-automation-events.
 */
export function unknownActionKind(
  config: AutomationConfig | undefined,
  ids: ReadonlySet<string> | undefined,
): string | undefined {
  const acceptable = (kind: unknown): boolean =>
    typeof kind === "string" &&
    kind.length > 0 &&
    (BUILTIN_ACTION_KINDS.has(kind) || !!ids?.has(kind));
  // Fan-out form: validate every `actions:` entry, naming the offending index
  // so `/create` + `/update` cannot persist a config `/list` would mark
  // invalid. See change: add-automation-concurrent-spawn.
  if (Array.isArray(config?.actions)) {
    for (let i = 0; i < config.actions.length; i++) {
      const kind = config.actions[i]?.kind;
      if (typeof kind !== "string" || kind.length === 0) continue; // writer surfaces shape errors
      if (!acceptable(kind)) return `actions[${i}]: ${kind}`;
    }
    return undefined;
  }
  const kind = config?.action?.kind;
  if (typeof kind !== "string" || kind.length === 0) return undefined; // writer surfaces shape errors
  if (acceptable(kind)) return undefined;
  return kind;
}

/** Optional hooks supplied by the engine for routes that need run control. */
export interface AutomationRouteHooks {
  /**
   * Live admit set for a request `cwd`: host known folders ∪ `automation.folderscope.*`
   * contributions, read on EVERY request (no cache). Fail-closed default: nothing is known,
   * so every supplied cwd is refused. See change: harden-git-terminal-plugin-boundaries (S1r).
   */
  knownCwds?: () => string[];
  /** `admitCwd` options (the host's throttled `onIndeterminate` logger; test seams). */
  admitOptions?: AdmitCwdOptions;
  /** Trigger exactly one run of an automation now (manual fire). */
  runNow?: (args: {
    scope: AutomationScope;
    cwd?: string;
    name: string;
  }) => Promise<{ ok: boolean; runId?: string; error?: string }>;
  /** Stop a `running` run (terminate its process + finalize the record). */
  stopRun?: (args: {
    scope: AutomationScope;
    cwd?: string;
    runId: string;
  }) => Promise<{ ok: boolean; error?: string }> | { ok: boolean; error?: string };
  /**
   * Registered automation actions resolved for a cwd (availability +
   * enum options). Reads the live action registry shared with the engine.
   * See change: register-plugin-automation-events.
   */
  listActions?: (cwd?: string) => ActionDescriptor[];
  /**
   * All registered action ids (cwd-independent), for schema validation on the
   * `/list` + `/definition` routes so plugin-backed automations parse as valid.
   * See change: register-plugin-automation-events.
   */
  actionIds?: () => ReadonlySet<string>;
  /**
   * Live trigger kinds from the engine registry, so `/list` validates a
   * `schedule.batch` against the real registry instead of a frozen constant.
   * Falls back to `FALLBACK_KINDS` when absent. See change: work-source-seam.
   */
  triggerKinds?: () => ReadonlySet<string>;
  /**
   * Live work-source ids from the engine registry, so `/list` validates an
   * `on.source` against the real registry. See change: work-source-seam.
   */
  workSourceIds?: () => ReadonlySet<string>;
  /**
   * Whether global-scope scanning is enabled (absent = true). `/list` uses it to
   * avoid listing the home dir as a folder copy of the global scope.
   * See change: fix-home-folder-scope-double-arm.
   */
  scanGlobalScope?: () => boolean;
  /**
   * Host guard for reading file CONTENT returned to a client (`result.md`, `automation.yaml`, `prompt.md`):
   * `null` when the dashboard-state / pi-agent-credential guard refuses the real path (a symlink or hard
   * link inside the cwd to a credential file). An absent hook (older host) behaves as `null`: each read takes
   * its existing failed-read branch, never a plain `fs` read. See change: close-security-map-high-findings (D1, H1).
   */
  readFileGuarded?: (absPath: string) => Promise<string | null>;
}

export function mountAutomationRoutes(
  fastify: FastifyInstance,
  hooks: AutomationRouteHooks = {},
): void {
  /** Content read through the host guard; `null` = refused or no seam (fail closed). Other failures reject. */
  const guardedRead = async (absPath: string): Promise<string | null> =>
    hooks.readFileGuarded ? hooks.readFileGuarded(absPath) : null;

  /**
   * Parse + admit a request cwd (shape → presence → tri-state admission) BEFORE `fn` runs,
   * releasing the admission token afterwards. A supplied cwd is admitted in every scope
   * (global included); an absent one is `cwd_required` only when `required`.
   */
  async function withCwd<T>(
    reply: FastifyReply,
    raw: unknown,
    required: boolean,
    fn: (cwd: string | undefined) => Promise<T> | T,
  ): Promise<T | Record<string, unknown>> {
    const adm = await admitRouteCwdParam(raw, {
      required,
      ...(hooks.knownCwds ? { knownCwds: hooks.knownCwds } : {}),
      ...(hooks.admitOptions ? { admitOptions: hooks.admitOptions } : {}),
    });
    if (!adm.ok) return sendRouteCwdRefusal(reply, adm);
    try {
      return await fn(adm.cwd);
    } finally {
      adm.release();
    }
  }

  fastify.post("/api/plugins/automation/run", async (req, reply) => {
    const body = (req.body ?? {}) as { scope?: AutomationScope; cwd?: unknown; name?: string };
    return withCwd(reply, body.cwd, false, async (cwd) => {
      if (!body.name) {
        reply.code(400);
        return { error: "name required" };
      }
      if (!hooks.runNow) {
        reply.code(503);
        return { error: "automation engine not ready" };
      }
      const res = await hooks.runNow({
        scope: body.scope ?? "folder",
        ...(cwd ? { cwd } : {}),
        name: body.name,
      });
      if (!res.ok) {
        reply.code(400);
        return { error: res.error ?? "run failed" };
      }
      return { ok: true, ...(res.runId ? { runId: res.runId } : {}) };
    });
  });

  fastify.post("/api/plugins/automation/stop", async (req, reply) => {
    const body = (req.body ?? {}) as { scope?: AutomationScope; cwd?: unknown; runId?: string };
    return withCwd(reply, body.cwd, false, async (cwd) => {
      if (!body.runId) {
        reply.code(400);
        return { error: "runId required" };
      }
      if (!hooks.stopRun) {
        reply.code(503);
        return { error: "automation engine not ready" };
      }
      const res = await hooks.stopRun({
        scope: body.scope ?? "folder",
        ...(cwd ? { cwd } : {}),
        runId: body.runId,
      });
      if (!res.ok) {
        reply.code(400);
        return { error: res.error ?? "stop failed" };
      }
      return { ok: true };
    });
  });

  fastify.get("/api/plugins/automation/actions", async (req, reply) => {
    const q = (req.query ?? {}) as { cwd?: unknown };
    return withCwd(reply, q.cwd, false, (cwd) => {
      if (!hooks.listActions) return { actions: [] };
      return { actions: hooks.listActions(cwd) };
    });
  });

  // Takes no cwd: nothing to admit.
  fastify.get("/api/plugins/automation/trigger-kinds", async () => {
    const { TriggerRegistry, deriveTriggerTaxonomy } = await import("./trigger-registry.js");
    const { scheduleTrigger } = await import("./schedule-trigger.js");
    const registry = new TriggerRegistry();
    registry.register(scheduleTrigger);
    return { categories: deriveTriggerTaxonomy(registry) };
  });

  fastify.get("/api/plugins/automation/git-capable", async (req, reply) => {
    const q = (req.query ?? {}) as { cwd?: unknown };
    return withCwd(reply, q.cwd, false, async (cwd) => {
      if (!cwd) return { gitCapable: false };
      const { execFileSync } = await import(
        "@blackbelt-technology/pi-dashboard-shared/platform/exec.js"
      );
      try {
        const out = execFileSync("git", ["-C", cwd, "rev-parse", "--is-inside-work-tree"], {
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        return { gitCapable: out.trim() === "true" };
      } catch {
        return { gitCapable: false };
      }
    });
  });

  fastify.get("/api/plugins/automation/list", async (req, reply) => {
    const q = (req.query ?? {}) as { cwd?: unknown };
    // No cwd → global only (the server process cwd is never scanned).
    return withCwd(reply, q.cwd, false, async (cwd) => {
      const { scanAutomations } = await import("./scanner.js");
      const homeDir = os.homedir();
      const globalOn = hooks.scanGlobalScope?.() ?? true;
      // Global is always listed; with global on, a cwd of $HOME would list the same
      // `~/.pi/automation` again as folder. See change: fix-home-folder-scope-double-arm.
      const scanFolder = !!cwd && !(globalOn && path.resolve(cwd) === path.resolve(homeDir));
      const automations = scanAutomations(
        { repoRoot: cwd, homeDir, scanFolder, scanGlobal: true },
        hooks.triggerKinds?.() ?? FALLBACK_KINDS,
        hooks.actionIds?.(),
        hooks.workSourceIds?.(),
      );
      return { automations };
    });
  });

  fastify.get("/api/plugins/automation/runs", async (req, reply) => {
    const q = (req.query ?? {}) as { cwd?: unknown; scope?: AutomationScope; name?: string };
    const scope = q.scope ?? "folder";
    return withCwd(reply, q.cwd, scope !== "global", async (cwd) => {
      const { listRuns, readChildRuns } = await import("./run-store.js");
      const base = scopeBaseFor(scope, cwd);
      // Top-level records (parents + legacy flat). Attach child summaries so the
      // board can render a parent expandable to its children.
      // See change: add-automation-concurrent-spawn.
      const runs = listRuns(base, q.name).map((rec) =>
        rec.children ? { ...rec, childRuns: readChildRuns(base, rec) } : rec,
      );
      return { runs };
    });
  });

  fastify.get("/api/plugins/automation/result", async (req, reply) => {
    const q = (req.query ?? {}) as { cwd?: unknown; scope?: AutomationScope; runId?: string; sessionId?: string };
    // A session-id lookup with no scope and no cwd searches global only; every other
    // folder-scope lookup needs a cwd. See change: harden-git-terminal-plugin-boundaries (S1r).
    const bySession = !q.runId && !!q.sessionId;
    const required = q.scope ? q.scope !== "global" : !bySession;
    return withCwd(reply, q.cwd, required, async (cwd) => {
      const path = await import("node:path");
      const { findRunBySessionId, resolveRunDir } = await import("./run-store.js");
      // By session id: the run monitor's fallback once the run session is
      // archived (not resident). Searches the given scope, else folder (when a
      // cwd is given) then global. See change: archive-service-sessions-on-end.
      if (bySession && q.sessionId) {
        const scopes: AutomationScope[] = q.scope ? [q.scope] : cwd ? ["folder", "global"] : ["global"];
        for (const scope of scopes) {
          const base = scopeBaseFor(scope, cwd);
          const rec = findRunBySessionId(base, q.sessionId);
          if (!rec) continue;
          // Resolve the dir from the (validated) run id under the scope base —
          // never trust the record's own `dir` field (file content).
          const dir = resolveRunDir(base, rec.runId);
          let result: string | undefined;
          try {
            if (dir) result = (await guardedRead(path.join(dir, "result.md"))) ?? undefined;
          } catch { /* not finished yet */ }
          return { status: rec.status, runId: rec.runId, name: rec.name, ...(result !== undefined ? { result } : {}) };
        }
        reply.code(404);
        return { error: "run not found" };
      }
      if (!q.runId) {
        reply.code(400);
        return { error: "runId or sessionId required" };
      }
      const base = scopeBaseFor(q.scope ?? "folder", cwd);
      // Resolve a parent OR child run id to its on-disk dir (decision 1a).
      const dir = resolveRunDir(base, q.runId);
      if (!dir) {
        reply.code(404);
        return { error: "result not found" };
      }
      try {
        const result = await guardedRead(path.join(dir, "result.md"));
        if (result === null) throw new Error("refused");
        return { result };
      } catch {
        reply.code(404);
        return { error: "result not found" };
      }
    });
  });

  fastify.post("/api/plugins/automation/create", async (req, reply) => {
    const body = (req.body ?? {}) as {
      scope?: AutomationScope;
      cwd?: unknown;
      name?: string;
      config?: AutomationConfig;
      promptBody?: string;
    };
    const scope = body.scope ?? "folder";
    return withCwd(reply, body.cwd, scope !== "global", async (cwd) => {
      if (!body.name || !body.config) {
        reply.code(400);
        return { error: "name and config required" };
      }
      const { writeAutomation, isValidAutomationName } = await import("./automation-writer.js");
      if (!isValidAutomationName(body.name)) {
        reply.code(400);
        return { error: `invalid automation name: "${body.name}"` };
      }
      const badKind = unknownActionKind(body.config, hooks.actionIds?.());
      if (badKind) {
        reply.code(400);
        return { error: `unknown action kind: "${badKind}"` };
      }
      const base = scopeBaseFor(scope, cwd);
      try {
        const result = writeAutomation({
          scopeBase: base,
          name: body.name,
          config: body.config,
          ...(body.promptBody !== undefined ? { promptBody: body.promptBody } : {}),
        });
        return { ok: true, scope, dir: result.dir };
      } catch (e) {
        reply.code(400);
        return { error: e instanceof Error ? e.message : String(e) };
      }
    });
  });

  fastify.post("/api/plugins/automation/update", async (req, reply) => {
    const body = (req.body ?? {}) as {
      scope?: AutomationScope;
      cwd?: unknown;
      name?: string;
      config?: AutomationConfig;
      promptBody?: string;
    };
    const scope = body.scope ?? "folder";
    return withCwd(reply, body.cwd, scope !== "global", async (cwd) => {
      if (!body.name || !body.config) {
        reply.code(400);
        return { error: "name and config required" };
      }
      const { writeAutomation, isValidAutomationName } = await import("./automation-writer.js");
      if (!isValidAutomationName(body.name)) {
        reply.code(400);
        return { error: `invalid automation name: "${body.name}"` };
      }
      const badKind = unknownActionKind(body.config, hooks.actionIds?.());
      if (badKind) {
        reply.code(400);
        return { error: `unknown action kind: "${badKind}"` };
      }
      const base = scopeBaseFor(scope, cwd);
      try {
        const result = writeAutomation({
          scopeBase: base,
          name: body.name,
          config: body.config,
          intent: "update",
          ...(body.promptBody !== undefined ? { promptBody: body.promptBody } : {}),
        });
        return { ok: true, scope, dir: result.dir };
      } catch (e) {
        reply.code(400);
        return { error: e instanceof Error ? e.message : String(e) };
      }
    });
  });

  fastify.get("/api/plugins/automation/definition", async (req, reply) => {
    const q = (req.query ?? {}) as { cwd?: unknown; scope?: AutomationScope; name?: string };
    const scope = q.scope ?? "folder";
    return withCwd(reply, q.cwd, scope !== "global", async (cwd) => {
      if (!q.name) {
        reply.code(400);
        return { error: "name required" };
      }
      const { isValidAutomationName } = await import("./automation-writer.js");
      if (!isValidAutomationName(q.name)) {
        reply.code(400);
        return { error: `invalid automation name: "${q.name}"` };
      }
      const path = await import("node:path");
      const { parseAutomationYaml } = await import("./automation-schema.js");
      const base = scopeBaseFor(scope, cwd);
      const dir = path.join(base, ".pi", "automation", q.name);
      let rawText: string;
      try {
        const text = await guardedRead(path.join(dir, "automation.yaml"));
        if (text === null) throw new Error("refused");
        rawText = text;
      } catch {
        reply.code(404);
        return { error: "automation not found" };
      }
      const { config, error } = parseAutomationYaml(
        rawText,
        hooks.triggerKinds?.() ?? FALLBACK_KINDS,
        hooks.actionIds?.(),
        hooks.workSourceIds?.(),
      );
      if (!config) {
        reply.code(422);
        return { error: error ?? "invalid automation.yaml" };
      }
      let promptBody: string | undefined;
      if (config.action?.kind === "prompt") {
        try {
          promptBody = (await guardedRead(path.join(dir, "prompt.md"))) ?? "";
        } catch {
          promptBody = "";
        }
      }
      return { config, ...(promptBody !== undefined ? { promptBody } : {}) };
    });
  });

  fastify.delete("/api/plugins/automation", async (req, reply) => {
    // Query first (the dashboard client); a JSON body is accepted too because the generated MCP
    // tool sends a non-GET call's arguments as the body. See change: harden-git-terminal-plugin-boundaries (S1r).
    const q = { ...((req.body ?? {}) as object), ...((req.query ?? {}) as object) } as {
      cwd?: unknown;
      scope?: AutomationScope;
      name?: string;
    };
    const scope = q.scope ?? "folder";
    return withCwd(reply, q.cwd, scope !== "global", async (cwd) => {
      if (!q.name) {
        reply.code(400);
        return { error: "name required" };
      }
      const { deleteAutomation } = await import("./automation-writer.js");
      const base = scopeBaseFor(scope, cwd);
      return { ok: deleteAutomation(base, q.name) };
    });
  });
}
