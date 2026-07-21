/**
 * Seek-to-card reveal behavior in SessionList.
 * See change: add-seek-to-session-card.
 *
 * Covers test-plan scenarios:
 *   F1  buried-reveal (workspace + folder + ended)   -> T.1
 *   F2  nonce re-fire (same id, bumped nonce)         -> T.2
 *   F3/X1 laid-out wait + height predicate            -> T.3
 *   X3/X4/X5 hidden / tag / folder-path degrade       -> T.4
 *   E2/E3/E4 ancestor resolution + idempotence        -> T.5
 *   E5/X2/F4 backstop + Retry toast + no-leak         -> T.6
 *
 * DOM model exploited by these tests:
 *   - a COLLAPSED WORKSPACE does not render its folders/cards (conditional);
 *   - a COLLAPSED FOLDER renders cards inside `.group-collapse.collapsed`
 *     (grid-rows:0fr, height 0 — present but not laid out);
 *   - an ENDED session's card is absent until its cwd is in `endedExpanded`.
 * Presence therefore requires workspace + folder + ended all open, and the
 * reveal predicate is `getBoundingClientRect().height > 0` (mocked here).
 */

import type { Workspace } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { SessionList } from "../session/SessionList.js";
import { ThemeProvider } from "../settings/ThemeProvider.js";

function TestRouter({ children }: { children: React.ReactNode }) {
  const { hook } = memoryLocation({ path: "/", static: true });
  return <Router hook={hook}>{children}</Router>;
}

let scrollSpy: ReturnType<typeof vi.fn>;
let rectHeight: number;

beforeEach(() => {
  vi.useFakeTimers();
  rectHeight = 30;
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
    clear: () => { for (const k in store) delete store[k]; },
    get length() { return Object.keys(store).length; },
    key: (i: number) => Object.keys(store)[i] ?? null,
  });
  // rAF -> setTimeout(0) so it fires AFTER React commits the expand re-render
  // (a synchronous rAF stub would run before the pending setState commits).
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 0) as unknown as number);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  scrollSpy = vi.fn();
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true, writable: true, value: scrollSpy,
  });
  Object.defineProperty(Element.prototype, "getBoundingClientRect", {
    configurable: true, writable: true,
    value: function () {
      return { height: rectHeight, width: 100, top: 0, left: 0, right: 100, bottom: rectHeight, x: 0, y: 0, toJSON() {} };
    },
  });
});

afterEach(() => {
  act(() => { vi.runOnlyPendingTimers(); });
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

function s(overrides: Partial<DashboardSession> = {}): DashboardSession {
  return {
    id: "s1", cwd: "/proj", source: "tui", status: "active",
    startedAt: Date.now() - 60000, tokensIn: 0, tokensOut: 0, cost: 0,
    ...overrides,
  } as DashboardSession;
}

function seedCollapsed(cwds: string[]) {
  localStorage.setItem("dashboard:collapsedGroups", JSON.stringify(cwds));
}

interface Ctl {
  seek: (id: string) => void;
  setWorkspaces: (ws: Workspace[] | undefined) => void;
}

const Harness = React.forwardRef<Ctl, {
  sessions: DashboardSession[];
  workspaces?: Workspace[];
  initialSelectedId?: string;
  onSelect?: (id: string) => void;
  onSetWorkspaceCollapsed?: (id: string, collapsed: boolean) => void;
}>((props, ref) => {
  const [selectedId, setSelectedId] = React.useState<string | undefined>(props.initialSelectedId);
  const [revealRequest, setRevealRequest] = React.useState<{ sessionId: string; nonce: number } | null>(null);
  const [workspaces, setWorkspaces] = React.useState<Workspace[] | undefined>(props.workspaces);
  const seek = React.useCallback(
    (id: string) => setRevealRequest((p) => ({ sessionId: id, nonce: (p?.nonce ?? 0) + 1 })),
    [],
  );
  React.useImperativeHandle(ref, () => ({ seek, setWorkspaces }), [seek]);
  return (
    <TestRouter>
      <ThemeProvider>
        <SessionList
          sessions={props.sessions}
          selectedId={selectedId}
          onSelect={(id) => { props.onSelect?.(id); setSelectedId(id); }}
          revealRequest={revealRequest}
          onSeekToCard={seek}
          workspaces={workspaces}
          onSetWorkspaceCollapsed={props.onSetWorkspaceCollapsed}
        />
      </ThemeProvider>
    </TestRouter>
  );
});

function mount(props: React.ComponentProps<typeof Harness>) {
  const ref = React.createRef<Ctl>();
  const utils = render(<Harness ref={ref} {...props} />);
  return { ...utils, ctl: ref.current as Ctl };
}

/** Advance timers (flushes the rAF setTimeout(0)) inside act. */
function tick(ms = 1) {
  act(() => { vi.advanceTimersByTime(ms); });
}

const cardOf = (c: HTMLElement, id: string) => c.querySelector(`[data-session-id="${id}"]`);
const hasActionToast = (c: HTMLElement) => !!c.querySelector('[data-testid="toast-action"]');

describe("SessionList seek-to-card", () => {
  // ── T.1 / F1 ──────────────────────────────────────────────────────────
  it("reveals a card buried under collapsed workspace + folder + ended group", () => {
    seedCollapsed(["/proj"]);
    const onSetWorkspaceCollapsed = vi.fn();
    const onSelect = vi.fn();
    const sessions = [s({ id: "s1", status: "ended", sessionFile: "/x.jsonl" })];
    const ws: Workspace = { id: "w1", name: "WS", collapsed: true, folders: ["/proj"] };
    const { container, ctl } = mount({ sessions, workspaces: [ws], onSelect, onSetWorkspaceCollapsed });

    act(() => { ctl.seek("s1"); });
    // Ancestor guards fired synchronously.
    expect(onSetWorkspaceCollapsed).toHaveBeenCalledWith("w1", false);
    expect(onSelect).toHaveBeenCalledWith("s1");
    tick(); // immediate rAF: workspace still collapsed => card absent, no scroll
    expect(scrollSpy).not.toHaveBeenCalled();

    // Echo lands: workspace expands.
    act(() => { ctl.setWorkspaces([{ ...ws, collapsed: false }]); });
    tick();
    // Ended card is now in the DOM (endedExpanded added) and laid out.
    expect(cardOf(container, "s1")).not.toBeNull();
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
  });

  // ── T.2 / F2 ──────────────────────────────────────────────────────────
  it("re-fires the reveal on a bumped nonce for the SAME id", () => {
    const sessions = [s({ id: "s1" })];
    const { ctl } = mount({ sessions });
    act(() => { ctl.seek("s1"); });
    tick();
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    act(() => { ctl.seek("s1"); }); // same id, new nonce
    tick();
    expect(scrollSpy).toHaveBeenCalledTimes(2);
  });

  // ── T.3 / F3 + X1 ─────────────────────────────────────────────────────
  it("waits for the card to be laid out (height>0) before scrolling; height-0 does not scroll", () => {
    const sessions = [s({ id: "s1" })];
    rectHeight = 0; // present in DOM but 0-height (grid-rows:0fr row)
    const { ctl } = mount({ sessions });
    act(() => { ctl.seek("s1"); });
    tick();
    // X1: offsetParent would be non-null, but height 0 => no scroll.
    expect(scrollSpy).not.toHaveBeenCalled();
    // F3: becomes laid out; a workspaces-prop update (echo) re-checks presence.
    rectHeight = 40;
    act(() => { ctl.setWorkspaces([]); });
    tick();
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  // ── T.4 / X3 hidden ───────────────────────────────────────────────────
  it("degrades a hidden session to an informational toast; no reveal, no showHidden flip", () => {
    const onSetWorkspaceCollapsed = vi.fn();
    const sessions = [s({ id: "s1", hidden: true })];
    const { container, ctl, getByTestId } = mount({ sessions, onSetWorkspaceCollapsed });
    const hiddenToggleBefore = getByTestId("workspace-filter-input"); // sanity: list rendered
    expect(hiddenToggleBefore).toBeTruthy();
    act(() => { ctl.seek("s1"); });
    tick();
    expect(scrollSpy).not.toHaveBeenCalled();
    expect(onSetWorkspaceCollapsed).not.toHaveBeenCalled();
    // Informational toast: text present, NO action button.
    expect(container.textContent).toMatch(/hidden/i);
    expect(hasActionToast(container)).toBe(false);
  });

  // ── T.4 / X5 folder-path filter ───────────────────────────────────────
  it("degrades a folder-path-filtered session; filter unchanged, no reveal", () => {
    const sessions = [s({ id: "s1", cwd: "/proj" })];
    const { container, getByTestId, ctl } = mount({ sessions });
    fireEvent.change(getByTestId("workspace-filter-input"), { target: { value: "zzz-nomatch" } });
    act(() => { ctl.seek("s1"); });
    tick();
    expect(scrollSpy).not.toHaveBeenCalled();
    expect(hasActionToast(container)).toBe(false);
    // Filter query preserved (never cleared by the seek).
    expect((getByTestId("workspace-filter-input") as HTMLInputElement).value).toBe("zzz-nomatch");
  });

  // ── T.4 / X4 tag filter ───────────────────────────────────────────────
  it("degrades a tag-filtered session; no reveal", () => {
    const sessions = [
      s({ id: "s1", cwd: "/proj", tags: ["alpha"] }),
      s({ id: "s2", cwd: "/proj", tags: ["beta"] }),
    ];
    const { container, getByTestId, ctl } = mount({ sessions });
    // Activate the "alpha" tag filter -> s2 (beta) is excluded. Scope to the
    // filter bar (the tag also renders on the card's own tag strip).
    fireEvent.click(within(getByTestId("tag-filter-bar")).getByText("#alpha"));
    act(() => { ctl.seek("s2"); });
    tick();
    expect(scrollSpy).not.toHaveBeenCalled();
    expect(hasActionToast(container)).toBe(false);
  });

  // ── T.5 / E3 no-workspace ─────────────────────────────────────────────
  it("resolves no workspace ancestor when the cwd is in no workspace (no onSetWorkspaceCollapsed)", () => {
    const onSetWorkspaceCollapsed = vi.fn();
    const sessions = [s({ id: "s1", cwd: "/proj" })];
    const ws: Workspace = { id: "w1", name: "WS", collapsed: false, folders: ["/other"] };
    const { ctl } = mount({ sessions, workspaces: [ws], onSetWorkspaceCollapsed });
    act(() => { ctl.seek("s1"); });
    tick();
    expect(onSetWorkspaceCollapsed).not.toHaveBeenCalled();
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  // ── T.5 / E2 non-ended ────────────────────────────────────────────────
  it("does not expand the ended group when the sought session is active (E2)", () => {
    const sessions = [
      s({ id: "s1", cwd: "/proj", status: "active" }),
      s({ id: "s2", cwd: "/proj", status: "ended", sessionFile: "/e.jsonl" }),
    ];
    const { container, ctl } = mount({ sessions });
    act(() => { ctl.seek("s1"); });
    tick();
    // The active sibling revealed, but the ended card stays hidden.
    expect(cardOf(container, "s1")).not.toBeNull();
    expect(cardOf(container, "s2")).toBeNull();
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });

  // ── T.5 / E4 idempotence ──────────────────────────────────────────────
  it("does not re-collapse already-expanded ancestors on seek (folder guard)", () => {
    const sessions = [s({ id: "s1", cwd: "/proj", status: "active" })];
    const { container, ctl } = mount({ sessions }); // folder expanded by default
    act(() => { ctl.seek("s1"); });
    tick();
    const body = container.querySelector(".group-collapse");
    expect(body?.classList.contains("expanded")).toBe(true);
    expect(body?.classList.contains("collapsed")).toBe(false);
  });

  it("re-seeking an ended card keeps it expanded (add-only ended setter, not toggle)", () => {
    // Active sibling so the folder renders; s1 is the ended card being sought.
    const sessions = [
      s({ id: "s0", cwd: "/proj", status: "active" }),
      s({ id: "s1", cwd: "/proj", status: "ended", sessionFile: "/e.jsonl" }),
    ];
    const { container, ctl } = mount({ sessions });
    act(() => { ctl.seek("s1"); });
    tick();
    expect(cardOf(container, "s1")).not.toBeNull();
    act(() => { ctl.seek("s1"); }); // second seek must NOT toggle the ended group closed
    tick();
    expect(cardOf(container, "s1")).not.toBeNull();
  });

  // ── T.6 / E5 + X2 + F4 ────────────────────────────────────────────────
  it("shows a non-auto-dismissing Retry toast only after the 5s backstop when the echo never lands", () => {
    const sessions = [s({ id: "s1", cwd: "/proj" })];
    const ws: Workspace = { id: "w1", name: "WS", collapsed: true, folders: ["/proj"] };
    const { container, ctl } = mount({ sessions, workspaces: [ws], onSetWorkspaceCollapsed: () => {} });
    act(() => { ctl.seek("s1"); });
    tick();
    // Before the backstop: no toast.
    tick(4900);
    expect(hasActionToast(container)).toBe(false);
    // At/after 5s: Retry toast (with an action button).
    tick(200);
    expect(hasActionToast(container)).toBe(true);
  });

  it("completes the reveal and shows NO toast when the echo lands before the backstop", () => {
    const sessions = [s({ id: "s1", cwd: "/proj" })];
    const ws: Workspace = { id: "w1", name: "WS", collapsed: true, folders: ["/proj"] };
    const { container, ctl } = mount({ sessions, workspaces: [ws], onSetWorkspaceCollapsed: () => {} });
    act(() => { ctl.seek("s1"); });
    tick(2000);
    act(() => { ctl.setWorkspaces([{ ...ws, collapsed: false }]); });
    tick();
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    tick(6000); // past the backstop
    expect(hasActionToast(container)).toBe(false);
  });

  it("fires no frame/timer callback after unmount (no leak)", () => {
    const sessions = [s({ id: "s1", cwd: "/proj" })];
    const ws: Workspace = { id: "w1", name: "WS", collapsed: true, folders: ["/proj"] };
    const { ctl, unmount } = mount({ sessions, workspaces: [ws], onSetWorkspaceCollapsed: () => {} });
    act(() => { ctl.seek("s1"); });
    tick();
    act(() => { unmount(); });
    tick(6000);
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it("Retry re-dispatches a reveal for the same session (F4)", () => {
    const sessions = [s({ id: "s1", cwd: "/proj" })];
    const ws: Workspace = { id: "w1", name: "WS", collapsed: true, folders: ["/proj"] };
    const { container, ctl, getByTestId } = mount({ sessions, workspaces: [ws], onSetWorkspaceCollapsed: () => {} });
    act(() => { ctl.seek("s1"); });
    tick(5100); // backstop -> Retry toast
    expect(hasActionToast(container)).toBe(true);
    act(() => { fireEvent.click(getByTestId("toast-action")); }); // re-fires seek
    // Now let the echo land -> the re-dispatched reveal completes.
    act(() => { ctl.setWorkspaces([{ ...ws, collapsed: false }]); });
    tick();
    expect(scrollSpy).toHaveBeenCalledTimes(1);
  });
});
