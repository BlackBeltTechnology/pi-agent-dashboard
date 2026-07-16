import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  editorPaneReducer,
  EMPTY_PANE_STATE,
  loadEditorPaneState,
  saveEditorPaneState,
  useEditorPaneState,
  EDITOR_PANE_KEY_PREFIX,
  type EditorPaneState,
} from "../editor-pane-state.js";

const tab = (path: string, addedAt = 1): EditorPaneState["openFiles"][number] => ({
  path,
  viewer: "monaco",
  addedAt,
});

describe("editorPaneReducer", () => {
  it("openFile appends a tab and activates it", () => {
    const s = editorPaneReducer(EMPTY_PANE_STATE, { type: "openFile", path: "a.ts", viewer: "monaco" });
    expect(s.openFiles.map((f) => f.path)).toEqual(["a.ts"]);
    expect(s.activeIndex).toBe(0);
  });

  it("openFile is idempotent — activates existing tab, no duplicate", () => {
    const base: EditorPaneState = { openFiles: [tab("a.ts"), tab("b.ts")], activeIndex: 1, treeOpenRoots: [] };
    const s = editorPaneReducer(base, { type: "openFile", path: "a.ts", viewer: "monaco" });
    expect(s.openFiles).toHaveLength(2);
    expect(s.activeIndex).toBe(0);
  });

  it("a diff tab and a monaco tab for the same file coexist (virtual path)", () => {
    // change: add-change-summary-table — `diff:<path>` never collides with the
    // monaco tab of the same real file (dedup is by full path).
    let s = editorPaneReducer(EMPTY_PANE_STATE, { type: "openFile", path: "src/a.ts", viewer: "monaco" });
    s = editorPaneReducer(s, { type: "openFile", path: "diff:src/a.ts", viewer: "diff" });
    expect(s.openFiles.map((f) => f.path)).toEqual(["src/a.ts", "diff:src/a.ts"]);
    expect(s.openFiles.map((f) => f.viewer)).toEqual(["monaco", "diff"]);
  });

  it("openFile expands the ancestor dir chain (#5)", () => {
    const s = editorPaneReducer(EMPTY_PANE_STATE, {
      type: "openFile",
      path: "src/components/deep/Widget.tsx",
      viewer: "monaco",
    });
    expect(s.treeOpenRoots).toEqual(["src", "src/components", "src/components/deep"]);
  });

  it("openFile merges ancestors without duplicating already-open roots", () => {
    const base: EditorPaneState = { openFiles: [], activeIndex: -1, treeOpenRoots: ["src"] };
    const s = editorPaneReducer(base, { type: "openFile", path: "src/a/b.ts", viewer: "monaco" });
    expect(s.treeOpenRoots).toEqual(["src", "src/a"]);
  });

  it("setActive expands the ancestors of the newly active tab (#5)", () => {
    const base: EditorPaneState = {
      openFiles: [tab("a.ts"), tab("x/y/z.md")],
      activeIndex: 0,
      treeOpenRoots: [],
    };
    const s = editorPaneReducer(base, { type: "setActive", index: 1 });
    expect(s.activeIndex).toBe(1);
    expect(s.treeOpenRoots).toEqual(["x", "x/y"]);
  });

  it("closeTab on active middle tab activates the adjacent (next) tab", () => {
    const base: EditorPaneState = {
      openFiles: [tab("a.ts"), tab("b.ts"), tab("c.ts")],
      activeIndex: 1,
      treeOpenRoots: [],
    };
    const s = editorPaneReducer(base, { type: "closeTab", index: 1 });
    expect(s.openFiles.map((f) => f.path)).toEqual(["a.ts", "c.ts"]);
    expect(s.openFiles[s.activeIndex].path).toBe("c.ts");
  });

  it("closeTab before active shifts the active pointer left", () => {
    const base: EditorPaneState = {
      openFiles: [tab("a.ts"), tab("b.ts"), tab("c.ts")],
      activeIndex: 2,
      treeOpenRoots: [],
    };
    const s = editorPaneReducer(base, { type: "closeTab", index: 0 });
    expect(s.openFiles[s.activeIndex].path).toBe("c.ts");
  });

  it("closeTab on the last remaining tab yields empty state (activeIndex -1)", () => {
    const base: EditorPaneState = { openFiles: [tab("a.ts")], activeIndex: 0, treeOpenRoots: [] };
    const s = editorPaneReducer(base, { type: "closeTab", index: 0 });
    expect(s.openFiles).toEqual([]);
    expect(s.activeIndex).toBe(-1);
  });

  it("closeByPath closes the tab addressed by its full path", () => {
    const base: EditorPaneState = {
      openFiles: [tab("a.ts"), { path: "term:t1", viewer: "terminal", addedAt: 2 }, tab("c.ts", 3)],
      activeIndex: 2,
      treeOpenRoots: [],
    };
    const s = editorPaneReducer(base, { type: "closeByPath", path: "term:t1" });
    expect(s.openFiles.map((f) => f.path)).toEqual(["a.ts", "c.ts"]);
    // Active pointer shifts left (a tab before the active one was removed).
    expect(s.openFiles[s.activeIndex].path).toBe("c.ts");
  });

  it("closeByPath is a no-op for an absent path", () => {
    const base: EditorPaneState = { openFiles: [tab("a.ts")], activeIndex: 0, treeOpenRoots: [] };
    expect(editorPaneReducer(base, { type: "closeByPath", path: "term:gone" })).toBe(base);
  });

  it("setActive clamps to valid range", () => {
    const base: EditorPaneState = { openFiles: [tab("a.ts")], activeIndex: 0, treeOpenRoots: [] };
    expect(editorPaneReducer(base, { type: "setActive", index: 5 })).toBe(base);
    expect(editorPaneReducer(base, { type: "setActive", index: 0 }).activeIndex).toBe(0);
  });

  it("toggleTreeRoot adds then removes a directory", () => {
    const added = editorPaneReducer(EMPTY_PANE_STATE, { type: "toggleTreeRoot", relPath: "src" });
    expect(added.treeOpenRoots).toEqual(["src"]);
    const removed = editorPaneReducer(added, { type: "toggleTreeRoot", relPath: "src" });
    expect(removed.treeOpenRoots).toEqual([]);
  });

  it("reorderTabs moves a tab and preserves the active file identity", () => {
    const base: EditorPaneState = {
      openFiles: [tab("a.ts"), tab("b.ts"), tab("c.ts")],
      activeIndex: 0,
      treeOpenRoots: [],
    };
    const s = editorPaneReducer(base, { type: "reorderTabs", from: 0, to: 2 });
    expect(s.openFiles.map((f) => f.path)).toEqual(["b.ts", "c.ts", "a.ts"]);
    expect(s.openFiles[s.activeIndex].path).toBe("a.ts");
  });
});

describe("persistence", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips through localStorage", () => {
    const state: EditorPaneState = { openFiles: [tab("a.ts")], activeIndex: 0, treeOpenRoots: ["src"] };
    saveEditorPaneState("sess1", state);
    expect(loadEditorPaneState("sess1")).toEqual(state);
  });

  it("returns empty state when nothing is stored", () => {
    expect(loadEditorPaneState("absent")).toEqual(EMPTY_PANE_STATE);
  });

  it("recovers from corrupt JSON without throwing", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem(`${EDITOR_PANE_KEY_PREFIX}bad`, "{not json");
    expect(loadEditorPaneState("bad")).toEqual(EMPTY_PANE_STATE);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("discards structurally-invalid state", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem(`${EDITOR_PANE_KEY_PREFIX}weird`, JSON.stringify({ openFiles: "nope" }));
    expect(loadEditorPaneState("weird")).toEqual(EMPTY_PANE_STATE);
    spy.mockRestore();
  });

  it("retains a persisted terminal tab across reload (VALID_VIEWERS includes terminal)", () => {
    // change: terminals-in-tabbed-panes — `term:<id>` tabs must survive reload
    // (reconcile against live terminals happens after load, not at validation).
    const state: EditorPaneState = {
      openFiles: [{ path: "term:abc123", viewer: "terminal", addedAt: 1 }],
      activeIndex: 0,
      treeOpenRoots: [],
    };
    saveEditorPaneState("termsess", state);
    expect(loadEditorPaneState("termsess")).toEqual(state);
  });

  it("retains a persisted diff tab across reload (VALID_VIEWERS includes diff)", () => {
    // change: add-change-summary-table — diff tabs must survive reload.
    const state: EditorPaneState = {
      openFiles: [{ path: "diff:src/a.ts", viewer: "diff", addedAt: 1 }],
      activeIndex: 0,
      treeOpenRoots: [],
    };
    saveEditorPaneState("diffsess", state);
    expect(loadEditorPaneState("diffsess")).toEqual(state);
  });
});

describe("useEditorPaneState", () => {
  beforeEach(() => localStorage.clear());

  it("persists dispatched changes and reloads them", () => {
    const { result, unmount } = renderHook(() => useEditorPaneState("sX"));
    act(() => result.current[1]({ type: "openFile", path: "a.ts", viewer: "monaco" }));
    expect(result.current[0].openFiles.map((f) => f.path)).toEqual(["a.ts"]);
    unmount();

    const reopened = renderHook(() => useEditorPaneState("sX"));
    expect(reopened.result.current[0].openFiles.map((f) => f.path)).toEqual(["a.ts"]);
  });

  it("loads distinct state per session id", () => {
    saveEditorPaneState("sA", { openFiles: [tab("a.ts")], activeIndex: 0, treeOpenRoots: [] });
    saveEditorPaneState("sB", { openFiles: [tab("b.ts")], activeIndex: 0, treeOpenRoots: [] });
    const { result, rerender } = renderHook(({ id }) => useEditorPaneState(id), {
      initialProps: { id: "sA" },
    });
    expect(result.current[0].openFiles[0].path).toBe("a.ts");
    rerender({ id: "sB" });
    expect(result.current[0].openFiles[0].path).toBe("b.ts");
  });
});
