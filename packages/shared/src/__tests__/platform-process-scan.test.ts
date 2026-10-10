/**
 * Tests for packages/shared/src/platform/process-scan.ts.
 * Platform behavior is exercised via injected `platform` + `exec`.
 * See change: consolidate-platform-handlers.
 */
import { describe, it, expect, vi } from "vitest";
import {
  findListenAddresses,
  findProcessesByExecutable,
  isProcessRunning,
  matchesExecutable,
  parseEtime,
  readProcessCommandLine,
} from "../platform/process-scan.js";

describe("parseEtime", () => {
  it("parses mm:ss format", () => expect(parseEtime("02:15")).toBe(135_000));
  it("parses hh:mm:ss format", () => expect(parseEtime("01:30:00")).toBe(5_400_000));
  it("parses dd-hh:mm:ss format", () => expect(parseEtime("2-03:00:00")).toBe(183_600_000));
  it("parses 1-00:00:00 as 1 day", () => expect(parseEtime("1-00:00:00")).toBe(86_400_000));
  it("parses 00:05 as 5 seconds", () => expect(parseEtime("00:05")).toBe(5_000));
  it("returns 0 for empty", () => expect(parseEtime("")).toBe(0));
  it("returns 0 for whitespace", () => expect(parseEtime("   ")).toBe(0));
  it("returns 0 for garbage", () => expect(parseEtime("not-a-time")).toBe(0));
  it("returns 0 for single number (not a time)", () => expect(parseEtime("42")).toBe(0));
});

describe("isProcessRunning", () => {
  it("uses tasklist on Windows and matches image name", () => {
    const exec = vi.fn().mockReturnValue(
      "Code.exe                    12345 Console                    1    50,000 K\n",
    );
    expect(isProcessRunning("Code.exe", { platform: "win32", exec })).toBe(true);
    expect(exec.mock.calls[0][0]).toMatch(/tasklist\s+\/FI\s+"IMAGENAME eq Code\.exe"/);
  });

  it("returns false on Windows when image name is missing from output", () => {
    const exec = vi.fn().mockReturnValue("INFO: No tasks are running.\n");
    expect(isProcessRunning("Missing.exe", { platform: "win32", exec })).toBe(false);
  });

  it("uses pgrep on Unix and returns true when exit code is 0", () => {
    const exec = vi.fn().mockReturnValue("12345\n");
    expect(isProcessRunning("/Applications/Zed.app", { platform: "darwin", exec })).toBe(true);
    expect(exec.mock.calls[0][0]).toMatch(/pgrep\s+-f\s+"\/Applications\/Zed\.app"/);
  });

  it("returns false on Unix when pgrep throws (no match)", () => {
    const exec = vi.fn().mockImplementation(() => {
      throw new Error("exit code 1");
    });
    expect(isProcessRunning("nothing", { platform: "linux", exec })).toBe(false);
  });

  it("returns false on any platform when exec throws unexpectedly", () => {
    const exec = vi.fn().mockImplementation(() => {
      throw new Error("boom");
    });
    expect(isProcessRunning("Code.exe", { platform: "win32", exec })).toBe(false);
    expect(isProcessRunning("zed", { platform: "linux", exec })).toBe(false);
  });
});

// ── Managed-services scan primitives. See change: add-service-registry-core. ──

/** A run() fake answering by command name; unknown commands reject like a missing binary. */
function fakeRun(answers: Record<string, string | Error>) {
  return vi.fn(async (file: string, _args: readonly string[]) => {
    const a = answers[file];
    if (a === undefined) throw Object.assign(new Error(`spawn ${file} ENOENT`), { code: "ENOENT" });
    if (a instanceof Error) throw a;
    return a;
  });
}

describe("E40 — findListenAddresses", () => {
  const LSOF_HEADER = "COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME";
  it.each([
    ["lsof OBS *:4455", "darwin", { lsof: `${LSOF_HEADER}\nobs 812 me 20u IPv4 0x1 0t0 TCP *:4455 (LISTEN)` }, "all-interfaces"],
    ["lsof 127.0.0.1:4455", "linux", { lsof: `${LSOF_HEADER}\nnode 9 me 20u IPv4 0x1 0t0 TCP 127.0.0.1:4455 (LISTEN)` }, "loopback"],
    ["lsof [::1]:4455", "darwin", { lsof: `${LSOF_HEADER}\nnode 9 me 20u IPv6 0x1 0t0 TCP [::1]:4455 (LISTEN)` }, "loopback"],
    ["netstat tcp46 *.4455 (lsof missing)", "darwin", { netstat: "tcp46  0  0  *.4455  *.*  LISTEN\ntcp4 0 0 127.0.0.1.9999 *.* LISTEN" }, "all-interfaces"],
    ["win32 0.0.0.0:4455", "win32", { netstat: "  TCP    0.0.0.0:4455    0.0.0.0:0    LISTENING    1234" }, "all-interfaces"],
    ["empty", "linux", { lsof: "", netstat: "" }, "unknown"],
  ] as const)("%s → %s", async (_label, platform, answers, expected) => {
    const run = fakeRun(answers as Record<string, string>);
    expect(await findListenAddresses(4455, { platform, run })).toBe(expected);
  });

  it("ignores an ESTABLISHED row whose foreign port matches", async () => {
    const run = fakeRun({ netstat: "tcp4  0  0  192.168.1.5.50000  10.0.0.1.4455  ESTABLISHED" });
    expect(await findListenAddresses(4455, { platform: "darwin", run })).toBe("unknown");
  });

  it("win32 never calls lsof", async () => {
    const run = fakeRun({ netstat: "" });
    await findListenAddresses(4455, { platform: "win32", run });
    expect(run.mock.calls.map((c) => c[0])).toEqual(["netstat"]);
  });
});

describe("findProcessesByExecutable — exact basename, never substring", () => {
  it("darwin: full path from comm, case-insensitive", async () => {
    const run = fakeRun({ ps: " 812 /Applications/OBS.app/Contents/MacOS/OBS\n 900 /usr/bin/obs-helper\n 901 /bin/zsh" });
    expect(await findProcessesByExecutable("obs", { platform: "darwin", run })).toEqual([812]);
  });
  it("linux: argv[0] path, so a 15-char comm truncation does not matter; case-sensitive", async () => {
    const run = fakeRun({ ps: " 10 /opt/very-long-executable-name --flag\n 11 /usr/bin/python3 /opt/very-long-executable-name\n 12 /opt/OBS" });
    expect(await findProcessesByExecutable("very-long-executable-name", { platform: "linux", run })).toEqual([10]);
    expect(await findProcessesByExecutable("obs", { platform: "linux", run })).toEqual([]);
  });
  it("win32: tasklist CSV, .exe ignored", async () => {
    const run = fakeRun({ tasklist: '"obs64.exe","4321","Console","1","200,000 K"\n"other.exe","5","Console","1","1 K"' });
    expect(await findProcessesByExecutable("OBS64", { platform: "win32", run })).toEqual([4321]);
  });
  it("tool failure → []", async () => {
    expect(await findProcessesByExecutable("x", { platform: "linux", run: fakeRun({}) })).toEqual([]);
  });
  it("POSIX scans only the current user's processes (ps -U <uid>)", async () => {
    const run = fakeRun({ ps: "" });
    await findProcessesByExecutable("OBS", { platform: "darwin", run, uid: 501 });
    await findProcessesByExecutable("OBS", { platform: "linux", run, uid: 1000 });
    expect(run.mock.calls.map((c) => c[1])).toEqual([
      ["-U", "501", "-o", "pid=,comm="],
      ["-U", "1000", "-o", "pid=,args="],
    ]);
  });
  it("matchesExecutable per platform", () => {
    expect(matchesExecutable("C:\\Program Files\\obs\\obs64.EXE", "obs64", "win32")).toBe(true);
    expect(matchesExecutable("/usr/bin/obs-studio", "obs", "linux")).toBe(false);
  });
});

describe("readProcessCommandLine", () => {
  it("posix uses ps -ww -p <pid> -o args=", async () => {
    const run = fakeRun({ ps: "uvx docling-serve@1.36.0 --port 4100\n" });
    expect(await readProcessCommandLine(42, { platform: "linux", run })).toBe("uvx docling-serve@1.36.0 --port 4100");
    expect(run.mock.calls[0][1]).toEqual(["-ww", "-p", "42", "-o", "args="]);
  });
  it("dead pid / failure → null", async () => {
    expect(await readProcessCommandLine(42, { platform: "darwin", run: fakeRun({}) })).toBeNull();
  });
});
