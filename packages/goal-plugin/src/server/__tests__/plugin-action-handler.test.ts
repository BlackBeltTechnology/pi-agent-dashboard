/**
 * goal-plugin composition-root scenarios driven through the REAL
 * `registerPlugin` with a FAKE `ServerPluginContext` (vi.fn() seams).
 *
 * Covers test-plan #E21 (goals_update spend decoration), #E22 (goal_status
 * peers: accumulator → projector → budget guard), #E23 (kill order:
 * token-first, session-only on token-miss), #X5 (no respawn after dispose),
 * #X6 (boot reconcile spawns with a NEW minted token), #E24/#E25 (driver-link
 * handover + idempotent re-delivery).
 *
 * The store is the plugin's own default-dir instance (per-run test HOME), so
 * state persists across a simulated restart (#X6) and is read back through
 * the plugin's REST routes on the fake ctx's real fastify.
 *
 * See change: relocate-goal-product-to-plugin (D2, D3).
 */
import Fastify, { type FastifyInstance } from "fastify";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerPluginContext } from "@blackbelt-technology/dashboard-plugin-runtime/server";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { registerPlugin } from "../index.js";

/** Controllable fake ServerPluginContext with vi.fn() seams + captured subs. */
function makeFakeCtx(opts: { knownCwds: string[] }) {
  const sessions = new Map<string, Partial<DashboardSession>>();
  const captured = {
    piHandlers: new Map<string, Array<(msg: unknown, sessionId?: string) => void>>(),
    sessionEnded: [] as Array<(sessionId: string) => void>,
    sessionResolved: [] as Array<(sessionId: string, pluginRef: Record<string, unknown>) => void>,
    shutdown: [] as Array<() => void>,
  };
  const ctx = {
    fastify: Fastify(),
    sessionManager: {
      listActive: vi.fn(() => []),
      listAll: vi.fn(() => [...sessions.values()]),
      getSession: vi.fn((id: string) => sessions.get(id)),
    },
    eventStore: { getEvents: vi.fn(() => []), getLatestEvent: vi.fn(() => undefined) },
    broadcastToSubscribers: vi.fn(),
    registerPiHandler: vi.fn((type: string, handler: (msg: unknown) => void) => {
      const arr = captured.piHandlers.get(type) ?? [];
      arr.push(handler as (msg: unknown, sessionId?: string) => void);
      captured.piHandlers.set(type, arr);
    }),
    registerBrowserHandler: vi.fn(),
    onEvent: vi.fn(() => () => {}),
    onSessionEnded: vi.fn((h: (sessionId: string) => void) => {
      captured.sessionEnded.push(h);
      return () => {};
    }),
    onSessionResolved: vi.fn((h: (sessionId: string, ref: Record<string, unknown>) => void) => {
      captured.sessionResolved.push(h);
      return () => {};
    }),
    onShutdown: vi.fn((h: () => void) => {
      captured.shutdown.push(h);
      return () => {};
    }),
    sendToSession: vi.fn((_sessionId?: string, _text?: string) => true),
    emitEventToSession: vi.fn(() => false),
    spawnSession: vi.fn(async (_opts?: { spawnToken?: string }) => ({
      success: true,
      spawnToken: "spawned-token",
    })),
    abortSession: vi.fn(() => false),
    abortSpawnedRun: vi.fn(
      async (_args?: { sessionId?: string; spawnToken?: string }) => false,
    ),
    registerCwdPolicy: vi.fn(),
    unregisterCwdPolicy: vi.fn(),
    provide: vi.fn(),
    consume: vi.fn(<T,>(name: string) =>
      name === "host.knownFolderCwds" ? (() => opts.knownCwds) as unknown as T : undefined,
    ),
    consumeAll: vi.fn(() => []),
    mintSpawnToken: vi.fn(() => `minted-${Math.random().toString(36).slice(2, 10)}`),
    renameSession: vi.fn(() => true),
    assignSessionRef: vi.fn(
      (_sessionId?: string, _ref?: Record<string, unknown>, _opts?: { persist?: boolean }) => true,
    ),
    getPluginConfig: vi.fn(() => ({})),
    updatePluginConfig: vi.fn(async () => {}),
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
  return { ctx: ctx as unknown as ServerPluginContext, mocks: ctx, captured, sessions };
}

describe("goal-plugin composition root (fake ctx)", () => {
  let cwd: string;
  let app: FastifyInstance;

  // Fake ONLY the timer pair the boot-reconcile/debounce paths use, keeping
  // setImmediate real so async fs I/O (goal-store reads/writes) still
  // completes: `flush()` yields real macrotask turns for it. Explicit clock
  // jumps drive the 30 s boot-reconcile timer (X6) past its grace window.
  // See change: relocate-goal-product-to-plugin.
  const flush = async () => {
    for (let i = 0; i < 80; i++) await new Promise((r) => setImmediate(r));
  };
  // Store broadcasts are TRAILING-DEBOUNCED (default 100 ms, faked clock):
  // settle = let real fs I/O land, then advance past the debounce window so
  // subscriber callbacks fire.
  const settle = async () => {
    await flush();
    await vi.advanceTimersByTimeAsync(150);
    await flush();
  };
  // Drive timer-scheduled async chains (respawn performSpawn: mint → store
  // write → spawn) to completion: alternate clock advances with real I/O turns.
  const pump = async () => {
    for (let i = 0; i < 20; i++) {
      await flush();
      await vi.advanceTimersByTimeAsync(2_000);
    }
    await flush();
  };
  // Condition-based wait: drive clock + I/O turns until `cond` holds (bounded).
  const pumpUntil = async (cond: () => boolean): Promise<boolean> => {
    for (let i = 0; i < 200 && !cond(); i++) {
      await flush();
      await vi.advanceTimersByTimeAsync(1_000);
    }
    return cond();
  };

  beforeEach(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "goal-comp-root-"));
    // The plugin's store uses the default per-HOME data dir — wipe it between
    // tests so goals from earlier tests in this file can't leak into
    // listAll-driven paths (reconcile, findCurrentDriverGoal).
    // See change: relocate-goal-product-to-plugin.
    fs.rmSync(path.join(os.homedir(), ".pi", "dashboard", "goals"), { recursive: true, force: true });
    fs.mkdirSync(path.join(os.homedir(), ".pi", "dashboard", "goals"), { recursive: true });
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(async () => {
    vi.useRealTimers();
    if (app) await app.close();
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  async function createGoal(
    h: ReturnType<typeof makeFakeCtx>,
    body: Record<string, unknown> = { objective: "ship it" },
  ): Promise<string> {
    const res = await h.ctx.fastify.inject({
      method: "POST",
      url: `/api/folders/goals?cwd=${encodeURIComponent(cwd)}`,
      payload: body,
    });
    expect(res.statusCode).toBe(201);
    return (JSON.parse(res.payload).data as { id: string }).id;
  }

  it("E21: goals_update broadcast decorates records with Σ session spend", async () => {
    const h = makeFakeCtx({ knownCwds: [cwd] });
    await registerPlugin(h.ctx);
    app = h.mocks.fastify;

    h.sessions.set("a", { id: "a", cwd, cost: 1.5 });
    h.sessions.set("b", { id: "b", cwd, cost: 2 });
    const goalId = await createGoal(h);
    await app.inject({
      method: "POST",
      url: `/api/folders/goals/${goalId}/sessions?cwd=${encodeURIComponent(cwd)}`,
      payload: { sessionId: "a" },
    });
    await app.inject({
      method: "POST",
      url: `/api/folders/goals/${goalId}/sessions?cwd=${encodeURIComponent(cwd)}`,
      payload: { sessionId: "b" },
    });
    h.mocks.broadcastToSubscribers.mockClear();

    // Any store mutation re-broadcasts the decorated payload.
    await app.inject({
      method: "PATCH",
      url: `/api/folders/goals/${goalId}?cwd=${encodeURIComponent(cwd)}`,
      payload: { objective: "ship it harder" },
    });
    await settle(); // trailing-debounced subscriber callbacks
    const updates = h.mocks.broadcastToSubscribers.mock.calls
      .map((c) => c[0] as { type: string; cwd: string; goals: Array<{ id: string; totalSpendUsd?: number }> })
      .filter((m) => m.type === "goals_update" && m.cwd === cwd);
    expect(updates.length).toBeGreaterThanOrEqual(1);
    expect(updates.at(-1)!.goals.find((r) => r.id === goalId)?.totalSpendUsd).toBeCloseTo(3.5, 10);
  });

  it("E22: goal_status peers persist verdict, project status, and halt on budget", async () => {
    const h = makeFakeCtx({ knownCwds: [cwd] });
    await registerPlugin(h.ctx);
    app = h.mocks.fastify;

    const goalId = await createGoal(h, { objective: "x", budget: { maxTurns: 2 } });
    h.sessions.set("s1", { id: "s1", cwd, goalId });

    const handlers = h.captured.piHandlers.get("goal_status")!;
    expect(handlers.length).toBeGreaterThanOrEqual(4); // accumulator, projector, budget, snapshot

    // A passing snapshot from the driver: verdict recorded + status projected.
    handlers.forEach((h2) => h2({ sessionId: "s1", payload: { status: "active", verdict: "pass", turnsUsed: 1 } }));
    await settle();
    let res = await app.inject({ method: "GET", url: `/api/folders/goals?cwd=${encodeURIComponent(cwd)}` });
    let record = (JSON.parse(res.payload).data as Array<Record<string, unknown>>).find((r) => r.id === goalId)!;
    expect(record.status).toBe("pursuing");
    expect(record.totalTurnsUsed).toBe(1);

    // Budget exceeded: the guard halts the loop via a /goal pause dispatch.
    handlers.forEach((h2) => h2({ sessionId: "s1", payload: { status: "active", verdict: "pass", turnsUsed: 5 } }));
    await settle();
    expect(h.mocks.sendToSession).toHaveBeenCalledWith("s1", "/goal pause");
  });


  it("E23: supervisor abort kills token-first; session kill only on token miss", async () => {
    const h = makeFakeCtx({ knownCwds: [cwd] });
    await registerPlugin(h.ctx);
    app = h.mocks.fastify;

    const goalId = await createGoal(h, { objective: "ship it", autoRespawn: true });
    h.sessions.set("s1", { id: "s1", cwd, goalId, status: "active" });

    // Driver spawns (route) then registers → link handover makes s1 current.
    await app.inject({
      method: "POST",
      url: `/api/folders/goals/${goalId}/sessions?cwd=${encodeURIComponent(cwd)}`,
      payload: { spawn: true },
    });
    h.captured.sessionResolved.forEach((h2) => h2("s1", { goalId }));
    await settle();

    // Driver dies → classifyDeath schedules an auto-respawn with a MINTED
    // token; advance past the backoff so the respawn spawn actually fires.
    h.captured.sessionEnded.forEach((h2) => h2("s1"));
    // The respawn fires after its backoff on the fake clock; wait until the
    // respawned spawn (carrying a token) actually went out.
    expect(
      await pumpUntil(
        () =>
          typeof (h.mocks.spawnSession.mock.calls.at(-1)?.[0] as { spawnToken?: string } | undefined)
            ?.spawnToken === "string",
      ),
    ).toBe(true);
    const respawnToken = h.mocks.spawnSession.mock.calls.at(-1)![0]!.spawnToken as string;
    expect(respawnToken).toMatch(/^minted-/);

    // User pauses → abort: killByToken first; when it resolves true, the
    // session-id kill ladder is never consulted.
    h.mocks.abortSpawnedRun.mockResolvedValue(true);
    await app.inject({
      method: "PATCH",
      url: `/api/folders/goals/${goalId}?cwd=${encodeURIComponent(cwd)}`,
      payload: { status: "paused" },
    });
    expect(h.mocks.abortSpawnedRun).toHaveBeenCalledWith({ spawnToken: respawnToken });
    const kills = h.mocks.abortSpawnedRun.mock.calls.map((c) => c[0] as { sessionId?: string });
    expect(kills.filter((k) => "sessionId" in k)).toHaveLength(0);
  });

  it("E23b: abort falls through to the session kill when the token kill misses", async () => {
    const h = makeFakeCtx({ knownCwds: [cwd] });
    await registerPlugin(h.ctx);
    app = h.mocks.fastify;

    const goalId = await createGoal(h, { objective: "ship it", autoRespawn: true });
    h.sessions.set("s1", { id: "s1", cwd, goalId, status: "active", sessionFile: "/tmp/s1.jsonl" });

    await app.inject({
      method: "POST",
      url: `/api/folders/goals/${goalId}/sessions?cwd=${encodeURIComponent(cwd)}`,
      payload: { spawn: true },
    });
    h.captured.sessionResolved.forEach((h2) => h2("s1", { goalId }));
    await settle();
    // Driver dies → auto-respawn schedules under a MINTED, PERSISTED token
    // (inFlightSpawn) while driverSessionId still names the dead driver.
    h.captured.sessionEnded.forEach((h2) => h2("s1"));
    expect(
      await pumpUntil(
        () =>
          typeof (h.mocks.spawnSession.mock.calls.at(-1)?.[0] as { spawnToken?: string } | undefined)
            ?.spawnToken === "string",
      ),
    ).toBe(true);
    // A respawn is now in flight under a minted token.
    const respawnToken = h.mocks.spawnSession.mock.calls.at(-1)![0]!.spawnToken as string;
    expect(respawnToken).toMatch(/^minted-/);

    // Pause the goal: the token kill FAILS (miss) → the supervisor escalates
    // to the session-id kill of the (stale) driver.
    h.mocks.abortSpawnedRun.mockClear();
    h.mocks.abortSpawnedRun.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await app.inject({
      method: "PATCH",
      url: `/api/folders/goals/${goalId}?cwd=${encodeURIComponent(cwd)}`,
      payload: { status: "paused" },
    });
    const killArgs = h.mocks.abortSpawnedRun.mock.calls.map((c) => c[0]);
    expect(killArgs[0]).toEqual({ spawnToken: respawnToken });
    expect(killArgs[1]).toEqual({ sessionId: "s1" });
  });


  it("X5: after the shutdown sub ran, a driver death schedules no respawn", async () => {
    const h = makeFakeCtx({ knownCwds: [cwd] });
    await registerPlugin(h.ctx);
    app = h.mocks.fastify;

    const goalId = await createGoal(h);
    h.sessions.set("s1", { id: "s1", cwd, goalId, status: "active" });
    await app.inject({
      method: "POST",
      url: `/api/folders/goals/${goalId}/sessions?cwd=${encodeURIComponent(cwd)}`,
      payload: { spawn: true },
    });
    h.captured.sessionResolved.forEach((h2) => h2("s1", { goalId }));
    await settle();
    h.mocks.spawnSession.mockClear();

    // Host stop: the shutdown sub disposes the supervisor.
    expect(h.captured.shutdown.length).toBeGreaterThanOrEqual(1);
    h.captured.shutdown.forEach((fn) => fn());

    // Post-dispose death: no respawn spawn, no timer scheduled.
    h.captured.sessionEnded.forEach((h2) => h2("s1"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.mocks.spawnSession).not.toHaveBeenCalled();
  });

  it("X6: boot reconcile after a crash mid-spawn re-spawns with a NEW minted token", async () => {
    // Boot #1: drive a goal into a persisted in-flight respawn.
    const h1 = makeFakeCtx({ knownCwds: [cwd] });
    await registerPlugin(h1.ctx);
    app = h1.mocks.fastify;
    const goalId = await createGoal(h1, { objective: "ship it", autoRespawn: true });
    h1.sessions.set("s1", { id: "s1", cwd, goalId, status: "active" });
    await app.inject({
      method: "POST",
      url: `/api/folders/goals/${goalId}/sessions?cwd=${encodeURIComponent(cwd)}`,
      payload: { spawn: true },
    });
    h1.captured.sessionResolved.forEach((h2) => h2("s1", { goalId }));
    await settle(); // let the handover's fs writes land before any clock jump
    await vi.advanceTimersByTimeAsync(35_000); // #1's boot reconcile: driver live → skip
    h1.captured.shutdown.forEach((fn) => fn()); // stop #1 (dispose + timer clear)
    await app.close();

    // Boot #2 (restart): the persisted record carries the dead-driver state;
    // NO session ever registers → after the grace window reconcile re-spawns.
    const h2ctx = makeFakeCtx({ knownCwds: [cwd] });
    await registerPlugin(h2ctx.ctx);
    expect(
      await pumpUntil(() => h2ctx.mocks.spawnSession.mock.calls.length > 0),
    ).toBe(true);
    expect(h2ctx.mocks.spawnSession).toHaveBeenCalledTimes(1);
    const spawnOpts = h2ctx.mocks.spawnSession.mock.calls[0]![0] as {
      cwd: string;
      spawnToken?: string;
      pluginRef?: Record<string, unknown>;
      lifecycle?: Record<string, unknown>;
    };
    expect(spawnOpts.cwd).toBe(cwd);
    expect(spawnOpts.spawnToken).toMatch(/^minted-/); // NEW token, minted post-restart
    expect(spawnOpts.pluginRef).toEqual({ goalId });
    expect(spawnOpts.lifecycle).toEqual({ recover: false });
    // The in-flight stamp was updated to the new token.
    const res = await h2ctx.mocks.fastify.inject({
      method: "GET",
      url: `/api/folders/goals?cwd=${encodeURIComponent(cwd)}`,
    });
    const record = (JSON.parse(res.payload).data as Array<{ id: string; inFlightSpawn?: { spawnToken?: string } }>).find(
      (r) => r.id === goalId,
    )!;
    expect(record.inFlightSpawn?.spawnToken).toBe(spawnOpts.spawnToken);
    await h2ctx.mocks.fastify.close();
    app = undefined as unknown as FastifyInstance;
  });

  it("E24: link handover clears the outgoing driver, replaces, stamps, primes once", async () => {
    const h = makeFakeCtx({ knownCwds: [cwd] });
    await registerPlugin(h.ctx);
    app = h.mocks.fastify;

    const goalId = await createGoal(h);
    h.sessions.set("s1", { id: "s1", cwd, goalId, status: "active" });
    await app.inject({
      method: "POST",
      url: `/api/folders/goals/${goalId}/sessions?cwd=${encodeURIComponent(cwd)}`,
      payload: { spawn: true },
    });
    // First register: s1 becomes the driver.
    h.captured.sessionResolved.forEach((h2) => h2("s1", { goalId }));
    await settle();

    // The prior driver dies; a respawned s2 registers with the same ref.
    h.sessions.set("s2", { id: "s2", cwd, goalId, status: "active" });
    h.mocks.assignSessionRef.mockClear();
    h.captured.sessionResolved.forEach((h2) => h2("s2", { goalId }));
    await settle();

    // C2e: the OUTGOING driver's in-memory goalId was cleared memory-only.
    const c2e = h.mocks.assignSessionRef.mock.calls.find(
      (c) => c[0] === "s1" && (c[1] as Record<string, unknown>).goalId === undefined,
    );
    expect(c2e).toBeDefined();
    expect(c2e![2]).toEqual({ persist: false });
    expect(h.mocks.assignSessionRef).toHaveBeenCalledWith("s2", { goalId });
    const persisted = h.mocks.assignSessionRef.mock.calls.filter(
      (c) => c[0] === "s2" && (c[1] as Record<string, unknown>).goalId === goalId,
    );
    expect(persisted.length).toBeGreaterThanOrEqual(1);
    // Primer dispatched exactly once to the new driver.
    const primes = h.mocks.sendToSession.mock.calls.filter((c) => c[0] === "s2");
    expect(primes.length).toBe(1);
    const res = await app.inject({ method: "GET", url: `/api/folders/goals?cwd=${encodeURIComponent(cwd)}` });
    const record = (JSON.parse(res.payload).data as Array<{ id: string; driverSessionId?: string }>).find(
      (r) => r.id === goalId,
    )!;
    expect(record.driverSessionId).toBe("s2");
  });

  it("E25: re-delivered first register is a no-op", async () => {
    const h = makeFakeCtx({ knownCwds: [cwd] });
    await registerPlugin(h.ctx);
    app = h.mocks.fastify;

    const goalId = await createGoal(h);
    h.sessions.set("s1", { id: "s1", cwd, goalId, status: "active" });
    await app.inject({
      method: "POST",
      url: `/api/folders/goals/${goalId}/sessions?cwd=${encodeURIComponent(cwd)}`,
      payload: { spawn: true },
    });
    h.captured.sessionResolved.forEach((h2) => h2("s1", { goalId }));
    await settle();

    h.mocks.assignSessionRef.mockClear();
    h.mocks.sendToSession.mockClear();
    // Same session, same ref, delivered again.
    h.captured.sessionResolved.forEach((h2) => h2("s1", { goalId }));
    await settle();

    expect(h.mocks.sendToSession).not.toHaveBeenCalled();
    expect(h.mocks.assignSessionRef).not.toHaveBeenCalled();
    const res = await app.inject({ method: "GET", url: `/api/folders/goals?cwd=${encodeURIComponent(cwd)}` });
    const record = (JSON.parse(res.payload).data as Array<{ id: string; driverSessionId?: string }>).find(
      (r) => r.id === goalId,
    )!;
    expect(record.driverSessionId).toBe("s1");
  });
});
