/**
 * Tests for packages/shared/src/platform/commands.ts.
 * Platform behavior exercised via injected `platform` + `exec` / `asyncExec`.
 * See change: consolidate-platform-handlers.
 */
import { describe, it, expect, vi } from "vitest";
import { openBrowser, isVirtualMachine } from "../platform/commands.js";

describe("openBrowser", () => {
  it("uses `open` on macOS", () => {
    const asyncExec = vi.fn((_cmd, cb: (e: Error | null) => void) => cb(null));
    openBrowser("https://example.com", { platform: "darwin", asyncExec });
    expect(asyncExec).toHaveBeenCalledOnce();
    expect(asyncExec.mock.calls[0][0]).toMatch(/^open\s+"https:\/\/example\.com"$/);
  });

  it("uses `start` on Windows", () => {
    const asyncExec = vi.fn((_cmd, cb: (e: Error | null) => void) => cb(null));
    openBrowser("https://example.com", { platform: "win32", asyncExec });
    expect(asyncExec.mock.calls[0][0]).toMatch(/^start\s+""\s+"https:\/\/example\.com"$/);
  });

  it("uses `xdg-open` on Linux", () => {
    const asyncExec = vi.fn((_cmd, cb: (e: Error | null) => void) => cb(null));
    openBrowser("https://example.com", { platform: "linux", asyncExec });
    expect(asyncExec.mock.calls[0][0]).toMatch(/^xdg-open\s+"https:\/\/example\.com"$/);
  });

  it("escapes URLs via JSON.stringify (quotes, newlines, backslashes)", () => {
    const asyncExec = vi.fn((_cmd, cb: (e: Error | null) => void) => cb(null));
    openBrowser('https://example.com/?q="escaped"', { platform: "linux", asyncExec });
    // JSON.stringify converts " → \"
    expect(asyncExec.mock.calls[0][0]).toContain('\\"escaped\\"');
  });

  it("invokes onError callback when async exec fails", () => {
    const err = new Error("nope");
    const onError = vi.fn();
    const asyncExec = vi.fn((_cmd, cb: (e: Error | null) => void) => cb(err));
    openBrowser("https://example.com", { platform: "linux", asyncExec, onError });
    expect(onError).toHaveBeenCalledWith(err);
  });

  it("does not throw when onError is absent", () => {
    const err = new Error("nope");
    const asyncExec = vi.fn((_cmd, cb: (e: Error | null) => void) => cb(err));
    expect(() =>
      openBrowser("https://example.com", { platform: "linux", asyncExec }),
    ).not.toThrow();
  });
});

describe("isVirtualMachine", () => {
  it("detects VMware via sysctl on macOS", () => {
    const exec = vi.fn().mockReturnValue("VMware7,1\n");
    expect(isVirtualMachine({ platform: "darwin", exec })).toBe(true);
  });

  it("detects VirtualBox via sysctl on macOS", () => {
    const exec = vi.fn().mockReturnValue("VirtualBox6,0\n");
    expect(isVirtualMachine({ platform: "darwin", exec })).toBe(true);
  });

  it("returns false on physical macOS hardware", () => {
    const exec = vi.fn().mockReturnValue("MacBookPro18,3\n");
    expect(isVirtualMachine({ platform: "darwin", exec })).toBe(false);
  });

  it("detects VM via systemd-detect-virt on Linux", () => {
    const exec = vi.fn().mockReturnValue("kvm\n");
    expect(isVirtualMachine({ platform: "linux", exec })).toBe(true);
  });

  it("returns false on bare-metal Linux", () => {
    const exec = vi.fn().mockReturnValue("none\n");
    expect(isVirtualMachine({ platform: "linux", exec })).toBe(false);
  });

  it("detects VMware via wmic on Windows", () => {
    const exec = vi.fn().mockImplementation((cmd: string) => {
      if (cmd.includes("bios")) return "SerialNumber\nVMware-42 AA BB\n";
      return "";
    });
    expect(isVirtualMachine({ platform: "win32", exec })).toBe(true);
  });

  it("detects Hyper-V via wmic computersystem on Windows", () => {
    const exec = vi.fn().mockImplementation((cmd: string) => {
      if (cmd.includes("bios")) throw new Error("no serial");
      if (cmd.includes("computersystem")) return "Manufacturer  Model\nMicrosoft Corporation  Virtual Machine\n";
      return "";
    });
    expect(isVirtualMachine({ platform: "win32", exec })).toBe(true);
  });

  it("returns false on physical Windows when no VM markers found", () => {
    const exec = vi.fn().mockReturnValue("SerialNumber\nR90ABCDE\n");
    expect(isVirtualMachine({ platform: "win32", exec })).toBe(false);
  });

  it("returns false when exec throws unexpectedly", () => {
    const exec = vi.fn().mockImplementation(() => {
      throw new Error("boom");
    });
    expect(isVirtualMachine({ platform: "darwin", exec })).toBe(false);
    expect(isVirtualMachine({ platform: "linux", exec })).toBe(false);
  });
});
