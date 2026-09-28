/**
 * `launchServer` must PASS `env` to `launchDashboardServer`.
 *
 * This is the whole of design D5a, and it is invisible in a `buildSpawnEnv`
 * unit test: that builder was exported and tested for months while
 * `launchServer` called `launchDashboardServer` with no `env` at all, so it
 * never ran in production. Once the spawn-side strip landed, a bridge-started
 * server inherits a STRIPPED environment — without this argument it would drop
 * to the bare V8 default on exactly the recovery path where the event store is
 * hottest. Deleting the `env:` option is therefore a silent regression with a
 * crash to show for it, and this is the test that goes red.
 *
 * See change: bound-session-heap-and-gc-telemetry (D5a), review round 1.
 */
import { HEAP_FLAG_MARKER_ENV } from "@blackbelt-technology/pi-dashboard-shared/heap-flags.js";
import type { DashboardConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const launchDashboardServer = vi.hoisted(() => vi.fn());

vi.mock("@blackbelt-technology/pi-dashboard-shared/server-launcher.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, launchDashboardServer };
});

const { launchServer } = await import("../server-launcher.js");

function config(over: Partial<DashboardConfig> = {}): DashboardConfig {
  return { port: 8000, piPort: 9999, ...over } as DashboardConfig;
}

// The test process itself may be running under an inherited dashboard heap
// flag (it is, whenever these tests run inside a dashboard-spawned session —
// literally the bug this change fixes). An unmarked flag in the ambient env is
// correctly read as an OPERATOR PIN and suppresses the stamp, so the ambient
// value has to be cleared for the stamp to be observable at all.
let priorOptions: string | undefined;
let priorMarker: string | undefined;

beforeEach(() => {
  priorOptions = process.env.NODE_OPTIONS;
  priorMarker = process.env[HEAP_FLAG_MARKER_ENV];
  delete process.env.NODE_OPTIONS;
  delete process.env[HEAP_FLAG_MARKER_ENV];
  launchDashboardServer.mockReset();
  launchDashboardServer.mockResolvedValue({ childPid: 4242 });
});

afterEach(() => {
  if (priorOptions === undefined) delete process.env.NODE_OPTIONS;
  else process.env.NODE_OPTIONS = priorOptions;
  if (priorMarker === undefined) delete process.env[HEAP_FLAG_MARKER_ENV];
  else process.env[HEAP_FLAG_MARKER_ENV] = priorMarker;
});

describe("launchServer heap stamp (D5a)", () => {
  it("passes an env carrying the configured ceiling and its provenance marker", async () => {
    const result = await launchServer(config({ serverHeap: { maxOldSpaceMb: 4096 } } as never));
    expect(result.success).toBe(true);

    const opts = launchDashboardServer.mock.calls[0][0];
    expect(opts.env).toBeDefined();
    expect(opts.env.NODE_OPTIONS).toContain("--max-old-space-size=4096");
    expect(opts.env[HEAP_FLAG_MARKER_ENV]).toBe("--max-old-space-size=4096");
    expect(opts.env.DASHBOARD_STARTER).toBe("Bridge");
  });

  it("falls back to the shipped default when the config omits serverHeap", async () => {
    await launchServer(config());
    const opts = launchDashboardServer.mock.calls[0][0];
    expect(opts.env.NODE_OPTIONS).toContain("--max-old-space-size=1536");
  });
});

describe("launchServer env overrides (#720)", () => {
  it("E21: passes narrow overrides — no PATH/HOME, markers cleared", async () => {
    vi.stubEnv("PI_DASHBOARD_ELECTRON", "1");
    try {
      await launchServer(config({ serverHeap: { maxOldSpaceMb: 4096 } } as never));
      const env = launchDashboardServer.mock.calls[0][0].env;
      expect("PATH" in env).toBe(false);
      expect("HOME" in env).toBe(false);
      expect(env.DASHBOARD_STARTER).toBe("Bridge");
      expect(env.NODE_OPTIONS).toContain("--max-old-space-size=4096");
      expect("PI_DASHBOARD_ELECTRON" in env).toBe(true);
      expect(env.PI_DASHBOARD_ELECTRON).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
