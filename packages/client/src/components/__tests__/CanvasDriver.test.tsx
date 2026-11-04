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
import type { CanvasState } from "../../lib/canvas/canvas-gate.js";
import { EMPTY_CANVAS_STATE } from "../../lib/canvas/canvas-gate.js";
import { CanvasDriver } from "../canvas/CanvasDriver.js";
import { SplitWorkspaceProvider, useSplitWorkspace } from "../split/SplitWorkspaceContext.js";

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

describe("#E30 canvas provenance source (change: surface-denial-remedy-in-previews, D4)", () => {
  const tabOf = (path: string) => api?.paneState.openFiles.find((f) => f.path === path);

  it("(a) the auto-open effect opens the tab as auto-opened; restrictCsp unchanged", () => {
    render(<Harness initial={EMPTY_CANVAS_STATE} />);
    act(() => setCanvasState(fileState("agent.png")));
    expect(tabOf("agent.png")).toMatchObject({ autoOpened: true, restrictCsp: true });
  });

  it("(b) a chip tap opens it as operator-opened; restrictCsp unchanged", () => {
    tier = "mobile";
    render(<Harness initial={fileState("tapped.png")} />);
    fireEvent.click(screen.getByTestId("canvas-file-chip"));
    expect(tabOf("tapped.png")).toMatchObject({ autoOpened: false, restrictCsp: true });
  });
});

describe("CanvasDriver — target withheld by the mobile gate opens once the viewport grows", () => {
  it("mobile → desktop resize auto-opens the pending target (key not consumed while gated)", () => {
    tier = "mobile";
    const s = fileState("b.ts");
    render(<Harness initial={s} />);
    expect(api?.paneState.openFiles).toHaveLength(0);

    // Viewport grows to desktop: same target/version, tier changes → re-render.
    tier = "desktop";
    act(() => setCanvasState({ ...s }));
    expect(api?.paneState.openFiles.map((f) => f.path)).toEqual(["b.ts"]);
  });

  it("does not re-open an already-opened target on an unrelated re-render", () => {
    const s = fileState("b.ts");
    render(<Harness initial={s} />);
    expect(api?.paneState.openFiles).toHaveLength(1);
    act(() => api?.dispatch({ type: "closeTab", index: 0 }));
    act(() => setCanvasState({ ...s }));
    expect(api?.paneState.openFiles ?? []).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Chip tray: in-column slot above the composer dock, fixed overlay fallback.
// Test-plan #E12-#E18, #X1, #F18. See change: fix-chat-transcript-layout (D5);
// was fix-canvas-chip-tray-overlay (#E3/#E5 kept for the fallback).
// ---------------------------------------------------------------------------

const chipState: CanvasState = {
  ...EMPTY_CANVAS_STATE,
  chip: { kind: "server", port: 4321, title: "Dev server" } as CanvasState["chip"],
};

function renderTray(state: CanvasState, anchor?: HTMLElement | null) {
  const ui = (a: HTMLElement | null | undefined) => (
    <SplitWorkspaceProvider sessionId="sTray" cwd="/proj" orientation="h">
      <Probe />
      <CanvasDriver state={state} anchor={a} />
    </SplitWorkspaceProvider>
  );
  const r = render(ui(anchor));
  return { ...r, rerenderAnchor: (a: HTMLElement | null | undefined) => r.rerender(ui(a)) };
}

describe("CanvasDriver — chip tray slot", () => {
  const anchorHosts: HTMLElement[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    // Only remove what this suite created — RTL cleanup owns the portal node.
    for (const h of anchorHosts.splice(0)) h.remove();
  });

  function makeAnchor() {
    const parent = document.createElement("div");
    const anchor = document.createElement("div");
    anchor.setAttribute("data-testid", "composer-stack-anchor");
    parent.append(anchor, document.createElement("div"));
    document.body.append(parent);
    anchorHosts.push(parent);
    return anchor;
  }

  it("#E12: anchor set (split closed/split) → tray in the slot, in flow, with a bottom gap", () => {
    const anchor = makeAnchor();
    renderTray(chipState, anchor);
    const tray = screen.getByTestId("canvas-chip-tray");
    expect(anchor.contains(tray)).toBe(true);
    expect(tray.parentElement).not.toBe(document.body);
    expect(tray.className).not.toContain("fixed");
    expect(tray.style.bottom).toBe("");
    expect(tray.style.right).toBe("");
    expect(tray.className.split(/\s+/)).toContain("pb-3");
    expect(api?.split.mode).toBe("closed");
    act(() => api?.setMode("split"));
    expect(anchor.contains(screen.getByTestId("canvas-chip-tray"))).toBe(true);
  });

  it("#E13/#E3: no anchor → portaled to body, fixed, safe-area fallback bottom, visible", () => {
    renderTray(chipState);
    const tray = screen.getByTestId("canvas-chip-tray");
    expect(tray.parentElement).toBe(document.body);
    expect(tray.className).toContain("fixed");
    expect(tray.style.bottom).toBe("calc(1rem + env(safe-area-inset-bottom))");
    expect(tray.style.visibility).not.toBe("hidden");
  });

  it("#E5: fallback tray ignores pointer input, chips take it", () => {
    tier = "mobile";
    renderTray({ ...chipState, target: { kind: "file", cwd: "/proj", path: "a.md" }, version: 1 });
    expect(screen.getByTestId("canvas-chip-tray").className).toContain("pointer-events-none");
    expect(screen.getByTestId("canvas-file-chip").className).toContain("pointer-events-auto");
    expect(screen.getByTestId("canvas-server-chip").className).toContain("pointer-events-auto");
  });

  it("#E14: full-editor mode hides the chat pane → fallback overlay; split → back in the slot", () => {
    const anchor = makeAnchor();
    renderTray(chipState, anchor);
    act(() => api?.setMode("full"));
    let tray = screen.getByTestId("canvas-chip-tray");
    expect(anchor.contains(tray)).toBe(false);
    expect(tray.parentElement).toBe(document.body);
    expect(tray.className).toContain("fixed");
    act(() => api?.setMode("split"));
    tray = screen.getByTestId("canvas-chip-tray");
    expect(anchor.contains(tray)).toBe(true);
    act(() => api?.setMode("closed"));
    expect(anchor.contains(screen.getByTestId("canvas-chip-tray"))).toBe(true);
  });

  it("#E15: chips in the slot stay in the accessibility tree", () => {
    const anchor = makeAnchor();
    renderTray(chipState, anchor);
    const chip = screen.getByRole("button", { name: /Dev server/ });
    expect(anchor.contains(chip)).toBe(true);
    expect(anchor.closest("[aria-hidden]")).toBe(null);
  });

  it("#E17: the slot path creates no ResizeObserver / MutationObserver / viewport listener", () => {
    const ro = vi.fn();
    const mo = vi.fn();
    const origRO = globalThis.ResizeObserver;
    const origMO = globalThis.MutationObserver;
    globalThis.ResizeObserver = class {
      constructor() {
        ro();
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    globalThis.MutationObserver = class {
      constructor() {
        mo();
      }
      observe() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    } as unknown as typeof MutationObserver;
    const added: string[] = [];
    vi.spyOn(window, "addEventListener").mockImplementation((t: string) => {
      added.push(t);
    });
    try {
      const anchor = makeAnchor();
      const { unmount } = renderTray(chipState, anchor);
      unmount();
      expect(ro).not.toHaveBeenCalled();
      expect(mo).not.toHaveBeenCalled();
      expect(added).not.toContain("resize");
    } finally {
      globalThis.ResizeObserver = origRO;
      globalThis.MutationObserver = origMO;
    }
  });

  /**
   * @structural-pin E18: the App's live-composer guard (`!frozen && !readOnly`) around the chip slot cannot be rendered in isolation (App needs the full server/session harness); the guard is pinned on the source text.
   */
  it("#E18: a frozen / read-only composer column never renders the slot (App guard)", async () => {
    // The App renders the slot ONLY for a live composer, so a frozen underlay or a
    // read-only session leaves `anchor` null → fallback overlay (covered by #E13).
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.resolve(__dirname, "../../App.tsx"), "utf8");
    const slot = src.indexOf('data-testid="composer-stack-anchor"');
    expect(slot).toBeGreaterThan(0);
    const guard = src.lastIndexOf("{!frozen && !readOnly && (", slot);
    expect(guard).toBeGreaterThan(0);
    expect(slot - guard).toBeLessThan(200);
    renderTray(chipState, null);
    expect(screen.getByTestId("canvas-chip-tray").parentElement).toBe(document.body);
  });

  it("#X1: the anchor going away while a chip is live moves the tray to the fallback", () => {
    const anchor = makeAnchor();
    const { rerenderAnchor } = renderTray(chipState, anchor);
    expect(anchor.contains(screen.getByTestId("canvas-chip-tray"))).toBe(true);
    rerenderAnchor(null); // must not throw
    const tray = screen.getByTestId("canvas-chip-tray");
    expect(tray.parentElement).toBe(document.body);
    expect(screen.getAllByTestId("canvas-server-chip")).toHaveLength(1);
  });

  it("#F18: the fallback tray sits on the overlay layer, below toasts/dialogs", () => {
    renderTray(chipState);
    const tray = screen.getByTestId("canvas-chip-tray");
    expect(tray.className).toContain("z-overlay");
    expect(tray.className).not.toMatch(/z-(toast|modal|dialog|popover)/);
    expect(tray.className).toContain("pointer-events-none");
  });
});

describe("CanvasServerChip — long path truncates (#E16)", () => {
  for (const p of ["", `/${"x".repeat(120)}`]) {
    it(`address span truncates (path length ${p.length})`, () => {
      renderTray({ ...EMPTY_CANVAS_STATE, chip: { kind: "server", port: 4321, title: "Dev", path: p } as CanvasState["chip"] });
      const chip = screen.getByTestId("canvas-server-chip");
      const spans = chip.querySelectorAll(":scope > span");
      const address = spans[spans.length - 1] as HTMLElement;
      expect(address.className).toContain("min-w-0");
      expect(address.className).toContain("truncate");
      expect(address.className).not.toContain("shrink-0");
      expect((spans[0] as HTMLElement).className).toContain("truncate");
    });
  }
});
