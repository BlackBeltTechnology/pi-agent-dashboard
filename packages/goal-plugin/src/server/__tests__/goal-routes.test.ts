/**
 * HTTP-level tests for the folder-scoped goal routes.
 *
 * Covers spec scenarios under `Requirement: Goals content page`,
 * `Requirement: Goal-to-session linking (1:N)`, and the cwd-validation
 * pattern shared with openspec-group-routes.
 *
 * See change: add-goals-folder-page (tasks 1.2, 1.4).
 */

import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decorateGoalsWithSpend } from "../decorate-goals-spend.js";
import { createGoalStore, type GoalStore } from "../goal-store.js";
import { registerGoalRoutes } from "../routes.js";

const PASSTHRU_GUARD = async () => {};

function makeSessionManager(cwd: string, costs: Record<string, number> = {}): any {
  const ids = new Set(["s1", ...Object.keys(costs)]);
  const sessions = [...ids].map((id) => ({ id, cwd, source: "tui", cost: costs[id] }));
  return {
    listAll: () => sessions,
    // PluginSessionManager surface (unknown-typed getSession) — the routes'
    // spend adapter reads through it. `get` stays for decorateGoalsWithSpend's
    // SpendSessionLookup, which this suite also drives directly.
    // See change: relocate-goal-product-to-plugin.
    getSession: (id: string) => sessions.find((s) => s.id === id),
    get: (id: string) => sessions.find((s) => s.id === id),
  };
}
/** Known-cwd set the routes validate against (host.knownFolderCwds stand-in). */
const knownCwds = new Set<string>();

describe("goal REST routes", () => {
  let dataDir: string;
  let fastify: FastifyInstance;
  let store: GoalStore;
  let cwd: string;
  let applied: { sessionId: string; goalId: string | null }[];
  let primed: { sessionId: string; objective: string }[];

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "goal-routes-"));
    cwd = dataDir; // any path in the known-cwd set
    knownCwds.clear();
    knownCwds.add(cwd);
    store = createGoalStore({ dataDir, debounceMs: 5 });
    applied = [];
    primed = [];
  });

  afterEach(async () => {
    if (fastify) await fastify.close();
    store.dispose();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  async function setup(spawnGoalSession?: any, sessionManager?: any) {
    fastify = Fastify();
    registerGoalRoutes(fastify, {
      sessionManager: sessionManager ?? makeSessionManager(cwd),
      knownFolderCwds: () => [...knownCwds],
      networkGuard: PASSTHRU_GUARD,
      store,
      applyGoalIdToSession: (sessionId, goalId) => applied.push({ sessionId, goalId }),
      primeGoalSession: (sessionId, goal) => primed.push({ sessionId, objective: goal.objective }),
      ...(spawnGoalSession ? { spawnGoalSession } : {}),
    });
    await fastify.ready();
  }

  const q = () => `cwd=${encodeURIComponent(cwd)}`;

  it("GET → empty list when none exist", async () => {
    await setup();
    const res = await fastify.inject({ method: "GET", url: `/api/folders/goals?${q()}` });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ success: true, data: [] });
  });

  it("GET → 400 when cwd missing", async () => {
    await setup();
    const res = await fastify.inject({ method: "GET", url: `/api/folders/goals` });
    expect(res.statusCode).toBe(400);
  });

  it("GET → 403 when cwd not in known set", async () => {
    await setup();
    const res = await fastify.inject({ method: "GET", url: `/api/folders/goals?cwd=/not/known` });
    expect(res.statusCode).toBe(403);
  });

  it("POST → creates a goal (201)", async () => {
    await setup();
    const res = await fastify.inject({
      method: "POST",
      url: `/api/folders/goals?${q()}`,
      payload: { objective: "Ship it" },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(true);
    expect(body.data.objective).toBe("Ship it");
    expect(body.data.status).toBe("pursuing");
  });

  it("POST → accepts a valid judge and persists it", async () => {
    await setup();
    const res = await fastify.inject({
      method: "POST",
      url: `/api/folders/goals?${q()}`,
      payload: { objective: "Ship it", judge: { provider: "anthropic", modelId: "claude", sameModel: true } },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload);
    expect(body.data.judge).toEqual({ provider: "anthropic", modelId: "claude", sameModel: true });
  });

  it("POST → 400 for malformed judge (missing modelId)", async () => {
    await setup();
    const res = await fastify.inject({
      method: "POST",
      url: `/api/folders/goals?${q()}`,
      payload: { objective: "x", judge: { provider: "anthropic" } },
    });
    expect(res.statusCode).toBe(400);
    expect(await store.list(cwd)).toEqual([]);
  });

  it("POST → ignores absent judge", async () => {
    await setup();
    const res = await fastify.inject({
      method: "POST",
      url: `/api/folders/goals?${q()}`,
      payload: { objective: "x" },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.payload).data.judge).toBeUndefined();
  });

  it("PATCH → 400 for malformed judge (missing provider)", async () => {
    await setup();
    const g = await store.create(cwd, { objective: "x" });
    const res = await fastify.inject({
      method: "PATCH",
      url: `/api/folders/goals/${g.id}?${q()}`,
      payload: { judge: { modelId: "claude" } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST → 400 without objective", async () => {
    await setup();
    const res = await fastify.inject({ method: "POST", url: `/api/folders/goals?${q()}`, payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH → updates status", async () => {
    await setup();
    const g = await store.create(cwd, { objective: "x" });
    const res = await fastify.inject({
      method: "PATCH",
      url: `/api/folders/goals/${g.id}?${q()}`,
      payload: { status: "achieved" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).data.status).toBe("achieved");
  });

  it("PATCH → 400 invalid status", async () => {
    await setup();
    const g = await store.create(cwd, { objective: "x" });
    const res = await fastify.inject({
      method: "PATCH",
      url: `/api/folders/goals/${g.id}?${q()}`,
      payload: { status: "bogus" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH → 404 unknown id", async () => {
    await setup();
    const res = await fastify.inject({
      method: "PATCH",
      url: `/api/folders/goals/nope?${q()}`,
      payload: { status: "paused" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("DELETE → removes goal and clears goalId on linked sessions", async () => {
    await setup();
    const g = await store.create(cwd, { objective: "x" });
    await store.linkSession(cwd, g.id, "s1");
    const res = await fastify.inject({ method: "DELETE", url: `/api/folders/goals/${g.id}?${q()}` });
    expect(res.statusCode).toBe(200);
    expect(await store.list(cwd)).toEqual([]);
    expect(applied).toContainEqual({ sessionId: "s1", goalId: null });
  });

  it("POST sessions → links existing session + stamps goalId", async () => {
    await setup();
    const g = await store.create(cwd, { objective: "x" });
    const res = await fastify.inject({
      method: "POST",
      url: `/api/folders/goals/${g.id}/sessions?${q()}`,
      payload: { sessionId: "s1" },
    });
    expect(res.statusCode).toBe(200);
    const cur = (await store.list(cwd))[0]!;
    expect(cur.sessionIds).toContain("s1");
    expect(applied).toContainEqual({ sessionId: "s1", goalId: g.id });
    // Linking primes the session: dispatch the objective so the loop starts.
    expect(primed).toContainEqual({ sessionId: "s1", objective: "x" });
  });

  it("DELETE sessions → unlinks + clears goalId", async () => {
    await setup();
    const g = await store.create(cwd, { objective: "x" });
    await store.linkSession(cwd, g.id, "s1");
    const res = await fastify.inject({
      method: "DELETE",
      url: `/api/folders/goals/${g.id}/sessions/s1?${q()}`,
    });
    expect(res.statusCode).toBe(200);
    const cur = (await store.list(cwd))[0]!;
    expect(cur.sessionIds).not.toContain("s1");
    expect(applied).toContainEqual({ sessionId: "s1", goalId: null });
  });

  it("POST sessions spawn:true → invokes spawnGoalSession", async () => {
    let spawnedFor: string | null = null;
    await setup(async (_cwd: string, goalId: string) => {
      spawnedFor = goalId;
      return { success: true };
    });
    const g = await store.create(cwd, { objective: "x" });
    const res = await fastify.inject({
      method: "POST",
      url: `/api/folders/goals/${g.id}/sessions?${q()}`,
      payload: { spawn: true },
    });
    expect(res.statusCode).toBe(200);
    expect(spawnedFor).toBe(g.id);
  });

  // See change: fix-goal-detail-turns-and-spend.
  it("X3: GET record carries server-derived totalSpendUsd", async () => {
    const sm = makeSessionManager(cwd, { s1: 0.29 });
    await setup(undefined, sm);
    const g = await store.create(cwd, { objective: "x" });
    await store.linkSession(cwd, g.id, "s1");
    const res = await fastify.inject({ method: "GET", url: `/api/folders/goals?${q()}` });
    const body = JSON.parse(res.payload);
    expect(body.data[0].totalSpendUsd).toBeCloseTo(0.29, 10);
  });

  it("X3: goals_update broadcast payload record carries totalSpendUsd", async () => {
    const sm = makeSessionManager(cwd, { s1: 0.29 });
    await setup(undefined, sm);
    const g = await store.create(cwd, { objective: "x" });
    await store.linkSession(cwd, g.id, "s1");
    // Mirror the server.ts subscriber: decorate payload.goals before broadcast.
    const seen = await new Promise<any[]>((resolve) => {
      const unsub = store.subscribe((_cwd, payload) => {
        unsub();
        resolve(decorateGoalsWithSpend(payload.goals, sm));
      });
      void store.update(cwd, g.id, { objective: "x2" });
    });
    expect(seen.find((r) => r.id === g.id)?.totalSpendUsd).toBeCloseTo(0.29, 10);
  });

  it("X2: mutation response is decorated but persisted file has NO totalSpendUsd", async () => {
    const sm = makeSessionManager(cwd, { s1: 0.29 });
    await setup(undefined, sm);
    const g = await store.create(cwd, { objective: "x" });
    // Link via the route so the cache-aliased response path is exercised.
    const res = await fastify.inject({
      method: "POST",
      url: `/api/folders/goals/${g.id}/sessions?${q()}`,
      payload: { sessionId: "s1" },
    });
    expect(JSON.parse(res.payload).data.totalSpendUsd).toBeCloseTo(0.29, 10);
    // Flush the debounced write, then inspect the on-disk record.
    await new Promise((r) => setTimeout(r, 30));
    const hash = createHash("sha256").update(cwd).digest("hex").slice(0, 12);
    const raw = JSON.parse(await fs.readFile(path.join(dataDir, `${hash}.json`), "utf-8"));
    const stored = raw.goals.find((r: any) => r.id === g.id);
    expect(stored).toBeTruthy();
    expect("totalSpendUsd" in stored).toBe(false);
  });

  it("POST sessions spawn:true → 404 for unknown goal", async () => {
    await setup(async () => ({ success: true }));
    const res = await fastify.inject({
      method: "POST",
      url: `/api/folders/goals/nope/sessions?${q()}`,
      payload: { spawn: true },
    });
    expect(res.statusCode).toBe(404);
  });
});


/** The exact REST surface today (test-plan #E19) — method+path pairs. */
const EXPECTED_ROUTES: Array<[string, string]> = [
  ["GET", "/api/folders/goals"],
  ["POST", "/api/folders/goals"],
  ["PATCH", "/api/folders/goals/:id"],
  ["DELETE", "/api/folders/goals/:id"],
  ["POST", "/api/folders/goals/:id/sessions"],
  ["DELETE", "/api/folders/goals/:id/sessions/:sid"],
];

/** A network guard that rejects any non-loopback remote (mirrors the host guard's posture). */
const LOOPBACK_GUARD = async (
  request: { ip: string },
  reply: { code: (n: number) => void; send: (body: unknown) => void },
) => {
  const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];
  if (!loopback.includes(request.ip)) {
    reply.code(403);
    reply.send({ success: false, error: "localhost only" });
  }
};

describe("goal routes on the plugin surface (relocate-goal-product-to-plugin)", () => {
  let dataDir: string;
  let fastify: FastifyInstance;
  let store: GoalStore;
  let cwd: string;
  let knownCwds: Set<string>;

  beforeEach(async () => {
    dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "goal-routes-reloc-"));
    cwd = dataDir;
    knownCwds = new Set([cwd]);
    store = createGoalStore({ dataDir, debounceMs: 5 });
  });

  afterEach(async () => {
    if (fastify) await fastify.close();
    store.dispose();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const q = () => `cwd=${encodeURIComponent(cwd)}`;

  function setupRelocated(): void {
    fastify = Fastify();
    registerGoalRoutes(fastify, {
      sessionManager: makeSessionManager(cwd),
      knownFolderCwds: () => [...knownCwds],
      networkGuard: LOOPBACK_GUARD as unknown as Parameters<typeof registerGoalRoutes>[1]["networkGuard"],
      store,
      applyGoalIdToSession: () => {},
    });
  }

  it("E19: route table is exactly today's six /api/folders/goals* pairs; nothing under /api/plugins/goal/", async () => {
    const onRoute: Array<{ method: string; url: string }> = [];
    fastify = Fastify();
    // onRoute fires at REGISTRATION time — the hook must precede the routes.
    fastify.addHook("onRoute", (r) => {
      onRoute.push({ method: r.method as string, url: r.url });
    });
    registerGoalRoutes(fastify, {
      sessionManager: makeSessionManager(cwd),
      knownFolderCwds: () => [...knownCwds],
      networkGuard: LOOPBACK_GUARD as unknown as Parameters<typeof registerGoalRoutes>[1]["networkGuard"],
      store,
      applyGoalIdToSession: () => {},
    });
    await fastify.ready();
    const pairs = onRoute
      .filter((r) => r.method !== "HEAD")
      .map((r) => `${r.method} ${r.url}`)
      .sort();
    expect(pairs).toEqual(EXPECTED_ROUTES.map(([m, u]) => `${m} ${u}`).sort());
    expect(pairs.some((p) => p.includes("/api/plugins/goal"))).toBe(false);
  });

  it("E18: every route mounts the networkGuard preHandler; non-loopback inject → 403", async () => {
    const onRoute: Array<{ method: string; url: string; preHandler: unknown }> = [];
    fastify = Fastify();
    // onRoute fires at REGISTRATION time — hook before the routes.
    fastify.addHook("onRoute", (r) => {
      onRoute.push({
        method: r.method as string,
        url: r.url,
        preHandler: r.preHandler,
      });
    });
    registerGoalRoutes(fastify, {
      sessionManager: makeSessionManager(cwd),
      knownFolderCwds: () => [...knownCwds],
      networkGuard: LOOPBACK_GUARD as unknown as Parameters<typeof registerGoalRoutes>[1]["networkGuard"],
      store,
      applyGoalIdToSession: () => {},
    });
    await fastify.ready();

    // The six method+path pairs (auto-derived HEAD twins excluded), each with
    // the guard mounted as its preHandler.
    const goalRoutes = onRoute.filter((r) => r.url.startsWith("/api/folders/goals") && r.method !== "HEAD");
    expect(goalRoutes).toHaveLength(EXPECTED_ROUTES.length);
    const pairs = new Set(goalRoutes.map((r) => `${r.method} ${r.url}`));
    for (const [method, url] of EXPECTED_ROUTES) {
      expect(pairs.has(`${method} ${url}`), `${method} ${url} mounted`).toBe(true);
    }
    for (const r of goalRoutes) expect(r.preHandler, `preHandler on ${r.method} ${r.url}`).toBeDefined();

    // Non-loopback remote, no auth → the guard rejects.
    const res = await fastify.inject({
      method: "GET",
      url: `/api/folders/goals?${q()}`,
      remoteAddress: "10.1.2.3",
    });
    expect(res.statusCode).toBe(403);
  });

  it("E20: known-cwd decision table — active, pinned-inactive, neither", async () => {
    // active-unpinned: session cwd in the known set → 200.
    setupRelocated();
    await fastify.ready();
    let res = await fastify.inject({ method: "GET", url: `/api/folders/goals?${q()}` });
    expect(res.statusCode).toBe(200);

    // pinned-inactive: in the known set without any session → 200 (empty).
    const other = await fs.mkdtemp(path.join(os.tmpdir(), "goal-routes-pinned-"));
    knownCwds.add(other);
    res = await fastify.inject({ method: "GET", url: `/api/folders/goals?cwd=${encodeURIComponent(other)}` });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload).data).toEqual([]);

    // neither: unknown cwd → today's rejectInvalidCwd 403 body.
    res = await fastify.inject({ method: "GET", url: "/api/folders/goals?cwd=/elsewhere" });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload).error).toBe("cwd not allowed");
    await fs.rm(other, { recursive: true, force: true });
  });
});
