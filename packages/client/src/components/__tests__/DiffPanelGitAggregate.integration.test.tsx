/**
 * Integration guard for the empty-diff regression, using the REAL
 * @git-diff-view/core (no mock). The mocked DiffPanel tests never exercise the
 * library's line reconstruction, so they cannot catch that a bare-hunk payload
 * yields zero lines. This test builds the two candidate Path B payloads and
 * asserts only the header-bearing whole-diff produces renderable lines.
 * See change: fix-empty-git-aggregate-diff-tab.
 */

import { DiffFile } from "@git-diff-view/core";
import { describe, expect, it } from "vitest";

// A complete unified diff as the server emits it (git diff HEAD -- <path>),
// header included.
const GIT_DIFF = [
  "diff --git a/src/acc.ts b/src/acc.ts",
  "index 1111111..2222222 100644",
  "--- a/src/acc.ts",
  "+++ b/src/acc.ts",
  "@@ -18,7 +18,7 @@ export function accumulate(canvas) {",
  " export function accumulate(canvas, delta) {",
  "   const next = { ...canvas };",
  "-  next.nodes = delta.nodes;",
  "+  next.nodes = mergeNodes(canvas.nodes, delta.nodes);",
  "   next.revision = canvas.revision + 1;",
  " }",
].join("\n");

// The header-stripped hunk body — what extractHunks produced (the BUG payload).
const BARE_HUNK = [
  "@@ -18,7 +18,7 @@ export function accumulate(canvas) {",
  " export function accumulate(canvas, delta) {",
  "   const next = { ...canvas };",
  "-  next.nodes = delta.nodes;",
  "+  next.nodes = mergeNodes(canvas.nodes, delta.nodes);",
  "   next.revision = canvas.revision + 1;",
  " }",
].join("\n");

function unifiedLines(hunks: string[]): number {
  const df = new DiffFile("src/acc.ts", "", "src/acc.ts", "", hunks, "typescript", "typescript");
  df.init();
  df.buildUnifiedDiffLines();
  return df.unifiedLineLength;
}

describe("Path B payload reconstruction (real @git-diff-view/core)", () => {
  it("the header-bearing whole diff yields > 0 unified lines", () => {
    expect(unifiedLines([GIT_DIFF])).toBeGreaterThan(0);
  });

  it("the header-stripped bare hunk yields 0 unified lines (the regression)", () => {
    expect(unifiedLines([BARE_HUNK])).toBe(0);
  });
});
