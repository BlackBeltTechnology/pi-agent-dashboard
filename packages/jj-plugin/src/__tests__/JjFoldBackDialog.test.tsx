/**
 * Tests for the buildFoldBackPrompt pure helper. Component-level tests
 * are covered by JjActionBar.test.tsx (dialog open/close).
 *
 * See change: add-jj-workspace-plugin.
 */
import { describe, it, expect } from "vitest";
import { buildFoldBackPrompt } from "../client/JjFoldBackDialog.js";

describe("buildFoldBackPrompt", () => {
  it("includes the workspace name in backticks", () => {
    const out = buildFoldBackPrompt("agent-1", "preserve");
    expect(out).toContain("`agent-1`");
  });

  it("preserve mode mentions default flavor", () => {
    expect(buildFoldBackPrompt("ws", "preserve")).toContain("default flavor");
  });

  it("squash mode mentions `mode: squash`", () => {
    expect(buildFoldBackPrompt("ws", "squash")).toContain("mode: squash");
  });

  it("pr mode mentions GitHub PR", () => {
    expect(buildFoldBackPrompt("ws", "pr")).toContain("GitHub PR");
  });

  it("always includes the precondition reminder", () => {
    for (const mode of ["preserve", "squash", "pr"] as const) {
      expect(buildFoldBackPrompt("ws", mode)).toContain("precondition");
    }
  });

  it("always includes the workspace-name-verbatim bookmark rule", () => {
    expect(buildFoldBackPrompt("ws", "preserve")).toContain("verbatim");
  });
});
