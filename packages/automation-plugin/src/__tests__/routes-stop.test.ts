/**
 * /api/plugins/automation/stop route: validates runId, returns 503 when the
 * engine hook is absent, 400 on a failed stop, and ok when the injected
 * stopRun hook succeeds. See change: automation-ui-mockup-parity.
 */
import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import { mountAutomationRoutes } from "../server/routes.js";

async function appWith(hooks: Parameters<typeof mountAutomationRoutes>[1]) {
  const app = Fastify();
  mountAutomationRoutes(app, hooks);
  await app.ready();
  return app;
}

describe("POST /api/plugins/automation/stop", () => {
  it("400 when runId is missing", async () => {
    const app = await appWith({ stopRun: () => ({ ok: true }) });
    const res = await app.inject({ method: "POST", url: "/api/plugins/automation/stop", payload: {} });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("503 when the engine stop hook is not wired", async () => {
    const app = await appWith({});
    const res = await app.inject({ method: "POST", url: "/api/plugins/automation/stop", payload: { runId: "r1" } });
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it("aborts the run and returns ok via the injected hook", async () => {
    const stopRun = vi.fn(() => ({ ok: true as const }));
    const app = await appWith({ stopRun });
    const res = await app.inject({
      method: "POST",
      url: "/api/plugins/automation/stop",
      payload: { scope: "folder", cwd: "/r", runId: "r1" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(stopRun).toHaveBeenCalledWith({ scope: "folder", cwd: "/r", runId: "r1" });
    await app.close();
  });

  it("400 when the hook reports the run is not running", async () => {
    const app = await appWith({ stopRun: () => ({ ok: false, error: "not running" }) });
    const res = await app.inject({ method: "POST", url: "/api/plugins/automation/stop", payload: { runId: "r1" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain("not running");
    await app.close();
  });
});
