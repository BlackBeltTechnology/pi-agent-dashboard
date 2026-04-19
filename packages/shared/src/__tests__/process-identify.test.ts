/**
 * Tests for platform/process-identify.ts.
 *
 * Uses an injected fake `exec` so we can simulate ps/tasklist output on
 * any host OS. All tests pass `platform` explicitly.
 */
import { describe, it, expect, vi } from "vitest";
import {
  findPidByMarker,
  isProcessLikePi,
  isPiCommandLine,
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
