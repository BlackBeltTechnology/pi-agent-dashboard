import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EDITOR_PANE_KEY_PREFIX,
  type EditorPaneState,
  type OpenFile,
  EMPTY_PANE_STATE,
  editorPaneReducer,
  loadEditorPaneState,
  saveEditorPaneState,
  useEditorPaneState,
} from "../layout/editor-pane-state.js";

/**
 * A stored blob as `loadEditorPaneState` returns it: tabs written before
 * `autoOpened` existed are seeded from `restrictCsp` (surface-denial-remedy-in-previews).
 */
const seeded = <S extends { openFiles: Array<{ path: string; restrictCsp?: boolean; autoOpened?: boolean }> }>(state: S): S => ({
  ...state,
  openFiles: state.openFiles.map((f) => ({ ...f, autoOpened: f.autoOpened ?? f.restrictCsp === true })),
});

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

describe("openFile activate flag + unread (non-disruptive-file-open)", () => {
  it("E1 activate:false + tab NOT open → pushed, activeIndex unchanged, new tab unread", () => {
    const base: EditorPaneState = { openFiles: [tab("a.ts")], activeIndex: 0, treeOpenRoots: [] };
    const s = editorPaneReducer(base, { type: "openFile", path: "b.ts", viewer: "monaco", activate: false });
    expect(s.openFiles.map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
    expect(s.activeIndex).toBe(0); // unchanged
    expect(s.openFiles[1].unread).toBe(true);
    expect(s.openFiles[0].unread).toBeUndefined();
  });

  it("E2 activate:false + open INACTIVE tab → activeIndex unchanged, that tab unread (re-signal)", () => {
    const base: EditorPaneState = {
      openFiles: [tab("a.ts"), tab("b.ts")],
      activeIndex: 0,
      treeOpenRoots: [],
    };
    const s = editorPaneReducer(base, { type: "openFile", path: "b.ts", viewer: "monaco", activate: false });
    expect(s.openFiles).toHaveLength(2);
    expect(s.activeIndex).toBe(0);
    expect(s.openFiles[1].unread).toBe(true);
    // Re-signal produces a NEW tab object so the pulse effect re-runs.
    expect(s.openFiles[1]).not.toBe(base.openFiles[1]);
  });

  it("E3 activate:false + open ACTIVE tab → no-op, active stays not unread (invariant)", () => {
    const base: EditorPaneState = {
      openFiles: [tab("a.ts"), tab("b.ts")],
      activeIndex: 1,
      treeOpenRoots: [],
    };
    const s = editorPaneReducer(base, { type: "openFile", path: "b.ts", viewer: "monaco", activate: false });
    expect(s.activeIndex).toBe(1);
    expect(s.openFiles[1].unread).toBeUndefined();
  });

  it("E4 activate omitted → tab activated, unread unset (back-compat)", () => {
    const base: EditorPaneState = { openFiles: [tab("a.ts")], activeIndex: 0, treeOpenRoots: [] };
    const s = editorPaneReducer(base, { type: "openFile", path: "b.ts", viewer: "monaco" });
    expect(s.activeIndex).toBe(1);
    expect(s.openFiles[1].unread).toBeUndefined();
  });

  it("foreground open of an existing unread tab clears its unread", () => {
    const base: EditorPaneState = {
      openFiles: [tab("a.ts"), { ...tab("b.ts", 2), unread: true }],
      activeIndex: 0,
      treeOpenRoots: [],
    };
    const s = editorPaneReducer(base, { type: "openFile", path: "b.ts", viewer: "monaco" });
    expect(s.activeIndex).toBe(1);
    expect(s.openFiles[1].unread).toBe(false);
  });

  it("E5 closeTab re-points activeIndex onto an unread adjacent tab → that tab's unread cleared", () => {
    const base: EditorPaneState = {
      openFiles: [tab("a.ts"), { ...tab("b.ts", 2), unread: true }],
      activeIndex: 0,
      treeOpenRoots: [],
    };
    // Close the active tab (a.ts) → activeIndex re-points onto b.ts (unread).
    const s = editorPaneReducer(base, { type: "closeTab", index: 0 });
    expect(s.openFiles.map((f) => f.path)).toEqual(["b.ts"]);
    expect(s.activeIndex).toBe(0);
    expect(s.openFiles[0].unread).toBe(false); // cleared, not only via setActive
  });

  it("setActive clears unread on the newly-active tab", () => {
    const base: EditorPaneState = {
      openFiles: [tab("a.ts"), { ...tab("b.ts", 2), unread: true }],
      activeIndex: 0,
      treeOpenRoots: [],
    };
    const s = editorPaneReducer(base, { type: "setActive", index: 1 });
    expect(s.activeIndex).toBe(1);
    expect(s.openFiles[1].unread).toBe(false);
  });
});

describe("persistence", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips through localStorage", () => {
    const state: EditorPaneState = { openFiles: [tab("a.ts")], activeIndex: 0, treeOpenRoots: ["src"] };
    saveEditorPaneState("sess1", state);
    expect(loadEditorPaneState("sess1")).toEqual(seeded(state));
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
    expect(loadEditorPaneState("termsess")).toEqual(seeded(state));
  });

  it("retains a persisted diff tab across reload (VALID_VIEWERS includes diff)", () => {
    // change: add-change-summary-table — diff tabs must survive reload.
    const state: EditorPaneState = {
      openFiles: [{ path: "diff:src/a.ts", viewer: "diff", addedAt: 1 }],
      activeIndex: 0,
      treeOpenRoots: [],
    };
    saveEditorPaneState("diffsess", state);
    expect(loadEditorPaneState("diffsess")).toEqual(seeded(state));
  });

  it("#E13 drops only the unknown-viewer entry, keeps the rest and the active tab", () => {
    const persisted = {
      openFiles: [
        { path: "a.ts", viewer: "monaco", addedAt: 1 },
        { path: "x:1", viewer: "no-such-viewer", addedAt: 2 },
        { path: "c.md", viewer: "markdown", addedAt: 3 },
      ],
      activeIndex: 2,
      treeOpenRoots: [],
    };
    localStorage.setItem(`${EDITOR_PANE_KEY_PREFIX}mixed`, JSON.stringify(persisted));
    const loaded = loadEditorPaneState("mixed");
    expect(loaded.openFiles.map((f) => f.path)).toEqual(["a.ts", "c.md"]);
    expect(loaded.activeIndex).toBe(1);
    expect(loaded.openFiles[loaded.activeIndex].path).toBe("c.md");
  });

  it("#E13 clamps activeIndex when the active tab was the dropped one", () => {
    const persisted = {
      openFiles: [
        { path: "a.ts", viewer: "monaco", addedAt: 1 },
        { path: "x:1", viewer: "no-such-viewer", addedAt: 2 },
      ],
      activeIndex: 1,
      treeOpenRoots: [],
    };
    localStorage.setItem(`${EDITOR_PANE_KEY_PREFIX}clamp`, JSON.stringify(persisted));
    const loaded = loadEditorPaneState("clamp");
    expect(loaded.openFiles.map((f) => f.path)).toEqual(["a.ts"]);
    expect(loaded.activeIndex).toBe(0);
    localStorage.setItem(
      `${EDITOR_PANE_KEY_PREFIX}allgone`,
      JSON.stringify({ openFiles: [{ path: "x", viewer: "nope", addedAt: 1 }], activeIndex: 0, treeOpenRoots: [] }),
    );
    expect(loadEditorPaneState("allgone")).toEqual({ openFiles: [], activeIndex: -1, treeOpenRoots: [] });
  });

  it("#E13 a persisted docx (and every other known kind) tab no longer resets the pane", () => {
    const kinds = ["docx", "pptx", "spreadsheet", "asciidoc", "email", "diagram"];
    const state: EditorPaneState = {
      openFiles: kinds.map((k, i) => ({ path: `f${i}.${k}`, viewer: k as OpenFile["viewer"], addedAt: i })),
      activeIndex: 0,
      treeOpenRoots: [],
    };
    saveEditorPaneState("docxsess", state);
    expect(loadEditorPaneState("docxsess")).toEqual(seeded(state));
  });

  it("#E14 structural faults still reset the whole state", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem(
      `${EDITOR_PANE_KEY_PREFIX}noroots`,
      JSON.stringify({ openFiles: [{ path: "a.ts", viewer: "monaco", addedAt: 1 }], activeIndex: 0 }),
    );
    expect(loadEditorPaneState("noroots")).toEqual(EMPTY_PANE_STATE);
    spy.mockRestore();
  });

  it("E6 persisted blob without `unread` loads valid (back-compat)", () => {
    // Blob written before non-disruptive-file-open has no `unread` field.
    const legacy = {
      openFiles: [{ path: "a.ts", viewer: "monaco", addedAt: 1 }],
      activeIndex: 0,
      treeOpenRoots: [],
    };
    localStorage.setItem(`${EDITOR_PANE_KEY_PREFIX}legacy`, JSON.stringify(legacy));
    expect(loadEditorPaneState("legacy")).toEqual(seeded(legacy));
  });

  it("E7 persisted blob with `unread: 42` is rejected as corrupt (type guard)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const corrupt = {
      openFiles: [{ path: "a.ts", viewer: "monaco", addedAt: 1, unread: 42 }],
      activeIndex: 0,
      treeOpenRoots: [],
    };
    localStorage.setItem(`${EDITOR_PANE_KEY_PREFIX}corruptUnread`, JSON.stringify(corrupt));
    expect(loadEditorPaneState("corruptUnread")).toEqual(EMPTY_PANE_STATE);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("E8 background unread tab survives save→load", () => {
    const state: EditorPaneState = {
      openFiles: [tab("a.ts"), { ...tab("b.ts", 2), unread: true }],
      activeIndex: 0,
      treeOpenRoots: [],
    };
    saveEditorPaneState("unreadsess", state);
    const loaded = loadEditorPaneState("unreadsess");
    expect(loaded.openFiles[1].unread).toBe(true);
    expect(loaded.activeIndex).toBe(0);
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

describe("tab provenance: autoOpened follows the action that activated the tab (change: surface-denial-remedy-in-previews, D4)", () => {
  const t = (path: string, autoOpened: boolean) => ({ ...tab(path), autoOpened });
  const two = (a: boolean, b: boolean, activeIndex = 1): EditorPaneState => ({
    openFiles: [t("a.png", a), t("b.png", b)],
    activeIndex,
    treeOpenRoots: [],
  });
  const auto = (s: EditorPaneState, path: string, activate = true) =>
    editorPaneReducer(s, { type: "openFile", path, viewer: "image", autoOpened: true, activate });
  const op = (s: EditorPaneState, path: string, activate = true) =>
    editorPaneReducer(s, { type: "openFile", path, viewer: "image", activate });
  const autoOf = (s: EditorPaneState, path: string) => s.openFiles.find((f) => f.path === path)?.autoOpened;

  it("#E25 every row of the D4 table", () => {
    // new tab from an auto-open / an operator open
    expect(autoOf(auto(EMPTY_PANE_STATE, "n.png"), "n.png")).toBe(true);
    expect(autoOf(op(EMPTY_PANE_STATE, "n.png"), "n.png")).toBe(false);
    // auto-open of an existing INACTIVE tab that activates it → true
    expect(autoOf(auto(two(false, false), "a.png"), "a.png")).toBe(true);
    // auto-open of the ACTIVE tab → unchanged
    expect(autoOf(auto(two(false, false), "b.png"), "b.png")).toBe(false);
    // operator open that activates an existing tab, incl. the active one → false
    expect(autoOf(op(two(true, true), "a.png"), "a.png")).toBe(false);
    expect(autoOf(op(two(true, true), "b.png"), "b.png")).toBe(false);
    // operator tab click → false
    expect(autoOf(editorPaneReducer(two(true, true), { type: "setActive", index: 0 }), "a.png")).toBe(false);
    // operator close that re-points activation → the newly active tab is false
    const closed = editorPaneReducer(two(true, true), { type: "closeTab", index: 1 });
    expect(closed.activeIndex).toBe(0);
    expect(autoOf(closed, "a.png")).toBe(false);
    // background open (operator or auto) that does not activate → unchanged
    expect(autoOf(op(two(true, false), "a.png", false), "a.png")).toBe(true);
    expect(autoOf(auto(two(false, false), "a.png", false), "a.png")).toBe(false);
    // terminal reconcile (closeByPath) re-pointing activation → unchanged
    const reconciled = editorPaneReducer(two(true, true), { type: "closeByPath", path: "b.png" });
    expect(reconciled.activeIndex).toBe(0);
    expect(autoOf(reconciled, "a.png")).toBe(true);
  });

  it("#E26 persisted provenance: validated as a boolean, seeded from restrictCsp", () => {
    const key = `${EDITOR_PANE_KEY_PREFIX}prov`;
    const store = (openFiles: unknown[]) =>
      localStorage.setItem(key, JSON.stringify({ openFiles, activeIndex: 0, treeOpenRoots: [] }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    store([{ ...tab("a.png"), autoOpened: "yes" }]);
    expect(loadEditorPaneState("prov")).toEqual(EMPTY_PANE_STATE);
    store([{ ...tab("a.png"), restrictCsp: true }]);
    expect(loadEditorPaneState("prov").openFiles[0].autoOpened).toBe(true);
    store([tab("a.png")]);
    expect(loadEditorPaneState("prov").openFiles[0].autoOpened).toBe(false);
    err.mockRestore();
    localStorage.removeItem(key);
  });
});
