import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  buildHeadlessArgs,
  buildSpawnEnv,
  buildTmuxCommand,
  type SessionOptions,
  spawnPiSession,
  spawnTmux,
  spawnWslTmux,
} from "../spawn-process/process-manager.js";
import { execFileSync, execSync } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";

// Mock the exec module but keep the REAL buildSafeArgv (its win32/cmd branch
// logic is what the WSL argv-shape assertion depends on) and the real
// spawn/exec wrappers. Only the sync entry points are stubbed so spawnTmux /
// spawnWslTmux never actually launch a process.
vi.mock("@blackbelt-technology/pi-dashboard-shared/platform/exec.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    execSync: vi.fn(),
    spawnSync: vi.fn().mockReturnValue({ status: 1, stdout: "", stderr: "" }),
    execFileSync: vi.fn(),
  };
});

const mockExecFileSync = vi.mocked(execFileSync);
const mockExecSync = vi.mocked(execSync);

// Note: platform-dispatch tests live in packages/shared/src/__tests__/
// spawn-mechanism.test.ts. `detectPlatform` was removed in change:
// consolidate-windows-spawn-and-platform-handlers — its job is now
// owned by platform/spawn-mechanism.ts `selectMechanism`.

describe("Process Manager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("buildTmuxCommand", () => {
    it("should create new session when no pi-dashboard session exists", () => {
      const cmd = buildTmuxCommand("/home/user/project", false);
      expect(cmd).toContain("new-session");
      expect(cmd).toContain("pi-dashboard");
      expect(cmd).not.toContain("new-window");
    });

    it("should create new window when pi-dashboard session exists", () => {
      const cmd = buildTmuxCommand("/home/user/project", true);
      expect(cmd).toContain("new-window");
      expect(cmd).not.toContain("new-session");
    });

    it("should not set PI_DASHBOARD_SPAWNED env var", () => {
      const cmd = buildTmuxCommand("/home/user/project", false);
      expect(cmd).not.toContain("PI_DASHBOARD_SPAWNED");
    });

    it("carries cwd with spaces as a literal -c element, no quoting", () => {
      const cwd = "/home/user/my project";
      const cmd = buildTmuxCommand(cwd, false);
      expect(cmd[cmd.indexOf("-c") + 1]).toBe(cwd);
      expect(cmd).not.toContain("cd");
    });

    it("carries cwd with semicolons as a literal element", () => {
      const cwd = "/tmp/test; rm -rf /";
      const cmd = buildTmuxCommand(cwd, false);
      expect(cmd[cmd.indexOf("-c") + 1]).toBe(cwd);
    });

    it("carries cwd with backticks as a literal element", () => {
      const cwd = "/tmp/`whoami`";
      const cmd = buildTmuxCommand(cwd, false);
      expect(cmd[cmd.indexOf("-c") + 1]).toBe(cwd);
    });

    it("should shell-escape sessionFile with special characters in the pane command", () => {
      const cmd = buildTmuxCommand("/home/user/project", true, {
        sessionFile: "/path/to/my session; cat /etc/passwd",
        mode: "continue",
      });
      expect(cmd[cmd.length - 1]).toBe("pi --session '/path/to/my session; cat /etc/passwd'");
    });

    it("should not double-quote safe paths (cwd is a raw argv element)", () => {
      const cwd = "/home/user/project";
      const cmd = buildTmuxCommand(cwd, false);
      expect(cmd.filter(e => e === cwd).length).toBe(1);
      expect(cmd).not.toContain("cd");
      expect(cmd).not.toContain("&&");
    });

    it("should include --session flag for continue mode", () => {
      const cmd = buildTmuxCommand("/home/user/project", true, {
        sessionFile: "/path/to/session.jsonl",
        mode: "continue",
      });
      expect(cmd[cmd.length - 1]).toBe("pi --session /path/to/session.jsonl");
    });

    it("should include --fork flag for fork mode", () => {
      const cmd = buildTmuxCommand("/home/user/project", true, {
        sessionFile: "/path/to/session.jsonl",
        mode: "fork",
      });
      expect(cmd[cmd.length - 1]).toBe("pi --fork /path/to/session.jsonl");
    });

    it("should not include session flags when no options provided", () => {
      const cmd = buildTmuxCommand("/home/user/project", false);
      expect(cmd[cmd.length - 1]).toBe("pi");
    });

    it("should create new session for continue mode when no tmux session exists", () => {
      const cmd = buildTmuxCommand("/home/user/project", false, {
        sessionFile: "/path/to/session.jsonl",
        mode: "continue",
      });
      expect(cmd).toContain("new-session");
      expect(cmd[cmd.length - 1]).toBe("pi --session /path/to/session.jsonl");
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
      expect(cmd[cmd.length - 1]).toBe("pi --fork /s/abc.jsonl");
    });

    it("buildTmuxCommand includes --session in the pi command", () => {
      const cmd = buildTmuxCommand("/project", false, { sessionFile: "/s/abc.jsonl", mode: "continue" });
      expect(cmd[cmd.length - 1]).toBe("pi --session /s/abc.jsonl");
    });

    it("buildTmuxCommand with special-character sessionFile still shell-escapes", () => {
      const cmd = buildTmuxCommand("/project", false, {
        sessionFile: "/s/with space.jsonl",
        mode: "fork",
      });
      expect(cmd[cmd.length - 1]).toBe("pi --fork '/s/with space.jsonl'");
    });
  });

  // ── Command-injection regression (change: fix-tmux-cwd-command-injection) ──

  describe("buildTmuxCommand: hostile cwd is a literal argv element", () => {
    it("E1: command-substitution cwd is strictly equal to input, after -c", () => {
      const cwd = "/tmp/$(touch /tmp/PWNED) dir";
      const cmd = buildTmuxCommand(cwd, false);
      expect(cmd[cmd.indexOf("-c") + 1]).toBe(cwd);
      expect(cmd.filter(e => e.includes("'") && e.includes(cwd)).length).toBe(0);
    });

    it("E2: quote/separator cwd is exactly one verbatim element", () => {
      const cwd = `/tmp/a"b'c;d e&f`;
      const cmd = buildTmuxCommand(cwd, false);
      expect(cmd.filter(e => e === cwd).length).toBe(1);
      // No other element may contain the cwd text (it is not interpolated anywhere else).
      expect(cmd.filter(e => e.includes(cwd)).length).toBe(1);
    });

    it("E3: pane command carries no cd, no &&, and no cwd", () => {
      const cwd = "/tmp/$(id) x";
      const cmd = buildTmuxCommand(cwd, false);
      expect(cmd[cmd.length - 1]).toBe("pi");
      expect(cmd).not.toContain("cd");
      expect(cmd.filter(e => e.includes("&&")).length).toBe(0);
      expect(cmd.filter(e => e.includes("/tmp/$(id) x") && e !== cwd).length).toBe(0);
    });

    it("E4: flag value stays one escaped token, pane stays ONE element", () => {
      const cmd = buildTmuxCommand("/p", false, {
        sessionFile: "/s/a$(id);x .jsonl",
        mode: "continue",
      });
      expect(cmd[cmd.length - 1]).toBe("pi --session '/s/a$(id);x .jsonl'");
      // The pane command is a single argv element, not split by the flag's spaces.
      expect(cmd[cmd.length - 1].split(" ").length).toBeGreaterThan(1);
    });

    it("E5: decision table — subcommand/token/flags as discrete elements", () => {
      const rows: Array<[boolean, string | undefined, SessionOptions | undefined]> = [
        [true, undefined, undefined],
        [true, "tok", undefined],
        [true, undefined, { sessionFile: "/s/a.jsonl", mode: "continue" }],
        [true, "tok", { sessionFile: "/s/a.jsonl", mode: "continue" }],
        [false, undefined, undefined],
        [false, "tok", undefined],
        [false, undefined, { sessionFile: "/s/a.jsonl", mode: "continue" }],
        [false, "tok", { sessionFile: "/s/a.jsonl", mode: "continue" }],
      ];
      for (const [sessionExists, spawnToken, flags] of rows) {
        const cmd = buildTmuxCommand("/p", sessionExists, { ...flags, spawnToken });
        if (sessionExists) {
          expect(cmd).toContain("new-window");
          expect(cmd).toContain("-t");
          expect(cmd).not.toContain("new-session");
          expect(cmd).not.toContain("-d");
        } else {
          expect(cmd).toContain("new-session");
          expect(cmd).toContain("-d");
          expect(cmd).toContain("-s");
          expect(cmd).not.toContain("new-window");
        }
        const eIdx = cmd.indexOf("-e");
        if (spawnToken) {
          expect(eIdx).toBeGreaterThanOrEqual(0);
          expect(cmd[eIdx + 1]).toBe(`PI_DASHBOARD_SPAWN_TOKEN=${spawnToken}`);
        } else {
          expect(eIdx).toBe(-1);
          expect(cmd.filter(e => e.startsWith("PI_DASHBOARD_SPAWN_TOKEN=")).length).toBe(0);
        }
      }
    });

    it("E6: piInvocation parameter is escaped into the pane; default is pi", () => {
      const piInvocation = ["/usr/local/bin/node", "/opt/pi/cli.js"];
      const cmd = buildTmuxCommand("/p", false, undefined, piInvocation);
      expect(cmd[cmd.length - 1]).toBe("/usr/local/bin/node /opt/pi/cli.js");
      expect(buildTmuxCommand("/p", false)[buildTmuxCommand("/p", false).length - 1]).toBe("pi");
    });

    it("E7: degenerate paths are each one strictly-equal element, no throw", () => {
      for (const cwd of ["/", "/tmp/trailing\\", "/tmp/  double  space  "]) {
        const cmd = buildTmuxCommand(cwd, false);
        expect(cmd[cmd.indexOf("-c") + 1]).toBe(cwd);
        expect(cmd.filter(e => e === cwd).length).toBe(1);
      }
    });
  });

  describe("spawnTmux: argv execution without a shell", () => {
    it("E8: calls execFileSync (not execSync) with the buildSafeArgv argv and shell:false", () => {
      const cwd = "/tmp/$(id)";
      const result = spawnTmux(cwd, undefined);
      expect(result.success).toBe(true);
      expect(mockExecFileSync).toHaveBeenCalledTimes(1);
      const [file, args, opts] = mockExecFileSync.mock.calls[0];
      expect(file).toBe("tmux");
      expect(args![args!.indexOf("-c") + 1]).toBe(cwd);
      expect(opts!).toMatchObject({ shell: false });
      expect(mockExecSync).not.toHaveBeenCalledWith(expect.stringContaining("tmux new-"));
    });

    it("X1: maps execFileSync ENOENT to TMUX_MISSING without throwing", () => {
      mockExecFileSync.mockImplementationOnce(() => {
        const e: Error & { code?: string } = new Error("spawn tmux ENOENT");
        e.code = "ENOENT";
        throw e;
      });
      const result = spawnTmux("/p");
      expect(result.success).toBe(false);
      expect(result.code).toBe("TMUX_MISSING");
      expect(result.message).toContain("spawn tmux ENOENT");
    });
  });

  describe("spawnWslTmux: wsl.exe --exec argv shape", () => {
    it("E9: spawns wsl.exe (not cmd.exe) with --exec then tmux", () => {
      const result = spawnWslTmux("/tmp/$(id)", undefined);
      expect(result.success).toBe(true);
      expect(mockExecFileSync).toHaveBeenCalledTimes(1);
      const [file, args] = mockExecFileSync.mock.calls[0];
      expect(file).toBe("wsl.exe");
      expect(file).not.toBe("cmd.exe");
      expect(args![0]).toBe("--exec");
      expect(args![1]).toBe("tmux");
      expect(args!).toContain("/tmp/$(id)");
    });

    it("X2: maps execFileSync failure to TMUX_MISSING with the WSL message", () => {
      mockExecFileSync.mockImplementationOnce(() => {
        throw new Error("spawn wsl.exe ENOENT");
      });
      const result = spawnWslTmux("/p");
      expect(result.success).toBe(false);
      expect(result.code).toBe("TMUX_MISSING");
      expect(result.message).toContain("via WSL tmux (wsl-tmux mechanism)");
    });
  });

  describe("spawn env/stdio invariants (both sites)", () => {
    it("X3: passes stdio:ignore and a buildSpawnEnv env carrying the token", () => {
      spawnTmux("/p", { spawnToken: "tok-1" });
      spawnWslTmux("/p", { spawnToken: "tok-1" });
      expect(mockExecFileSync).toHaveBeenCalledTimes(2);
      for (const [, , opts] of mockExecFileSync.mock.calls) {
        expect(opts!).toMatchObject({ stdio: "ignore" });
        expect((opts!.env as Record<string, string>).PI_DASHBOARD_SPAWN_TOKEN).toBe("tok-1");
      }
    });

    it("X4: missing-dir guard runs before construction — no exec call at all", async () => {
      const result = await spawnPiSession("/nonexistent-path-12345");
      expect(result.success).toBe(false);
      expect(result.code).toBe("DIR_MISSING");
      expect(mockExecFileSync).not.toHaveBeenCalled();
      expect(mockExecSync).not.toHaveBeenCalled();
    });
  });
});

/**
 * Each tmux window SHALL carry its OWN spawn correlation token.
 *
 * The `-e` flag sets the variable for the window being created. When a
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

  it("passes the token with -e on a new window", () => {
    const cmd = buildTmuxCommand("/home/user/project", true, { spawnToken: TOKEN });
    const eIdx = cmd.indexOf("-e");
    expect(eIdx).toBeGreaterThanOrEqual(0);
    expect(cmd[eIdx + 1]).toBe(`PI_DASHBOARD_SPAWN_TOKEN=${TOKEN}`);
    // The -e precedes the -c (pane command) — it is a tmux flag, not pane text.
    expect(eIdx).toBeLessThan(cmd.indexOf("-c"));
  });

  it("passes the token with -e on a new session too", () => {
    const cmd = buildTmuxCommand("/home/user/project", false, { spawnToken: TOKEN });
    expect(cmd).toContain("-e");
    expect(cmd).toContain(`PI_DASHBOARD_SPAWN_TOKEN=${TOKEN}`);
  });

  it("omits -e entirely when there is no token", () => {
    expect(buildTmuxCommand("/home/user/project", true)).not.toContain("-e");
  });

  it("keeps a metacharacter token RAW (argv element, not shell-escaped)", () => {
    const cmd = buildTmuxCommand("/p", true, { spawnToken: "a; rm -rf /" });
    // The token is a discrete argv element after -e; tmux parses `name=value`
    // itself (no shell), so the value stays literal — no quoting.
    expect(cmd).toContain("PI_DASHBOARD_SPAWN_TOKEN=a; rm -rf /");
    expect(cmd).not.toContain("PI_DASHBOARD_SPAWN_TOKEN='a; rm -rf /'");
  });
});
