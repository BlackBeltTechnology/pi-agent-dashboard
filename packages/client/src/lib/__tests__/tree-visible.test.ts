/**
 * Per-session tree-rail visibility persistence (#6).
 * See change: improve-content-editor (tasks §3.3).
 */
import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  loadTreeVisible,
  saveTreeVisible,
  useTreeVisible,
  TREE_VISIBLE_KEY_PREFIX,
} from "../tree-visible.js";

describe("tree-visible persistence", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to visible when nothing persisted", () => {
    expect(loadTreeVisible("s1")).toBe(true);
  });

  it("round-trips a hidden state", () => {
    saveTreeVisible("s1", false);
    expect(localStorage.getItem(`${TREE_VISIBLE_KEY_PREFIX}s1`)).toBe("false");
    expect(loadTreeVisible("s1")).toBe(false);
  });

  it("useTreeVisible persists on set and reloads on session change", () => {
    const { result, rerender } = renderHook(({ id }) => useTreeVisible(id), {
      initialProps: { id: "sA" },
    });
    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    expect(loadTreeVisible("sA")).toBe(false);

    // Switch sessions → distinct (default) state; back → persisted hidden.
    rerender({ id: "sB" });
    expect(result.current[0]).toBe(true);
    rerender({ id: "sA" });
    expect(result.current[0]).toBe(false);
  });
});
