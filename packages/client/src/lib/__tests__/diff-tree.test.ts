import type { FileDiffEntry } from "@blackbelt-technology/pi-dashboard-shared/diff-types.js";
import { describe, expect, it } from "vitest";
import { buildFileTree, OUTSIDE_WORKSPACE_PATH } from "../git/diff-tree.js";

function makeFile(path: string): FileDiffEntry {
  return { path, changes: [{ type: "write", timestamp: 1000 }] };
}
function makeOutOfCwd(path: string): FileDiffEntry {
  return { path, changes: [{ type: "write", timestamp: 1000 }], previewable: false };
}

describe("buildFileTree", () => {
  it("should return empty array for empty input", () => {
    expect(buildFileTree([])).toEqual([]);
  });

  it("should create flat file nodes for root-level files", () => {
    const tree = buildFileTree([makeFile("foo.ts"), makeFile("bar.ts")]);
    expect(tree).toHaveLength(2);
    expect(tree[0].name).toBe("bar.ts");
    expect(tree[1].name).toBe("foo.ts");
    expect(tree.every((n) => !n.isDir)).toBe(true);
  });

  it("should group files under directory nodes", () => {
    const tree = buildFileTree([makeFile("src/a.ts"), makeFile("src/b.ts")]);
    expect(tree).toHaveLength(1);
    expect(tree[0].isDir).toBe(true);
    expect(tree[0].name).toBe("src");
    expect(tree[0].children).toHaveLength(2);
  });

  it("should sort directories before files", () => {
    const tree = buildFileTree([makeFile("z.ts"), makeFile("src/a.ts")]);
    expect(tree[0].isDir).toBe(true);
    expect(tree[0].name).toBe("src");
    expect(tree[1].name).toBe("z.ts");
  });

  it("should collapse single-child directory chains", () => {
    const tree = buildFileTree([makeFile("src/server/foo.ts")]);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("src/server");
    expect(tree[0].isDir).toBe(true);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].name).toBe("foo.ts");
  });

  it("should not collapse when directory has multiple children", () => {
    const tree = buildFileTree([
      makeFile("src/a.ts"),
      makeFile("src/b.ts"),
    ]);
    expect(tree[0].name).toBe("src");
    expect(tree[0].children).toHaveLength(2);
  });

  it("should handle deeply nested paths", () => {
    const tree = buildFileTree([makeFile("a/b/c/d.ts")]);
    expect(tree[0].name).toBe("a/b/c");
    expect(tree[0].children[0].name).toBe("d.ts");
  });

  it("should attach file entry to leaf nodes", () => {
    const file = makeFile("foo.ts");
    const tree = buildFileTree([file]);
    expect(tree[0].file).toBe(file);
  });

  // opt-in-out-of-cwd-session-diffs (F4): an absolute out-of-cwd key must NOT
  // corrupt the relative tree with a blank-root node; it goes in its own group.
  it("F4 — out-of-cwd (previewable:false) entries group under 'outside workspace', no blank-root", () => {
    const tree = buildFileTree([makeOutOfCwd("/tmp/mockup/index.html"), makeFile("src/a.ts")]);
    // No blank-root node from splitting the absolute path.
    expect(tree.some((n) => n.name === "" || n.path === "")).toBe(false);
    const group = tree.find((n) => n.path === OUTSIDE_WORKSPACE_PATH);
    expect(group).toBeDefined();
    expect(group!.name).toBe("outside workspace");
    expect(group!.isDir).toBe(true);
    expect(group!.children).toHaveLength(1);
    expect(group!.children[0].name).toBe("index.html");
    expect(group!.children[0].path).toBe("/tmp/mockup/index.html");
    // The in-cwd file still forms the normal relative tree.
    expect(tree.some((n) => n.name === "src" || n.name === "src/a.ts")).toBe(true);
  });

  it("omits the 'outside workspace' group when there are no out-of-cwd entries", () => {
    const tree = buildFileTree([makeFile("src/a.ts")]);
    expect(tree.some((n) => n.path === OUTSIDE_WORKSPACE_PATH)).toBe(false);
  });
});
