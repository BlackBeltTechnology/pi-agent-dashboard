import { describe, it, expect, vi, afterEach } from "vitest";
import { autoStartServer, type AutoStartDeps, type DiscoveredServer } from "../server-auto-start.js";

function makeDeps(overrides: Partial<AutoStartDeps> = {}): AutoStartDeps {
  return {
    discoverDashboard: vi.fn().mockResolvedValue([]),
    isDashboardRunning: vi.fn().mockResolvedValue({ running: false }),
    launchServer: vi.fn().mockResolvedValue({ success: true, message: "Server started" }),
    notify: vi.fn(),
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
    // Spec requirement (fix-windows-server-parity): failure notification
    // MUST include the absolute path to ~/.pi/dashboard/server.log.
    expect(msg).toMatch(/server\.log/);
    expect(level).toBe("warning");
    expect(result.server).toBeUndefined();
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
});
