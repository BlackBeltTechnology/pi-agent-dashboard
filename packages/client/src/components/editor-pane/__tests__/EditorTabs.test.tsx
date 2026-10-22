/**
 * EditorTabs stable tab testids (D4): every tab carries `data-testid="editor-tab"`
 * + `data-tab-path`, so a browser test can assert which tab is active without
 * depending on title text or tab order.
 *
 * See change: fix-terminals-action-opens-terminal (test-plan E8).
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenFile } from "../../../lib/layout/editor-pane-state.js";
import { EditorTabs } from "../EditorTabs.js";

afterEach(() => cleanup());

const openFiles: OpenFile[] = [
  { path: "term:t1", viewer: "terminal", addedAt: 1 },
  { path: "src/a.ts", viewer: "monaco", addedAt: 2 },
];

describe("EditorTabs testids (E8)", () => {
  it("every tab exposes data-testid + data-tab-path; only the active tab is aria-selected", () => {
    render(
      <EditorTabs
        openFiles={openFiles}
        activeIndex={0}
        onActivate={vi.fn()}
        onClose={vi.fn()}
        onReorder={vi.fn()}
      />,
    );
    const els = screen.getAllByTestId("editor-tab");
    expect(els.map((el) => el.getAttribute("data-tab-path"))).toEqual(["term:t1", "src/a.ts"]);
    const selected = els.filter((el) => el.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]?.getAttribute("data-tab-path")).toBe("term:t1");
  });
});

// See change: scope-anchor-editor-pane-controls (D1, D6 / test-plan task 2.3)
describe("EditorTabs pane-bar behaviour", () => {
  const props = () => ({ openFiles, activeIndex: 1, onActivate: vi.fn(), onClose: vi.fn(), onReorder: vi.fn() });

  it("the × is a 24 px target that becomes visible on keyboard focus", () => {
    render(<EditorTabs {...props()} />);
    const x = screen.getAllByRole("button")[0];
    expect(x.className).toContain("h-6");
    expect(x.className).toContain("w-6");
    expect(x.className).toContain("focus-visible:opacity-100");
  });

  it("the tablist is the flexible item (min-w-0, scrolls)", () => {
    render(<EditorTabs {...props()} />);
    const list = screen.getByRole("tablist");
    expect(list.className).toContain("min-w-0");
    expect(list.className).toContain("overflow-x-auto");
    expect(list.className).not.toContain("shrink-0");
  });

  it("Cmd/Ctrl-W closes the active tab, and is inert while an overlay is open", () => {
    const p = props();
    const { rerender } = render(<EditorTabs {...p} closeShortcutSuspended />);
    fireEvent.keyDown(window, { key: "w", metaKey: true });
    expect(p.onClose).not.toHaveBeenCalled();
    rerender(<EditorTabs {...p} closeShortcutSuspended={false} />);
    fireEvent.keyDown(window, { key: "w", ctrlKey: true });
    expect(p.onClose).toHaveBeenCalledWith(1);
  });

  it("secondary click, ContextMenu key and Shift+F10 request the tab menu with the tab as anchor", () => {
    const onContextMenuTab = vi.fn();
    render(<EditorTabs {...props()} onContextMenuTab={onContextMenuTab} />);
    const tabs = screen.getAllByTestId("editor-tab");
    fireEvent.contextMenu(tabs[0]);
    fireEvent.keyDown(tabs[1], { key: "ContextMenu" });
    fireEvent.keyDown(tabs[1], { key: "F10", shiftKey: true });
    expect(onContextMenuTab.mock.calls.map((c) => c[0])).toEqual([0, 1, 1]);
    expect(onContextMenuTab.mock.calls[0][1]).toBe(tabs[0]);
  });
});
