/**
 * REST routes for the automation-plugin, mounted under
 * `/api/plugins/automation/*`. Route registration is synchronous (required
 * before `fastify.listen`); handler bodies lazy-import the heavy modules
 * (`yaml`, scanner, run-store) so plugin load stays cheap.
 *
 *   GET    /api/plugins/automation/list?cwd=<repo>          → automations (folder+global)
 *   GET    /api/plugins/automation/runs?cwd=&scope=&name=   → run records
 *   GET    /api/plugins/automation/result?cwd=&scope=&runId= → result.md text
 *   GET    /api/plugins/automation/trigger-kinds            → trigger taxonomy descriptors
 *   POST   /api/plugins/automation/create                   → write automation.yaml (+prompt.md), reject collision
 *   POST   /api/plugins/automation/update                   → overwrite an existing automation in place
 *   GET    /api/plugins/automation/definition?cwd=&scope=&name= → load config + prompt body for edit
 *   POST   /api/plugins/automation/run                      → trigger a single run now
 *   DELETE /api/plugins/automation?cwd=&scope=&name=        → remove an automation
 *
 * Auth gating is handled by the dashboard's onRequest hook on `fastify`.
 * See change: add-automation-plugin.
 */
import os from "node:os";
import type { FastifyInstance } from "fastify";
import type { ActionDescriptor, AutomationConfig, AutomationScope } from "../shared/automation-types.js";
import { BUILTIN_ACTION_ALIASES } from "../shared/automation-types.js";

/** Phase-1 registered trigger kinds (mirrors the server registry). */
const KNOWN_KINDS = new Set(["schedule"]);

/** Resolve the scope base dir for a (scope, cwd) pair. */
function scopeBaseFor(scope: AutomationScope, cwd: string | undefined): string {
  return scope === "global" ? os.homedir() : (cwd ?? process.cwd());
}

/** Built-in action kinds always accepted (aliased to core.* at read time). */
const BUILTIN_ACTION_KINDS = new Set(Object.keys(BUILTIN_ACTION_ALIASES));

/**
 * Reject an automation whose `action.kind` is neither a built-in alias nor a
 * registered action id, BEFORE it is written to disk. Mirrors the read-path
 * validation so `/create` + `/update` cannot persist a config that `/list`
 * would later mark invalid. See change: register-plugin-automation-events.
 */
function unknownActionKind(
  config: AutomationConfig | undefined,
  ids: ReadonlySet<string> | undefined,
): string | undefined {
  const kind = config?.action?.kind;
  if (typeof kind !== "string" || kind.length === 0) return undefined; // writer surfaces shape errors
  if (BUILTIN_ACTION_KINDS.has(kind)) return undefined;
  if (ids?.has(kind)) return undefined;
  return kind;
}

/** Optional hooks supplied by the engine for routes that need run control. */
export interface AutomationRouteHooks {
  /** Trigger exactly one run of an automation now (manual fire). */
  runNow?: (args: {
    scope: AutomationScope;
    cwd?: string;
    name: string;
  }) => Promise<{ ok: boolean; runId?: string; error?: string }>;
  /** Stop a `running` run (abort its session + finalize the record). */
  stopRun?: (args: {
    scope: AutomationScope;
    cwd?: string;
    runId: string;
  }) => { ok: boolean; error?: string };
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
}

export function mountAutomationRoutes(
  fastify: FastifyInstance,
  hooks: AutomationRouteHooks = {},
): void {
  fastify.post("/api/plugins/automation/run", async (req, reply) => {
    const body = (req.body ?? {}) as { scope?: AutomationScope; cwd?: string; name?: string };
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
      ...(body.cwd ? { cwd: body.cwd } : {}),
      name: body.name,
    });
    if (!res.ok) {
      reply.code(400);
      return { error: res.error ?? "run failed" };
    }
    return { ok: true, ...(res.runId ? { runId: res.runId } : {}) };
  });

  fastify.post("/api/plugins/automation/stop", async (req, reply) => {
    const body = (req.body ?? {}) as { scope?: AutomationScope; cwd?: string; runId?: string };
    if (!body.runId) {
      reply.code(400);
      return { error: "runId required" };
    }
    if (!hooks.stopRun) {
      reply.code(503);
      return { error: "automation engine not ready" };
    }
    const res = hooks.stopRun({
      scope: body.scope ?? "folder",
      ...(body.cwd ? { cwd: body.cwd } : {}),
      runId: body.runId,
    });
    if (!res.ok) {
      reply.code(400);
      return { error: res.error ?? "stop failed" };
    }
    return { ok: true };
  });

  fastify.get("/api/plugins/automation/actions", async (req) => {
    const q = (req.query ?? {}) as { cwd?: string };
    if (!hooks.listActions) return { actions: [] };
    return { actions: hooks.listActions(q.cwd) };
  });

  fastify.get("/api/plugins/automation/trigger-kinds", async () => {
    const { TriggerRegistry, deriveTriggerTaxonomy } = await import("./trigger-registry.js");
    const { scheduleTrigger } = await import("./schedule-trigger.js");
    const registry = new TriggerRegistry();
    registry.register(scheduleTrigger);
    return { categories: deriveTriggerTaxonomy(registry) };
  });

  fastify.get("/api/plugins/automation/git-capable", async (req) => {
    const q = (req.query ?? {}) as { cwd?: string };
    if (!q.cwd) return { gitCapable: false };
    const { execFileSync } = await import(
      "@blackbelt-technology/pi-dashboard-shared/platform/exec.js"
    );
    try {
      const out = execFileSync("git", ["-C", q.cwd, "rev-parse", "--is-inside-work-tree"], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return { gitCapable: out.trim() === "true" };
    } catch {
      return { gitCapable: false };
    }
  });

  fastify.get("/api/plugins/automation/list", async (req) => {
    const q = (req.query ?? {}) as { cwd?: string };
    const { scanAutomations } = await import("./scanner.js");
    const automations = scanAutomations(
      { repoRoot: q.cwd, homeDir: os.homedir(), scanFolder: !!q.cwd, scanGlobal: true },
      KNOWN_KINDS,
      hooks.actionIds?.(),
    );
    return { automations };
  });

  fastify.get("/api/plugins/automation/runs", async (req) => {
    const q = (req.query ?? {}) as { cwd?: string; scope?: AutomationScope; name?: string };
    const { listRuns } = await import("./run-store.js");
    const base = scopeBaseFor(q.scope ?? "folder", q.cwd);
    const runs = listRuns(base, q.name);
    return { runs };
  });

  fastify.get("/api/plugins/automation/result", async (req, reply) => {
    const q = (req.query ?? {}) as { cwd?: string; scope?: AutomationScope; runId?: string };
    if (!q.runId) {
      reply.code(400);
      return { error: "runId required" };
    }
    const fs = await import("node:fs");
    const path = await import("node:path");
    const base = scopeBaseFor(q.scope ?? "folder", q.cwd);
    const file = path.join(base, ".pi", "automation", "runs", q.runId, "result.md");
    try {
      return { result: fs.readFileSync(file, "utf-8") };
    } catch {
      reply.code(404);
      return { error: "result not found" };
    }
  });

  fastify.post("/api/plugins/automation/create", async (req, reply) => {
    const body = (req.body ?? {}) as {
      scope?: AutomationScope;
      cwd?: string;
      name?: string;
      config?: AutomationConfig;
      promptBody?: string;
    };
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
    const scope = body.scope ?? "folder";
    const base = scopeBaseFor(scope, body.cwd);
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

  fastify.post("/api/plugins/automation/update", async (req, reply) => {
    const body = (req.body ?? {}) as {
      scope?: AutomationScope;
      cwd?: string;
      name?: string;
      config?: AutomationConfig;
      promptBody?: string;
    };
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
    const scope = body.scope ?? "folder";
    const base = scopeBaseFor(scope, body.cwd);
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

  fastify.get("/api/plugins/automation/definition", async (req, reply) => {
    const q = (req.query ?? {}) as { cwd?: string; scope?: AutomationScope; name?: string };
    if (!q.name) {
      reply.code(400);
      return { error: "name required" };
    }
    const { isValidAutomationName } = await import("./automation-writer.js");
    if (!isValidAutomationName(q.name)) {
      reply.code(400);
      return { error: `invalid automation name: "${q.name}"` };
    }
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { parseAutomationYaml } = await import("./automation-schema.js");
    const base = scopeBaseFor(q.scope ?? "folder", q.cwd);
    const dir = path.join(base, ".pi", "automation", q.name);
    let rawText: string;
    try {
      rawText = fs.readFileSync(path.join(dir, "automation.yaml"), "utf-8");
    } catch {
      reply.code(404);
      return { error: "automation not found" };
    }
    const { config, error } = parseAutomationYaml(rawText, KNOWN_KINDS, hooks.actionIds?.());
    if (!config) {
      reply.code(422);
      return { error: error ?? "invalid automation.yaml" };
    }
    let promptBody: string | undefined;
    if (config.action.kind === "prompt") {
      try {
        promptBody = fs.readFileSync(path.join(dir, "prompt.md"), "utf-8");
      } catch {
        promptBody = "";
      }
    }
    return { config, ...(promptBody !== undefined ? { promptBody } : {}) };
  });

  fastify.delete("/api/plugins/automation", async (req, reply) => {
    const q = (req.query ?? {}) as { cwd?: string; scope?: AutomationScope; name?: string };
    if (!q.name) {
      reply.code(400);
      return { error: "name required" };
    }
    const { deleteAutomation } = await import("./automation-writer.js");
    const base = scopeBaseFor(q.scope ?? "folder", q.cwd);
    return { ok: deleteAutomation(base, q.name) };
  });
}
