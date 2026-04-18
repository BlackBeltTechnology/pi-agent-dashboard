/**
 * Tests for packages/shared/src/platform/process-scan.ts.
 * Platform behavior is exercised via injected `platform` + `exec`.
 * See change: consolidate-platform-handlers.
 */
import { describe, it, expect, vi } from "vitest";
import { parseEtime, isProcessRunning } from "../platform/process-scan.js";

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
