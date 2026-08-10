/**
 * Tests for GET /api/spawn-failures endpoint.
 * See change: spawn-failure-diagnostics.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerSystemRoutes } from "../routes/system-routes.js";

// Mock the spawn-failure-log module.
vi.mock("../spawn-process/spawn-failure-log.js", () => ({
  readSpawnFailures: vi.fn().mockReturnValue([]),
  appendSpawnFailure: vi.fn(),
  SpawnFailureEntry: undefined,
}));

import { readSpawnFailures } from "../spawn-process/spawn-failure-log.js";

const mockReadSpawnFailures = vi.mocked(readSpawnFailures);

function makeNoopDeps() {
  return {
    sessionManager: {} as never,
    preferencesStore: { flush: () => {} } as never,
    metaPersistence: { flushAll: () => {} } as never,
    config: { port: 8000, piPort: 9999, dev: false } as never,
    directoryService: {} as never,
    piGateway: {
      broadcast: vi.fn(),
      announceRestart: vi.fn(),
    } as never,
    idleTimer: {} as never,
    serverVersion: "test",
    localhostGuard: () => async () => {},
    tunnelStatus: () => ({ active: false }),
    serverConfig: { dev: false } as never,
    pluginStatusStore: { getAll: () => [] } as never,
  };
}

describe("GET /api/spawn-failures", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify({ logger: false });
    registerSystemRoutes(app, makeNoopDeps() as never);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns empty entries when no log exists", async () => {
    mockReadSpawnFailures.mockReturnValue([]);
    const res = await app.inject({ method: "GET", url: "/api/spawn-failures" });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty("entries");
    expect(body.entries).toEqual([]);
    expect(mockReadSpawnFailures).toHaveBeenCalledWith(50);
  });

  it("passes custom limit", async () => {
    mockReadSpawnFailures.mockReturnValue([]);
    await app.inject({ method: "GET", url: "/api/spawn-failures?limit=10" });
    expect(mockReadSpawnFailures).toHaveBeenCalledWith(10);
  });

  it("falls back to default limit on NaN", async () => {
    mockReadSpawnFailures.mockReturnValue([]);
    await app.inject({ method: "GET", url: "/api/spawn-failures?limit=abc" });
    expect(mockReadSpawnFailures).toHaveBeenCalledWith(50);
  });

  it("returns entries from the log", async () => {
    const entry = { ts: "2026-01-01T00:00:00Z", cwd: "/p/x", strategy: "headless", code: "PI_CRASHED", message: "crashed" };
    mockReadSpawnFailures.mockReturnValue([entry] as never);
    const res = await app.inject({ method: "GET", url: "/api/spawn-failures" });
    const body = JSON.parse(res.body);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].code).toBe("PI_CRASHED");
  });
});
