/**
 * Electron is the third launch path: the server it spawns must run under the
 * configured heap ceiling, not the runtime default, and must never override an
 * operator pin.
 *
 * See change: guard-server-heap-and-store-coupling
 * (D3, test-plan #E7 #E8 #E10 #X5).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_SERVER_HEAP } from "@blackbelt-technology/pi-dashboard-shared/heap-limits.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { launchDashboardServer } = vi.hoisted(() => ({
  launchDashboardServer: vi.fn(async () => ({ childPid: 4242 })),
}));
vi.mock("@blackbelt-technology/pi-dashboard-shared/server-launcher.js", async (orig) => ({
  ...(await orig<typeof import("@blackbelt-technology/pi-dashboard-shared/server-launcher.js")>()),
  launchDashboardServer,
}));

import { readServerMaxOldSpaceMb, spawnFromSource, stampServerHeap } from "../launch-source.js";

const MARKER = "PI_DASHBOARD_HEAP_FLAG";
let dir: string;
let configFile: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "elec-heap-"));
  configFile = path.join(dir, "config.json");
  launchDashboardServer.mockClear();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("readServerMaxOldSpaceMb", () => {
  it("E7: reads serverHeap.maxOldSpaceMb from config.json", () => {
    writeFileSync(configFile, JSON.stringify({ serverHeap: { maxOldSpaceMb: 2048 } }));
    expect(readServerMaxOldSpaceMb(configFile)).toBe(2048);
  });

  it.each([
    ["absent", null],
    ["unparseable", "{not json"],
    ["below the floor", JSON.stringify({ serverHeap: { maxOldSpaceMb: 16 } })],
    ["non-integer", JSON.stringify({ serverHeap: { maxOldSpaceMb: "lots" } })],
  ])("E10/E8: %s config falls back to the shared default", (_label, body) => {
    if (body !== null) writeFileSync(configFile, body);
    expect(readServerMaxOldSpaceMb(configFile)).toBe(DEFAULT_SERVER_HEAP.maxOldSpaceMb);
  });
});

describe("stampServerHeap", () => {
  it("E7: stamps the configured ceiling with its provenance marker", () => {
    writeFileSync(configFile, JSON.stringify({ serverHeap: { maxOldSpaceMb: 2048 } }));
    const env = stampServerHeap({ NODE_OPTIONS: "--enable-source-maps" }, configFile);
    expect(env.NODE_OPTIONS).toBe("--enable-source-maps --max-old-space-size=2048");
    expect(env[MARKER]).toBe("--max-old-space-size=2048");
  });

  it("X5: an operator pin wins and no flag of ours is added", () => {
    writeFileSync(configFile, JSON.stringify({ serverHeap: { maxOldSpaceMb: 2048 } }));
    const env = stampServerHeap({ NODE_OPTIONS: "--max_old_space_size=4096" }, configFile);
    expect(env.NODE_OPTIONS).toBe("--max_old_space_size=4096");
    expect(env).not.toHaveProperty(MARKER);
  });
});

describe("spawnFromSource carries the ceiling (wiring)", () => {
  const source = { kind: "bundled" as const, cliPath: "/r/server/cli.ts", cwd: "/r/server" };

  it("E7: the env handed to launchDashboardServer carries the ceiling", async () => {
    vi.stubEnv("NODE_OPTIONS", "");
    vi.stubEnv(MARKER, "");
    await spawnFromSource(source, { port: 8000, piPort: 9999 }, { logFile: path.join(dir, "server.log") });
    const { env } = (launchDashboardServer.mock.calls.at(-1) as unknown[])[0] as { env: Record<string, string> };
    // HOME is an ephemeral dir under `npm test`, so the shared default applies.
    expect(env.NODE_OPTIONS).toContain(`--max-old-space-size=${DEFAULT_SERVER_HEAP.maxOldSpaceMb}`);
    expect(env[MARKER]).toBe(`--max-old-space-size=${DEFAULT_SERVER_HEAP.maxOldSpaceMb}`);
  });

  it("E7: a CONFIGURED ceiling in ~/.pi/dashboard/config.json reaches the server env", async () => {
    const cfgDir = path.join(os.homedir(), ".pi", "dashboard");
    mkdirSync(cfgDir, { recursive: true });
    writeFileSync(path.join(cfgDir, "config.json"), JSON.stringify({ serverHeap: { maxOldSpaceMb: 3072 } }));
    try {
      vi.stubEnv("NODE_OPTIONS", "");
      vi.stubEnv(MARKER, "");
      await spawnFromSource(source, { port: 8000, piPort: 9999 }, { logFile: path.join(dir, "server.log") });
      const { env } = (launchDashboardServer.mock.calls.at(-1) as unknown[])[0] as { env: Record<string, string> };
      expect(env.NODE_OPTIONS).toBe("--max-old-space-size=3072");
      expect(env[MARKER]).toBe("--max-old-space-size=3072");
    } finally {
      rmSync(path.join(cfgDir, "config.json"), { force: true });
    }
  });

  it("X5: an operator pin in the Electron env reaches the server untouched", async () => {
    vi.stubEnv("NODE_OPTIONS", "--max-old-space-size=6000");
    await spawnFromSource(source, { port: 8000, piPort: 9999 }, { logFile: path.join(dir, "server.log") });
    const { env } = (launchDashboardServer.mock.calls.at(-1) as unknown[])[0] as { env: Record<string, string> };
    expect(env.NODE_OPTIONS).toBe("--max-old-space-size=6000");
    expect(env).not.toHaveProperty(MARKER);
  });
});
