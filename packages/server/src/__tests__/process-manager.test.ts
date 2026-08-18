import { describe, expect, it, vi } from "vitest";
import { buildHeadlessArgs, buildSpawnEnv, buildTmuxCommand, type SessionOptions, shellEscape, spawnPiSession } from "../spawn-process/process-manager.js";

// Note: platform-dispatch tests live in packages/shared/src/__tests__/
// spawn-mechanism.test.ts. `detectPlatform` was removed in change:
// consolidate-windows-spawn-and-platform-handlers — its job is now
// owned by platform/spawn-mechanism.ts `selectMechanism`.

describe("Process Manager", () => {
  // `buildTmuxCommand` returns an ARGV ARRAY, not a shell string. The pane
  // command is the LAST element and is the only shell-interpreted part.
  // See change: select-pi-runtime-install / fix-tmux-cwd-command-injection (D9).
  const pane = (argv: string[]): string => argv[argv.length - 1];

  describe("buildTmuxCommand", () => {
    it("should create new session when no pi-dashboard session exists", () => {
      const argv = buildTmuxCommand("/home/user/project", false);
      expect(argv).toContain("new-session");
      expect(argv).toContain("pi-dashboard");
    });

    it("should create new window when pi-dashboard session exists", () => {
      expect(buildTmuxCommand("/home/user/project", true)).toContain("new-window");
    });

    it("should not set PI_DASHBOARD_SPAWNED env var", () => {
      expect(buildTmuxCommand("/home/user/project", false).join(" ")).not.toContain(
        "PI_DASHBOARD_SPAWNED",
      );
    });

    it("X5: returns an argv array with no `cd <cwd> &&` prefix; cwd is a literal -c element", () => {
      const argv = buildTmuxCommand("/home/user/my project", false);
      expect(Array.isArray(argv)).toBe(true);
      expect(argv.join(" ")).not.toContain("cd ");
      // The cwd travels VERBATIM — no quoting, because there is no shell.
      expect(argv[argv.indexOf("-c") + 1]).toBe("/home/user/my project");
    });

    it("X1/X2/X3 (unit half): an adversarial cwd is one literal argv element", () => {
      for (const evil of [
        "/tmp/$(touch /tmp/pwned)",
        "/tmp/`whoami`",
        '/tmp/a"b\'c;d e',
      ]) {
        const argv = buildTmuxCommand(evil, false);
        expect(argv).toContain(evil);
        // It appears ONLY as the -c value, never spliced into the pane command.
        expect(pane(argv)).not.toContain(evil);
      }
    });

    it("should shell-escape sessionFile with special characters inside the pane command", () => {
      const argv = buildTmuxCommand("/home/user/project", true, {
        sessionFile: "/path/to/my session; cat /etc/passwd",
        mode: "continue",
      });
      expect(pane(argv)).toContain("--session '/path/to/my session; cat /etc/passwd'");
    });

    it("X4: a flag value with $(…), backticks and quotes reaches pi as ONE literal argument", () => {
      const evil = '$(touch /tmp/pwned)`whoami`"x\'y';
      const argv = buildTmuxCommand("/p", false, { sessionFile: evil, mode: "fork" });
      const p = pane(argv);
      // Single-quoted, in a context with no enclosing double quotes, so the
      // shell tmux runs the pane command through cannot expand any of it.
      expect(p).toContain(shellEscape(evil));
      expect(p).not.toContain("$(touch /tmp/pwned)`whoami`\"x'y");
    });

    it("should include --session flag for continue mode", () => {
      const argv = buildTmuxCommand("/home/user/project", true, {
        sessionFile: "/path/to/session.jsonl",
        mode: "continue",
      });
      expect(pane(argv)).toContain("--session /path/to/session.jsonl");
      expect(pane(argv)).not.toContain("--fork");
    });

    it("should include --fork flag for fork mode", () => {
      const argv = buildTmuxCommand("/home/user/project", true, {
        sessionFile: "/path/to/session.jsonl",
        mode: "fork",
      });
      expect(pane(argv)).toContain("--fork /path/to/session.jsonl");
      expect(pane(argv)).not.toContain("--session");
    });

    it("should not include session flags when no options provided", () => {
      const p = pane(buildTmuxCommand("/home/user/project", false));
      expect(p).not.toContain("--session");
      expect(p).not.toContain("--fork");
    });

    it("should create new session for continue mode when no tmux session exists", () => {
      const argv = buildTmuxCommand("/home/user/project", false, {
        sessionFile: "/path/to/session.jsonl",
        mode: "continue",
      });
      expect(argv).toContain("new-session");
      expect(pane(argv)).toContain("--session /path/to/session.jsonl");
    });

    it("X7: a node-wrapped invocation carries BOTH elements into the pane", () => {
      const argv = buildTmuxCommand("/p", false, undefined, [
        "/usr/bin/node",
        "/opt/pi/dist/cli.js",
      ]);
      expect(pane(argv)).toBe("/usr/bin/node /opt/pi/dist/cli.js");
    });

    it("X8: wsl-tmux embeds bare `pi` so WSL resolves it in its own namespace", () => {
      // `spawnWslTmux` passes ["pi"] — the builder's default — and no
      // host-resolved path may leak in.
      const argv = buildTmuxCommand("/p", false, undefined, ["pi"]);
      expect(pane(argv)).toBe("pi");
      expect(argv.join(" ")).not.toContain("cli.js");
    });

    it("defaults to bare `pi` when no invocation is supplied", () => {
      expect(pane(buildTmuxCommand("/p", false))).toBe("pi");
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
      const argv = buildTmuxCommand("/project", false, { sessionFile: "/s/abc.jsonl", mode: "fork" });
      expect(pane(argv)).toBe("pi --fork /s/abc.jsonl");
    });

    it("buildTmuxCommand includes --session in the pi command", () => {
      const argv = buildTmuxCommand("/project", false, { sessionFile: "/s/abc.jsonl", mode: "continue" });
      expect(pane(argv)).toBe("pi --session /s/abc.jsonl");
    });

    it("buildTmuxCommand with special-character sessionFile still shell-escapes", () => {
      const argv = buildTmuxCommand("/project", false, {
        sessionFile: "/s/with space.jsonl",
        mode: "fork",
      });
      expect(pane(argv)).toContain("--fork '/s/with space.jsonl'");
    });
  });
});

/**
 * Each tmux window SHALL carry its OWN spawn correlation token.
 *
 * `execSync(cmd, { env })` sets the env of the tmux CLIENT. When a
 * `pi-dashboard` tmux SERVER is already running, `new-window` inherits the
 * SERVER's environment — the one captured when the very first window was
 * created — so every later window received the FIRST spawn's token.
 *
 * Measured in the harness: three concurrently spawned panes all reported
 * `PI_DASHBOARD_SPAWN_TOKEN=5fbdbd63-…`. That silently breaks the token as an
 * identity: watchdog `byToken` collapses every spawn onto one entry, and any
 * token-keyed action (correlation OR termination) addresses the wrong process.
 * `-e` sets the variable for that window only.
 *
 * See change: fix-tmux-session-shutdown-leak (design D5).
 */
describe("buildTmuxCommand: per-window spawn token", () => {
  const TOKEN = "fe487887-9973-4805-ab90-17f3d889ef68";
  const paneOf = (argv: string[]): string => argv[argv.length - 1];

  it("passes the token with -e on a new window", () => {
    const argv = buildTmuxCommand("/home/user/project", true, { spawnToken: TOKEN });
    const i = argv.indexOf("-e");
    expect(argv[i + 1]).toBe(`PI_DASHBOARD_SPAWN_TOKEN=${TOKEN}`);
    // As a tmux flag rather than part of the pane command.
    expect(i).toBeLessThan(argv.length - 1);
    expect(paneOf(argv)).not.toContain("PI_DASHBOARD_SPAWN_TOKEN");
  });

  it("passes the token with -e on a new session too", () => {
    const argv = buildTmuxCommand("/home/user/project", false, { spawnToken: TOKEN });
    expect(argv[argv.indexOf("-e") + 1]).toBe(`PI_DASHBOARD_SPAWN_TOKEN=${TOKEN}`);
  });

  it("omits -e entirely when there is no token", () => {
    expect(buildTmuxCommand("/home/user/project", true)).not.toContain("-e");
  });

  it("a token containing shell metacharacters travels as ONE literal argv element", () => {
    // No dashboard-side shell any more, so the token needs no escaping — but
    // it must not be splittable either.
    const argv = buildTmuxCommand("/p", true, { spawnToken: "a; rm -rf /" });
    expect(argv).toContain("PI_DASHBOARD_SPAWN_TOKEN=a; rm -rf /");
    expect(paneOf(argv)).not.toContain("rm -rf");
  });
});
