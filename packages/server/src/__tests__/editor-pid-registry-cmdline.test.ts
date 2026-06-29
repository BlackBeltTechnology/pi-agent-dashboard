/**
 * Tests for `defaultGetCmdline` Windows branch.
 * Win 11 22H2+ removed wmic; resolution now runs PowerShell Get-CimInstance
 * via an injectable spawnSync (no real process spawned here).
 * See change: replace-wmic-with-powershell.
 */
import { afterEach, describe, expect, it } from "vitest";
import { type CmdlineSpawnSyncFn, defaultGetCmdline } from "../editor-pid-registry.js";

const origPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;

function forceWin32(): void {
  Object.defineProperty(process, "platform", { value: "win32", configurable: true });
}

afterEach(() => {
  Object.defineProperty(process, "platform", origPlatform);
});

describe("defaultGetCmdline (win32, PowerShell)", () => {
  it("returns the trimmed CommandLine on success", () => {
    forceWin32();
    const spawnSync: CmdlineSpawnSyncFn = () => ({ status: 0, stdout: "node.exe foo.js\r\n" });
    expect(defaultGetCmdline(4321, spawnSync)).toBe("node.exe foo.js");
  });

  it("returns null when PowerShell exits non-zero", () => {
    forceWin32();
    const spawnSync: CmdlineSpawnSyncFn = () => ({ status: 1, stdout: "" });
    expect(defaultGetCmdline(4321, spawnSync)).toBeNull();
  });

  it("returns null when output is empty", () => {
    forceWin32();
    const spawnSync: CmdlineSpawnSyncFn = () => ({ status: 0, stdout: "  \r\n" });
    expect(defaultGetCmdline(4321, spawnSync)).toBeNull();
  });

  it("returns null when spawnSync throws", () => {
    forceWin32();
    const spawnSync: CmdlineSpawnSyncFn = () => {
      throw new Error("spawn failed");
    };
    expect(defaultGetCmdline(4321, spawnSync)).toBeNull();
  });
});
