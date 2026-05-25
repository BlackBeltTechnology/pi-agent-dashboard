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
    // Count substring occurrences (case-insensitive). buildSpawnEnv may
    // splice POSIX `:` delimiters on a darwin host into the prepended
    // segment, so splitting by `;` is unreliable; substring count is the
    // right invariant for de-dup.
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
