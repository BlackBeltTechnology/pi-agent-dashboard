import { describe, it, expect } from "vitest";
import { resolveLinkOrigin, stripWorktreeSegment } from "../util/link-origin.js";

describe("stripWorktreeSegment", () => {
  it("derives parent root from a worktree cwd", () => {
    expect(stripWorktreeSegment("/repo/.worktrees/x")).toBe("/repo");
  });

  it("tolerates a trailing slash", () => {
    expect(stripWorktreeSegment("/repo/.worktrees/x/")).toBe("/repo");
  });

  it("returns undefined for a non-worktree cwd", () => {
    expect(stripWorktreeSegment("/repo")).toBeUndefined();
    expect(stripWorktreeSegment("/repo/packages/server")).toBeUndefined();
  });

  it("handles Windows separators and drive-letter case", () => {
    expect(stripWorktreeSegment("C:\\repo\\.worktrees\\x")).toBe("c:/repo");
  });
});

describe("resolveLinkOrigin — absolute tokens", () => {
  const wt = "/repo/.worktrees/x";

  it("re-roots a parent-checkout path onto the worktree", () => {
    expect(resolveLinkOrigin(wt, "/repo/node_modules/vitest/package.json", true)).toBe(
      "/repo/.worktrees/x/node_modules/vitest/package.json",
    );
  });

  it("leaves a path already under the worktree unchanged (no double-root)", () => {
    expect(resolveLinkOrigin(wt, "/repo/.worktrees/x/src/foo.ts", true)).toBe(
      "/repo/.worktrees/x/src/foo.ts",
    );
  });

  it("leaves a foreign absolute path verbatim", () => {
    expect(resolveLinkOrigin(wt, "/etc/hosts", true)).toBe("/etc/hosts");
  });

  it("does not match a sibling dir sharing the parent-root prefix", () => {
    expect(resolveLinkOrigin(wt, "/repobar/y.ts", true)).toBe("/repobar/y.ts");
  });

  it("leaves absolute paths unchanged for a non-worktree cwd", () => {
    expect(resolveLinkOrigin("/repo", "/repo/node_modules/vitest/package.json", true)).toBe(
      "/repo/node_modules/vitest/package.json",
    );
  });

  it("re-roots Windows drive paths (separator + drive-case tolerant)", () => {
    expect(resolveLinkOrigin("C:\\repo\\.worktrees\\x", "c:\\repo\\vitest.config.ts", true)).toBe(
      "c:/repo/.worktrees/x/vitest.config.ts",
    );
  });
});

describe("resolveLinkOrigin — relative tokens resolve against cwd", () => {
  it("joins a bare relative path to the worktree cwd", () => {
    expect(resolveLinkOrigin("/repo/.worktrees/x", "node_modules/vitest/package.json", false)).toBe(
      "/repo/.worktrees/x/node_modules/vitest/package.json",
    );
  });

  it("collapses ../ against cwd", () => {
    expect(resolveLinkOrigin("/repo/.worktrees/x/src", "../foo.ts", false)).toBe(
      "/repo/.worktrees/x/foo.ts",
    );
  });

  it("returns the path unchanged when cwd is absent", () => {
    expect(resolveLinkOrigin(undefined, "src/foo.ts", false)).toBe("src/foo.ts");
  });
});
