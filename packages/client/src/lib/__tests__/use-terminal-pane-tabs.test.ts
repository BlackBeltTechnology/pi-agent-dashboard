import type { TerminalSession } from "@blackbelt-technology/pi-dashboard-shared/terminal-types.js";
import { act, renderHook } from "@testing-library/react";
import { useReducer } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  type EditorPaneAction,
  type EditorPaneState,
  EMPTY_PANE_STATE,
  editorPaneReducer,
  type OpenFile,
} from "../editor-pane-state.js";
import {
  openTerminalIds,
  reconcileTerminalTabs,
  stripTermId,
  useTerminalPaneTabs,
} from "../use-terminal-pane-tabs.js";

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
