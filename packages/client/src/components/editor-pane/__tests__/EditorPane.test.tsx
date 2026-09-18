/**
 * EditorPane discoverable rail toggle (#6).
 *
 * The rail show/hide control is a labelled button ("Files") at the header/rail
 * boundary; toggling hides the rail (+ its resize divider) and persists.
 *
 * See change: improve-content-editor (tasks §3.3).
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

// Keep-alive contract instrumentation (change: add-lazy-terminal-diff-bootstrap).
// `TerminalView` is the single mount point per terminal id, so count mounts AND
// connect-effect runs — a remount or a WS reconnect regression must be
// observable, not inferred from DOM shape.
const tv = vi.hoisted(() => ({
  mounts: {} as Record<string, number>,
  connects: {} as Record<string, number>,
}));

vi.mock("../../terminal/TerminalView.js", async () => {
  const React = await import("react");
  return {
    TerminalView: ({ terminalId, visible }: { terminalId: string; visible: boolean }) => {
      // Count MOUNTS, not renders: an empty-dep effect re-runs only when the
      // component instance is created again (i.e. a real remount). `connects`
      // models the xterm WS connect effect, which must not re-run on a tab
      // switch either.
      React.useEffect(() => {
        tv.mounts[terminalId] = (tv.mounts[terminalId] ?? 0) + 1;
        tv.connects[terminalId] = (tv.connects[terminalId] ?? 0) + 1;
      }, [terminalId]);
      return React.createElement("div", {
        "data-testid": `tv-${terminalId}`,
        "data-visible": String(visible),
      });
    },
  };
});

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
  tv.mounts = {};
  tv.connects = {};
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

describe("EditorPane — terminal keep-alive contract (terminal-lazy-bootstrap E7/F6/F7)", () => {
  function TerminalProbe() {
    const { terminal, openInSplit, paneState, dispatch } = useSplitWorkspace();
    return (
      <>
        <button type="button" data-testid="open-t1" onClick={() => terminal.openTerminal("t1")}>
          open t1
        </button>
        <button type="button" data-testid="open-t2" onClick={() => terminal.openTerminal("t2")}>
          open t2
        </button>
        <button type="button" data-testid="open-f1" onClick={() => openInSplit("f1.md")}>
          open f1
        </button>
        <button
          type="button"
          data-testid="bg-term"
          onClick={() => dispatch({ type: "openFile", path: "term:tbg", viewer: "terminal", activate: false })}
        >
          background terminal
        </button>
        <button
          type="button"
          data-testid="activate-t1"
          onClick={() => {
            const i = paneState.openFiles.findIndex((f) => f.path === "term:t1");
            if (i >= 0) dispatch({ type: "setActive", index: i });
          }}
        >
          activate t1
        </button>
        <button
          type="button"
          data-testid="close-t1"
          onClick={() => dispatch({ type: "closeByPath", path: "term:t1" })}
        >
          close t1
        </button>
      </>
    );
  }

  function renderKeepAlive(sessionId = "sKeep") {
    return render(
      <SplitWorkspaceProvider sessionId={sessionId} cwd="/proj" orientation="h">
        <EditorPane />
        <TerminalProbe />
      </SplitWorkspaceProvider>,
    );
  }

  it("E7 · mounts exactly one TerminalView per terminal id", async () => {
    renderKeepAlive("sE7");
    fireEvent.click(screen.getByTestId("open-t1"));
    fireEvent.click(screen.getByTestId("open-t2"));
    await screen.findByTestId("tv-t1");
    await screen.findByTestId("tv-t2");

    expect(tv.mounts.t1).toBe(1);
    expect(tv.mounts.t2).toBe(1);
    expect(screen.getAllByTestId(/^tv-/)).toHaveLength(2);
  });

  it("F6 · keep-alive across a tab switch: no remount, no reconnect", async () => {
    renderKeepAlive("sF6");
    fireEvent.click(screen.getByTestId("open-t1"));
    await screen.findByTestId("tv-t1");
    expect(tv.mounts.t1).toBe(1);
    expect(tv.connects.t1).toBe(1);

    // Away to a file tab…
    fireEvent.click(screen.getByTestId("open-f1"));
    // …and back to the terminal.
    fireEvent.click(screen.getByTestId("activate-t1"));
    await screen.findByTestId("tv-t1");

    expect(tv.mounts.t1).toBe(1);
    expect(tv.connects.t1).toBe(1);
  });

  it("F7 · closing the terminal tab unmounts its TerminalView", async () => {
    renderKeepAlive("sF7");
    fireEvent.click(screen.getByTestId("open-t1"));
    await screen.findByTestId("tv-t1");
    expect(tv.mounts.t1).toBe(1);

    fireEvent.click(screen.getByTestId("close-t1"));
    await waitFor(() => expect(screen.queryByTestId("tv-t1")).toBeNull());
  });

  it("D3 · a BACKGROUND terminal tab does not mount the layer (no xterm fetch on landing)", async () => {
    renderKeepAlive("sD3");
    // A background `term:` tab is exactly the reload-with-persisted-tab and the
    // folder auto-surface case. It must NOT latch, so the lazy terminal chunk is
    // never requested. Against the pre-change unconditional render this FAILS
    // (the layer mounts a TerminalView for the open tab), which is what makes
    // this test a genuine gate on D3 rather than a restatement of "no terminal
    // tab, no terminal".
    fireEvent.click(screen.getByTestId("bg-term"));
    // Deterministic flush of pending React work (the repo bans bare-resolve
    // setTimeout barriers — see scripts/check-fixed-tick-waits.mjs).
    await act(async () => {});
    expect(screen.queryByTestId(/^tv-/)).toBeNull();
    expect(tv.mounts.tbg).toBeUndefined();
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
