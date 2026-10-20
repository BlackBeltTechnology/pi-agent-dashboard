/**
 * Pure selection helpers behind the file-manager folder picker.
 * Covers test-plan E1–E7. See change: simplify-add-folder-picker.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { browserIsMacLike } from "../../hooks/useHostPlatform.js";
import { applyRowClick, isAddToSelectionModifier, type SelectionPlatform } from "../selection-modifier.js";

describe("isAddToSelectionModifier (E1)", () => {
  const combos: Array<{ metaKey: boolean; ctrlKey: boolean }> = [
    { metaKey: true, ctrlKey: false },
    { metaKey: false, ctrlKey: true },
    { metaKey: true, ctrlKey: true },
    { metaKey: false, ctrlKey: false },
  ];
  const expected: Record<SelectionPlatform, boolean[]> = {
    // meta, ctrl, both, none
    mac: [true, false, true, false],
    other: [false, true, true, false],
  };
  for (const platform of ["mac", "other"] as const) {
    combos.forEach((e, i) => {
      it(`${platform} meta=${e.metaKey} ctrl=${e.ctrlKey} → ${expected[platform][i]}`, () => {
        expect(isAddToSelectionModifier(e, platform)).toBe(expected[platform][i]);
      });
    });
  }
  it("macOS Control-click alone never toggles (it is the secondary click)", () => {
    expect(isAddToSelectionModifier({ metaKey: false, ctrlKey: true }, "mac")).toBe(false);
  });
});

describe("browserIsMacLike (E2)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (platform: string, maxTouchPoints: number) =>
    vi.stubGlobal("navigator", { platform, maxTouchPoints });

  it("macOS desktop → true", () => {
    stub("MacIntel", 0);
    expect(browserIsMacLike()).toBe(true);
  });
  it("iPadOS (reports MacIntel with touch points) → true", () => {
    stub("MacIntel", 5);
    expect(browserIsMacLike()).toBe(true);
  });
  it("iPhone → true", () => {
    stub("iPhone", 5);
    expect(browserIsMacLike()).toBe(true);
  });
  it("Windows → false", () => {
    stub("Win32", 0);
    expect(browserIsMacLike()).toBe(false);
  });
  it("Linux → false", () => {
    stub("Linux x86_64", 0);
    expect(browserIsMacLike()).toBe(false);
  });
});

describe("applyRowClick", () => {
  const ordered = ["a", "b", "c", "d"];
  const click = (
    prev: { selected: string[]; anchor: string | null },
    path: string,
    mod = false,
    shift = false,
  ) => applyRowClick(prev, { path, ordered, mod, shift });

  it("E3 — shift range forward, on the anchor itself, and to the last row", () => {
    const start = { selected: ["a"], anchor: "a" };
    expect(click(start, "c", false, true)).toEqual({ selected: ["a", "b", "c"], anchor: "a" });
    expect(click(start, "a", false, true)).toEqual({ selected: ["a"], anchor: "a" });
    expect(click(start, "d", false, true)).toEqual({ selected: ["a", "b", "c", "d"], anchor: "a" });
  });

  it("E4 — reverse shift range keeps document order", () => {
    expect(click({ selected: ["c"], anchor: "c" }, "a", false, true)).toEqual({
      selected: ["a", "b", "c"],
      anchor: "c",
    });
  });

  it("E5 — shift with no anchor acts as a plain click and sets the anchor", () => {
    expect(click({ selected: [], anchor: null }, "b", false, true)).toEqual({ selected: ["b"], anchor: "b" });
  });

  it("E5b — shift with a stale anchor not in this listing acts as a plain click", () => {
    expect(click({ selected: [], anchor: "zz" }, "b", false, true)).toEqual({ selected: ["b"], anchor: "b" });
  });

  it("E6 — modifier toggles without touching others; anchor follows", () => {
    const one = click({ selected: ["a"], anchor: "a" }, "c", true);
    expect(one).toEqual({ selected: ["a", "c"], anchor: "c" });
    expect(click(one, "a", true)).toEqual({ selected: ["c"], anchor: "a" });
  });

  it("E7 — plain click replaces the selection", () => {
    expect(click({ selected: ["a", "b"], anchor: "b" }, "d")).toEqual({ selected: ["d"], anchor: "d" });
  });
});
