/**
 * Tests for the `/api/health.compatibility` field.
 * See change: restore-pi-version-skew-surface.
 *
 * `readCurrentPiVersion` is spied so we can drive the running-pi version;
 * `readPiCompatibility` + `computeCompatibility` stay real and read the
 * server's own package.json floor. The "above minimum" fixture is DERIVED from
 * that floor so a lockstep floor raise cannot silently flip it below the floor
 * (it did at 1.0.0). See change: update-pi-core-1-0-adopt-apis.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";

vi.mock("../pi/pi-version-skew.js", async (importActual) => {
  const actual = await importActual<typeof import("../pi/pi-version-skew.js")>();
  return { ...actual, readCurrentPiVersion: vi.fn() };
});

import { registerSystemRoutes } from "../routes/system-routes.js";
import { readCurrentPiVersion } from "../pi/pi-version-skew.js";

const mockReadCurrent = vi.mocked(readCurrentPiVersion);

const SERVER_MINIMUM: string = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../package.json"), "utf-8"),
).piCompatibility.minimum;
/** A version strictly above the floor: next major. */
const ABOVE_MINIMUM = `${Number(SERVER_MINIMUM.split(".")[0]) + 1}.0.0`;

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
    mockReadCurrent.mockReturnValue(ABOVE_MINIMUM);
    const compat = await getCompatibility(app);
    expect(compat).not.toBeNull();
    expect(compat.current).toBe(ABOVE_MINIMUM);
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
    mockReadCurrent.mockReturnValue(ABOVE_MINIMUM);
    await getCompatibility(app);
    await getCompatibility(app);
    await getCompatibility(app);
    expect(mockReadCurrent).toHaveBeenCalledTimes(1);
  });
});
