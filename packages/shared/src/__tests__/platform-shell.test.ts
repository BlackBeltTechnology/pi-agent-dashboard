/**
 * Tests for packages/shared/src/platform/shell.ts.
 * All four platform × env-present/absent branches are exercised via injected
 * `platform` and `env`. No `process.env` or `process.platform` mutation.
 * See change: consolidate-platform-handlers.
 */
import { describe, it, expect } from "vitest";
import { detectShell, getTerminalEnvHints } from "../platform/shell.js";

describe("detectShell", () => {
  it("uses COMSPEC on Windows when present", () => {
    expect(detectShell({
      platform: "win32",
      env: { COMSPEC: "C:\\Windows\\System32\\cmd.exe" },
    })).toBe("C:\\Windows\\System32\\cmd.exe");
  });

  it("falls back to powershell.exe on Windows when COMSPEC missing", () => {
    expect(detectShell({ platform: "win32", env: {} })).toBe("powershell.exe");
  });

  it("uses SHELL on Linux when present", () => {
    expect(detectShell({
      platform: "linux",
      env: { SHELL: "/bin/zsh" },
    })).toBe("/bin/zsh");
  });

  it("falls back to /bin/bash on Linux when SHELL missing", () => {
    expect(detectShell({ platform: "linux", env: {} })).toBe("/bin/bash");
  });

  it("uses SHELL on macOS when present", () => {
    expect(detectShell({
      platform: "darwin",
      env: { SHELL: "/bin/zsh" },
    })).toBe("/bin/zsh");
  });

  it("falls back to /bin/bash on macOS when SHELL missing", () => {
    expect(detectShell({ platform: "darwin", env: {} })).toBe("/bin/bash");
  });

  it("ignores SHELL on Windows (uses COMSPEC path)", () => {
    // Even if some Windows environment sets SHELL (e.g. Git Bash), the PTY
    // primitive must use COMSPEC / powershell because that's what node-pty
    // can actually spawn on win32.
    expect(detectShell({
      platform: "win32",
      env: { SHELL: "/usr/bin/bash" },
    })).toBe("powershell.exe");
  });
});

describe("getTerminalEnvHints", () => {
  it("adds TERM=cygwin on Windows when TERM is not set", () => {
    expect(getTerminalEnvHints({ platform: "win32", env: {} })).toEqual({ TERM: "cygwin" });
  });

  it("leaves TERM alone on Windows when already set", () => {
    expect(getTerminalEnvHints({
      platform: "win32",
      env: { TERM: "xterm-256color" },
    })).toEqual({});
  });

  it("adds no hints on Linux", () => {
    expect(getTerminalEnvHints({ platform: "linux", env: {} })).toEqual({});
  });

  it("adds no hints on macOS", () => {
    expect(getTerminalEnvHints({ platform: "darwin", env: {} })).toEqual({});
  });
});
