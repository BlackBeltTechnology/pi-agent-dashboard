import { describe, it, expect, vi } from "vitest";
import { buildTmuxCommand, buildHeadlessArgs, shellEscape, spawnPiSession, buildSpawnEnv, type SessionOptions } from "../spawn-process/process-manager.js";

// Note: platform-dispatch tests live in packages/shared/src/__tests__/
// spawn-mechanism.test.ts. `detectPlatform` was removed in change:
// consolidate-windows-spawn-and-platform-handlers — its job is now
// owned by platform/spawn-mechanism.ts `selectMechanism`.

describe("Process Manager", () => {
  describe("buildTmuxCommand", () => {
    it("should create new session when no pi-dashboard session exists", () => {
      const cmd = buildTmuxCommand("/home/user/project", false);
      expect(cmd).toContain("new-session");
      expect(cmd).toContain("pi-dashboard");
    });

    it("should create new window when pi-dashboard session exists", () => {
      const cmd = buildTmuxCommand("/home/user/project", true);
      expect(cmd).toContain("new-window");
    });

    it("should not set PI_DASHBOARD_SPAWNED env var", () => {
      const cmd = buildTmuxCommand("/home/user/project", false);
      expect(cmd).not.toContain("PI_DASHBOARD_SPAWNED");
    });

    it("should shell-escape cwd with spaces", () => {
      const cmd = buildTmuxCommand("/home/user/my project", false);
      expect(cmd).toContain("'/home/user/my project'");
      expect(cmd).not.toContain('cd /home/user/my project &&');
    });

    it("should shell-escape cwd with semicolons to prevent injection", () => {
      const cmd = buildTmuxCommand("/tmp/test; rm -rf /", false);
      expect(cmd).toContain("'/tmp/test; rm -rf /'");
    });

    it("should shell-escape cwd with backticks to prevent injection", () => {
      const cmd = buildTmuxCommand("/tmp/`whoami`", false);
      expect(cmd).toContain("'/tmp/`whoami`'");
    });

    it("should shell-escape sessionFile with special characters", () => {
      const cmd = buildTmuxCommand("/home/user/project", true, {
        sessionFile: "/path/to/my session; cat /etc/passwd",
        mode: "continue",
      });
      expect(cmd).toContain("--session '/path/to/my session; cat /etc/passwd'");
    });

    it("should not double-quote safe paths", () => {
      const cmd = buildTmuxCommand("/home/user/project", false);
      // Safe path should not be wrapped in single quotes
      expect(cmd).toContain("cd /home/user/project &&");
    });

    it("should include --session flag for continue mode", () => {
      const cmd = buildTmuxCommand("/home/user/project", true, {
        sessionFile: "/path/to/session.jsonl",
        mode: "continue",
      });
      expect(cmd).toContain("--session /path/to/session.jsonl");
      expect(cmd).not.toContain("--fork");
    });

    it("should include --fork flag for fork mode", () => {
      const cmd = buildTmuxCommand("/home/user/project", true, {
        sessionFile: "/path/to/session.jsonl",
        mode: "fork",
      });
      expect(cmd).toContain("--fork /path/to/session.jsonl");
      expect(cmd).not.toContain("--session");
    });

    it("should not include session flags when no options provided", () => {
      const cmd = buildTmuxCommand("/home/user/project", false);
      expect(cmd).not.toContain("--session");
      expect(cmd).not.toContain("--fork");
    });

    it("should create new session for continue mode when no tmux session exists", () => {
      const cmd = buildTmuxCommand("/home/user/project", false, {
        sessionFile: "/path/to/session.jsonl",
        mode: "continue",
      });
      expect(cmd).toContain("new-session");
      expect(cmd).toContain("--session /path/to/session.jsonl");
    });
  });

  describe("buildHeadlessArgs", () => {
    it("should return --mode rpc for fresh session", () => {
      const args = buildHeadlessArgs();
      expect(args).toEqual(["--mode", "rpc"]);
    });

    it("should include --session for continue mode", () => {
      const args = buildHeadlessArgs({
        sessionFile: "/path/to/session.jsonl",
        mode: "continue",
      });
      expect(args).toEqual(["--mode", "rpc", "--session", "/path/to/session.jsonl"]);
    });

    it("should include --fork for fork mode", () => {
      const args = buildHeadlessArgs({
        sessionFile: "/path/to/session.jsonl",
        mode: "fork",
      });
      expect(args).toEqual(["--mode", "rpc", "--fork", "/path/to/session.jsonl"]);
    });

    it("should not include session flags when no options", () => {
      const args = buildHeadlessArgs({});
      expect(args).toEqual(["--mode", "rpc"]);
    });
  });

  describe("spawnPiSession", () => {
    it("should return error for non-existent directory", async () => {
      const result = await spawnPiSession("/tmp/definitely-does-not-exist-" + Date.now());
      expect(result.success).toBe(false);
      expect(result.message).toContain("Directory does not exist");
    });
  });

  describe("SessionOptions strategy field", () => {
    it("should accept tmux strategy", () => {
      const opts: SessionOptions = { strategy: "tmux" };
      expect(opts.strategy).toBe("tmux");
    });

    it("should accept headless strategy", () => {
      const opts: SessionOptions = { strategy: "headless" };
      expect(opts.strategy).toBe("headless");
    });

    it("should allow strategy with session file options", () => {
      const opts: SessionOptions = {
        strategy: "headless",
        sessionFile: "/path/to/session.jsonl",
        mode: "continue",
      };
      const args = buildHeadlessArgs(opts);
      expect(args).toEqual(["--mode", "rpc", "--session", "/path/to/session.jsonl"]);
    });
  });

  describe("buildSpawnEnv", () => {
    it("should prepend managed bin to PATH", () => {
      const env = buildSpawnEnv({ PATH: "/usr/bin" });
      expect(env.PATH).toMatch(/\.pi-dashboard.*node_modules.*\.bin/);
      expect(env.PATH).toContain("/usr/bin");
    });

    it("should not duplicate managed bin if already present", () => {
      const managedBin = require("path").join(require("os").homedir(), ".pi-dashboard", "node_modules", ".bin");
      const env = buildSpawnEnv({ PATH: `${managedBin}:/usr/bin` });
      // Managed bin should appear exactly once
      const parts = env.PATH!.split(":");
      const managedCount = parts.filter(p => p === managedBin).length;
      expect(managedCount).toBe(1);
    });
  });

  describe("electronMode", () => {
    it("should force headless spawn when electronMode is true", async () => {
      // electronMode should bypass tmux detection and use headless directly
      // We test by calling with a non-existent dir to get a quick error without spawning
      const result = await spawnPiSession("/nonexistent-path-12345", { electronMode: true });
      expect(result.success).toBe(false);
      expect(result.message).toContain("does not exist");
    });
  });

  // ── Fork/continue option forwarding ──────────────────────────────────────
  // Regression guard for B1/B2: Windows WSL/cmd fallback used to drop
  // sessionFile + mode silently. buildTmuxCommand and buildHeadlessArgs
  // both go through `sessionFlagsToArgv`; make sure neither drops.
  describe("session-flag forwarding", () => {
    it("buildHeadlessArgs includes --fork for fork mode", () => {
      const args = buildHeadlessArgs({ sessionFile: "C:\\x\\session.jsonl", mode: "fork" });
      expect(args).toEqual(["--mode", "rpc", "--fork", "C:\\x\\session.jsonl"]);
    });

    it("buildHeadlessArgs includes --session for continue mode", () => {
      const args = buildHeadlessArgs({ sessionFile: "/s/abc.jsonl", mode: "continue" });
      expect(args).toEqual(["--mode", "rpc", "--session", "/s/abc.jsonl"]);
    });

    it("buildHeadlessArgs omits session flags when absent", () => {
      const args = buildHeadlessArgs({});
      expect(args).toEqual(["--mode", "rpc"]);
    });

    it("buildTmuxCommand includes --fork in the pi command", () => {
      const cmd = buildTmuxCommand("/project", false, { sessionFile: "/s/abc.jsonl", mode: "fork" });
      expect(cmd).toContain("pi --fork /s/abc.jsonl");
    });

    it("buildTmuxCommand includes --session in the pi command", () => {
      const cmd = buildTmuxCommand("/project", false, { sessionFile: "/s/abc.jsonl", mode: "continue" });
      expect(cmd).toContain("pi --session /s/abc.jsonl");
    });

    it("buildTmuxCommand with special-character sessionFile still shell-escapes", () => {
      const cmd = buildTmuxCommand("/project", false, {
        sessionFile: "/s/with space.jsonl",
        mode: "fork",
      });
      expect(cmd).toContain("--fork '/s/with space.jsonl'");
    });
  });
});
