/**
 * Integration tests: ToolResolver.buildSpawnEnv applies
 * ensureWindowsSystemPath on Windows and is a no-op on POSIX.
 *
 * See change: fix-windows-path-system32-missing.
 */
import { describe, it, expect, vi } from "vitest";

// Mock node:fs.existsSync to allow injecting an `exists` impl via opts;
// binary-lookup itself uses `existsSync` for other resolution code that
// we don't exercise here.
vi.mock("node:fs", () => ({ existsSync: () => false, realpathSync: (p: string) => p }));

import { ToolResolver } from "../platform/binary-lookup.js";
import { MANAGED_BIN } from "../managed-paths.js";

describe("ToolResolver.buildSpawnEnv with platform override", () => {
  it("on win32: adds System32 to PATH even when inherited PATH is empty", () => {
    const resolver = new ToolResolver({});
    const env = resolver.buildSpawnEnv(
      { PATH: "", SYSTEMROOT: "C:\\Windows" },
      { platform: "win32", exists: () => true },
    );
    expect(env.PATH).toContain("C:\\Windows\\System32");
    expect(env.PATH).toContain("C:\\Windows\\System32\\WindowsPowerShell\\v1.0");
  });

  it("on win32: does not duplicate System32 when already present", () => {
    const resolver = new ToolResolver({});
    const env = resolver.buildSpawnEnv(
      { PATH: "C:\\Windows\\System32;C:\\other", SYSTEMROOT: "C:\\Windows" },
      { platform: "win32", exists: () => true },
    );
    // Count substring occurrences (case-insensitive) — the invariant for
    // de-dup. (buildSpawnEnv now joins win32 prepends with `;` even on a
    // POSIX host; see change: fix-windows-path-env-key-casing.)
    const lower = (env.PATH ?? "").toLowerCase();
    const re = /c:\\windows\\system32(?![\\\w])/g;
    const matches = lower.match(re) ?? [];
    expect(matches.length).toBe(1);
  });

  it("on linux: does not inject Windows paths", () => {
    const resolver = new ToolResolver({});
    const env = resolver.buildSpawnEnv(
      { PATH: "/usr/bin" },
      { platform: "linux", exists: () => true },
    );
    expect(env.PATH).not.toContain("System32");
    expect(env.PATH).not.toContain("C:\\Windows");
  });

  it("on darwin: does not inject Windows paths", () => {
    const resolver = new ToolResolver({});
    const env = resolver.buildSpawnEnv(
      { PATH: "/usr/local/bin:/usr/bin" },
      { platform: "darwin", exists: () => true },
    );
    expect(env.PATH).not.toContain("System32");
  });
});

describe("ToolResolver.buildSpawnEnv PATH key casing (#720)", () => {
  const pathKeys = (env: NodeJS.ProcessEnv) => Object.keys(env).filter((k) => k.toUpperCase() === "PATH");

  it("E13: on win32 a Path-keyed env yields a single PATH keeping the inherited entries", () => {
    const resolver = new ToolResolver({});
    const env = resolver.buildSpawnEnv(
      { Path: "C:\\Program Files\\Git\\cmd;C:\\Windows\\System32", SYSTEMROOT: "C:\\Windows" },
      { platform: "win32", exists: () => true },
    );
    expect(pathKeys(env)).toEqual(["PATH"]);
    const entries = (env.PATH ?? "").split(";");
    expect(entries).toContain("C:\\Program Files\\Git\\cmd");
    expect(entries).toContain("C:\\Windows\\System32");
    const managedIdx = entries.indexOf(MANAGED_BIN);
    expect(managedIdx).toBeGreaterThanOrEqual(0);
    expect(managedIdx).toBeLessThan(entries.indexOf("C:\\Program Files\\Git\\cmd"));
    // No host `:`-joined prepend blob: a `:` may only appear as a drive letter.
    for (const entry of entries) expect(entry.indexOf(":", 2)).toBe(-1);
  });

  it("E14: on darwin a stray Path key is untouched and PATH is :-joined", () => {
    const resolver = new ToolResolver({});
    const env = resolver.buildSpawnEnv(
      { PATH: "/usr/bin", Path: "/opt/x" },
      { platform: "darwin", exists: () => true },
    );
    expect(env.Path).toBe("/opt/x");
    expect(env.PATH?.startsWith(`${MANAGED_BIN}:`)).toBe(true);
    expect(env.PATH?.endsWith(":/usr/bin")).toBe(true);
  });
});
