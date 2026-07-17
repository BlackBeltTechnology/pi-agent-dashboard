/**
 * CanvasDriver intent audit (change: non-disruptive-file-open, tasks §3.4).
 *
 * The shared `useOpenTarget` callback is reached by BOTH the auto-open effect
 * (agent → background) AND the mobile chip onClick (user tap → foreground).
 * These tests pin that split: the effect adds silently (unread, no focus
 * steal) on desktop; a mobile chip tap activates the tab (foreground).
 */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasState } from "../../lib/canvas-gate.js";
import { EMPTY_CANVAS_STATE } from "../../lib/canvas-gate.js";
import { CanvasDriver } from "../CanvasDriver.js";
import { SplitWorkspaceProvider, useSplitWorkspace } from "../SplitWorkspaceContext.js";

// Drive the responsive tier deterministically per-test.
let tier: "mobile" | "tablet" | "desktop" = "desktop";
vi.mock("../../hooks/useCanvasTier.js", () => ({ useCanvasTier: () => tier }));

function fileState(path: string): CanvasState {
  return { ...EMPTY_CANVAS_STATE, target: { kind: "file", cwd: "/proj", path }, version: 1 };
}

// Live handle onto the provider api, refreshed every render.
let api: ReturnType<typeof useSplitWorkspace> | null = null;
function Probe() {
  api = useSplitWorkspace();
  return null;
}

// Harness lets a test swap the canvas state (simulating an agent canvas target).
let setCanvasState: (s: CanvasState) => void = () => {};
function Harness({ initial }: { initial: CanvasState }) {
  const [state, setState] = useState(initial);
  setCanvasState = setState;
  return (
    <SplitWorkspaceProvider sessionId="sCanvas" cwd="/proj" orientation="h">
      <Probe />
      <CanvasDriver state={state} />
    </SplitWorkspaceProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
  tier = "desktop";
  api = null;
});
afterEach(() => cleanup());

describe("CanvasDriver — auto-open effect is background (desktop)", () => {
  it("F12: agent canvas open while reading a.ts leaves a.ts active + marks b.ts unread", () => {
    render(<Harness initial={EMPTY_CANVAS_STATE} />);
    // Seed a reading context: open a.ts foreground first.
    act(() => api?.openInSplit("a.ts"));
    expect(api?.paneState.openFiles[api.paneState.activeIndex].path).toBe("a.ts");

    // Agent canvas targets b.ts → the effect opens it in the BACKGROUND.
    act(() => setCanvasState(fileState("b.ts")));

    const files = api?.paneState.openFiles ?? [];
    expect(files.map((f) => f.path)).toEqual(["a.ts", "b.ts"]);
    expect(files[api?.paneState.activeIndex ?? -1].path).toBe("a.ts"); // no focus steal
    expect(files[1].unread).toBe(true);
    expect(api?.split.mode).toBe("split");
  });
});

describe("CanvasDriver — mobile chip tap is foreground", () => {
  it("F15: tapping the chip opens the target as the ACTIVE tab, not unread", () => {
    tier = "mobile";
    render(<Harness initial={fileState("b.ts")} />);
    // Mobile: the effect must NOT auto-open (no yank).
    expect(api?.paneState.openFiles).toHaveLength(0);

    // Tap the chip → foreground open.
    fireEvent.click(screen.getByTestId("canvas-file-chip"));
    expect(api?.paneState.openFiles.map((f) => f.path)).toEqual(["b.ts"]);
    expect(api?.paneState.activeIndex).toBe(0);
    expect(api?.paneState.openFiles[0].unread).toBeUndefined();
  });
});
