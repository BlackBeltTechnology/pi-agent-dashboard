/**
 * EditorPane discoverable rail toggle (#6).
 *
 * The rail show/hide control is a labelled button ("Files") at the header/rail
 * boundary; toggling hides the rail (+ its resize divider) and persists.
 *
 * See change: improve-content-editor (tasks §3.3).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import React from "react";

vi.mock("../../../lib/api-context.js", () => ({ getApiBase: () => "" }));

import { EditorPane } from "../EditorPane.js";
import { SplitWorkspaceProvider } from "../../SplitWorkspaceContext.js";
import { TREE_VISIBLE_KEY_PREFIX } from "../../../lib/tree-visible.js";

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

describe("EditorPane — rail toggle (#6)", () => {
  it("renders a labelled toggle that hides/shows the rail and persists", () => {
    renderPane("s1");
    const toggle = screen.getByTestId("tree-toggle");
    // Labelled + discoverable.
    expect(toggle.getAttribute("aria-label")).toMatch(/toggle file tree/i);
    expect(toggle.textContent).toContain("Files");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");

    // Rail divider visible while shown.
    expect(screen.queryByTestId("rail-divider")).toBeTruthy();

    // Hide → rail + divider gone, state persisted false.
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByTestId("rail-divider")).toBeNull();
    expect(localStorage.getItem(`${TREE_VISIBLE_KEY_PREFIX}s1`)).toBe("false");

    // Show again.
    fireEvent.click(toggle);
    expect(screen.queryByTestId("rail-divider")).toBeTruthy();
    expect(localStorage.getItem(`${TREE_VISIBLE_KEY_PREFIX}s1`)).toBe("true");
  });
});
