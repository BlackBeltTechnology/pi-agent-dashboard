import { describe, expect, it } from "vitest";
import { enabledMenuItems, nextMenuIndex } from "../menu-keys.js";

describe("menu-keys (scope-anchor-editor-pane-controls D9)", () => {
  it("nextMenuIndex wraps, supports Home/End and ignores other keys", () => {
    expect(nextMenuIndex("ArrowDown", 2, 3)).toBe(0);
    expect(nextMenuIndex("ArrowDown", -1, 3)).toBe(0);
    expect(nextMenuIndex("ArrowUp", 0, 3)).toBe(2);
    expect(nextMenuIndex("ArrowUp", -1, 3)).toBe(2);
    expect(nextMenuIndex("Home", 2, 3)).toBe(0);
    expect(nextMenuIndex("End", 0, 3)).toBe(2);
    expect(nextMenuIndex("a", 0, 3)).toBeNull();
    expect(nextMenuIndex("ArrowDown", 0, 0)).toBeNull();
  });

  it("enabledMenuItems skips disabled and aria-disabled items", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<button role="menuitem" id="a"></button><button role="menuitem" disabled id="b"></button><button role="menuitem" aria-disabled="true" id="c"></button><button role="menuitem" id="d"></button><button id="e"></button>';
    expect(enabledMenuItems(root).map((e) => e.id)).toEqual(["a", "d"]);
    expect(enabledMenuItems(null)).toEqual([]);
  });
});
