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

// fix-file-link-editor-routing S12: `normalizeUnderCwd` boundary — a cwd-relative tab only for a true subtree.
describe("normalizeUnderCwd — cwd boundary (S12)", () => {
  const cwd = "/work/repo";

  it("maps an in-cwd absolute path to its relative-posix tab path", () => {
    expect(normalizeUnderCwd("/work/repo/a.md", cwd)).toBe("a.md");
  });

  it("does not collide on a shared prefix (`/work/repo2` is outside `/work/repo`)", () => {
    expect(normalizeUnderCwd("/work/repo2/a.md", cwd)).toBe("/work/repo2/a.md");
  });

  it("maps the cwd itself to the empty tab path without crashing", () => {
    expect(normalizeUnderCwd("/work/repo", cwd)).toBe("");
  });
});

// fix-file-link-editor-routing S13 / G6: only the Windows drive LETTER compares case-insensitively.
describe("normalizeUnderCwd — Windows drive links (S13)", () => {
  const cwd = "C:/Work/repo";

  it("a backslash link under the cwd → relative tab", () => {
    expect(normalizeUnderCwd("C:\\Work\\repo\\a.md", cwd)).toBe("a.md");
  });

  it("another drive stays an absolute tab, verbatim", () => {
    expect(normalizeUnderCwd("D:\\x\\y.md", cwd)).toBe("D:\\x\\y.md");
  });

  it("a lower-case drive letter still maps to the cwd-relative tab (no duplicate absolute tab)", () => {
    expect(normalizeUnderCwd("c:/Work/repo/a.md", cwd)).toBe("a.md");
  });

  it("path-case differences beyond the drive letter stay absolute", () => {
    expect(normalizeUnderCwd("C:/Work/Repo/a.md", cwd)).toBe("C:/Work/Repo/a.md");
  });

  it("a lower-case drive in the cwd matches an upper-case drive in the link", () => {
    expect(normalizeUnderCwd("C:/Work/repo/a.md", "c:/Work/repo")).toBe("a.md");
  });
});
