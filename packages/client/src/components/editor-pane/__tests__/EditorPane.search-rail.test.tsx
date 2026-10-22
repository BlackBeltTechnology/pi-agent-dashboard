/**
 * Search as a rail view (test-plan #E11, #E12, #F9, #F10). The rail visibility
 * preference is persisted ONLY by the Files toggle / rail Files tab / reveals,
 * never by Search. See change: scope-anchor-editor-pane-controls (D4).
 */
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSplitWorkspace } from "../../split/SplitWorkspaceContext.js";
import { installMemoryStorage, mount, seedPane, stubFetch, tab, tree, treeVisibleKey } from "./chrome-harness.js";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));
vi.mock("../CappedViewer.js", async () => {
  const React = await import("react");
  return { CappedViewer: ({ path }: { path: string }) => React.createElement("div", { "data-testid": "capped-viewer" }, path) };
});

const originalFetch = globalThis.fetch;
beforeEach(() => {
  installMemoryStorage();
  stubFetch();
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const key = (k: string, extra: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key: k, metaKey: true, ...extra });
const cmdP = () => key("p");
const cmdShiftF = () => key("f", { shiftKey: true });
const panel = () => screen.queryByTestId("editor-search-panel");
const modeOf = () => (screen.getByTestId("mode-file").getAttribute("aria-pressed") === "true" ? "file" : "content");

function Probe() {
  const { openChanges, dispatch } = useSplitWorkspace();
  return (
    <>
      <button type="button" data-testid="chip" onClick={() => openChanges()} />
      <button type="button" data-testid="bg-open" onClick={() => dispatch({ type: "openFile", path: "bg.ts", viewer: "monaco", activate: false })} />
    </>
  );
}

describe("shortcuts (#E11)", () => {
  it("opens in the key's mode, the same key closes, the other key switches", () => {
    seedPane("s1", [tab("a.ts")], 0);
    mount();
    expect(panel()).toBeNull();

    cmdP();
    expect(panel()).toBeTruthy();
    expect(modeOf()).toBe("file");

    cmdShiftF(); // other mode → switches, stays open
    expect(panel()).toBeTruthy();
    expect(modeOf()).toBe("content");

    cmdShiftF(); // same mode → closes
    expect(panel()).toBeNull();

    cmdShiftF(); // closed → opens in Contents
    expect(modeOf()).toBe("content");
    cmdP();
    expect(modeOf()).toBe("file");
    cmdP();
    expect(panel()).toBeNull();
  });

  it("B1: Cmd/Ctrl-Shift-P is not a search shortcut and is not intercepted", () => {
    seedPane("s1", [tab("a.ts")], 0);
    mount();
    for (const key of ["p", "P"]) {
      const ev = new KeyboardEvent("keydown", { key, metaKey: true, shiftKey: true, cancelable: true, bubbles: true });
      window.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);
    }
    expect(panel()).toBeNull();
  });

  it("without file search (folder pane) nothing opens and the key is not intercepted", () => {
    seedPane("s1", [tab("a.ts")], 0);
    mount({ kind: "folder" });
    for (const init of [{ key: "p", metaKey: true }, { key: "f", metaKey: true, shiftKey: true }]) {
      const ev = new KeyboardEvent("keydown", { ...init, cancelable: true, bubbles: true });
      window.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);
    }
    expect(panel()).toBeNull();
    expect(screen.queryByTestId("editor-search-toggle")).toBeNull();
  });

  it("the rail switch appears only in session panes", () => {
    seedPane("s1", [tab("a.ts")], 0);
    localStorage.setItem(treeVisibleKey("s1"), "true");
    mount({ kind: "folder" });
    expect(screen.queryByTestId("rail-view-files")).toBeNull();
    cleanup();
    mount({ kind: "session" });
    expect(screen.getByTestId("rail-view-files")).toBeTruthy();
    expect(screen.getByTestId("editor-search-toggle")).toBeTruthy();
  });

  it("+ → Open file… opens Search in Filenames mode", () => {
    seedPane("s1", [tab("a.ts")], 0);
    mount();
    fireEvent.click(screen.getByTestId("new-tab-menu-toggle"));
    fireEvent.click(screen.getByTestId("open-file-launch"));
    expect(panel()).toBeTruthy();
    expect(modeOf()).toBe("file");
  });
});

describe("rail visibility (#E12)", () => {
  beforeEach(() => {
    seedPane("s1", [tab("a.ts")], 0);
    localStorage.setItem(treeVisibleKey("s1"), "false");
  });

  it("Search over a collapsed rail: Escape in the rail collapses it again, preference untouched", () => {
    mount({ extra: <Probe /> });
    cmdP();
    expect(panel()).toBeTruthy();
    expect(localStorage.getItem(treeVisibleKey("s1"))).toBe("false");
    fireEvent.keyDown(screen.getByTestId("editor-search-input"), { key: "Escape" });
    expect(panel()).toBeNull();
    expect(screen.queryByTestId("editor-rail")).toBeNull();
    expect(localStorage.getItem(treeVisibleKey("s1"))).toBe("false");
  });

  it("the rail Files tab shows the tree and persists visibility", () => {
    mount();
    cmdP();
    fireEvent.click(screen.getByTestId("rail-view-files"));
    expect(panel()).toBeNull();
    expect(screen.getByTestId("editor-rail")).toBeTruthy();
    expect(localStorage.getItem(treeVisibleKey("s1"))).toBe("true");
  });

  it("the pane Files toggle (pressed) hides the rail and persists false", () => {
    mount();
    cmdP();
    const toggle = screen.getByTestId("tree-toggle");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toggle);
    expect(screen.queryByTestId("editor-rail")).toBeNull();
    expect(localStorage.getItem(treeVisibleKey("s1"))).toBe("false");
  });

  it("the Changed-files chip persists a reveal; closing Search later leaves the rail visible", () => {
    mount({ extra: <Probe /> });
    cmdP();
    fireEvent.click(screen.getByTestId("chip"));
    expect(localStorage.getItem(treeVisibleKey("s1"))).toBe("true");
    fireEvent.keyDown(screen.getByTestId("editor-search-input"), { key: "Escape" });
    expect(panel()).toBeNull();
    expect(screen.getByTestId("editor-rail")).toBeTruthy();
    expect(localStorage.getItem(treeVisibleKey("s1"))).toBe("true");
  });

  it("Show in file tree switches to the Files view and persists visibility", () => {
    mount();
    cmdP();
    fireEvent.click(screen.getByTestId("doc-more-menu"));
    fireEvent.click(screen.getByTestId("doc-show-in-tree"));
    expect(panel()).toBeNull();
    expect(localStorage.getItem(treeVisibleKey("s1"))).toBe("true");
  });
});

describe("Escape scope and session switch (#F9, #F10)", () => {
  it("#F9 Escape in the viewer leaves Search open; in the rail it closes and refocuses the viewer", async () => {
    seedPane("s1", [tab("a.ts")], 0);
    mount();
    cmdP();
    fireEvent.keyDown(await screen.findByTestId("capped-viewer"), { key: "Escape" });
    expect(panel()).toBeTruthy();
    fireEvent.keyDown(screen.getByTestId("editor-search-input"), { key: "Escape" });
    expect(panel()).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("capped-viewer").parentElement));
  });

  it("#F10 a session switch resets the Search view, mode and query", async () => {
    seedPane("s1", [tab("a.ts")], 0);
    seedPane("s2", [tab("b.ts")], 0);
    const view = mount({ sessionId: "s1" });
    cmdShiftF();
    fireEvent.change(screen.getByTestId("editor-search-input"), { target: { value: "foo" } });
    expect(modeOf()).toBe("content");

    view.rerender(tree({ sessionId: "s2" }));
    await waitFor(() => expect(panel()).toBeNull());

    cmdP(); // reopen: default mode, empty query
    expect(modeOf()).toBe("file");
    expect((screen.getByTestId("editor-search-input") as HTMLInputElement).value).toBe("");
    // keep `act` imported for React 19 batching parity with sibling suites
    await act(async () => {});
  });
});
