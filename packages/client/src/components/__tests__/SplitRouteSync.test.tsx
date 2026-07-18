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

vi.mock("../split/SplitWorkspaceContext.js", () => ({
  useSplitWorkspace: () => ({ openInSplit, openUrlTarget, openLiveTarget, ensureRevealed }),
}));

import { SplitRouteSync } from "../split/SessionSplitView.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
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
