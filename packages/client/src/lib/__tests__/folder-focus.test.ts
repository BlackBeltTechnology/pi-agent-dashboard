/**
 * Accordion helpers. Scenarios: test-plan #E9 (render-mode table), #E10
 * (attention predicate), #E11 (active-folder derivation).
 * See change: add-focus-mode-and-card-block-toggles.
 */
import { describe, expect, it } from "vitest";
import { demandsAttention, type GroupRenderMode, resolveActiveCwd, resolveGroupRenderMode } from "../folder-focus.js";

describe("demandsAttention (#E10)", () => {
  const s = (over: object) => ({ status: "idle", currentTool: null, unread: false, ...over }) as never;
  it.each([
    ["ask_user", { currentTool: "ask_user" }, true],
    ["streaming", { status: "streaming" }, true],
    ["active", { status: "active" }, true],
    ["unread", { unread: true }, true],
    ["idle + read", {}, false],
    ["ended + read", { status: "ended" }, false],
    ["ended + unread", { status: "ended", unread: true }, true],
  ])("%s → %s", (_n, over, expected) => {
    expect(demandsAttention(s(over))).toBe(expected);
  });
});

describe("resolveGroupRenderMode (#E9) — all 16 combinations", () => {
  const modes: GroupRenderMode[] = [];
  for (const focused of [true, false]) {
    for (const collapsed of [true, false]) {
      for (const pinnedOpen of [true, false]) {
        for (const hasAttention of [true, false]) {
          it(`focused=${focused} collapsed=${collapsed} pinned=${pinnedOpen} attention=${hasAttention}`, () => {
            const m = resolveGroupRenderMode({ focused, collapsed, pinnedOpen, hasAttention });
            modes.push(m);
            let expected: GroupRenderMode;
            if (pinnedOpen) expected = "full";
            else if (focused) expected = collapsed ? "collapsed" : "full";
            else expected = hasAttention ? "compactAttention" : "compactEmpty";
            expect(m).toBe(expected);
          });
        }
      }
    }
  }
  it("search/workspace filter forces full", () => {
    expect(resolveGroupRenderMode({ focused: false, collapsed: true, pinnedOpen: false, hasAttention: false, forceFull: true })).toBe("full");
  });
  it("peek off + attention → compactEmpty (caller passes hasAttention=false)", () => {
    expect(resolveGroupRenderMode({ focused: false, collapsed: false, pinnedOpen: false, hasAttention: false })).toBe("compactEmpty");
  });
});

describe("resolveActiveCwd (#E11) — latest intent wins", () => {
  const all = () => true;
  it("select → activate → select again", () => {
    expect(resolveActiveCwd({ selectedCwd: "/repo", activatedCwd: null, lastIntent: "select", isRendered: all })).toBe("/repo");
    expect(resolveActiveCwd({ selectedCwd: "/repo", activatedCwd: "/bar", lastIntent: "activate", isRendered: all })).toBe("/bar");
    expect(resolveActiveCwd({ selectedCwd: "/repo", activatedCwd: "/bar", lastIntent: "select", isRendered: all })).toBe("/repo");
  });
  it("activation with nothing selected focuses the folder", () => {
    expect(resolveActiveCwd({ selectedCwd: null, activatedCwd: "/bar", lastIntent: "activate", isRendered: all })).toBe("/bar");
  });
  it("neither → null", () => {
    expect(resolveActiveCwd({ selectedCwd: null, activatedCwd: null, lastIntent: null, isRendered: all })).toBeNull();
  });
  it("an activated folder that no longer renders is cleared", () => {
    expect(resolveActiveCwd({ selectedCwd: null, activatedCwd: "/bar", lastIntent: "activate", isRendered: (c) => c !== "/bar" })).toBeNull();
    expect(resolveActiveCwd({ selectedCwd: "/repo", activatedCwd: "/bar", lastIntent: "activate", isRendered: (c) => c !== "/bar" })).toBe("/repo");
  });
});
