/**
 * Key canonicalization tests (test-plan E6–E9) for change:
 * persist-folder-collapse-server-side.
 *
 * `pathKey` is the single canonicalization authority for folder identity. The
 * collapse store, the client render lookup and the reveal path all compare
 * through it, so a folder reached by a worktree main path, a pin string, or a
 * session cwd resolves to one key. These tests pin the rule itself — in
 * particular that case folding is Windows-only, which is the regression guard
 * against a server that reaches for `process.platform`.
 */
import { describe, expect, it } from "vitest";
import { inferPlatform, pathKey } from "../session-group-path.js";

describe("pathKey canonicalization", () => {
  it("E6: a trailing separator collapses to one key", () => {
    const platform = inferPlatform(["/repo/a"]);
    expect(pathKey("/repo/a/", platform)).toBe(pathKey("/repo/a", platform));
  });

  it("E7: win32 drive-letter case and separator style collapse to one key", () => {
    const platform = inferPlatform(["C:\\repo\\a"]);
    expect(platform).toBe("win32");
    expect(pathKey("c:/repo/a", platform)).toBe(pathKey("C:\\repo\\a", platform));
  });

  it("E8: POSIX case is significant — no case folding (guards `process.platform`)", () => {
    const platform = inferPlatform(["/repo/a"]);
    // `inferPlatform` returns `linux` for any POSIX path, on every host OS, so
    // both sides agree and case is preserved. A `process.platform` server would
    // fold case on macOS and silently diverge from the client.
    expect(platform).toBe("linux");
    expect(pathKey("/repo/A", platform)).not.toBe(pathKey("/repo/a", platform));
  });

  it("E9: expanding under another spelling reuses the single stored key", () => {
    const platform = inferPlatform(["/repo/a"]);
    const stored = new Set([pathKey("/repo/a", platform)]);
    const expandKey = pathKey("/repo/a/", platform);
    expect(stored.has(expandKey)).toBe(true);
    stored.delete(expandKey);
    expect(stored.size).toBe(0);
  });

  it("client and server agree: a POSIX sample infers `linux` regardless of host", () => {
    expect(inferPlatform(["/Users/robson/Project"])).toBe("linux");
  });
});
