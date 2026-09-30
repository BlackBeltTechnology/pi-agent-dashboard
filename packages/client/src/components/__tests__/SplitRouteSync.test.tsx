/**
 * `SplitRouteSync` bridges the `/session/:id/editor` deep-link into the split:
 * `?file=` → `openInSplit`, `?url=` → `openUrlTarget` (or `openLiveTarget` for a
 * loopback URL), with `file` authoritative when both are present (D6).
 *
 * See change: open-view-command-in-editor-pane (D1/D6, tasks 6.4/6.5).
 */
import { cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const openInSplit = vi.fn();
const openUrlTarget = vi.fn();
const openLiveTarget = vi.fn();
const ensureRevealed = vi.fn();

// `ctx.fresh()` hands out NEW opener identities (what a split `mode` change —
// e.g. closing the editor — does to the real provider) that still count into
// the same spies.
const ctx = {
  sessionId: "S1",
  openers: { openInSplit, openUrlTarget, openLiveTarget, ensureRevealed } as Record<string, (...a: unknown[]) => unknown>,
  fresh() {
    this.openers = {
      openInSplit: (...a: unknown[]) => openInSplit(...a),
      openUrlTarget: (...a: unknown[]) => openUrlTarget(...a),
      openLiveTarget: (...a: unknown[]) => openLiveTarget(...a),
      ensureRevealed: (...a: unknown[]) => ensureRevealed(...a),
    };
  },
};

vi.mock("../split/SplitWorkspaceContext.js", () => ({
  useSplitWorkspace: () => ({ sessionId: ctx.sessionId, ...ctx.openers }),
}));

import { SplitRouteSync } from "../split/SessionSplitView.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  ctx.sessionId = "S1";
  ctx.openers = { openInSplit, openUrlTarget, openLiveTarget, ensureRevealed };
});

describe("SplitRouteSync — /view route bridge", () => {
  it("?file= → openInSplit", () => {
    render(<SplitRouteSync active file="src/foo.ts" />);
    expect(openInSplit).toHaveBeenCalledWith("src/foo.ts", undefined);
    expect(openUrlTarget).not.toHaveBeenCalled();
  });

  it("?url= (public) → openUrlTarget", () => {
    render(<SplitRouteSync active url="https://youtu.be/x" />);
    expect(openUrlTarget).toHaveBeenCalledWith("https://youtu.be/x");
    expect(openLiveTarget).not.toHaveBeenCalled();
  });

  it("?url= loopback → openLiveTarget (SSRF-gated)", () => {
    render(<SplitRouteSync active url="http://localhost:5173" />);
    expect(openLiveTarget).toHaveBeenCalledWith("http://localhost:5173");
    expect(openUrlTarget).not.toHaveBeenCalled();
  });

  it("D6: both ?file= and ?url= → file wins, url ignored", () => {
    render(<SplitRouteSync active file="a.ts" url="https://x.com" />);
    expect(openInSplit).toHaveBeenCalledWith("a.ts", undefined);
    expect(openUrlTarget).not.toHaveBeenCalled();
    expect(openLiveTarget).not.toHaveBeenCalled();
  });

  it("inactive route → no opener called", () => {
    render(<SplitRouteSync active={false} file="a.ts" url="https://x.com" />);
    expect(openInSplit).not.toHaveBeenCalled();
    expect(openUrlTarget).not.toHaveBeenCalled();
  });
});

// Regression: closing the split changes `mode`, which recreates every opener.
// The route target is unchanged, so the bridge must NOT re-open (the editor
// could not be closed after a deep-link open). See change: attach-flow-before-run.
describe("SplitRouteSync — applies a route target once", () => {
  it("opener identity change (split closed) does not re-open the same target", () => {
    const { rerender } = render(<SplitRouteSync active file="a.ts" />);
    expect(openInSplit).toHaveBeenCalledTimes(1);
    ctx.fresh();
    rerender(<SplitRouteSync active file="a.ts" />);
    ctx.fresh();
    rerender(<SplitRouteSync active file="a.ts" />);
    expect(openInSplit).toHaveBeenCalledTimes(1);
  });

  it("same for ?url= and the param-less reveal", () => {
    const u = render(<SplitRouteSync active url="https://x.com" />);
    ctx.fresh();
    u.rerender(<SplitRouteSync active url="https://x.com" />);
    expect(openUrlTarget).toHaveBeenCalledTimes(1);
    u.unmount();
    const r = render(<SplitRouteSync active />);
    ctx.fresh();
    r.rerender(<SplitRouteSync active />);
    expect(ensureRevealed).toHaveBeenCalledTimes(1);
  });

  it("a new file, a new line, or another session re-applies", () => {
    const { rerender } = render(<SplitRouteSync active file="a.ts" />);
    rerender(<SplitRouteSync active file="b.ts" />);
    rerender(<SplitRouteSync active file="b.ts" line={7} />);
    ctx.sessionId = "S2";
    ctx.fresh();
    rerender(<SplitRouteSync active file="b.ts" line={7} />);
    expect(openInSplit.mock.calls).toEqual([
      ["a.ts", undefined],
      ["b.ts", undefined],
      ["b.ts", 7],
      ["b.ts", 7],
    ]);
  });

  it("leaving and re-entering the route (back/forward) re-applies", () => {
    const { rerender } = render(<SplitRouteSync active file="a.ts" />);
    rerender(<SplitRouteSync active={false} file={null} />);
    rerender(<SplitRouteSync active file="a.ts" />);
    expect(openInSplit).toHaveBeenCalledTimes(2);
  });
});
