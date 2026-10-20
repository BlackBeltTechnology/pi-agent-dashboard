/**
 * EditorPane discoverable rail toggle (#6).
 *
 * The rail show/hide control is a labelled button ("Files") at the header/rail
 * boundary; toggling hides the rail (+ its resize divider) and persists.
 *
 * See change: improve-content-editor (tasks §3.3).
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useCallback, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Terminal keep-alive probes (change: add-lazy-terminal-diff-bootstrap). The
// real TerminalView opens an xterm + WebSocket; the contract under test is the
// MOUNT lifecycle, so a probe counts mounts per terminal id. `vi.hoisted` keeps
// the counters available to the hoisted `vi.mock` factory.
const { mockMountCounts, resetMountCounts, monacoMounts } = vi.hoisted(() => ({
  monacoMounts: { count: 0 },
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
vi.mock("../MonacoBuffer.js", async () => {
  const React = await import("react");
  return {
    default: () => {
      React.useEffect(() => {
        monacoMounts.count++;
      }, []);
      return React.createElement("div", { "data-testid": "monaco-viewer" });
    },
  };
});

import { nextFrame, pointerDown, pointerMove, pointerUp } from "../../../test-support/pointer.js";
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

// Rail divider drag — DOM preview per frame, one commit on release.
// See change: fix-split-divider-drag (test-plan E19–E21, E25).
describe("EditorPane — rail divider drag (fix-split-divider-drag)", () => {
  function openRail(sessionId = "s1") {
    renderPane(sessionId);
    fireEvent.click(screen.getByTestId("tree-toggle"));
    const divider = screen.getByTestId("rail-divider");
    const rail = divider.previousElementSibling as HTMLElement;
    const row = divider.parentElement as HTMLElement;
    row.getBoundingClientRect = () =>
      ({ left: 0, width: 1000, top: 0, height: 400, right: 1000, bottom: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    return { divider, rail };
  }

  it("E19: held moves preview the rail width in the DOM, clamped 160..480", async () => {
    const { divider, rail } = openRail();
    pointerDown(divider, { clientX: 224 });
    pointerMove(window, { clientX: 100 });
    await nextFrame();
    expect(rail.style.width).toBe("160px");
    pointerMove(window, { clientX: 300 });
    await nextFrame();
    expect(rail.style.width).toBe("300px");
    pointerMove(window, { clientX: 600 });
    await nextFrame();
    expect(rail.style.width).toBe("480px");
  });

  it("E20: a drag persists the rail width exactly once, on release", async () => {
    const { divider } = openRail();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    pointerDown(divider, { clientX: 224 });
    for (const x of [240, 260, 280, 300]) {
      pointerMove(window, { clientX: x });
      await nextFrame();
    }
    expect(setItem.mock.calls.filter(([k]) => k === "pi-dashboard:rail:s1")).toHaveLength(0);
    pointerUp(window, { clientX: 300 });
    const writes = setItem.mock.calls.filter(([k]) => k === "pi-dashboard:rail:s1");
    expect(writes).toHaveLength(1);
    expect(Number(writes[0][1])).toBe(300);
  });

  it("E21: press + release without movement keeps the width and writes nothing", () => {
    const { divider, rail } = openRail();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    pointerDown(divider, { clientX: 224 });
    pointerUp(window, { clientX: 224 });
    expect(rail.style.width).toBe("224px");
    expect(setItem.mock.calls.filter(([k]) => String(k).startsWith("pi-dashboard:rail:"))).toHaveLength(0);
  });

  it("E25: the rail divider sets touch-action:none", () => {
    const { divider } = openRail();
    expect(divider.style.touchAction).toBe("none");
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

// ── Changed-on-disk verification wiring (baseline before mount, Refresh, activation) ─
// See change: gate-changed-on-disk-by-content (test-plan #F1, #F9, #F10).
describe("EditorPane — changed-on-disk verification wiring", () => {
  let disk: Map<string, string>;
  let digestCalls: Array<{ path: string; purpose: string }>;
  let digestDelayMs: number;
  let setCand!: React.Dispatch<React.SetStateAction<Map<string, number>>>;
  let setSession!: React.Dispatch<React.SetStateAction<string>>;
  let gen = 0;
  const onWatchFiles = vi.fn();

  function Host() {
    const [cand, setC] = useState<Map<string, number>>(new Map());
    const [session, setS] = useState("sV");
    setCand = setC;
    setSession = setS;
    const onClear = useCallback((p: string, g?: number) => {
      setC((prev) => {
        if (!prev.has(p) || (g !== undefined && prev.get(p) !== g)) return prev;
        const n = new Map(prev);
        n.delete(p);
        return n;
      });
    }, []);
    return (
      <SplitWorkspaceProvider
        sessionId={session}
        cwd="/proj"
        orientation="h"
        changeDetection
        changedFiles={cand}
        onClearChanged={onClear}
        onWatchFiles={onWatchFiles}
      >
        <EditorPane />
        <OpenProbe />
        <div data-testid="candidate-count">{cand.size}</div>
      </SplitWorkspaceProvider>
    );
  }

  function OpenProbe() {
    const { openInSplit } = useSplitWorkspace();
    return (
      <>
        <button type="button" data-testid="open-foo" onClick={() => openInSplit("foo.ts")}>
          foo
        </button>
        <button type="button" data-testid="open-bar-bg" onClick={() => openInSplit("bar.ts", undefined, undefined, { background: true })}>
          bar
        </button>
      </>
    );
  }

  beforeEach(() => {
    disk = new Map([["foo.ts", "S"], ["bar.ts", "B"]]);
    digestCalls = [];
    digestDelayMs = 0;
    onWatchFiles.mockClear();
    monacoMounts.count = 0;
    gen = 0;
    globalThis.fetch = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("/api/file/digest")) {
        const u = new URL(url, "http://x");
        const path = u.searchParams.get("path") ?? "";
        digestCalls.push({ path, purpose: u.searchParams.get("purpose") ?? "" });
        const body = JSON.stringify({ success: true, data: { sha1: disk.get(path) ?? "none", size: 1, mtime: 1 } });
        return new Promise<Response>((resolve) => setTimeout(() => resolve(new Response(body, { status: 200 })), digestDelayMs));
      }
      return Promise.resolve(new Response(JSON.stringify({ success: true, data: { entries: [] } }), { status: 200 }));
    }) as unknown as typeof fetch;
  });

  it("F1: the viewer is not mounted until the baseline digest resolves, then mounts once", async () => {
    digestDelayMs = 200;
    render(<Host />);
    fireEvent.click(screen.getByTestId("open-foo"));
    await waitFor(() => expect(digestCalls).toEqual([{ path: "foo.ts", purpose: "baseline" }]));
    expect(screen.queryByTestId("monaco-viewer")).toBeNull();
    expect(screen.getByText("Loading viewer…")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("monaco-viewer")).toBeTruthy(), { timeout: 2000 });
    expect(monacoMounts.count).toBe(1);
  });

  it("F9: Refresh clears the banner, re-captures the baseline, re-sends the watch set and remounts the viewer", async () => {
    render(<Host />);
    fireEvent.click(screen.getByTestId("open-foo"));
    await waitFor(() => expect(screen.getByTestId("monaco-viewer")).toBeTruthy());
    disk.set("foo.ts", "S2");
    act(() => setCand((prev) => new Map(prev).set("foo.ts", ++gen)));
    await waitFor(() => expect(screen.getByTestId("changed-on-disk-banner")).toBeTruthy(), { timeout: 2000 });

    const baselinesBefore = digestCalls.filter((c) => c.purpose === "baseline").length;
    const mountsBefore = monacoMounts.count;
    onWatchFiles.mockClear();
    fireEvent.click(screen.getByTestId("changed-refresh"));
    await waitFor(() => expect(screen.queryByTestId("changed-on-disk-banner")).toBeNull());
    await waitFor(() => expect(monacoMounts.count).toBe(mountsBefore + 1));
    expect(digestCalls.filter((c) => c.purpose === "baseline").length).toBe(baselinesBefore + 1);
    expect(onWatchFiles).toHaveBeenCalledWith("sV", "/proj", ["foo.ts"]);
    // The new baseline is S2: an identical rewrite no longer banners.
    act(() => setCand((prev) => new Map(prev).set("foo.ts", ++gen)));
    // The candidate is verified (digest == new baseline) and cleared; only then is "no banner" meaningful.
    await waitFor(() => expect(screen.getByTestId("candidate-count").textContent).toBe("0"), { timeout: 3000 });
    expect(screen.queryByTestId("changed-on-disk-banner")).toBeNull();
  });

  it("review-B1: switching to a session whose active tab has the SAME path/key still captures a baseline before the viewer mounts (review B1)", async () => {
    render(<Host />);
    // sV: open foo.ts, mount (so its split state persists with foo.ts active).
    fireEvent.click(screen.getByTestId("open-foo"));
    await waitFor(() => expect(screen.getByTestId("monaco-viewer")).toBeTruthy(), { timeout: 3000 });
    // sW: open the same file, so BOTH sessions persist foo.ts as the active tab.
    act(() => setSession("sW"));
    fireEvent.click(screen.getByTestId("open-foo"));
    await waitFor(() => expect(screen.getByTestId("monaco-viewer")).toBeTruthy(), { timeout: 3000 });
    // Switch back: sV's persisted tab is active at once, so the viewer key is unchanged.
    const baselinesBefore = digestCalls.filter((c) => c.purpose === "baseline").length;
    act(() => setSession("sV"));
    await waitFor(() => expect(digestCalls.filter((c) => c.purpose === "baseline").length).toBe(baselinesBefore + 1), { timeout: 3000 });
    await waitFor(() => expect(screen.getByTestId("monaco-viewer")).toBeTruthy(), { timeout: 3000 });
    // An identical-bytes candidate must now be quiet (it banners when no baseline was captured).
    act(() => setCand((prev) => new Map(prev).set("foo.ts", ++gen)));
    await waitFor(() => expect(screen.getByTestId("candidate-count").textContent).toBe("0"), { timeout: 3000 });
    expect(screen.queryByTestId("changed-on-disk-banner")).toBeNull();
  }, 20_000);

  it("F10: activating a background tab re-captures its baseline and clears its candidate and banner", async () => {
    render(<Host />);
    fireEvent.click(screen.getByTestId("open-foo"));
    await waitFor(() => expect(screen.getByTestId("monaco-viewer")).toBeTruthy());
    fireEvent.click(screen.getByTestId("open-bar-bg")); // bar.ts: background, no baseline yet
    disk.set("bar.ts", "B2");
    act(() => setCand((prev) => new Map(prev).set("bar.ts", ++gen)));
    // bar.ts has no baseline, so its candidate is verified (and banners) in the background.
    await waitFor(() => expect(digestCalls.some((c) => c.path === "bar.ts" && c.purpose === "verify")).toBe(true), { timeout: 3000 });
    // foo.ts is active: no banner for it.
    expect(screen.queryByTestId("changed-on-disk-banner")).toBeNull();

    const baselinesBefore = digestCalls.filter((c) => c.path === "bar.ts" && c.purpose === "baseline").length;
    fireEvent.click(screen.getByText("bar.ts")); // activate the tab
    await waitFor(() =>
      expect(digestCalls.filter((c) => c.path === "bar.ts" && c.purpose === "baseline").length).toBe(baselinesBefore + 1),
    );
    await waitFor(() => expect(screen.getByTestId("monaco-viewer")).toBeTruthy());
    expect(screen.queryByTestId("changed-on-disk-banner")).toBeNull();
  });
});
