/**
 * REST routes for the automation-plugin, mounted under
 * `/api/plugins/automation/*`. Route registration is synchronous (required
 * before `fastify.listen`); handler bodies lazy-import the heavy modules
 * (`yaml`, scanner, run-store) so plugin load stays cheap.
 *
 *   GET    /api/plugins/automation/list?cwd=<repo>          → automations (folder+global)
 *   GET    /api/plugins/automation/runs?cwd=&scope=&name=   → run records
 *   GET    /api/plugins/automation/result?cwd=&scope=&runId= → result.md text
 *   POST   /api/plugins/automation/create                   → write automation.yaml (+prompt.md)
 *   DELETE /api/plugins/automation?cwd=&scope=&name=        → remove an automation
 *
 * Auth gating is handled by the dashboard's onRequest hook on `fastify`.
 * See change: add-automation-plugin.
 */
import os from "node:os";
import type { FastifyInstance } from "fastify";
import type { AutomationConfig, AutomationScope } from "../shared/automation-types.js";

/** Phase-1 registered trigger kinds (mirrors the server registry). */
const KNOWN_KINDS = new Set(["schedule"]);

/** Resolve the scope base dir for a (scope, cwd) pair. */
function scopeBaseFor(scope: AutomationScope, cwd: string | undefined): string {
  return scope === "global" ? os.homedir() : (cwd ?? process.cwd());
}

export function mountAutomationRoutes(fastify: FastifyInstance): void {
  fastify.get("/api/plugins/automation/list", async (req) => {
    const q = (req.query ?? {}) as { cwd?: string };
    const { scanAutomations } = await import("./scanner.js");
    const automations = scanAutomations(
      { repoRoot: q.cwd, homeDir: os.homedir(), scanFolder: !!q.cwd, scanGlobal: true },
      KNOWN_KINDS,
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
