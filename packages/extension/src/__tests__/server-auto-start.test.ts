import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDashboardServerLogPath } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import { autoStartServer, type AutoStartDeps, type DiscoveredServer } from "../server-auto-start.js";

/**
 * Every spawn-path test takes the single-flight auto-start lock. Point it at a
 * per-file temp dir: the production default is `~/.pi/dashboard`, which is
 * SHARED across parallel vitest workers, so two workers in the spawn path
 * contend for one real lockfile and the loser waits out the readiness budget
 * (30s) — it stalled CI for over an hour. Also shorten the loser's poll.
 * See change: fix-worktree-server-autostart-leak.
 */
const LOCK_DIR = mkdtempSync(join(tmpdir(), "auto-start-lock-"));

function makeDeps(overrides: Partial<AutoStartDeps> = {}): AutoStartDeps {
  return {
    discoverDashboard: vi.fn().mockResolvedValue([]),
    isDashboardRunning: vi.fn().mockResolvedValue({ running: false }),
    launchServer: vi.fn().mockResolvedValue({ success: true, message: "Server started" }),
    notify: vi.fn(),
    resolveCliPath: () => join(tmpdir(), "host-install", "packages", "server", "src", "cli.ts"),
    lockDir: LOCK_DIR,
    lossPollIntervalMs: 5,
    ...overrides,
  };
}

const baseConfig = { piPort: 9999, port: 8000, autoStart: true };

describe("autoStartServer", () => {
  it("returns server from mDNS when local server is discovered", async () => {
    const localServer: DiscoveredServer = {
      host: "myhost.local", port: 8000, piPort: 9999,
      isLocal: true, source: "mdns",
    };
    const deps = makeDeps({
      discoverDashboard: vi.fn().mockResolvedValue([localServer]),
    });

    const result = await autoStartServer(baseConfig, deps);

    expect(result.server).toEqual({ host: "myhost.local", port: 8000, piPort: 9999 });
    expect(deps.isDashboardRunning).not.toHaveBeenCalled();
    expect(deps.launchServer).not.toHaveBeenCalled();
  });

  it("falls back to health check when mDNS finds no local server", async () => {
    const deps = makeDeps({
      discoverDashboard: vi.fn().mockResolvedValue([]),
      isDashboardRunning: vi.fn().mockResolvedValue({ running: true }),
    });

    const result = await autoStartServer(baseConfig, deps);

    expect(result.server).toEqual({ host: "localhost", port: 8000, piPort: 9999 });
    expect(deps.launchServer).not.toHaveBeenCalled();
  });

  it("falls back to health check when mDNS throws", async () => {
    const deps = makeDeps({
      discoverDashboard: vi.fn().mockRejectedValue(new Error("mDNS failed")),
      isDashboardRunning: vi.fn().mockResolvedValue({ running: true }),
    });

    const result = await autoStartServer(baseConfig, deps);

    expect(result.server).toEqual({ host: "localhost", port: 8000, piPort: 9999 });
  });

  it("auto-starts server and returns config defaults when mDNS fails after launch", async () => {
    const deps = makeDeps({
      discoverDashboard: vi.fn().mockResolvedValue([]),
      isDashboardRunning: vi.fn().mockResolvedValue({ running: false }),
      launchServer: vi.fn().mockResolvedValue({ success: true, message: "ok" }),
    });

    const result = await autoStartServer(baseConfig, deps);

    expect(deps.launchServer).toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledWith(
      "🌐 Dashboard started at http://localhost:8000",
      "info",
    );
    expect(result.server).toEqual({ host: "localhost", port: 8000, piPort: 9999 });
  });

  it("uses mDNS-discovered piPort after auto-start", async () => {
    const localServer: DiscoveredServer = {
      host: "myhost.local", port: 8000, piPort: 9998,
      isLocal: true, source: "mdns",
    };
    const deps = makeDeps({
      discoverDashboard: vi.fn()
        .mockResolvedValueOnce([])      // First call: nothing found
        .mockResolvedValueOnce([localServer]), // After launch: found
      isDashboardRunning: vi.fn().mockResolvedValue({ running: false }),
      launchServer: vi.fn().mockResolvedValue({ success: true, message: "ok" }),
    });

    const result = await autoStartServer(baseConfig, deps);

    expect(result.server).toEqual({ host: "myhost.local", port: 8000, piPort: 9998 });
  });

  it("suppresses warning when launch fails but health check succeeds on recheck", async () => {
    const deps = makeDeps({
      discoverDashboard: vi.fn().mockResolvedValue([]),
      isDashboardRunning: vi.fn()
        .mockResolvedValueOnce({ running: false })  // initial check
        .mockResolvedValueOnce({ running: true }),   // recheck after failure
      launchServer: vi.fn().mockResolvedValue({ success: false, message: "exited" }),
    });

    const result = await autoStartServer(baseConfig, deps);

    expect(deps.notify).not.toHaveBeenCalled();
    expect(result.server).toEqual({ host: "localhost", port: 8000, piPort: 9999 });
  });

  it("shows warning when launch fails and recheck also fails", async () => {
    const deps = makeDeps({
      discoverDashboard: vi.fn().mockResolvedValue([]),
      isDashboardRunning: vi.fn().mockResolvedValue({ running: false }),
      launchServer: vi.fn().mockResolvedValue({ success: false, message: "exited" }),
    });

    const result = await autoStartServer(baseConfig, deps);

    expect(deps.notify).toHaveBeenCalledTimes(1);
    const [msg, level] = (deps.notify as any).mock.calls[0];
    expect(msg).toMatch(/Dashboard server failed to start: exited/);
    // Spec requirement (fix-windows-server-parity + fix-bridge-server-start-
    // diagnostics): failure notification MUST include the absolute path
    // returned by getDashboardServerLogPath() — the same file the bridge
    // auto-spawn now writes — not a hardcoded string.
    expect(msg).toContain(getDashboardServerLogPath());
    expect(level).toBe("warning");
    expect(result.server).toBeUndefined();
  });

  // fix-bridge-server-start-diagnostics (CodeRabbit #3): the "See log:" suffix
  // must only appear when the spawn actually owned/opened the log file. A
  // JitiNotFoundError is thrown BEFORE launchDashboardServer opens the logFile
  // fd, so no server.log exists — pointing the user at it resurfaces issue #99.
  // launchServer signals this via logOwned:false.
  it("omits the 'See log' suffix when the failure never owned a log (logOwned:false)", async () => {
    const deps = makeDeps({
      discoverDashboard: vi.fn().mockResolvedValue([]),
      isDashboardRunning: vi.fn().mockResolvedValue({ running: false }),
      launchServer: vi.fn().mockResolvedValue({ success: false, message: "loader missing", logOwned: false }),
    });

    await autoStartServer(baseConfig, deps);

    expect(deps.notify).toHaveBeenCalledTimes(1);
    const [msg, level] = (deps.notify as any).mock.calls[0];
    expect(msg).toMatch(/Dashboard server failed to start: loader missing/);
    expect(msg).not.toMatch(/See log/);
    expect(msg).not.toContain(getDashboardServerLogPath());
    expect(level).toBe("warning");
  });

  it("does nothing when autoStart is disabled and no server found", async () => {
    const deps = makeDeps({
      discoverDashboard: vi.fn().mockResolvedValue([]),
      isDashboardRunning: vi.fn().mockResolvedValue({ running: false }),
    });

    const result = await autoStartServer({ ...baseConfig, autoStart: false }, deps);

    expect(deps.launchServer).not.toHaveBeenCalled();
    expect(result.server).toBeUndefined();
  });

  it("shows port conflict warning when port is occupied by another service", async () => {
    const deps = makeDeps({
      discoverDashboard: vi.fn().mockResolvedValue([]),
      isDashboardRunning: vi.fn().mockResolvedValue({ running: false, portConflict: true }),
    });

    const result = await autoStartServer(baseConfig, deps);

    expect(deps.launchServer).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledWith(
      "Port 8000 is occupied by another service",
      "warning",
    );
    expect(result.server).toBeUndefined();
  });

  it("prefers local server over remote when both discovered via mDNS", async () => {
    const remote: DiscoveredServer = {
      host: "remote.local", port: 8000, piPort: 9999,
      isLocal: false, source: "mdns",
    };
    const local: DiscoveredServer = {
      host: "myhost.local", port: 8000, piPort: 9999,
      isLocal: true, source: "mdns",
    };
    const deps = makeDeps({
      discoverDashboard: vi.fn().mockResolvedValue([remote, local]),
    });

    const result = await autoStartServer(baseConfig, deps);

    expect(result.server).toEqual({ host: "myhost.local", port: 8000, piPort: 9999 });
  });

  // Change: resolve-global-prompt-templates-from-dashboard — bridge-side
  // PI_DASHBOARD_NO_MDNS opt-out (mirrors the server's gate). Required for
  // isolated runs: otherwise the bridge discovers a co-located real dashboard
  // via mDNS and hijacks its connection off the explicit PI_DASHBOARD_URL.
  describe("PI_DASHBOARD_NO_MDNS opt-out", () => {
    afterEach(() => {
      delete process.env.PI_DASHBOARD_NO_MDNS;
    });

    it("skips mDNS discovery and uses health-check fallback when NO_MDNS=1", async () => {
      process.env.PI_DASHBOARD_NO_MDNS = "1";
      // A local server IS discoverable via mDNS, but the gate must ignore it.
      const otherServer: DiscoveredServer = {
        host: "realhost.local", port: 8000, piPort: 9999,
        isLocal: true, source: "mdns",
      };
      const deps = makeDeps({
        discoverDashboard: vi.fn().mockResolvedValue([otherServer]),
        isDashboardRunning: vi.fn().mockResolvedValue({ running: true }),
      });

      const result = await autoStartServer({ piPort: 9123, port: 8123, autoStart: true }, deps);

      // mDNS never consulted; connection stays on the configured iso port.
      expect(deps.discoverDashboard).not.toHaveBeenCalled();
      expect(result.server).toEqual({ host: "localhost", port: 8123, piPort: 9123 });
    });

    it("with NO_MDNS, after auto-start returns config ports without re-discovering", async () => {
      process.env.PI_DASHBOARD_NO_MDNS = "true";
      const deps = makeDeps({
        discoverDashboard: vi.fn().mockResolvedValue([]),
        isDashboardRunning: vi.fn().mockResolvedValue({ running: false }),
        launchServer: vi.fn().mockResolvedValue({ success: true, message: "ok" }),
      });

      const result = await autoStartServer({ piPort: 9123, port: 8123, autoStart: true }, deps);

      expect(deps.launchServer).toHaveBeenCalled();
      expect(deps.discoverDashboard).not.toHaveBeenCalled();
      expect(result.server).toEqual({ host: "localhost", port: 8123, piPort: 9123 });
    });

    it("skips mDNS when NO_MDNS=yes (server-compatible truthy value)", async () => {
      process.env.PI_DASHBOARD_NO_MDNS = "yes";
      const deps = makeDeps({
        discoverDashboard: vi.fn().mockResolvedValue([]),
        isDashboardRunning: vi.fn().mockResolvedValue({ running: true }),
      });
      const result = await autoStartServer({ piPort: 9123, port: 8123, autoStart: true }, deps);
      expect(deps.discoverDashboard).not.toHaveBeenCalled();
      expect(result.server).toEqual({ host: "localhost", port: 8123, piPort: 9123 });
    });

    it("normalizes NO_MDNS values via trim + lowercase (' TRUE ')", async () => {
      process.env.PI_DASHBOARD_NO_MDNS = " TRUE ";
      const deps = makeDeps({
        discoverDashboard: vi.fn().mockResolvedValue([]),
        isDashboardRunning: vi.fn().mockResolvedValue({ running: true }),
      });
      await autoStartServer({ piPort: 9123, port: 8123, autoStart: true }, deps);
      expect(deps.discoverDashboard).not.toHaveBeenCalled();
    });

    it("treats an unrelated NO_MDNS value as NOT disabled (mDNS still runs)", async () => {
      process.env.PI_DASHBOARD_NO_MDNS = "0";
      const local: DiscoveredServer = {
        host: "myhost.local", port: 8000, piPort: 9999,
        isLocal: true, source: "mdns",
      };
      const deps = makeDeps({ discoverDashboard: vi.fn().mockResolvedValue([local]) });
      const result = await autoStartServer(baseConfig, deps);
      expect(deps.discoverDashboard).toHaveBeenCalled();
      expect(result.server).toEqual({ host: "myhost.local", port: 8000, piPort: 9999 });
    });

    it("still uses mDNS when NO_MDNS is unset (default behavior preserved)", async () => {
      const local: DiscoveredServer = {
        host: "myhost.local", port: 8000, piPort: 9999,
        isLocal: true, source: "mdns",
      };
      const deps = makeDeps({
        discoverDashboard: vi.fn().mockResolvedValue([local]),
      });

      const result = await autoStartServer(baseConfig, deps);

      expect(deps.discoverDashboard).toHaveBeenCalled();
      expect(result.server).toEqual({ host: "myhost.local", port: 8000, piPort: 9999 });
    });
  });

  describe("onLaunchStart / onLaunchEnd callbacks", () => {
    it("fires onLaunchStart then onLaunchEnd(true) when launch succeeds", async () => {
      const onLaunchStart = vi.fn();
      const onLaunchEnd = vi.fn();
      const deps = makeDeps({
        launchServer: vi.fn().mockResolvedValue({ success: true, message: "ok" }),
        onLaunchStart,
        onLaunchEnd,
      });

      await autoStartServer(baseConfig, deps);

      expect(onLaunchStart).toHaveBeenCalledTimes(1);
      expect(onLaunchEnd).toHaveBeenCalledTimes(1);
      expect(onLaunchEnd).toHaveBeenCalledWith(true);
    });

    it("fires onLaunchStart then onLaunchEnd(false) when launch fails", async () => {
      const onLaunchStart = vi.fn();
      const onLaunchEnd = vi.fn();
      const deps = makeDeps({
        launchServer: vi.fn().mockResolvedValue({ success: false, message: "boom" }),
        isDashboardRunning: vi.fn().mockResolvedValue({ running: false }),
        onLaunchStart,
        onLaunchEnd,
      });

      await autoStartServer(baseConfig, deps);

      expect(onLaunchStart).toHaveBeenCalledTimes(1);
      expect(onLaunchEnd).toHaveBeenCalledTimes(1);
      expect(onLaunchEnd).toHaveBeenCalledWith(false);
    });

    it("fires onLaunchEnd(true) when launch fails but recheck finds running server", async () => {
      // Race scenario: another agent started the server during our launch attempt.
      const onLaunchStart = vi.fn();
      const onLaunchEnd = vi.fn();
      const deps = makeDeps({
        launchServer: vi.fn().mockResolvedValue({ success: false, message: "EADDRINUSE" }),
        isDashboardRunning: vi.fn()
          .mockResolvedValueOnce({ running: false })   // before launch
          .mockResolvedValueOnce({ running: true }),   // after launch (recheck)
        onLaunchStart,
        onLaunchEnd,
      });

      await autoStartServer(baseConfig, deps);

      expect(onLaunchStart).toHaveBeenCalledTimes(1);
      expect(onLaunchEnd).toHaveBeenCalledWith(true);
    });

    it("does NOT fire onLaunchStart when mDNS finds a local server (no launch happens)", async () => {
      const onLaunchStart = vi.fn();
      const onLaunchEnd = vi.fn();
      const local: DiscoveredServer = {
        host: "localhost", port: 8000, piPort: 9999,
        isLocal: true, source: "mdns",
      };
      const deps = makeDeps({
        discoverDashboard: vi.fn().mockResolvedValue([local]),
        onLaunchStart,
        onLaunchEnd,
      });

      await autoStartServer(baseConfig, deps);

      expect(onLaunchStart).not.toHaveBeenCalled();
      expect(onLaunchEnd).not.toHaveBeenCalled();
    });

    it("does NOT fire onLaunchStart when health check finds an already-running server", async () => {
      const onLaunchStart = vi.fn();
      const onLaunchEnd = vi.fn();
      const deps = makeDeps({
        isDashboardRunning: vi.fn().mockResolvedValue({ running: true }),
        onLaunchStart,
        onLaunchEnd,
      });

      await autoStartServer(baseConfig, deps);

      expect(onLaunchStart).not.toHaveBeenCalled();
      expect(onLaunchEnd).not.toHaveBeenCalled();
    });
  });

  // fix-bridge-autostart-port-resolution — pinned-endpoint gate (design D3/D4)
  // + loud, greppable non-launch paths (design D6). A session whose env pins
  // its dashboard endpoint (the server injects PI_DASHBOARD_URL /
  // PI_DASHBOARD_SOCKET; process-manager.ts) must never spawn a competing
  // dashboard — and every skip must leave a durable appendAutoStartLog line.
  describe("pinned-endpoint gate + loud skips (fix-bridge-autostart-port-resolution)", () => {
    afterEach(() => {
      delete process.env.PI_DASHBOARD_URL;
      delete process.env.PI_DASHBOARD_SOCKET;
    });

    // test-plan #E1 (task 2.2). The env→port MAPPING is proven by the
    // resolveDashboardPorts units (shared config.test.ts); the wiring that
    // hands the resolved ports in is proven end-to-end by the harness
    // (tasks 1.4 / 4.7). This unit pins the behavioural half: at the
    // resolved ports, an answering dashboard attaches and launchServer is
    // NEVER called.
    it("attaches at the resolved non-default ports and NEVER launches (test-plan #E1)", async () => {
      const deps = makeDeps({
        isDashboardRunning: vi.fn().mockResolvedValue({ running: true }),
      });

      const result = await autoStartServer({ piPort: 19697, port: 18697, autoStart: true }, deps);

      expect(deps.isDashboardRunning).toHaveBeenCalledWith(18697);
      expect(deps.launchServer).not.toHaveBeenCalled();
      expect(result.server).toEqual({ host: "localhost", port: 18697, piPort: 19697 });
    });

    // test-plan #X1 (task 2.3) — both decision-table cells.
    it.each([
      ["PI_DASHBOARD_URL", "ws://localhost:19697"],
      ["PI_DASHBOARD_SOCKET", "/tmp/dashboard.sock"],
    ])("a session pinned via %s skips the launch step while discovery/health still run (test-plan #X1)", async (varName, value) => {
      process.env[varName] = value;
      const deps = makeDeps({
        discoverDashboard: vi.fn().mockResolvedValue([]),
        isDashboardRunning: vi.fn().mockResolvedValue({ running: false }),
      });

      const result = await autoStartServer(baseConfig, deps);

      expect(deps.discoverDashboard).toHaveBeenCalled();
      expect(deps.isDashboardRunning).toHaveBeenCalled();
      expect(deps.launchServer).not.toHaveBeenCalled();
      expect(result.server).toBeUndefined();
    });

    // test-plan #X2 (task 2.6) — documented dead-parent trade-off (D4): the
    // pinned parent is not answering, we still do NOT relaunch, and the
    // durable log names the pinned endpoint.
    it("pinned session with a dead parent: no launch + durable log naming the pinned endpoint (test-plan #X2)", async () => {
      process.env.PI_DASHBOARD_URL = "ws://localhost:19697";
      const log = vi.fn();
      const deps = makeDeps({
        isDashboardRunning: vi.fn().mockResolvedValue({ running: false }),
        log,
      });

      const result = await autoStartServer(baseConfig, deps);

      expect(deps.launchServer).not.toHaveBeenCalled();
      expect(result.server).toBeUndefined();
      expect(log).toHaveBeenCalledTimes(1);
      const [line] = log.mock.calls[0] as [string];
      expect(line).toMatch(/skip/i);
      expect(line).toContain("ws://localhost:19697");
      expect(line).toContain("8000");
    });

    // test-plan #X3 (task 2.7) — attach-without-launch becomes visible.
    it("attaching via health check logs the port and that no launch happened (test-plan #X3)", async () => {
      const log = vi.fn();
      const deps = makeDeps({
        isDashboardRunning: vi.fn().mockResolvedValue({ running: true }),
        log,
      });

      const result = await autoStartServer(baseConfig, deps);

      expect(result.server).toEqual({ host: "localhost", port: 8000, piPort: 9999 });
      expect(deps.launchServer).not.toHaveBeenCalled();
      const line = log.mock.calls.map(c => c[0] as string).join("\n");
      expect(line).toMatch(/attach/i);
      expect(line).toContain("8000");
      expect(line).toMatch(/no launch/i);
    });

    // test-plan #X4 (task 2.8) — port conflict keeps its toast AND gains a
    // durable log line.
    it("port conflict emits the notify warning AND a durable log line naming the port (test-plan #X4)", async () => {
      const log = vi.fn();
      const deps = makeDeps({
        isDashboardRunning: vi.fn().mockResolvedValue({ running: false, portConflict: true }),
        log,
      });

      const result = await autoStartServer(baseConfig, deps);

      expect(deps.notify).toHaveBeenCalledWith("Port 8000 is occupied by another service", "warning");
      expect(deps.launchServer).not.toHaveBeenCalled();
      const line = log.mock.calls.map(c => c[0] as string).join("\n");
      expect(line).toMatch(/occupied/i);
      expect(line).toContain("8000");
      expect(result.server).toBeUndefined();
    });

    // test-plan #X5 (task 2.4) — discovery finds a dashboard elsewhere than
    // the silent resolved port: warn naming BOTH ports, no launch.
    it("warns naming both ports when discovery answers elsewhere than the silent resolved port (test-plan #X5)", async () => {
      const log = vi.fn();
      const elsewhere: DiscoveredServer = {
        host: "localhost", port: 18697, piPort: 19697, isLocal: true, source: "mdns",
      };
      const deps = makeDeps({
        discoverDashboard: vi.fn().mockResolvedValue([elsewhere]),
        isDashboardRunning: vi.fn().mockResolvedValue({ running: false }),
        log,
      });

      const result = await autoStartServer(baseConfig, deps);

      expect(deps.launchServer).not.toHaveBeenCalled();
      expect(result.server).toEqual({ host: "localhost", port: 18697, piPort: 19697 });
      expect(deps.notify).toHaveBeenCalledTimes(1);
      const [msg, level] = (deps.notify as any).mock.calls[0];
      expect(msg).toContain("8000");
      expect(msg).toContain("18697");
      expect(level).toBe("warning");
      const line = log.mock.calls.map(c => c[0] as string).join("\n");
      expect(line).toContain("18697");
    });
  });
});
