/**
 * EditorTabs stable tab testids (D4): every tab carries `data-testid="editor-tab"`
 * + `data-tab-path`, so a browser test can assert which tab is active without
 * depending on title text or tab order.
 *
 * See change: fix-terminals-action-opens-terminal (test-plan E8).
 */

import { cleanup, render, screen } from "@testing-library/react";
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
