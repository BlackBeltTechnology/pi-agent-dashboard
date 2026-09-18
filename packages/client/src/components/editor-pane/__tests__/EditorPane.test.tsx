/**
 * EditorPane discoverable rail toggle (#6).
 *
 * The rail show/hide control is a labelled button ("Files") at the header/rail
 * boundary; toggling hides the rail (+ its resize divider) and persists.
 *
 * See change: improve-content-editor (tasks §3.3).
 */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Terminal keep-alive probes (change: add-lazy-terminal-diff-bootstrap). The
// real TerminalView opens an xterm + WebSocket; the contract under test is the
// MOUNT lifecycle, so a probe counts mounts per terminal id. `vi.hoisted` keeps
// the counters available to the hoisted `vi.mock` factory.
const { mockMountCounts, resetMountCounts } = vi.hoisted(() => ({
  mockMountCounts: {} as Record<string, number>,
  resetMountCounts: () => {
    for (const k of Object.keys(mockMountCounts)) delete mockMountCounts[k];
  },
}));

vi.mock("../../terminal/TerminalView.js", async () => {
  const React = await import("react");
  return {
    TerminalView: ({ terminalId, visible }: { terminalId: string; visible: boolean }) => {
      React.useEffect(() => {
        mockMountCounts[terminalId] = (mockMountCounts[terminalId] ?? 0) + 1;
      }, [terminalId]);
      return React.createElement("div", {
        "data-testid": `terminal-view-${terminalId}`,
        "data-visible": String(visible),
      });
    },
  };
});

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

// Keep the keep-alive tests off the heavyweight Monaco chunk (opening a
// `monaco` file tab must not pull `monaco-editor` into the jsdom test).
vi.mock("../MonacoBuffer.js", () => ({ default: () => <div data-testid="monaco-viewer" /> }));

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

// ---------------------------------------------------------------------------
// Terminal keep-alive contract under the lazy + latch gate
// (change: add-lazy-terminal-diff-bootstrap, design Risks — no prior coverage).
// The lazy `TerminalPaneLayer` must not change mount lifecycle: mount once per
// id, hide (not unmount) on tab switch, unmount on close.
// ---------------------------------------------------------------------------

function TerminalProbe() {
  const { terminal, openInSplit } = useSplitWorkspace();
  return (
    <>
      {terminal.terminals.map((t) => (
        <button key={t.id} type="button" data-testid={`open-${t.id}`} onClick={() => terminal.openTerminal(t.id)}>
          {t.id}
        </button>
      ))}
      {terminal.terminals.map((t) => (
        <button
          key={`close-${t.id}`}
          type="button"
          data-testid={`close-${t.id}`}
          onClick={() => terminal.closeTerminalTab(t.id)}
        >
          close {t.id}
        </button>
      ))}
      <button type="button" data-testid="open-file" onClick={() => openInSplit("f1.ts")}>
        f1
      </button>
    </>
  );
}

function renderTerminalPane(sessionId: string, ids: string[]) {
  return render(
    <SplitWorkspaceProvider
      sessionId={sessionId}
      cwd="/proj"
      orientation="h"
      terminals={ids.map((id) => ({ id, cwd: "/proj", shell: "/bin/zsh", status: "active", createdAt: 1 }))}
    >
      <EditorPane />
      <TerminalProbe />
    </SplitWorkspaceProvider>,
  );
}

describe("EditorPane — terminal keep-alive (lazy layer + activation latch)", () => {
  beforeEach(() => resetMountCounts());

  it("E7: mounts exactly one TerminalView per terminal id", async () => {
    renderTerminalPane("sKeep1", ["t1", "t2"]);
    fireEvent.click(screen.getByTestId("open-t1"));
    await screen.findByTestId("terminal-view-t1");
    fireEvent.click(screen.getByTestId("open-t2"));
    await screen.findByTestId("terminal-view-t2");
    expect(mockMountCounts.t1).toBe(1);
    expect(mockMountCounts.t2).toBe(1);
  });

  it("F6: switching to a file tab and back does not remount or reconnect", async () => {
    renderTerminalPane("sKeep2", ["t1"]);
    fireEvent.click(screen.getByTestId("open-t1"));
    await screen.findByTestId("terminal-view-t1");
    expect(mockMountCounts.t1).toBe(1);

    // File tab active: the terminal stays mounted but hidden.
    fireEvent.click(screen.getByTestId("open-file"));
    expect(screen.getByTestId("terminal-view-t1").getAttribute("data-visible")).toBe("false");
    expect(mockMountCounts.t1).toBe(1);

    // Back to the terminal: still the same single mount.
    fireEvent.click(screen.getByTestId("open-t1"));
    expect(screen.getByTestId("terminal-view-t1").getAttribute("data-visible")).toBe("true");
    expect(mockMountCounts.t1).toBe(1);
  });

  it("F7: closing the terminal tab unmounts its TerminalView", async () => {
    renderTerminalPane("sKeep3", ["t1"]);
    fireEvent.click(screen.getByTestId("open-t1"));
    await screen.findByTestId("terminal-view-t1");
    fireEvent.click(screen.getByTestId("close-t1"));
    await waitFor(() => expect(screen.queryByTestId("terminal-view-t1")).toBeNull());
  });

  it("D3: a persisted terminal tab does NOT mount the layer until it is activated", async () => {
    // Persisted state: a `term:t1` tab is open but a FILE tab is active. A
    // naive "a terminal tab exists" gate would fetch xterm here; the sticky
    // activation latch must not fire until the terminal is the active tab.
    localStorage.setItem(
      "pi-dashboard:editor-pane:sKeep4",
      JSON.stringify({
        openFiles: [
          { path: "term:t1", viewer: "terminal", addedAt: 1 },
          { path: "f1.ts", viewer: "monaco", addedAt: 2 },
        ],
        activeIndex: 1,
        treeOpenRoots: [],
      }),
    );
    renderTerminalPane("sKeep4", ["t1"]);
    // Let the lazy import + effects settle; the layer must still be absent.
    await waitFor(() => expect(screen.getByTestId("open-t1")).toBeTruthy());
    expect(screen.queryByTestId("terminal-view-t1")).toBeNull();
    expect(mockMountCounts.t1).toBeUndefined();

    // Activating the terminal latches the layer and mounts exactly one view.
    fireEvent.click(screen.getByTestId("open-t1"));
    await screen.findByTestId("terminal-view-t1");
    expect(mockMountCounts.t1).toBe(1);
  });
});
