/**
 * Tests for client-side cwd normalization
 * (change: fix-session-diff-open-nongit-and-preview).
 * Pins the abs↔rel rule agreement with the server's `normalizePath`.
 */
import { describe, expect, it } from "vitest";
import { isOutOfCwd, normalizeUnderCwd } from "../util/normalize-path.js";

describe("normalizeUnderCwd", () => {
  const cwd = "/Users/me/proj";

  it("rewrites an absolute-under-cwd path to relative-posix", () => {
    expect(normalizeUnderCwd("/Users/me/proj/src/a.ts", cwd)).toBe("src/a.ts");
    expect(normalizeUnderCwd("/Users/me/proj/openspec/changes/x/proposal.md", cwd)).toBe(
      "openspec/changes/x/proposal.md",
    );
  });

  it("tolerates a trailing slash on cwd", () => {
    expect(normalizeUnderCwd("/Users/me/proj/src/a.ts", "/Users/me/proj/")).toBe("src/a.ts");
  });

  it("leaves an already-relative path unchanged", () => {
    expect(normalizeUnderCwd("src/a.ts", cwd)).toBe("src/a.ts");
    expect(normalizeUnderCwd("./src/a.ts", cwd)).toBe("./src/a.ts");
  });

  it("leaves an absolute-outside-cwd path unchanged", () => {
    expect(normalizeUnderCwd("/etc/hosts", cwd)).toBe("/etc/hosts");
    expect(normalizeUnderCwd("/Users/me/other/a.ts", cwd)).toBe("/Users/me/other/a.ts");
  });

  it("does not treat a sibling with a shared prefix as under cwd", () => {
    expect(normalizeUnderCwd("/Users/me/proj-2/a.ts", cwd)).toBe("/Users/me/proj-2/a.ts");
  });

  it("normalizes Windows separators under a Windows cwd", () => {
    expect(normalizeUnderCwd("C:\\Users\\me\\proj\\src\\a.ts", "C:\\Users\\me\\proj")).toBe(
      "src/a.ts",
    );
  });

  it("treats a backslash-rooted / UNC path as absolute", () => {
    // Under a drive-letter cwd a UNC path is outside cwd → unchanged (not
    // mistaken for a relative path and left un-normalized elsewhere).
    expect(normalizeUnderCwd("\\\\server\\share\\a.ts", "C:\\Users\\me\\proj")).toBe(
      "\\\\server\\share\\a.ts",
    );
    // A `\`-rooted path under a matching `\`-rooted cwd normalizes.
    expect(normalizeUnderCwd("\\proj\\src\\a.ts", "\\proj")).toBe("src/a.ts");
  });

  it("returns the raw path when cwd is missing", () => {
    expect(normalizeUnderCwd("/Users/me/proj/src/a.ts", undefined)).toBe(
      "/Users/me/proj/src/a.ts",
    );
  });
});

// opt-in-out-of-cwd-session-diffs: out-of-cwd = absolute AND not under cwd.
describe("isOutOfCwd", () => {
  it("is false for a relative in-cwd path", () => {
    expect(isOutOfCwd("src/a.ts", "/repo")).toBe(false);
  });
  it("is false for an absolute-under-cwd path", () => {
    expect(isOutOfCwd("/repo/src/a.ts", "/repo")).toBe(false);
  });
  it("is true for an absolute path outside cwd", () => {
    expect(isOutOfCwd("/tmp/mockup/index.html", "/repo")).toBe(true);
  });
  it("is true for a sibling-escape path", () => {
    expect(isOutOfCwd("/repo-backup/x.ts", "/repo")).toBe(true);
  });
  it("treats an absolute path as out-of-cwd when cwd is undefined", () => {
    // Undefined cwd cannot confine an absolute path → out-of-cwd.
    expect(isOutOfCwd("/repo/src/a.ts", undefined)).toBe(true);
  });
});
