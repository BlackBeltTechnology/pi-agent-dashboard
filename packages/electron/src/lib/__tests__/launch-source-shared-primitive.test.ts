/**
 * Electron launches the server through the shared `launchDashboardServer`
 * primitive with the resolved LaunchSource's `cliPath` — it never resolves or
 * spawns a tsx binary itself (test-plan #E14).
 *
 * See change: cleanup-stale-fork-specs.
 */
import { describe, expect, it, vi } from "vitest";

const { launchDashboardServer } = vi.hoisted(() => ({
  launchDashboardServer: vi.fn(async () => ({ childPid: 4242 })),
}));
vi.mock("@blackbelt-technology/pi-dashboard-shared/server-launcher.js", async (orig) => ({
  ...(await orig<typeof import("@blackbelt-technology/pi-dashboard-shared/server-launcher.js")>()),
  launchDashboardServer,
}));

import { spawnFromSource } from "../launch-source.js";

describe("spawnFromSource → shared launch primitive (E14)", () => {
  it("calls launchDashboardServer with source.cliPath and no tsx binary", async () => {
    const source = { kind: "bundled" as const, cliPath: "/r/server/src/cli.ts", cwd: "/r/server" };
    const result = await spawnFromSource(source, { port: 8000, piPort: 9999 }, { logFile: "/tmp/e14-server.log" });

    expect(result).toEqual({ pid: 4242 });
    expect(launchDashboardServer).toHaveBeenCalledTimes(1);
    const arg = (launchDashboardServer.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(arg.cliPath).toBe(source.cliPath);
    expect(arg.starter).toBe("Electron");
    // The launch spec carries no tsx binary / tsx-shaped command anywhere.
    const nonEnv = { ...arg, env: undefined };
    expect(JSON.stringify(nonEnv)).not.toMatch(/\btsx\b/);
    expect(arg).not.toHaveProperty("cmd");
  });
});
