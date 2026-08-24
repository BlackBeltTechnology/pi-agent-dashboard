/**
 * Unit tests for `dashboard-paths.ts` helpers.
 *
 * Pins each getter accepts a `{ homedir }` override and falls back to
 * `os.homedir()` when none is provided. Asserts that the live server
 * log path and the legacy installer log path resolve to *distinct*
 * files even though both end in `server.log`.
 *
 * See change: harvest-bootstrap-survivor-fixes (cherry-pick 1).
 */
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getDashboardConfigDir,
  getDashboardServerLogPath,
  getGatewaySocketPath,
  getInstallerLogPath,
  getManagedDir,
  resolveLocalGatewayEndpoint,
  resolvePiSessionsDir,
  SUN_PATH_MAX,
} from "../dashboard-paths.js";

describe("dashboard-paths getters", () => {
  describe("getDashboardConfigDir", () => {
    it("no-arg resolves to ~/.pi/dashboard", () => {
      expect(getDashboardConfigDir()).toBe(path.join(os.homedir(), ".pi", "dashboard"));
    });
    it("honours { homedir } override", () => {
      expect(getDashboardConfigDir({ homedir: "/fake/home" })).toBe(
        path.join("/fake/home", ".pi", "dashboard"),
      );
    });
  });

  describe("getDashboardServerLogPath", () => {
    it("no-arg resolves to ~/.pi/dashboard/server.log", () => {
      expect(getDashboardServerLogPath()).toBe(
        path.join(os.homedir(), ".pi", "dashboard", "server.log"),
      );
    });
    it("honours { homedir } override", () => {
      expect(getDashboardServerLogPath({ homedir: "/fake/home" })).toBe(
        path.join("/fake/home", ".pi", "dashboard", "server.log"),
      );
    });
  });

  describe("getManagedDir (re-export)", () => {
    it("no-arg resolves to ~/.pi-dashboard", () => {
      expect(getManagedDir()).toBe(path.join(os.homedir(), ".pi-dashboard"));
    });
    it("honours { homedir } override", () => {
      expect(getManagedDir({ homedir: "/fake/home" })).toBe(
        path.join("/fake/home", ".pi-dashboard"),
      );
    });
  });

  describe("getInstallerLogPath", () => {
    it("no-arg resolves to ~/.pi-dashboard/server.log", () => {
      expect(getInstallerLogPath()).toBe(
        path.join(os.homedir(), ".pi-dashboard", "server.log"),
      );
    });
    it("honours { homedir } override", () => {
      expect(getInstallerLogPath({ homedir: "/fake/home" })).toBe(
        path.join("/fake/home", ".pi-dashboard", "server.log"),
      );
    });
  });

  describe("resolvePiSessionsDir", () => {
    const HOME = "/home/u";
    const base = { homedir: HOME };

    // Isolate from a real PI_CODING_AGENT_SESSION_DIR / PI_CODING_AGENT_DIR in
    // the test env by always passing both env seams explicitly (empty = unset).
    const resolve = (over: Record<string, string>) =>
      resolvePiSessionsDir({
        ...base,
        sessionDirEnv: "",
        agentDirEnv: "",
        ...over,
      });

    it("all unset → literal ~/.pi/agent/sessions", () => {
      expect(resolve({})).toBe(path.join(HOME, ".pi", "agent", "sessions"));
    });
    it("PI_CODING_AGENT_DIR + /sessions when nothing higher set", () => {
      expect(resolve({ agentDirEnv: "/custom/agent" })).toBe(
        path.join("/custom/agent", "sessions"),
      );
    });
    it("config piSessionsDir wins", () => {
      expect(resolve({ piSessionsDir: "/data/sess" })).toBe("/data/sess");
    });
    it("env SESSION_DIR used when config unset", () => {
      expect(resolve({ sessionDirEnv: "/env/sess" })).toBe("/env/sess");
    });
    it("SESSION_DIR beats AGENT_DIR", () => {
      expect(resolve({ sessionDirEnv: "/env/sess", agentDirEnv: "/custom/agent" })).toBe(
        "/env/sess",
      );
    });
    it("blank config skipped, env used", () => {
      expect(resolve({ piSessionsDir: "  ", sessionDirEnv: "/env/sess" })).toBe("/env/sess");
    });
    it("blank sessionDirEnv falls through to AGENT_DIR", () => {
      expect(resolve({ sessionDirEnv: "  ", agentDirEnv: "/custom/agent" })).toBe(
        path.join("/custom/agent", "sessions"),
      );
    });
    it("blank agentDirEnv ignored, falls to literal default", () => {
      expect(resolve({ agentDirEnv: "  " })).toBe(path.join(HOME, ".pi", "agent", "sessions"));
    });
    it("tilde config expands against homedir", () => {
      expect(resolve({ piSessionsDir: "~/mine" })).toBe(path.join(HOME, "mine"));
    });
    it("tilde sessionDirEnv expands against homedir", () => {
      expect(resolve({ sessionDirEnv: "~/envsess" })).toBe(path.join(HOME, "envsess"));
    });
    it("tilde agentDirEnv expands then appends /sessions", () => {
      expect(resolve({ agentDirEnv: "~/agent" })).toBe(path.join(HOME, "agent", "sessions"));
    });
    it("config beats env", () => {
      expect(resolve({ piSessionsDir: "/data/sess", sessionDirEnv: "/env/sess" })).toBe(
        "/data/sess",
      );
    });
    it("absolute path passes through untouched", () => {
      expect(resolve({ piSessionsDir: "/abs/path" })).toBe("/abs/path");
    });
  });

  // (test-plan #E2) Per-instance socket path — D2.
  describe("getGatewaySocketPath", () => {
    it("two piPorts under one HOME yield distinct paths in the same config dir", () => {
      const env = { homedir: "/fake/home" };
      const a = getGatewaySocketPath(env, 9999);
      const b = getGatewaySocketPath(env, 9594);
      expect(a).not.toBe(b);
      expect(path.dirname(a)).toBe(getDashboardConfigDir(env));
      expect(path.dirname(b)).toBe(getDashboardConfigDir(env));
      expect(path.basename(a)).toBe("gateway-9999.sock");
      expect(path.basename(b)).toBe("gateway-9594.sock");
    });
    it("honours the homedir seam rather than os.homedir()", () => {
      expect(getGatewaySocketPath({ homedir: "/fake/home" }, 1)).toBe(
        path.join("/fake/home", ".pi", "dashboard", "gateway-1.sock"),
      );
    });
  });

  // (test-plan #E1) sun_path boundary — D15. The fallback is loopback+token,
  // NEVER discovery, and the diagnostic names the length limit not EINVAL.
  describe("resolveLocalGatewayEndpoint sun_path boundary", () => {
    /** Build a homedir whose derived socket path is exactly `target` bytes. */
    const homedirForSocketLength = (target: number, piPort: number): string => {
      const suffix = path.join(".pi", "dashboard", `gateway-${piPort}.sock`);
      // path.join(home, suffix) === home + sep + suffix
      const fill = target - (suffix.length + 1);
      return `/${"h".repeat(fill - 1)}`;
    };

    it.each([SUN_PATH_MAX - 1, SUN_PATH_MAX])("length %i returns a unix socket", (len) => {
      const homedir = homedirForSocketLength(len, 9999);
      const res = resolveLocalGatewayEndpoint({ homedir }, 9999);
      expect(Buffer.byteLength(getGatewaySocketPath({ homedir }, 9999))).toBe(len);
      expect(res.transport).toBe("unix");
      if (res.transport !== "unix") throw new Error("unreachable");
      expect(res.path).toBe(getGatewaySocketPath({ homedir }, 9999));
    });

    it("one byte over the limit falls back to loopback with a length diagnostic", () => {
      const len = SUN_PATH_MAX + 1;
      const homedir = homedirForSocketLength(len, 9999);
      const res = resolveLocalGatewayEndpoint({ homedir }, 9999);
      expect(res.transport).toBe("loopback");
      if (res.transport !== "loopback") throw new Error("unreachable");
      expect(res.port).toBe(9999);
      expect(res.reason).toMatch(/sun_path/);
      expect(res.reason).toContain(String(SUN_PATH_MAX));
      expect(res.reason).toContain(String(len));
      expect(res.reason).not.toMatch(/EINVAL/);
    });
  });

  describe("live server log vs installer log are distinct", () => {
    it("the two log paths must never collide for the same homedir", () => {
      const serverLog = getDashboardServerLogPath({ homedir: "/fake/home" });
      const installerLog = getInstallerLogPath({ homedir: "/fake/home" });
      expect(serverLog).not.toBe(installerLog);
      // Different parent dirs even though both basename to server.log
      expect(path.basename(serverLog)).toBe("server.log");
      expect(path.basename(installerLog)).toBe("server.log");
      expect(path.dirname(serverLog)).not.toBe(path.dirname(installerLog));
    });
  });
});
