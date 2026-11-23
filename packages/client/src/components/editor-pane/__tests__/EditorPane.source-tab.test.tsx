/**
 * `source:<abs>` tab (change: rich-chat-links, task 7.2 / test-plan #E27): the same HTML file shown read-only in the
 * `monaco` viewer beside its rendered tab; no save/edit control; the tab strip shows the file name + a source marker.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { monacoProps } = vi.hoisted(() => ({ monacoProps: [] as Array<Record<string, unknown>> }));

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));
// Keep the heavyweight Monaco chunk out of jsdom; record what the pane hands the viewer.
vi.mock("../MonacoBuffer.js", async () => {
  const React = await import("react");
  return {
    default: (p: Record<string, unknown>) => {
      monacoProps.push(p);
      return React.createElement("div", { "data-testid": "monaco-viewer", "data-path": String(p.path) });
    },
  };
});
// The rendered tab's viewer is not under test.
vi.mock("../../preview/HtmlPreview.js", async () => {
  const React = await import("react");
  return { HtmlPreview: () => React.createElement("div", { "data-testid": "html-preview" }) };
});

import { SplitWorkspaceProvider, useSplitWorkspace } from "../../split/SplitWorkspaceContext.js";
import { EditorPane } from "../EditorPane.js";
import { tabLabelText } from "../tab-labels.js";

let api: ReturnType<typeof useSplitWorkspace>;
function Probe() {
  const ws = useSplitWorkspace();
  useEffect(() => {
    api = ws;
  });
  return null;
}
function renderPane() {
  return render(
    <SplitWorkspaceProvider sessionId="sSrc" cwd="/w/r" orientation="h">
      <Probe />
      <EditorPane />
    </SplitWorkspaceProvider>,
  );
}

const originalFetch = globalThis.fetch;
beforeEach(() => {
  localStorage.clear();
  monacoProps.length = 0;
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({ json: () => Promise.resolve({ success: true, data: { entries: [] } }) }),
  ) as unknown as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

describe("source tab (#E27)", () => {
  it("coexists with the rendered tab, focuses on a second call, and labels the file + a source marker", () => {
    renderPane();
    act(() => api.openInSplit("m/board.html"));
    act(() => api.openSourceTab("m/board.html"));
    act(() => api.openSourceTab("m/board.html"));
    const tabs = screen.getAllByTestId("editor-tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0].textContent).toContain("board.html");
    expect(tabs[0].textContent).not.toMatch(/source/i);
    expect(tabs[1].textContent).toContain("board.html");
    expect(tabs[1].textContent).toMatch(/source/i);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
  });

  it("renders the real file read-only in the monaco viewer (no save / edit control)", () => {
    renderPane();
    act(() => api.openSourceTab("m/board.html"));
    expect(screen.getByTestId("monaco-viewer").getAttribute("data-path")).toBe("/w/r/m/board.html");
    const last = monacoProps.at(-1) as Record<string, unknown>;
    expect(last.readOnly).toBe(true);
    // The document bar is the plain title (no breadcrumb / file actions): nothing to save or edit.
    expect(screen.getByTestId("doc-title").textContent).toContain("board.html");
    expect(screen.queryByRole("button", { name: /\bsave\b|\bedit\b/i })).toBeNull();
    expect(screen.queryByTestId("html-preview")).toBeNull();
  });

  it("is never watched as a real file", () => {
    const onWatchFiles = vi.fn();
    render(
      <SplitWorkspaceProvider sessionId="sSrcW" cwd="/w/r" orientation="h" onWatchFiles={onWatchFiles}>
        <Probe />
      </SplitWorkspaceProvider>,
    );
    act(() => api.openInSplit("m/board.html"));
    act(() => api.openSourceTab("m/board.html"));
    const lastPaths = onWatchFiles.mock.calls.at(-1)?.[2] as string[];
    expect(lastPaths).toEqual(["m/board.html"]);
  });

  it("closing the source tab leaves the rendered tab", () => {
    renderPane();
    act(() => api.openInSplit("m/board.html"));
    act(() => api.openSourceTab("m/board.html"));
    const closeBtn = screen.getAllByTestId("editor-tab")[1].querySelector("button");
    fireEvent.click(closeBtn as HTMLElement);
    expect(api.paneState.openFiles.map((f) => f.path)).toEqual(["m/board.html"]);
  });
});

describe("tabLabelText for a source tab", () => {
  const file = { path: "source:/w/r/m/board.html", viewer: "monaco" as const, addedAt: 0 };
  it("is the file name + the source marker", () => {
    expect(tabLabelText(file, { terminalFallback: "terminal", sourceLabel: "source" })).toBe("board.html · source");
  });
  it("without a marker label it is the plain file name", () => {
    expect(tabLabelText(file, { terminalFallback: "terminal" })).toBe("board.html");
  });
});
