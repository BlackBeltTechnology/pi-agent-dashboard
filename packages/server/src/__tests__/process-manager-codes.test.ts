/**
 * Verify every { success: false } path in process-manager sets a `code`.
 * Uses a mocked ToolResolver and stubbed spawnDetached/waitForNoCrash.
 * See change: spawn-failure-diagnostics.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import os from "node:os";

// Stub ToolResolver so we don't touch the real binary resolver.
vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js", () => ({
  ToolResolver: function MockToolResolver() {
    return {
      which: vi.fn().mockReturnValue("/usr/bin/pi"),
      resolvePi: vi.fn().mockReturnValue(["/usr/bin/node", "/path/to/pi/cli.js"]),
      resolveNode: vi.fn().mockReturnValue("/usr/bin/node"),
      buildSpawnEnv: vi.fn().mockReturnValue(process.env),
    };
  },
}));

vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/detached-spawn.js", () => ({
  spawnDetached: vi.fn(),
  waitForNoCrash: vi.fn(),
}));

vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/exec.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    execSync: vi.fn().mockImplementation(() => { throw new Error("tmux not found"); }),
    spawnSync: vi.fn().mockReturnValue({ status: 1, stdout: "", stderr: "" }),
    buildSafeArgv: vi.fn().mockImplementation((cmd: string, args: string[]) => ({
      argv: [cmd, ...args],
      spawnOptions: {},
    })),
  };
});

vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/managed-node-path.js", () => ({
  prependManagedNodeToPath: vi.fn().mockImplementation((env: unknown) => env),
}));

import { spawnPiSession, setResolver, resetResolver } from "../spawn-process/process-manager.js";
import { spawnDetached, waitForNoCrash } from "@blackbelt-technology/pi-dashboard-shared/platform/detached-spawn.js";
import { ToolResolver } from "@blackbelt-technology/pi-dashboard-shared/platform/binary-lookup.js";

const mockSpawnDetached = vi.mocked(spawnDetached);
const mockWaitForNoCrash = vi.mocked(waitForNoCrash);

describe("spawnPiSession failure codes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetResolver();
  });

  it("returns DIR_MISSING for non-existent cwd", async () => {
    const result = await spawnPiSession("/nonexistent/path/does/not/exist");
    expect(result.success).toBe(false);
    expect(result.code).toBe("DIR_MISSING");
  });

  it("returns PI_NOT_FOUND when pi binary is missing", async () => {
    const resolver = new ToolResolver();
    vi.mocked(resolver.resolvePi).mockReturnValue(null);
    setResolver(resolver as unknown as InstanceType<typeof ToolResolver>);

    // Force headless strategy so we reach the pi resolution check.
    const result = await spawnPiSession(os.tmpdir(), { strategy: "headless" });
    expect(result.success).toBe(false);
    expect(result.code).toBe("PI_NOT_FOUND");
  });

  it("returns TMUX_MISSING when tmux throws", async () => {
    // Force tmux mechanism via strategy option.
    const result = await spawnPiSession(os.tmpdir(), { strategy: "tmux" });
    expect(result.success).toBe(false);
    expect(result.code).toBe("TMUX_MISSING");
  });
});
