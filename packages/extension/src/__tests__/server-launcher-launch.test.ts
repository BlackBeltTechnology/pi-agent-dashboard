/**
 * Pins the Bridge → `launchDashboardServer` forwarding contract: the
 * extension's `launchServer` must always pass `starter: "Bridge"`,
 * `stdio: { logFile: getDashboardServerLogPath() }`, and
 * `healthTimeoutMs: 10_000`. The shared launcher is mocked so this test
 * never spawns a real server.
 *
 * See change: unify-server-launch-ts-loader (§3.1.2),
 * fix-bridge-server-start-diagnostics (bridge now owns the server log
 * and uses a 10 s cold-start window).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { launchDashboardServer } from "@blackbelt-technology/pi-dashboard-shared/server-launcher.js";
import { getDashboardServerLogPath } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";

const { launchSpy } = vi.hoisted(() => ({
  launchSpy: vi.fn<typeof launchDashboardServer>(async () => ({ childPid: 1, reportedPid: 1, healthOk: true as const })),
}));

vi.mock("@blackbelt-technology/pi-dashboard-shared/server-launcher.js", () => ({
  launchDashboardServer: launchSpy,
  JitiNotFoundError: class JitiNotFoundError extends Error {},
  PortConflictError: class PortConflictError extends Error {},
  EarlyExitError: class EarlyExitError extends Error { code: number | null = null; },
}));

import { launchServer } from "../server-launcher.js";

const cfg = {
  port: 3000,
  piPort: 4000,
  autoStart: true,
  autoShutdown: true,
  shutdownIdleSeconds: 300,
  spawnStrategy: "tmux" as const,
  tunnel: { enabled: true },
  devBuildOnReload: false,
  memoryLimits: { maxEventsPerSession: 5000, maxStringFieldSize: 0, maxWsBufferBytes: 4194304 },
  editor: { idleTimeoutMinutes: 10, maxInstances: 3 },
  defaultModel: "",
  trustedNetworks: [],
  resolvedTrustedNetworks: [],
  cors: { allowedOrigins: [] },
  electronMode: false,
} as any;

beforeEach(() => {
  launchSpy.mockClear();
  launchSpy.mockResolvedValue({ childPid: 1, reportedPid: 1, healthOk: true } as any);
});

describe("Bridge launchServer → launchDashboardServer forwarding", () => {
  it("passes starter:Bridge + stdio:{logFile} + 10s health timeout + port", async () => {
    const r = await launchServer(cfg);
    expect(r.success).toBe(true);
    expect(launchSpy).toHaveBeenCalledOnce();
    const opts = launchSpy.mock.calls[0]![0]!;
    expect(opts.starter).toBe("Bridge");
    expect(opts.stdio).toEqual({ logFile: getDashboardServerLogPath() });
    expect(opts.healthTimeoutMs).toBe(10000);
    expect(opts.port).toBe(3000);
    expect(opts.extraArgs).toEqual(["--port", "3000", "--pi-port", "4000"]);
  });

  it("maps JitiNotFoundError to a failed LaunchResult (no throw)", async () => {
    const { JitiNotFoundError } = await import("@blackbelt-technology/pi-dashboard-shared/server-launcher.js");
    launchSpy.mockRejectedValueOnce(new JitiNotFoundError("loader missing"));
    const r = await launchServer(cfg);
    expect(r.success).toBe(false);
    expect(r.message).toContain("loader missing");
  });

  it("maps EarlyExitError to a failed LaunchResult mentioning the exit code", async () => {
    const { EarlyExitError } = await import("@blackbelt-technology/pi-dashboard-shared/server-launcher.js");
    const err = new (EarlyExitError as unknown as new (...args: unknown[]) => Error & { code: number })();
    err.code = 17;
    launchSpy.mockRejectedValueOnce(err);
    const r = await launchServer(cfg);
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/code=17/);
  });

  // fix-bridge-server-start-diagnostics: the EarlyExitError copy must point
  // at the path the bridge spawn actually writes (getDashboardServerLogPath),
  // not a hardcoded "~/.pi/dashboard/server.log" string.
  it("EarlyExitError message references getDashboardServerLogPath(), not a hardcoded path", async () => {
    const { EarlyExitError } = await import("@blackbelt-technology/pi-dashboard-shared/server-launcher.js");
    const err = new (EarlyExitError as unknown as new (...args: unknown[]) => Error & { code: number })();
    err.code = 1;
    launchSpy.mockRejectedValueOnce(err);
    const r = await launchServer(cfg);
    expect(r.success).toBe(false);
    expect(r.message).toContain(getDashboardServerLogPath());
    expect(r.message).not.toContain("~/.pi/dashboard/server.log");
  });
});
