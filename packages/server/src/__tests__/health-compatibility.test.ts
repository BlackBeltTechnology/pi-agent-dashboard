/**
 * Tests for the `/api/health.compatibility` field.
 * See change: restore-pi-version-skew-surface.
 *
 * `readCurrentPiVersion` is spied so we can drive the running-pi version;
 * `readPiCompatibility` + `computeCompatibility` stay real and read the
 * server's own package.json floor (currently minimum 0.78.0).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

vi.mock("../pi-version-skew.js", async (importActual) => {
  const actual = await importActual<typeof import("../pi-version-skew.js")>();
  return { ...actual, readCurrentPiVersion: vi.fn() };
});

import { registerSystemRoutes } from "../routes/system-routes.js";
import { readCurrentPiVersion } from "../pi-version-skew.js";

const mockReadCurrent = vi.mocked(readCurrentPiVersion);

function makeHealthDeps() {
  return {
    sessionManager: { listActive: () => [], listAll: () => [] } as never,
    preferencesStore: { flush: () => {} } as never,
    metaPersistence: { flushAll: () => {} } as never,
    config: { port: 8000, piPort: 9999, dev: false } as never,
    networkGuard: (async () => {}) as never,
    version: "test",
  };
}

async function getCompatibility(app: FastifyInstance) {
  const res = await app.inject({ method: "GET", url: "/api/health" });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body).compatibility;
}

describe("GET /api/health — compatibility", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = Fastify({ logger: false });
    registerSystemRoutes(app, makeHealthDeps() as never);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("null when pi is unresolvable", async () => {
    mockReadCurrent.mockReturnValue(undefined);
    expect(await getCompatibility(app)).toBeNull();
  });

  it("includes current + range when pi resolves above minimum", async () => {
    mockReadCurrent.mockReturnValue("0.99.0");
    const compat = await getCompatibility(app);
    expect(compat).not.toBeNull();
    expect(compat.current).toBe("0.99.0");
    expect(typeof compat.minimum).toBe("string");
    expect(compat.error).toBeUndefined();
  });

  it("surfaces error when pi is below the server's minimum floor", async () => {
    mockReadCurrent.mockReturnValue("0.10.0");
    const compat = await getCompatibility(app);
    expect(compat.error).toBeTruthy();
    expect(compat.error).toContain("0.10.0");
  });

  it("caches the probe for 30s (readCurrentPiVersion called once)", async () => {
    mockReadCurrent.mockReturnValue("0.99.0");
    await getCompatibility(app);
    await getCompatibility(app);
    await getCompatibility(app);
    expect(mockReadCurrent).toHaveBeenCalledTimes(1);
  });
});
