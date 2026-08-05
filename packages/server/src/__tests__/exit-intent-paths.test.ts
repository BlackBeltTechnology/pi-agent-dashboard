/**
 * Every deliberate exit path records WHY it is leaving, before it leaves.
 * That positive record is what replaced "nothing cleared the marker, so it
 * must have crashed". See change: fix-recovery-exit-intent (task 3.7).
 */
import { rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The restart route spawns a detached orchestrator process; stub it so the
// test exercises only the intent recording.
vi.mock("../spawn-process/restart-helper.js", () => ({ spawnRestart: () => {} }));

import { _resetBootStateForTests, readBootState, stampBootStart } from "../persistence/boot-state.js";
import { registerSystemRoutes } from "../routes/system-routes.js";

const BOOT_STATE_PATH = path.join(os.homedir(), ".pi", "dashboard", "boot-state.json");

function makeDeps() {
  return {
    sessionManager: {} as never,
    preferencesStore: { flush: () => {} } as never,
    metaPersistence: { flushAll: () => {} } as never,
    config: { port: 8000, piPort: 9999, dev: false } as never,
    networkGuard: (async () => { /* allow all */ }) as never,
  };
}

describe("deliberate exit paths record their intent", () => {
  let fastify: FastifyInstance;
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    rmSync(BOOT_STATE_PATH, { force: true });
    _resetBootStateForTests();
    stampBootStart(4242);
    fastify = Fastify();
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined as never) as never);
    registerSystemRoutes(fastify, makeDeps());
  });

  afterEach(async () => {
    // Absorb the route's deferred process.exit while the spy is still active.
    await new Promise((r) => setTimeout(r, 300));
    await fastify.close();
    exitSpy.mockRestore();
    rmSync(BOOT_STATE_PATH, { force: true });
  });

  it("/api/restart records `restart` (sessions survive it and will reattach)", async () => {
    const res = await fastify.inject({ method: "POST", url: "/api/restart", payload: {} });
    expect(res.statusCode).toBe(200);
    expect(readBootState()).toMatchObject({ bootId: 4242, exitIntent: "restart" });
  });

  it("/api/shutdown records `shutdown` by default", async () => {
    const res = await fastify.inject({ method: "POST", url: "/api/shutdown", payload: {} });
    expect(res.statusCode).toBe(200);
    expect(readBootState()).toMatchObject({ bootId: 4242, exitIntent: "shutdown" });
  });

  it("/api/shutdown records `user-quit` when the caller declares a user quit", async () => {
    const res = await fastify.inject({
      method: "POST",
      url: "/api/shutdown",
      payload: { userQuit: true },
    });
    expect(res.statusCode).toBe(200);
    expect(readBootState()).toMatchObject({ bootId: 4242, exitIntent: "user-quit" });
  });
});
