import type { TerminalSession } from "@blackbelt-technology/pi-dashboard-shared/terminal-types.js";
import { act, renderHook } from "@testing-library/react";
import { StrictMode, useReducer } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  type EditorPaneAction,
  type EditorPaneState,
  EMPTY_PANE_STATE,
  editorPaneReducer,
  type OpenFile,
} from "../layout/editor-pane-state.js";
import {
  openTerminalIds,
  reconcileTerminalTabs,
  stripTermId,
  useTerminalPaneTabs,
} from "../layout/use-terminal-pane-tabs.js";

const term = (path: string): OpenFile => ({ path, viewer: "terminal", addedAt: 1 });
const file = (path: string): OpenFile => ({ path, viewer: "monaco", addedAt: 1 });
const session = (id: string, extra: Partial<TerminalSession> = {}): TerminalSession => ({
  id,
  cwd: "/w",
  shell: "/bin/zsh",
  status: "active",
  createdAt: 1,
  ...extra,
});

describe("stripTermId / openTerminalIds", () => {
  it("stripTermId returns id only for term: paths", () => {
    expect(stripTermId("term:abc")).toBe("abc");
    expect(stripTermId("src/a.ts")).toBeNull();
    expect(stripTermId("diff:src/a.ts")).toBeNull();
  });

  it("openTerminalIds extracts only terminal tabs, in order", () => {
    const files = [file("a.ts"), term("term:t1"), file("b.ts"), term("term:t2")];
    expect(openTerminalIds(files)).toEqual(["t1", "t2"]);
  });
});

describe("reconcileTerminalTabs (pure planner)", () => {
  it("drops term tabs whose id is not live (D5)", () => {
    const files = [file("a.ts"), term("term:dead"), term("term:live")];
    const plan = reconcileTerminalTabs(files, new Set(["live"]), false);
    expect(plan.closePaths).toEqual(["term:dead"]);
    expect(plan.openIds).toEqual([]);
  });

  it("auto-surface opens live terminals lacking a tab (D3 folder)", () => {
    const files = [file("a.ts"), term("term:t1")];
    const plan = reconcileTerminalTabs(files, new Set(["t1", "t2", "t3"]), true);
    expect(plan.closePaths).toEqual([]);
    expect(plan.openIds.sort()).toEqual(["t2", "t3"]);
  });

  it("opt-in mode never auto-opens (D3 split)", () => {
    const plan = reconcileTerminalTabs([file("a.ts")], new Set(["t1"]), false);
    expect(plan.openIds).toEqual([]);
  });

  it("never touches non-terminal tabs", () => {
    const files = [file("a.ts"), { path: "diff:a.ts", viewer: "diff" as const, addedAt: 1 }];
    const plan = reconcileTerminalTabs(files, new Set(), true);
    expect(plan.closePaths).toEqual([]);
  });

  it("cold-load guard: an empty live set drops nothing (snapshot not yet arrived)", () => {
    // A page reload restores persisted term tabs before the WS snapshot lands;
    // dropping here would wipe live tabs. Empty set == unknown, keep them.
    const files = [term("term:t1"), term("term:t2")];
    const plan = reconcileTerminalTabs(files, new Set(), false);
    expect(plan.closePaths).toEqual([]);
  });
});

/** Drive the real pane reducer so hook effects mutate observable state. */
function harness(opts: {
  terminals: TerminalSession[];
  autoSurface: boolean;
  initial?: EditorPaneState;
  handlers?: Partial<Parameters<typeof useTerminalPaneTabs>[0]>;
}) {
  const onCreateTerminal = vi.fn();
  const onKillTerminal = vi.fn();
  const onRenameTerminal = vi.fn();
  const ensureOpen = vi.fn();
  return renderHook(
    ({ terminals }: { terminals: TerminalSession[] }) => {
      const [paneState, dispatch] = useReducer(
        editorPaneReducer,
        opts.initial ?? EMPTY_PANE_STATE,
      );
      const api = useTerminalPaneTabs({
        cwd: "/w",
        terminals,
        autoSurface: opts.autoSurface,
        paneState,
        dispatch: dispatch as React.Dispatch<EditorPaneAction>,
        ensureOpen,
        onCreateTerminal,
        onKillTerminal,
        onRenameTerminal,
        ...opts.handlers,
      });
      return { paneState, api, mocks: { onCreateTerminal, onKillTerminal, onRenameTerminal, ensureOpen } };
    },
    { initialProps: { terminals: opts.terminals } },
  );
}

describe("useTerminalPaneTabs", () => {
  it("filters ephemeral terminals out of the exposed set", () => {
    const { result } = harness({
      terminals: [session("t1"), session("e1", { ephemeral: true })],
      autoSurface: false,
    });
    expect(result.current.api.terminals.map((t) => t.id)).toEqual(["t1"]);
  });

  it("folder pane auto-surfaces every cwd terminal on mount (D3)", () => {
    const { result } = harness({ terminals: [session("t1"), session("t2")], autoSurface: true });
    expect(openTerminalIds(result.current.paneState.openFiles).sort()).toEqual(["t1", "t2"]);
  });

  it("reconcile drops a stale persisted term tab on mount (D5)", () => {
    const { result } = harness({
      terminals: [session("live")],
      autoSurface: false,
      initial: { openFiles: [term("term:dead"), term("term:live")], activeIndex: 1, treeOpenRoots: [] },
    });
    expect(openTerminalIds(result.current.paneState.openFiles)).toEqual(["live"]);
  });

  it("cold-load: persisted term tabs survive an empty-then-populated terminal set (session split)", () => {
    // Mount with NO terminals (snapshot pending) but persisted term tabs.
    const { result, rerender } = harness({
      terminals: [],
      autoSurface: false,
      initial: { openFiles: [term("term:a"), term("term:b")], activeIndex: 0, treeOpenRoots: [] },
    });
    // Nothing dropped while the live set is unknown (empty).
    expect(openTerminalIds(result.current.paneState.openFiles)).toEqual(["a", "b"]);
    // Snapshot arrives: `a` is live, `b` is gone → only `b` drops.
    rerender({ terminals: [session("a")] });
    expect(openTerminalIds(result.current.paneState.openFiles)).toEqual(["a"]);
  });

  it("session split opens only the freshly-created terminal (D3 opt-in)", () => {
    const { result, rerender } = harness({ terminals: [session("old")], autoSurface: false });
    // Pre-existing terminal is NOT surfaced.
    expect(openTerminalIds(result.current.paneState.openFiles)).toEqual([]);
    act(() => result.current.api.createTerminal());
    expect(result.current.mocks.onCreateTerminal).toHaveBeenCalledWith("/w");
    // Server confirms the new terminal — it should open, the old one stays hidden.
    rerender({ terminals: [session("old"), session("new")] });
    expect(openTerminalIds(result.current.paneState.openFiles)).toEqual(["new"]);
  });

  it("openTerminal opens/activates an existing terminal tab", () => {
    const { result } = harness({ terminals: [session("t1")], autoSurface: false });
    act(() => result.current.api.openTerminal("t1"));
    expect(openTerminalIds(result.current.paneState.openFiles)).toEqual(["t1"]);
    expect(result.current.mocks.ensureOpen).toHaveBeenCalled();
  });

  it("closeTerminalTab removes the tab AND kills the terminal (D4)", () => {
    const { result } = harness({
      terminals: [session("t1")],
      autoSurface: true,
    });
    expect(openTerminalIds(result.current.paneState.openFiles)).toEqual(["t1"]);
    act(() => result.current.api.closeTerminalTab("t1"));
    expect(result.current.mocks.onKillTerminal).toHaveBeenCalledWith("t1");
    expect(openTerminalIds(result.current.paneState.openFiles)).toEqual([]);
  });

  it("renameTerminal delegates to the shell handler", () => {
    const { result } = harness({ terminals: [session("t1")], autoSurface: false });
    act(() => result.current.api.renameTerminal("t1", "build"));
    expect(result.current.mocks.onRenameTerminal).toHaveBeenCalledWith("t1", "build");
  });
});

// ---------------------------------------------------------------------------
// Terminal-focused entry one-shot (change: fix-terminals-action-opens-terminal)
// Test-plan E1–E7, F1–F4, X1–X2. Folder pane = autoSurface:true.
// ---------------------------------------------------------------------------

interface FocusHarnessProps {
  terminals: TerminalSession[];
  cwd: string;
  focusOnMount: boolean;
  terminalsReady: boolean;
  withOnCreate: boolean;
}

/**
 * Harness for the D2 one-shot: drives the real pane reducer, exposes the
 * `onCreateTerminal` / `onFocusConsumed` / `ensureOpen` spies, and lets each
 * rerender override terminals / cwd / flags — or omit `onCreateTerminal` (X1).
 */
function focusHarness(opts: {
  autoSurface?: boolean;
  initial?: EditorPaneState;
  terminals?: TerminalSession[];
  cwd?: string;
  focusOnMount?: boolean;
  terminalsReady?: boolean;
  withOnCreate?: boolean;
}) {
  const mocks = { onCreateTerminal: vi.fn(), ensureOpen: vi.fn(), onFocusConsumed: vi.fn() };
  const focusOnMount = opts.focusOnMount ?? true;
  const terminalsReady = opts.terminalsReady ?? true;
  const withOnCreate = opts.withOnCreate ?? true;
  const view = renderHook(
    (props: FocusHarnessProps) => {
      const [paneState, dispatch] = useReducer(editorPaneReducer, opts.initial ?? EMPTY_PANE_STATE);
      const api = useTerminalPaneTabs({
        cwd: props.cwd,
        terminals: props.terminals,
        autoSurface: opts.autoSurface ?? true,
        paneState,
        dispatch: dispatch as React.Dispatch<EditorPaneAction>,
        ensureOpen: mocks.ensureOpen,
        onCreateTerminal: props.withOnCreate ? mocks.onCreateTerminal : undefined,
        focusOnMount: props.focusOnMount,
        terminalsReady: props.terminalsReady,
        onFocusConsumed: mocks.onFocusConsumed,
      });
      return { paneState, api };
    },
    {
      initialProps: {
        terminals: opts.terminals ?? [],
        cwd: opts.cwd ?? "/w",
        focusOnMount,
        terminalsReady,
        withOnCreate,
      } satisfies FocusHarnessProps,
    },
  );
  return { ...view, mocks };
}

const activePath = (s: EditorPaneState): string | undefined =>
  s.activeIndex >= 0 ? s.openFiles[s.activeIndex]?.path : undefined;

const props = (over: Partial<FocusHarnessProps> = {}): FocusHarnessProps => ({
  terminals: [],
  cwd: "/w",
  focusOnMount: true,
  terminalsReady: true,
  withOnCreate: true,
  ...over,
});

describe("useTerminalPaneTabs — terminal-focused entry one-shot", () => {
  it("E1: focusOnMount:false is inert — auto-surface alone decides the active tab", () => {
    // t1 is the NEWEST but sits first; auto-surface activates the LAST id (t2).
    // If the one-shot ran it would activate t1, so active=t2 proves it did not.
    const { result, mocks } = focusHarness({
      terminals: [session("t1", { createdAt: 2000 }), session("t2", { createdAt: 1000 })],
      focusOnMount: false,
      terminalsReady: true,
    });
    expect(activePath(result.current.paneState)).toBe("term:t2");
    expect(mocks.onCreateTerminal).not.toHaveBeenCalled();
    expect(mocks.onFocusConsumed).not.toHaveBeenCalled();
  });

  it("E2/E3: readiness gate defers the one-shot until the snapshot lands", () => {
    const { result, rerender, mocks } = focusHarness({
      terminals: [],
      focusOnMount: true,
      terminalsReady: false,
    });
    // Unapplied snapshot must NOT read as "no terminal" → no create.
    expect(mocks.onCreateTerminal).not.toHaveBeenCalled();
    rerender(
      props({
        terminals: [session("t1", { createdAt: 1000 }), session("t2", { createdAt: 2000 })],
      }),
    );
    expect(activePath(result.current.paneState)).toBe("term:t2");
    expect(mocks.onCreateTerminal).not.toHaveBeenCalled();
  });

  it("E4: existing terminals → newest by createdAt is activated, none created", () => {
    const { result, mocks } = focusHarness({
      terminals: [session("t1", { createdAt: 1000 }), session("t2", { createdAt: 2000 })],
    });
    expect(openTerminalIds(result.current.paneState.openFiles).sort()).toEqual(["t1", "t2"]);
    expect(activePath(result.current.paneState)).toBe("term:t2");
    expect(mocks.onCreateTerminal).not.toHaveBeenCalled();
  });

  it("E5: no terminal → exactly one create at the pane cwd", () => {
    const { mocks } = focusHarness({ terminals: [], cwd: "/home/u/proj" });
    expect(mocks.onCreateTerminal).toHaveBeenCalledTimes(1);
    expect(mocks.onCreateTerminal).toHaveBeenCalledWith("/home/u/proj");
    expect(mocks.onFocusConsumed).toHaveBeenCalledTimes(1);
  });

  it("E6: only ephemeral terminals → treated as none (one create, no term:e1 tab)", () => {
    const { result, mocks } = focusHarness({
      terminals: [session("e1", { ephemeral: true })],
    });
    expect(mocks.onCreateTerminal).toHaveBeenCalledTimes(1);
    expect(openTerminalIds(result.current.paneState.openFiles)).toEqual([]);
  });

  it("E7: equal createdAt → last element wins the tie-break", () => {
    const { result, mocks } = focusHarness({
      terminals: [session("t1", { createdAt: 5000 }), session("t2", { createdAt: 5000 })],
    });
    expect(activePath(result.current.paneState)).toBe("term:t2");
    expect(mocks.onCreateTerminal).not.toHaveBeenCalled();
  });

  it("F1: newest-not-last wins over auto-surface's last-id activation", () => {
    const { result, mocks } = focusHarness({
      // Newest (t2, 2000) at index 0; auto-surface activates the LAST id (t1).
      terminals: [session("t2", { createdAt: 2000 }), session("t1", { createdAt: 1000 })],
    });
    expect(activePath(result.current.paneState)).toBe("term:t2");
    expect(mocks.onCreateTerminal).not.toHaveBeenCalled();
  });

  it("F2: a title update re-render does not create a second terminal", () => {
    const { result, rerender, mocks } = focusHarness({ terminals: [] });
    expect(mocks.onCreateTerminal).toHaveBeenCalledTimes(1);
    rerender(props({ terminals: [session("t1", { title: "zsh" })] }));
    expect(mocks.onCreateTerminal).toHaveBeenCalledTimes(1);
    expect(activePath(result.current.paneState)).toBe("term:t1");
  });

  it("F3: onFocusConsumed fires exactly once per entry", () => {
    const { rerender, mocks } = focusHarness({ terminals: [session("t1")] });
    expect(mocks.onFocusConsumed).toHaveBeenCalledTimes(1);
    rerender(props({ terminals: [session("t1")] }));
    rerender(props({ terminals: [session("t1")] }));
    expect(mocks.onFocusConsumed).toHaveBeenCalledTimes(1);
  });

  it("F4: a cwd change resets the one-shot and honours the new cwd", () => {
    const { rerender, mocks } = focusHarness({ terminals: [], cwd: "/home/u/a" });
    expect(mocks.onCreateTerminal).toHaveBeenCalledWith("/home/u/a");
    rerender(props({ terminals: [], cwd: "/home/u/b" }));
    expect(mocks.onCreateTerminal).toHaveBeenCalledWith("/home/u/b");
    expect(mocks.onCreateTerminal).toHaveBeenCalledTimes(2);
  });

  it("X1: missing onCreateTerminal does not burn the flag; a later handler honours it", () => {
    const { rerender, mocks } = focusHarness({ terminals: [], withOnCreate: false });
    expect(mocks.onCreateTerminal).not.toHaveBeenCalled();
    rerender(props({ terminals: [], withOnCreate: true }));
    expect(mocks.onCreateTerminal).toHaveBeenCalledTimes(1);
  });

  it("X2: a create whose terminal never arrives does not retry", () => {
    const { result, rerender, mocks } = focusHarness({ terminals: [] });
    expect(mocks.onCreateTerminal).toHaveBeenCalledTimes(1);
    rerender(props({ terminals: [] }));
    rerender(props({ terminals: [] }));
    rerender(props({ terminals: [] }));
    expect(mocks.onCreateTerminal).toHaveBeenCalledTimes(1);
    expect(openTerminalIds(result.current.paneState.openFiles)).toEqual([]);
  });

  it("StrictMode: the dev double-invoke does not create a second terminal", () => {
    // React StrictMode re-runs effects on a simulated remount. A guardless
    // cwd-reset effect would un-burn `focusHandledRef` and fire a second
    // create; the previous-cwd guard keeps the reset a true cwd-change reset.
    const onCreateTerminal = vi.fn();
    const ensureOpen = vi.fn();
    const onFocusConsumed = vi.fn();
    renderHook(
      () => {
        const [paneState, dispatch] = useReducer(editorPaneReducer, EMPTY_PANE_STATE);
        useTerminalPaneTabs({
          cwd: "/w",
          terminals: [],
          autoSurface: true,
          paneState,
          dispatch: dispatch as React.Dispatch<EditorPaneAction>,
          ensureOpen,
          onCreateTerminal,
          focusOnMount: true,
          terminalsReady: true,
          onFocusConsumed,
        });
      },
      { wrapper: StrictMode },
    );
    expect(onCreateTerminal).toHaveBeenCalledTimes(1);
  });
});
