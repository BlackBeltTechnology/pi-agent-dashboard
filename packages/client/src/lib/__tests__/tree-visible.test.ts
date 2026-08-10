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
} from "../util/tree-visible.js";

describe("tree-visible persistence", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to collapsed when nothing persisted", () => {
    expect(loadTreeVisible("s1")).toBe(false);
  });

  it("round-trips a hidden state", () => {
    saveTreeVisible("s1", false);
    expect(localStorage.getItem(`${TREE_VISIBLE_KEY_PREFIX}s1`)).toBe("false");
    expect(loadTreeVisible("s1")).toBe(false);
  });

  it("a persisted reveal overrides the collapsed default", () => {
    saveTreeVisible("s1", true);
    expect(loadTreeVisible("s1")).toBe(true);
  });

  it("useTreeVisible persists on set and reloads on session change", () => {
    const { result, rerender } = renderHook(({ id }) => useTreeVisible(id), {
      initialProps: { id: "sA" },
    });
    // Fresh session with no persisted preference → collapsed by default.
    expect(result.current[0]).toBe(false);
    // Reveal the rail, verify it persists for this session.
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
    expect(loadTreeVisible("sA")).toBe(true);

    // Switch sessions → distinct (collapsed default) state; back → persisted reveal.
    rerender({ id: "sB" });
    expect(result.current[0]).toBe(false);
    rerender({ id: "sA" });
    expect(result.current[0]).toBe(true);
  });
});
