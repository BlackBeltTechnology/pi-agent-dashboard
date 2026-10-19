/**
 * E11 — `handlerMode` hydration + reducer action.
 * See change: add-editor-pane-file-handlers (D2, task 3.1).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EDITOR_PANE_KEY_PREFIX, editorPaneReducer, loadEditorPaneState } from "../layout/editor-pane-state.js";

beforeEach(() => {
  // Per-file in-memory storage (Node's file-backed one is shared across workers).
  const m = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => vi.unstubAllGlobals());

const stored = (files: Array<Record<string, unknown>>, activeIndex = 0) =>
  localStorage.setItem(
    `${EDITOR_PANE_KEY_PREFIX}s1`,
    JSON.stringify({ openFiles: files, activeIndex, treeOpenRoots: [] }),
  );
const f = (path: string, extra: Record<string, unknown> = {}) => ({ path, viewer: "docx", addedAt: 1, ...extra });

describe("loadEditorPaneState — handlerMode (E11)", () => {
  it("drops a non-string handlerMode for that tab only, keeping every tab", () => {
    stored([f("a.docx", { handlerMode: 42 }), f("b.docx", { handlerMode: "demo/docx" }), f("c.docx", { handlerMode: "gone/x" })]);
    const s = loadEditorPaneState("s1");
    expect(s.openFiles.map((t) => t.path)).toEqual(["a.docx", "b.docx", "c.docx"]);
    expect(s.openFiles[0].handlerMode).toBeUndefined();
    expect(s.openFiles[1].handlerMode).toBe("demo/docx");
    // An unknown claim is NOT validated at load (the registry may not be ready).
    expect(s.openFiles[2].handlerMode).toBe("gone/x");
  });

  it("tabs written before the field existed stay valid", () => {
    stored([f("a.docx")]);
    expect(loadEditorPaneState("s1").openFiles[0].handlerMode).toBeUndefined();
  });
});

describe("editorPaneReducer — setHandlerMode", () => {
  const base = { openFiles: [f("a.docx"), f("b.docx")] as never, activeIndex: 0, treeOpenRoots: [] };

  it("sets and clears the mode on the addressed tab only", () => {
    const on = editorPaneReducer(base, { type: "setHandlerMode", path: "a.docx", mode: "demo/docx" });
    expect(on.openFiles[0].handlerMode).toBe("demo/docx");
    expect(on.openFiles[1].handlerMode).toBeUndefined();
    const off = editorPaneReducer(on, { type: "setHandlerMode", path: "a.docx", mode: undefined });
    expect("handlerMode" in off.openFiles[0]).toBe(false);
  });

  it("is a no-op (same state object) for an unknown path or an unchanged mode", () => {
    expect(editorPaneReducer(base, { type: "setHandlerMode", path: "zzz", mode: "x/y" })).toBe(base);
    expect(editorPaneReducer(base, { type: "setHandlerMode", path: "a.docx", mode: undefined })).toBe(base);
  });
});
