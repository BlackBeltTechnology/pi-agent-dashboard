/**
 * EditorPane discoverable rail toggle (#6).
 *
 * The rail show/hide control is a labelled button ("Files") at the header/rail
 * boundary; toggling hides the rail (+ its resize divider) and persists.
 *
 * See change: improve-content-editor (tasks §3.3).
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

import { TREE_VISIBLE_KEY_PREFIX } from "../../../lib/util/tree-visible.js";
import { SplitWorkspaceProvider, useSplitWorkspace } from "../../split/SplitWorkspaceContext.js";
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

function UnreadProbe() {
  const { openInSplit } = useSplitWorkspace();
  return (
    <>
      <button type="button" data-testid="open-a" onClick={() => openInSplit("a.ts")}>
        open a
      </button>
      <button
        type="button"
        data-testid="bg-open-b"
        onClick={() => openInSplit("b.ts", undefined, undefined, { background: true })}
      >
        bg open b
      </button>
    </>
  );
}

describe("EditorPane — unread affordance (non-disruptive-file-open F16/F17)", () => {
  function renderWithProbe(sessionId = "sUnread") {
    return render(
      <SplitWorkspaceProvider sessionId={sessionId} cwd="/proj" orientation="h">
        <EditorPane />
        <UnreadProbe />
      </SplitWorkspaceProvider>,
    );
  }

  it("F16: unread dot renders on a background tab and clears after activation", () => {
    renderWithProbe();
    fireEvent.click(screen.getByTestId("open-a")); // a.ts foreground, active
    fireEvent.click(screen.getByTestId("bg-open-b")); // b.ts background, unread
    // Dot present on the inactive unread b.ts tab.
    expect(screen.getByTestId("unread-dot")).toBeTruthy();
    // Activate b.ts by clicking its tab → dot clears (active tab never unread).
    fireEvent.click(screen.getByTitle("b.ts"));
    expect(screen.queryByTestId("unread-dot")).toBeNull();
  });

  it("F17: a repeat background open re-pulses and stays unread + inactive", () => {
    renderWithProbe("sRepulse");
    fireEvent.click(screen.getByTestId("open-a"));
    fireEvent.click(screen.getByTestId("bg-open-b"));
    // Second background open of the already-unread b.ts.
    fireEvent.click(screen.getByTestId("bg-open-b"));
    const dot = screen.getByTestId("unread-dot");
    // Re-signal re-triggers the pulse (transient, keyed on the tab's identity).
    expect(dot.getAttribute("data-pulse")).toBe("true");
    // b.ts stays inactive (a.ts still active) → its dot is still shown.
    expect(screen.getByTitle("a.ts").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTitle("b.ts").getAttribute("aria-selected")).toBe("false");
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
