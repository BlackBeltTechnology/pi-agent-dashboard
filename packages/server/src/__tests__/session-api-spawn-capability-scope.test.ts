/**
 * WO-A (change: leaf-only-helpers) 1.1 — POST /api/session/spawn accepts a
 * capability-scope body: `{ cwd?, excludeTools?, name? }`. `excludeTools` (array
 * of non-empty strings, at most 32 entries, at most 200 chars each) and `name`
 * (non-empty string, at most 200 chars) are validated at the HTTP boundary and
 * handed to `spawnPiSession` verbatim; anything else is a 400 with no spawn.
 */
import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { registerSessionApi } from "../session/session-api.js";

const spawn = vi.hoisted(() => vi.fn());
vi.mock("../spawn-process/process-manager.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  spawnPiSession: spawn,
}));
vi.mock("../spawn-process/spawn-register-watchdog.js", () => ({ armSpawnWatchdog: vi.fn() }));

async function build() {
  const app = Fastify();
  registerSessionApi(app, {
    sessionManager: createMemorySessionManager(),
    piGateway: {} as never,
    browserGateway: { headlessPidRegistry: { register: vi.fn() } } as never,
  });
  return app;
}

describe("POST /api/session/spawn capability scope", () => {
  beforeEach(() => {
    spawn.mockReset();
    spawn.mockResolvedValue({ success: true, message: "ok" });
  });

  it("passes excludeTools + name through to spawnPiSession verbatim", async () => {
    const app = await build();
    const excludeTools = ["Agent", "agent_*", "workflow_*"];
    const res = await app.inject({
      method: "POST",
      url: "/api/session/spawn",
      payload: { cwd: "/w", excludeTools, name: "leaf-worker" },
    });
    expect(res.statusCode).toBe(200);
    expect(spawn).toHaveBeenCalledWith(
      "/w",
      expect.objectContaining({ excludeTools, name: "leaf-worker" }),
    );
  });

  it("rejects a non-array excludeTools with 400 (no spawn)", async () => {
    const app = await build();
    const res = await app.inject({
      method: "POST",
      url: "/api/session/spawn",
      payload: { cwd: "/w", excludeTools: "Agent" },
    });
    expect(res.statusCode).toBe(400);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("rejects an excludeTools entry that is not a non-empty string with 400 (no spawn)", async () => {
    const app = await build();
    const res = await app.inject({
      method: "POST",
      url: "/api/session/spawn",
      payload: { cwd: "/w", excludeTools: ["Agent", ""] },
    });
    expect(res.statusCode).toBe(400);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("rejects more than 32 excludeTools entries with 400 (no spawn)", async () => {
    const app = await build();
    const res = await app.inject({
      method: "POST",
      url: "/api/session/spawn",
      payload: { cwd: "/w", excludeTools: Array.from({ length: 33 }, (_, i) => `t${i}`) },
    });
    expect(res.statusCode).toBe(400);
    expect(spawn).not.toHaveBeenCalled();
  });

  it("rejects an invalid name with 400 (no spawn)", async () => {
    const app = await build();
    const res = await app.inject({
      method: "POST",
      url: "/api/session/spawn",
      payload: { cwd: "/w", name: "x".repeat(201) },
    });
    expect(res.statusCode).toBe(400);
    expect(spawn).not.toHaveBeenCalled();
  });
});
