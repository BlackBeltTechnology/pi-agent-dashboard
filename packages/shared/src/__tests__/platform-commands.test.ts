/**
 * Tests for packages/shared/src/platform/commands.ts.
 * Platform behavior exercised via injected `platform` + `exec` / `asyncExec`.
 * See change: consolidate-platform-handlers.
 */
import { describe, it, expect, vi } from "vitest";
import { openBrowser, isVirtualMachine, parseVmProbeOutput, type VmSpawnSyncFn } from "../platform/commands.js";

/** Build a spawnSync stub returning a fixed CIM-probe result. */
function vmSpawn(status: number, stdout: string): VmSpawnSyncFn {
  return () => ({ status, stdout });
}

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

  it("detects VMware via PowerShell Get-CimInstance on Windows", () => {
    const spawnSync = vmSpawn(0, "VMware-42 AA BB\nVMware, Inc.  VMware Virtual Platform\n");
    expect(isVirtualMachine({ platform: "win32", spawnSync })).toBe(true);
  });

  it("detects Hyper-V via the computersystem CIM output on Windows", () => {
    const spawnSync = vmSpawn(0, "\nMicrosoft Corporation  Virtual Machine\n");
    expect(isVirtualMachine({ platform: "win32", spawnSync })).toBe(true);
  });

  it("returns false on physical Windows when no VM markers found", () => {
    const spawnSync = vmSpawn(0, "R90ABCDE\nDell Inc.  Latitude 7420\n");
    expect(isVirtualMachine({ platform: "win32", spawnSync })).toBe(false);
  });

  it("returns false on Windows when PowerShell exits non-zero", () => {
    const spawnSync = vmSpawn(1, "");
    expect(isVirtualMachine({ platform: "win32", spawnSync })).toBe(false);
  });

  it("returns false on Windows when spawnSync throws", () => {
    const spawnSync: VmSpawnSyncFn = () => {
      throw new Error("spawn failed");
    };
    expect(isVirtualMachine({ platform: "win32", spawnSync })).toBe(false);
  });

  it("returns false when exec throws unexpectedly", () => {
    const exec = vi.fn().mockImplementation(() => {
      throw new Error("boom");
    });
    expect(isVirtualMachine({ platform: "darwin", exec })).toBe(false);
    expect(isVirtualMachine({ platform: "linux", exec })).toBe(false);
  });
});

describe("parseVmProbeOutput", () => {
  it("returns false for empty input", () => {
    expect(parseVmProbeOutput("")).toBe(false);
  });

  it("detects VMware Virtual Platform", () => {
    expect(parseVmProbeOutput("VMware, Inc.  VMware Virtual Platform")).toBe(true);
  });

  it("detects Hyper-V", () => {
    expect(parseVmProbeOutput("Microsoft Corporation  Hyper-V")).toBe(true);
  });

  it("returns false for physical-hardware output", () => {
    expect(parseVmProbeOutput("Dell Inc.\nLatitude 7420")).toBe(false);
  });
});
