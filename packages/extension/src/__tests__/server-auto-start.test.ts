import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDashboardServerLogPath } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import {
  autoStartServer,
  selectLocalCandidate,
  type AutoStartDeps,
  type DiscoveredServer,
} from "../server-auto-start.js";

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

/**
 * Per-attempt probe outcomes for `scriptedProbeDeps`. `"timeout"` simulates
 * the fetch AbortError path of the shared `isDashboardRunning`; `"refused"`
 * simulates ECONNREFUSED; `"conflict"` simulates a foreign service answering
 * HTTP (`portConflict: true`). Any other value is returned verbatim.
 */
type ProbeOutcome = "timeout" | "refused" | "conflict" | { running: boolean; portConflict?: boolean };

/**
 * Fake for the WIDENED `isDashboardRunning` seam that reproduces the shared
 * fn's retry contract (server-identity.ts): a timeout attempt sleeps
 * `opts.retryDelayMs` via `opts._sleep` and retries while `opts.retries`
 * remain; a refusal or conflict returns immediately — no sleep, no retry.
 * Scripts are keyed `"host:port"` and consumed attempt-by-attempt (the last
 * entry repeats). Tests that don't need scripts keep the plain mock.
 * See change: fix-autostart-discovery-precedence (D1, F7).
 */
function scriptedProbeDeps(
  script: Record<string, ProbeOutcome[]>,
  overrides: Partial<AutoStartDeps> = {},
): { deps: AutoStartDeps; sleepCalls: number[] } {
  const sleepCalls: number[] = [];
  const isDashboardRunning = vi.fn(
    async (
      port: number,
      host?: string,
      opts?: { retries?: number; retryDelayMs?: number; _sleep?: (ms: number) => Promise<void> },
    ) => {
      const h = host ?? "localhost";
      const outcomes = script[`${h}:${port}`] ?? [];
      const attempts = (opts?.retries ?? 0) + 1;
      let last: ProbeOutcome = outcomes.at(-1) ?? { running: false };
      for (let i = 0; i < attempts; i++) {
        last = outcomes.shift() ?? last;
        if (last === "refused") return { running: false };
        if (last === "conflict") return { running: false, portConflict: true };
        if (last !== "timeout") return last;
        if (i < attempts - 1) {
          const delay = opts?.retryDelayMs ?? 500;
          sleepCalls.push(delay);
          await opts?._sleep?.(delay);
        }
      }
      return { running: false };
    },
  );
  return { deps: makeDeps({ isDashboardRunning, ...overrides }), sleepCalls };
}

describe("autoStartServer", () => {
  it("returns server from mDNS when local server is discovered", async () => {
    const localServer: DiscoveredServer = {
      host: "myhost.local", port: 8000, piPort: 9999,
      isLocal: true, source: "mdns",
    };
    // The resolved-port gate runs FIRST (D1) and is silent; the candidate is
    // then health-verified at its ADVERTISED host (D2) before adoption.
    const deps = makeDeps({
      discoverDashboard: vi.fn().mockResolvedValue([localServer]),
      isDashboardRunning: scriptedProbeDeps({
        "localhost:8000": ["refused"],
        "myhost.local:8000": [{ running: true }],
      }).deps.isDashboardRunning,
    });

    const result = await autoStartServer(baseConfig, deps);

    expect(result.server).toEqual({ host: "myhost.local", port: 8000, piPort: 9999 });
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
      isDashboardRunning: scriptedProbeDeps({
        // Resolved-port gate (pre-launch) AND the post-launch attach probe
        // both stay silent; only the advertised-host verification answers.
        "localhost:8000": ["refused"],
        "myhost.local:8000": [{ running: true }],
      }).deps.isDashboardRunning,
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
      isDashboardRunning: scriptedProbeDeps({
        "localhost:8000": ["refused"],
        "myhost.local:8000": [{ running: true }],
        "remote.local:8000": [{ running: true }],
      }).deps.isDashboardRunning,
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
      const deps = makeDeps({
        discoverDashboard: vi.fn().mockResolvedValue([local]),
        isDashboardRunning: scriptedProbeDeps({
          "localhost:8000": ["refused"],
          "myhost.local:8000": [{ running: true }],
        }).deps.isDashboardRunning,
      });
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
        isDashboardRunning: scriptedProbeDeps({
          "localhost:8000": ["refused"],
          "myhost.local:8000": [{ running: true }],
        }).deps.isDashboardRunning,
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
        // Same host:port as the resolved gate — the script's last entry
        // repeats, so the gate attempt is refused and the candidate's
        // verification attempt answers.
        isDashboardRunning: scriptedProbeDeps({
          "localhost:8000": ["refused", { running: true }],
        }).deps.isDashboardRunning,
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

      expect(deps.isDashboardRunning).toHaveBeenCalledWith(
        18697,
        "localhost",
        expect.objectContaining({ retries: expect.any(Number), timeoutMs: expect.any(Number) }),
      );
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
    // the silent resolved port: warn naming BOTH ports, no launch. The
    // candidate is adopted only after its health verification answers (D2);
    // the resolved-port gate (port 8000) stays silent (D1).
    it("warns naming both ports when discovery answers elsewhere than the silent resolved port (test-plan #X5)", async () => {
      const log = vi.fn();
      const elsewhere: DiscoveredServer = {
        host: "localhost", port: 18697, piPort: 19697, isLocal: true, source: "mdns",
      };
      const deps = makeDeps({
        discoverDashboard: vi.fn().mockResolvedValue([elsewhere]),
        isDashboardRunning: scriptedProbeDeps({
          "localhost:8000": ["refused"],
          "localhost:18697": [{ running: true }],
        }).deps.isDashboardRunning,
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

// ─── fix-autostart-discovery-precedence (folded from test-plan.md) ──────────
// D1: the resolved port's status is established BEFORE discovery can win;
// D2: candidates are health-verified at their advertised host+port;
// D2b: portConflict falls through to discovery; D3: deterministic selection;
// D4: a serving resolved port emits no mismatch record; D-post: the
// post-launch branch never lets a stray displace the just-launched server.

describe("resolved-port gate before discovery (test-plan E1–E3, E6, E7, E11, E12)", () => {
  // 9.1 (E1) — resolved serves → returned without consulting discovery.
  it("resolved port serves → returned, discovery ignored, no notify (test-plan E1)", async () => {
    const { deps } = scriptedProbeDeps({
      "localhost:8000": [{ running: true }],
    });
    const result = await autoStartServer(baseConfig, deps);

    expect(result.server).toEqual({ host: "localhost", port: 8000, piPort: 9999 });
    expect(deps.launchServer).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
    // D1: when the resolved port serves, discovery is never consulted.
    expect(deps.discoverDashboard).not.toHaveBeenCalled();
  });

  // 9.2 (E2) — a serving resolved port never produces a mismatch record.
  it("resolved port serves + stray advertises → no mismatch record, no notify (test-plan E2)", async () => {
    const stray: DiscoveredServer = {
      host: "localhost", port: 8588, piPort: 19697, isLocal: true, source: "mdns",
    };
    const log = vi.fn();
    const { deps } = scriptedProbeDeps(
      { "localhost:8000": [{ running: true }] },
      { discoverDashboard: vi.fn().mockResolvedValue([stray]), log },
    );
    const result = await autoStartServer(baseConfig, deps);

    expect(result.server).toEqual({ host: "localhost", port: 8000, piPort: 9999 });
    expect(deps.notify).not.toHaveBeenCalled();
    const lines = log.mock.calls.map(c => c[0] as string).join("\n");
    expect(lines).not.toMatch(/elsewhere|silent/);
  });

  // 9.3 (E3) — silent resolved port + verified candidate adopted; the ONLY
  // mismatch path warns naming BOTH ports (D4).
  it("silent resolved port + verified candidate adopted; warning names both ports (test-plan E3)", async () => {
    const candidate: DiscoveredServer = {
      host: "localhost", port: 8588, piPort: 19697, isLocal: true, source: "mdns",
    };
    const log = vi.fn();
    const { deps } = scriptedProbeDeps(
      {
        "localhost:8000": ["refused"],
        "localhost:8588": [{ running: true }],
      },
      { discoverDashboard: vi.fn().mockResolvedValue([candidate]), log },
    );
    const result = await autoStartServer(baseConfig, deps);

    expect(result.server).toEqual({ host: "localhost", port: 8588, piPort: 19697 });
    expect(deps.launchServer).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledTimes(1);
    const [msg, level] = (deps.notify as any).mock.calls[0];
    expect(msg).toContain("8000");
    expect(msg).toContain("8588");
    expect(level).toBe("warning");
    const lines = log.mock.calls.map(c => c[0] as string).join("\n");
    expect(lines).toContain("8588");
    expect(lines).toContain("8000");
  });

  // 9.6 (E6) — portConflict does NOT short-circuit; discovery still runs (D2b).
  it("portConflict on resolved port falls through to a verified candidate (test-plan E6)", async () => {
    const candidate: DiscoveredServer = {
      host: "localhost", port: 8588, piPort: 19697, isLocal: true, source: "mdns",
    };
    const log = vi.fn();
    const { deps } = scriptedProbeDeps(
      {
        "localhost:8000": ["conflict"],
        "localhost:8588": [{ running: true }],
      },
      { discoverDashboard: vi.fn().mockResolvedValue([candidate]), log },
    );
    const result = await autoStartServer(baseConfig, deps);

    expect(result.server).toEqual({ host: "localhost", port: 8588, piPort: 19697 });
    // The port-occupied REFUSAL never fires (its exact wording); the adopted
    // candidate's own log may legitimately describe the foreign service.
    const lines = log.mock.calls.map(c => c[0] as string).join("\n");
    expect(lines).not.toMatch(/occupied by another service/);
    expect(deps.notify).not.toHaveBeenCalledWith(
      "Port 8000 is occupied by another service",
      "warning",
    );
  });

  // 9.7 (E7) — portConflict + no verified candidate → the existing refusal.
  it("portConflict + no candidate → port-occupied refusal (test-plan E7)", async () => {
    const log = vi.fn();
    const { deps } = scriptedProbeDeps(
      { "localhost:8000": ["conflict"] },
      { log },
    );
    const result = await autoStartServer(baseConfig, deps);

    expect(result.server).toBeUndefined();
    expect(deps.launchServer).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledWith("Port 8000 is occupied by another service", "warning");
    const lines = log.mock.calls.map(c => c[0] as string).join("\n");
    expect(lines).toMatch(/occupied/);
  });

  // 9.11 (E11) — the resolved-port gate uses bootstrap-aware opts: a timeout
  // (AbortError — server mid-jiti-bootstrap) retries; attempt 2 serves.
  it("bootstrap-aware probe retries on timeout and keeps the resolved port (test-plan E11)", async () => {
    const probeSleep = vi.fn().mockResolvedValue(undefined);
    const { deps } = scriptedProbeDeps(
      { "localhost:8000": ["timeout", { running: true }] },
      { probeSleep },
    );
    const result = await autoStartServer(baseConfig, deps);

    expect(result.server).toEqual({ host: "localhost", port: 8000, piPort: 9999 });
    expect(deps.launchServer).not.toHaveBeenCalled();
    // The gate must carry bootstrap-aware settings: non-default timeout and
    // at least one retry (spec: bridge-auto-start-lifecycle).
    expect(deps.isDashboardRunning).toHaveBeenCalledWith(
      8000,
      "localhost",
      expect.objectContaining({ retries: expect.any(Number), timeoutMs: expect.any(Number) }),
    );
    const [, , opts] = (deps.isDashboardRunning as any).mock.calls[0];
    expect(opts.retries).toBeGreaterThanOrEqual(1);
    expect(opts.timeoutMs).toBeGreaterThan(2000);
    // The retry slept through the injected _sleep seam.
    expect(probeSleep).toHaveBeenCalled();
  });

  // 9.12 (E12) — ECONNREFUSED is definitive: no retry delays, straight to launch.
  it("cold start (ECONNREFUSED) pays no retry sleeps and reaches launch (test-plan E12)", async () => {
    const probeSleep = vi.fn().mockResolvedValue(undefined);
    const { deps } = scriptedProbeDeps(
      { "localhost:8000": ["refused"] },
      { probeSleep },
    );
    const result = await autoStartServer(baseConfig, deps);

    expect(deps.launchServer).toHaveBeenCalledTimes(1);
    expect(result.server).toEqual({ host: "localhost", port: 8000, piPort: 9999 });
    expect(probeSleep).not.toHaveBeenCalled();
  });
});

describe("selectLocalCandidate — deterministic selection (D3, test-plan E8–E10)", () => {
  const local = (host: string, port: number): DiscoveredServer => ({
    host, port, piPort: port + 1000, isLocal: true, source: "mdns",
  });

  // 9.8 (E8) — a candidate matching the resolved port wins.
  it("resolved-port match wins (test-plan E8)", () => {
    const picked = selectLocalCandidate([local("a.local", 8588), local("b.local", 8000)], 8000);
    expect(picked?.port).toBe(8000);
  });

  // 9.9 (E9) — otherwise lowest port, order-independent.
  it("lowest port, order-independent (test-plan E9)", () => {
    const a = [local("a.local", 8611), local("b.local", 8588)];
    const b = [local("b.local", 8588), local("a.local", 8611)];
    expect(selectLocalCandidate(a, 8000)?.port).toBe(8588);
    expect(selectLocalCandidate(b, 8000)?.port).toBe(8588);
  });

  // 9.10 (E10) — port tie broken by host string, order-independent.
  it("same-port tiebreak by host string, order-independent (test-plan E10)", () => {
    const a = [local("hostB", 8588), local("hostA", 8588)];
    const b = [local("hostA", 8588), local("hostB", 8588)];
    expect(selectLocalCandidate(a, 8000)?.host).toBe("hostA");
    expect(selectLocalCandidate(b, 8000)?.host).toBe("hostA");
  });

  it("ignores non-local candidates", () => {
    const remote: DiscoveredServer = { host: "r.local", port: 80, piPort: 1, isLocal: false, source: "mdns" };
    expect(selectLocalCandidate([remote], 8000)).toBeUndefined();
  });
});

describe("post-launch attach prefers the just-launched server (D-post, test-plan X1–X2)", () => {
  // 9.13 (X1) — our own server answers post-launch; a stray advertiser must
  // never displace it.
  it("stray advertiser does not displace the just-launched resolved port (test-plan X1)", async () => {
    const stray: DiscoveredServer = {
      host: "localhost", port: 8588, piPort: 19697, isLocal: true, source: "mdns",
    };
    const probeSleep = vi.fn().mockResolvedValue(undefined);
    const { deps } = scriptedProbeDeps(
      {
        // Pre-launch gate silent (so we launch); post-launch probe answers.
        "localhost:8000": ["refused", { running: true }],
      },
      {
        discoverDashboard: vi.fn().mockResolvedValue([stray]),
        probeSleep,
      },
    );
    const result = await autoStartServer(baseConfig, deps);

    expect(deps.launchServer).toHaveBeenCalledTimes(1);
    expect(result.server).toEqual({ host: "localhost", port: 8000, piPort: 9999 });
    const warnings = (deps.notify as any).mock.calls.filter((c: unknown[]) => c[1] === "warning");
    expect(warnings).toHaveLength(0);
  });

  // 9.14 (X2) — a transient post-launch miss retries; NO "resolved port
  // silent" warning is ever raised on this path (D4/D-post).
  it("transient post-launch miss retries silently, then returns the resolved port (test-plan X2)", async () => {
    const probeSleep = vi.fn().mockResolvedValue(undefined);
    const { deps } = scriptedProbeDeps(
      {
        "localhost:8000": ["refused", "timeout", { running: true }],
      },
      { probeSleep },
    );
    const result = await autoStartServer(baseConfig, deps);

    expect(deps.launchServer).toHaveBeenCalledTimes(1);
    expect(result.server).toEqual({ host: "localhost", port: 8000, piPort: 9999 });
    expect(probeSleep).toHaveBeenCalled(); // the retry happened
    expect(deps.notify).toHaveBeenCalledTimes(1); // only the 🌐 info
    const [msg, level] = (deps.notify as any).mock.calls[0] as [string, string];
    expect(level).toBe("info");
    expect(msg).not.toMatch(/silent/i);
  });
});
