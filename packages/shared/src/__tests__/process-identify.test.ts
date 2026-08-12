/**
 * Tests for platform/process-identify.ts.
 *
 * Uses an injected fake `exec` so we can simulate ps/tasklist output on
 * any host OS. All tests pass `platform` explicitly.
 */
import { describe, expect, it, vi } from "vitest";
import {
  findPidByMarker,
  findPidsBySpawnToken,
  isPiCommandLine,
  isProcessLikePi,
} from "../platform/process-identify.js";

describe("isPiCommandLine", () => {
  it("matches pi", () => {
    expect(isPiCommandLine("/usr/bin/pi --mode rpc")).toBe(true);
  });
  it("matches node", () => {
    expect(isPiCommandLine("node cli.js")).toBe(true);
  });
  it("matches pi even with path prefixes", () => {
    expect(isPiCommandLine("/opt/foo/pi --args")).toBe(true);
  });
  it("does not match unrelated processes", () => {
    expect(isPiCommandLine("/bin/bash")).toBe(false);
    expect(isPiCommandLine("/usr/bin/zsh")).toBe(false);
  });
  it("does not match substrings without word boundary", () => {
    // "pip" and "typescript" must not match pi or node.
    expect(isPiCommandLine("pip install something")).toBe(false);
    expect(isPiCommandLine("/usr/bin/typescript-compiler")).toBe(false);
  });
});

describe("findPidByMarker", () => {
  it("Windows returns empty array without execution", () => {
    const exec = vi.fn(() => "should not be called");
    const result = findPidByMarker("marker", { platform: "win32", exec: exec as any });
    expect(result).toEqual([]);
    expect(exec).not.toHaveBeenCalled();
  });

  it("Linux parses ps output and filters to sentinel lines", () => {
    const fakeOutput = [
      "12345 sh -c tail -f /dev/null | pi --mode rpc session-abc",
      "67890 grep session-abc",
      "11111 sleep 2147483647 | pi --mode rpc session-abc",
      "22222 vim notes-about-session-abc.txt",
    ].join("\n");
    const exec = vi.fn(() => fakeOutput) as any;
    const result = findPidByMarker("session-abc", { platform: "linux", exec });
    expect(result).toEqual([12345, 11111]);
  });

  it("macOS parses ps output similarly", () => {
    const fakeOutput = "99999 tail -f /dev/null | pi --mode rpc s1";
    const exec = vi.fn(() => fakeOutput) as any;
    const result = findPidByMarker("s1", { platform: "darwin", exec });
    expect(result).toEqual([99999]);
  });

  it("returns empty array when no match", () => {
    const exec = vi.fn(() => "") as any;
    const result = findPidByMarker("nothing", { platform: "linux", exec });
    expect(result).toEqual([]);
  });

  it("returns empty array when exec throws (process dead / permission)", () => {
    const exec = vi.fn(() => { throw new Error("no such command"); }) as any;
    const result = findPidByMarker("x", { platform: "linux", exec });
    expect(result).toEqual([]);
  });

  it("excludes lines without pi headless sentinels", () => {
    const fakeOutput = "12345 some-random-process matching-marker-only";
    const exec = vi.fn(() => fakeOutput) as any;
    const result = findPidByMarker("matching-marker", { platform: "linux", exec });
    expect(result).toEqual([]);
  });
});

describe("isProcessLikePi", () => {
  it("Windows returns true unconditionally", () => {
    const exec = vi.fn(() => "should not be called");
    expect(isProcessLikePi(1234, { platform: "win32", exec: exec as any })).toBe(true);
    expect(exec).not.toHaveBeenCalled();
  });

  it("Linux matches via /proc cmdline", () => {
    const exec = vi.fn(() => "/usr/bin/node /opt/pi-coding-agent/dist/cli.js") as any;
    expect(isProcessLikePi(1234, { platform: "linux", exec })).toBe(true);
  });

  it("Linux does not match non-pi", () => {
    const exec = vi.fn(() => "/bin/bash") as any;
    expect(isProcessLikePi(1234, { platform: "linux", exec })).toBe(false);
  });

  it("macOS uses ps -p -o command=", () => {
    let capturedCmd = "";
    const exec = ((cmd: string) => {
      capturedCmd = cmd;
      return "node cli.js --mode rpc";
    }) as any;
    expect(isProcessLikePi(555, { platform: "darwin", exec })).toBe(true);
    expect(capturedCmd).toMatch(/ps -p 555 -o command=/);
  });

  it("returns false when process has exited (exec throws)", () => {
    const exec = vi.fn(() => { throw new Error("no such process"); }) as any;
    expect(isProcessLikePi(9999, { platform: "linux", exec })).toBe(false);
  });
});

/**
 * `findPidsBySpawnToken` — the only handle for a spawn the dashboard cannot
 * address any other way.
 *
 * A tmux-spawned pi that never registers (blocked on pi's interactive
 * "Trust project folder?" prompt, measured in the E2E harness) has no session
 * record, no pid known to the server, and nothing on its command line: three
 * such panes held ~127 MB each indefinitely while the watchdog reported the
 * timeout and moved on. The spawn token in the process ENVIRONMENT is what
 * survives.
 *
 * See change: fix-tmux-session-shutdown-leak (design D5).
 */
describe("findPidsBySpawnToken", () => {
  const TOKEN = "fe487887-9973-4805-ab90-17f3d889ef68";

  it("linux: returns the pids the /proc scan printed", () => {
    // Typed params, so `exec.mock.calls[0][0]` is the command string rather
    // than an empty tuple.
    const exec = vi.fn((_cmd: string, _opts: { encoding: "utf-8" }) => "18163\n18674\n18830\n");
    expect(findPidsBySpawnToken(TOKEN, { platform: "linux", exec })).toEqual([
      18163, 18674, 18830,
    ]);
    // The token must be matched in the ENVIRONMENT, never on the command line:
    // it is not on the command line, and a `ps | grep <token>` would match the
    // lookup's own process.
    expect(exec.mock.calls[0]?.[0]).toContain("environ");
    // Leaf `pi` only. The token is an ordinary env var, so it is INHERITED by
    // the tmux server, the dashboard's own node process and every shell in
    // between; an un-narrowed lookup returned five pids for one token and
    // handing that set to a kill path took the whole container down.
    expect(exec.mock.calls[0]?.[0]).toContain('"$d/comm"');
    expect(exec.mock.calls[0]?.[0]).toContain(`PI_DASHBOARD_SPAWN_TOKEN=${TOKEN}`);
  });

  it("linux: the probe cannot exit non-zero just because the last /proc entry did not match", () => {
    // The loop's status is the LAST iteration's, and the last /proc entry almost
    // never matches. Without a forced zero exit, `grep -q` left the shell at
    // status 1, execSync threw, the catch swallowed it, and EVERY lookup
    // silently returned [] — a watchdog that fired but reclaimed nothing.
    const exec = vi.fn((_cmd: string, _opts: { encoding: "utf-8" }) => "18163\n");
    findPidsBySpawnToken(TOKEN, { platform: "linux", exec });
    expect(exec.mock.calls[0]?.[0]).toMatch(/exit 0\s*$/);
  });

  it("darwin: keeps only the ps lines whose environment carries the token", () => {
    const exec = vi.fn(
      () =>
        `  501 pi /usr/bin/pi PI_DASHBOARD_SPAWN_TOKEN=${TOKEN} TERM=xterm\n` +
        "  777 pi /usr/bin/pi PI_DASHBOARD_SPAWN_TOKEN=some-other-token TERM=xterm\n" +
        "  999 node node server.js\n",
    );
    expect(findPidsBySpawnToken(TOKEN, { platform: "darwin", exec })).toEqual([501]);
  });

  it("darwin: a node/tmux process that INHERITED the token is not a target", () => {
    // The dashboard server and the tmux server both carry the token by
    // inheritance. Killing either takes down far more than one leaked session.
    const exec = vi.fn(
      () =>
        `  100 node /usr/bin/node server.js PI_DASHBOARD_SPAWN_TOKEN=${TOKEN}\n` +
        `  200 tmux tmux new-session PI_DASHBOARD_SPAWN_TOKEN=${TOKEN}\n` +
        `  300 pi /usr/bin/pi PI_DASHBOARD_SPAWN_TOKEN=${TOKEN}\n`,
    );
    expect(findPidsBySpawnToken(TOKEN, { platform: "darwin", exec })).toEqual([300]);
  });

  it("windows returns []", () => {
    const exec = vi.fn(() => "1\n");
    expect(findPidsBySpawnToken(TOKEN, { platform: "win32", exec })).toEqual([]);
    expect(exec).not.toHaveBeenCalled();
  });

  it("refuses a blank or too-short token instead of matching every process", () => {
    // A wildcard here would hand a KILL path every process that merely has the
    // variable set.
    const exec = vi.fn(() => "1\n2\n3\n");
    for (const bad of ["", "   ", "short"]) {
      expect(findPidsBySpawnToken(bad, { platform: "linux", exec })).toEqual([]);
    }
    expect(exec).not.toHaveBeenCalled();
  });

  it("never throws when the probe fails", () => {
    const exec = vi.fn(() => {
      throw new Error("no /proc");
    });
    expect(findPidsBySpawnToken(TOKEN, { platform: "linux", exec })).toEqual([]);
  });
});
