/**
 * Pins the exact `launchDashboardServer` call shape of `pi-dashboard start`
 * (test-plan #E16): the CLI hands the shared primitive its cliPath, extra
 * args, log file, readiness deadline, starter and port, and supplies NO
 * `env` (the primitive owns the PATH-augmented env merge).
 *
 * `cmdStart` is not exported; it is reached through `cmdRestart`'s
 * not-running fallback with every I/O probe stubbed.
 *
 * See change: cleanup-stale-fork-specs.
 */
import { describe, it, expect, vi } from "vitest";

const { launchDashboardServer } = vi.hoisted(() => ({
  launchDashboardServer: vi.fn(async () => ({ childPid: 4242, reportedPid: 4242 })),
}));
vi.mock("@blackbelt-technology/pi-dashboard-shared/server-launcher.js", async (orig) => ({
  ...(await orig<typeof import("@blackbelt-technology/pi-dashboard-shared/server-launcher.js")>()),
  launchDashboardServer,
}));
vi.mock("@blackbelt-technology/pi-dashboard-shared/server-identity.js", async (orig) => ({
  ...(await orig<typeof import("@blackbelt-technology/pi-dashboard-shared/server-identity.js")>()),
  isDashboardRunning: vi.fn(async () => ({ running: false, portConflict: false })),
}));
vi.mock("../spawn-process/server-pid.js", async (orig) => ({
  ...(await orig<typeof import("../spawn-process/server-pid.js")>()),
  isServerRunning: vi.fn(async () => null),
  readPid: vi.fn(() => null),
}));

import { cmdRestart } from "../cli.js";
import type { ServerConfig } from "../server.js";

describe("pi-dashboard start → launchDashboardServer call shape (E16)", () => {
  it("passes cliPath, extraArgs, stdio.logFile, healthTimeoutMs, starter, port and no env", async () => {
    const config = { port: 8123, piPort: 9999, dev: false, tunnel: false } as ServerConfig;
    await cmdRestart(config, {
      isDashboardRunning: (async () => ({ running: false })) as never,
      cmdStopImpl: async () => {},
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });

    expect(launchDashboardServer).toHaveBeenCalledTimes(1);
    const arg = (launchDashboardServer.mock.calls[0] as unknown[])[0] as Record<string, unknown> & {
      stdio: { logFile: string };
    };
    expect(arg.cliPath).toMatch(/cli\.ts$/);
    expect(arg.extraArgs).toEqual(["--port", "8123", "--no-tunnel"]);
    expect(arg.stdio.logFile).toMatch(/server\.log$/);
    expect(arg.healthTimeoutMs).toBe(30_000);
    expect(arg.starter).toBe("Standalone");
    expect(arg.port).toBe(8123);
    expect(arg).not.toHaveProperty("env");
  });
});
