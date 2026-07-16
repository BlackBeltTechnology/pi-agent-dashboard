/**
 * EditorPane discoverable rail toggle (#6).
 *
 * The rail show/hide control is a labelled button ("Files") at the header/rail
 * boundary; toggling hides the rail (+ its resize divider) and persists.
 *
 * See change: improve-content-editor (tasks §3.3).
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api-context.js", () => ({ getApiBase: () => "" }));

import { TREE_VISIBLE_KEY_PREFIX } from "../../../lib/tree-visible.js";
import { SplitWorkspaceProvider, useSplitWorkspace } from "../../SplitWorkspaceContext.js";
import { EditorPane } from "../EditorPane.js";

const originalFetch = globalThis.fetch;

function renderPane(sessionId = "s1") {
  return render(
    <SplitWorkspaceProvider sessionId={sessionId} cwd="/proj" orientation="h">
      <EditorPane />
    </SplitWorkspaceProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({ json: () => Promise.resolve({ success: true, data: { entries: [] } }) }),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function RevealProbe() {
  const { openChanges, paneState } = useSplitWorkspace();
  return (
    <>
      <button type="button" data-testid="reveal" onClick={() => openChanges()}>
        reveal
      </button>
      <div data-testid="open-tabs">{paneState.openFiles.map((f) => f.path).join("|")}</div>
    </>
  );
}

describe("EditorPane — openChanges reveals the rail (collapse-diff-file-tree F6)", () => {
  it("reveals the rail on openChanges() without opening a diff tab", () => {
    render(
      <SplitWorkspaceProvider sessionId="s6" cwd="/proj" orientation="h">
        <EditorPane />
        <RevealProbe />
      </SplitWorkspaceProvider>,
    );
    // Rail hidden by default.
    expect(screen.queryByTestId("rail-divider")).toBeNull();
    fireEvent.click(screen.getByTestId("reveal"));
    // Rail revealed; no diff tab opened by openChanges itself.
    expect(screen.queryByTestId("rail-divider")).toBeTruthy();
    expect(screen.getByTestId("open-tabs").textContent).toBe("");
  });
});

describe("EditorPane — rail toggle (#6)", () => {
  it("renders a labelled toggle that hides/shows the rail and persists", () => {
    renderPane("s1");
    const toggle = screen.getByTestId("tree-toggle");
    // Labelled + discoverable.
    expect(toggle.getAttribute("aria-label")).toMatch(/toggle file tree/i);
    expect(toggle.textContent).toContain("Files");
    // Collapsed by default (no persisted preference) — rail + divider absent.
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByTestId("rail-divider")).toBeNull();

    // Reveal → rail + divider present, state persisted true.
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByTestId("rail-divider")).toBeTruthy();
    expect(localStorage.getItem(`${TREE_VISIBLE_KEY_PREFIX}s1`)).toBe("true");

    // Hide again → rail + divider gone, state persisted false.
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByTestId("rail-divider")).toBeNull();
    expect(localStorage.getItem(`${TREE_VISIBLE_KEY_PREFIX}s1`)).toBe("false");
  });
});
