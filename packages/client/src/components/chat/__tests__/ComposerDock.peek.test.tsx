/**
 * ComposerDock hover peek, through the real dock: overlay, suppression, keep-open rules,
 * Escape order, modal dialogs, Pin / bar, rebind. Test-plan #P1 #F1 #F5 #F7–#F14.
 * See change: composer-dock-collapse-and-file-open (tasks 3.2, 3.4, 3.5, 3.9, 3.11–3.17).
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DOCK_COLLAPSED_KEY_PREFIX } from "../../../lib/util/dock-collapsed.js";
import { HOVER_CLOSE_GRACE_MS, HOVER_DWELL_MS } from "../../session/session-hover-intent.js";
import {
  DockHarness,
  fakeLane,
  installFrameAndResizeObserver,
  makeColumn,
  makeSession,
  renderDock,
  renderLanesDock,
  stubSessionDiffFetch,
} from "./dock-harness.js";

function stubHover(hover: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: hover && query.includes("hover: hover"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    })),
  );
}

function move(target: Element, x = 10, init: MouseEventInit = {}) {
  const e = new MouseEvent("pointermove", { bubbles: true, clientX: x, clientY: 20, ...init });
  Object.defineProperty(e, "pointerType", { value: "mouse" });
  act(() => {
    target.dispatchEvent(e);
  });
}
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

beforeEach(() => {
  localStorage.setItem(`${DOCK_COLLAPSED_KEY_PREFIX}s1`, "collapsed");
  vi.useFakeTimers();
  vi.setSystemTime(0);
  stubHover(true);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
  document.body.innerHTML = "";
});

const dock = () => screen.getByTestId("composer-dock");
const region = () => screen.getByTestId("composer-dock-scroll");
const bar = () => screen.getByTestId("composer-dock-bar");
const isPeek = () => dock().hasAttribute("data-peek");
const isCollapsed = () => !!screen.queryByTestId("composer-dock-bar") && !isPeek();
const elsewhere = () => {
  let el = document.getElementById("else");
  if (!el) {
    el = document.createElement("div");
    el.id = "else";
    document.body.appendChild(el);
  }
  return el;
};
const menuLane = () =>
  fakeLane("openspec", {
    actions: (
      <button type="button" data-testid="menu-trigger" aria-haspopup="menu" aria-expanded={false}>
        ⋯
      </button>
    ),
  });
const peekIt = () => {
  move(bar());
  advance(HOVER_DWELL_MS);
  expect(isPeek()).toBe(true);
};

describe("peek", () => {
  it("F1: dwell peeks as an absolute overlay; focus and the row key are untouched", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    renderDock({ session: makeSession(), lanes: [fakeLane("changes"), menuLane()] });
    expect(region().hasAttribute("hidden")).toBe(true);
    peekIt();
    expect(region().hasAttribute("hidden")).toBe(false);
    expect(region().className).toContain("absolute");
    expect(document.activeElement).toBe(input);
    expect(dock().getAttribute("data-pane-row")).toBe("composer-dock:collapsed");
    expect(screen.getByTestId("composer-dock-pin")).toBeTruthy();
  });

  it("P1: 200 moves over the bar commit nothing; the peek is one update (plus its nested layout re-render)", () => {
    const commits = vi.fn();
    render(
      <Profiler id="dock" onRender={commits}>
        <DockHarness session={makeSession()} lanes={[fakeLane("changes")]} />
      </Profiler>,
    );
    commits.mockClear();
    const phases: string[] = [];
    commits.mockImplementation((_id, phase) => phases.push(phase));
    for (let i = 0; i < 200; i++) {
      vi.setSystemTime(i);
      move(bar(), 10);
    }
    expect(commits).not.toHaveBeenCalled();
    advance(HOVER_DWELL_MS);
    expect(isPeek()).toBe(true);
    // One `update` for the peek; any further commit is a nested layout-effect re-render of the same
    // update (never a per-move one).
    expect(phases[0]).toBe("update");
    expect(phases.slice(1).every((p) => p === "nested-update")).toBe(true);
    expect(phases.length).toBeLessThanOrEqual(2);
  });

  it("F5: never arms without fine hover, with a pressed button, a modal dialog or a non-live dock", () => {
    const lanes = [fakeLane("changes")];
    stubHover(false);
    renderDock({ session: makeSession(), lanes });
    move(bar());
    advance(HOVER_DWELL_MS * 2);
    expect(isPeek()).toBe(false);
    cleanup();

    stubHover(true);
    renderDock({ session: makeSession(), lanes });
    move(bar(), 10, { buttons: 1 });
    advance(HOVER_DWELL_MS * 2);
    expect(isPeek()).toBe(false);

    const dlg = document.createElement("div");
    dlg.setAttribute("role", "dialog");
    dlg.setAttribute("aria-modal", "true");
    document.body.appendChild(dlg);
    move(bar(), 11);
    advance(HOVER_DWELL_MS * 2);
    expect(isPeek()).toBe(false);
    dlg.remove();
    // A `DialogPortal` modal locks body scroll.
    document.body.style.overflow = "hidden";
    move(bar(), 12);
    advance(HOVER_DWELL_MS * 2);
    expect(isPeek()).toBe(false);
    document.body.style.overflow = "";
    cleanup();

    renderDock({ session: makeSession(), lanes, live: false });
    move(bar());
    advance(HOVER_DWELL_MS * 2);
    expect(isPeek()).toBe(false);
  });

  it("F5: a click-opened dock popover suppresses arming", () => {
    renderDock({ session: makeSession(), lanes: [fakeLane("changes"), menuLane()] });
    const trigger = screen.getByTestId("menu-trigger");
    // The lane region is hidden while collapsed, but the open marker still counts.
    trigger.setAttribute("aria-expanded", "true");
    move(bar());
    advance(HOVER_DWELL_MS * 2);
    expect(isPeek()).toBe(false);
  });

  it("F6: closes after the grace period once the pointer is outside bar ∪ overlay", () => {
    renderDock({ session: makeSession(), lanes: [fakeLane("changes")] });
    peekIt();
    move(elsewhere(), 400);
    advance(HOVER_CLOSE_GRACE_MS - 1);
    expect(isPeek()).toBe(true);
    advance(2);
    expect(isCollapsed()).toBe(true);
  });

  it("F7: an open menu (popover marker in the overlay) holds the peek even with the pointer on a portaled menu", () => {
    renderDock({ session: makeSession(), lanes: [fakeLane("changes"), menuLane()] });
    peekIt();
    const trigger = screen.getByTestId("menu-trigger");
    trigger.setAttribute("aria-expanded", "true");
    const portaled = document.createElement("div");
    document.body.appendChild(portaled);
    move(portaled, 500);
    advance(HOVER_CLOSE_GRACE_MS * 3);
    expect(isPeek()).toBe(true);
    trigger.setAttribute("aria-expanded", "false");
    advance(HOVER_CLOSE_GRACE_MS + 150);
    expect(isCollapsed()).toBe(true);
  });

  it("F8: a compact chip's aria-expanded (no aria-haspopup) does not hold the peek", () => {
    const env = installFrameAndResizeObserver();
    const columnEl = makeColumn();
    renderDock({ session: makeSession(), lanes: [fakeLane("changes"), fakeLane("queue")], columnEl });
    env.resize(480);
    env.flush();
    peekIt();
    fireEvent.click(screen.getByTestId("composer-dock-chip-changes"));
    expect(screen.getByTestId("composer-dock-chip-changes").getAttribute("aria-expanded")).toBe("true");
    (document.activeElement as HTMLElement | null)?.blur();
    move(elsewhere(), 400);
    advance(HOVER_CLOSE_GRACE_MS + 1);
    expect(isCollapsed()).toBe(true);
  });

  it("F9: focus inside the overlay holds the peek", () => {
    renderDock({
      session: makeSession(),
      lanes: [fakeLane("changes", { renderBody: () => <button type="button" data-testid="inside">in</button> })],
    });
    peekIt();
    const trigger = region().querySelector<HTMLElement>("[data-dock-toggle]");
    trigger?.focus();
    move(elsewhere(), 400);
    advance(HOVER_CLOSE_GRACE_MS * 3);
    expect(isPeek()).toBe(true);
    act(() => trigger?.blur());
    advance(HOVER_CLOSE_GRACE_MS + 150);
    expect(isCollapsed()).toBe(true);
  });

  it("F10: Escape closes an open menu first, then the peek (focus → bar); Escape in the composer is not consumed", () => {
    const input = document.createElement("textarea");
    document.body.appendChild(input);
    const outer = vi.fn();
    document.addEventListener("keydown", outer);
    renderDock({ session: makeSession(), lanes: [fakeLane("changes"), menuLane()] });
    peekIt();
    const trigger = screen.getByTestId("menu-trigger");

    // (a) a menu is open → the dock leaves Escape to the menu
    trigger.setAttribute("aria-expanded", "true");
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(isPeek()).toBe(true);
    expect(outer).toHaveBeenCalledTimes(1);

    // (b) no menu, focus in the overlay → closes the peek, focus on the bar, key consumed
    trigger.setAttribute("aria-expanded", "false");
    trigger.focus();
    outer.mockClear();
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(isCollapsed()).toBe(true);
    expect(document.activeElement).toBe(bar());
    expect(outer).not.toHaveBeenCalled();

    // (c) focus in the composer → the dock never consumes it (the Escape cooldown ends once the pointer left the bar)
    move(elsewhere(), 400);
    peekIt();
    input.focus();
    outer.mockClear();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(outer).toHaveBeenCalledTimes(1);
    expect(isPeek()).toBe(true);
    document.removeEventListener("keydown", outer);
  });

  it("F11: a modal dialog opening returns the peek to collapsed", async () => {
    renderDock({ session: makeSession(), lanes: [fakeLane("changes")] });
    peekIt();
    const dlg = document.createElement("div");
    dlg.setAttribute("role", "dialog");
    dlg.setAttribute("aria-modal", "true");
    await act(async () => {
      document.body.appendChild(dlg);
      await Promise.resolve();
    });
    expect(isCollapsed()).toBe(true);
  });

  it("F11: a DialogPortal modal (body scroll lock) returns the peek to collapsed", async () => {
    renderDock({ session: makeSession(), lanes: [fakeLane("changes")] });
    peekIt();
    await act(async () => {
      document.body.style.overflow = "hidden";
      await Promise.resolve();
    });
    expect(isCollapsed()).toBe(true);
    document.body.style.overflow = "";
  });
});

describe("pin and expand", () => {
  it("F12: Pin expands in flow, focuses Hide and the pointer leaving no longer collapses it", () => {
    renderDock({ session: makeSession(), lanes: [fakeLane("changes")] });
    peekIt();
    fireEvent.click(screen.getByTestId("composer-dock-pin"));
    expect(screen.queryByTestId("composer-dock-bar")).toBeNull();
    expect(region().className).not.toContain("absolute");
    expect(document.activeElement).toBe(screen.getByTestId("composer-dock-hide"));
    move(elsewhere(), 400);
    advance(HOVER_CLOSE_GRACE_MS * 3);
    expect(screen.getByTestId("composer-dock-hide")).toBeTruthy();
  });

  it("F12: clicking the bar while peeked pins", () => {
    renderDock({ session: makeSession(), lanes: [fakeLane("changes")] });
    peekIt();
    fireEvent.click(bar());
    expect(screen.getByTestId("composer-dock-hide")).toBeTruthy();
    expect(screen.queryByTestId("composer-dock-bar")).toBeNull();
  });

  it("after Hide the pointer resting on the bar does not re-peek until it has left once", () => {
    localStorage.clear();
    renderDock({ session: makeSession(), lanes: [fakeLane("changes")] });
    fireEvent.click(screen.getByTestId("composer-dock-hide"));
    move(bar());
    advance(HOVER_DWELL_MS * 2);
    expect(isPeek()).toBe(false);
    move(elsewhere(), 400);
    move(bar());
    advance(HOVER_DWELL_MS);
    expect(isPeek()).toBe(true);
  });
});

describe("transient", () => {
  it("F13: a rebind or remount during a peek shows collapsed; storage is unchanged", () => {
    const lanes = [fakeLane("changes")];
    const view = renderDock({ session: makeSession({ id: "s1" }), lanes });
    peekIt();
    view.rerenderDock({ session: makeSession({ id: "s2" }), lanes });
    view.rerenderDock({ session: makeSession({ id: "s1" }), lanes });
    expect(isCollapsed()).toBe(true);
    peekIt();
    view.unmount();
    renderDock({ session: makeSession({ id: "s1" }), lanes });
    expect(isCollapsed()).toBe(true);
    expect(localStorage.getItem(`${DOCK_COLLAPSED_KEY_PREFIX}s1`)).toBe("collapsed");
  });

  it("F14: peeking never refetches the Changes lane", async () => {
    localStorage.clear();
    vi.useRealTimers();
    const fetchMock = stubSessionDiffFetch(() => ({
      body: {
        success: true,
        data: {
          isGitRepo: true,
          files: [{ path: "a.ts", changes: [], origin: "edit", sessionOwned: true, previewable: true, additions: 1, deletions: 0 }],
        },
      },
    }));
    renderLanesDock({ input: { session: makeSession(), working: false, openspecHasDir: false, openspecPending: false } });
    const settle = () =>
      act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    await settle();
    fireEvent.click(document.querySelector("[data-dock-toggle='changes']") as HTMLElement); // open lane → fetch
    await settle();
    fireEvent.click(screen.getByTestId("composer-dock-hide"));
    await settle();
    const before = fetchMock.mock.calls.length;
    vi.useFakeTimers();
    move(elsewhere(), 400); // the post-Hide cooldown ends once the pointer has left the bar
    for (let i = 0; i < 2; i++) {
      peekIt();
      move(elsewhere(), 400);
      advance(HOVER_CLOSE_GRACE_MS + 1);
      expect(isCollapsed()).toBe(true);
    }
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it("F15: Open (and Review) from a peek act, then return the dock to collapsed", async () => {
    localStorage.clear();
    vi.useRealTimers();
    stubSessionDiffFetch(() => ({
      body: {
        success: true,
        data: {
          isGitRepo: true,
          files: [{ path: "a.ts", changes: [], origin: "edit", sessionOwned: true, previewable: true, additions: 1, deletions: 0 }],
        },
      },
    }));
    const onOpenFile = vi.fn();
    const onReview = vi.fn();
    renderLanesDock({ input: { session: makeSession(), working: false, openspecHasDir: false, openspecPending: false, onOpenFile, onOpenDiff: vi.fn(), onReview } });
    const settle = () =>
      act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    await settle();
    fireEvent.click(document.querySelector("[data-dock-toggle='changes']") as HTMLElement);
    await settle();
    fireEvent.click(screen.getByTestId("composer-dock-hide"));
    await settle();
    vi.useFakeTimers();
    move(elsewhere(), 400);

    peekIt();
    fireEvent.click(screen.getByTestId("composer-dock-file-open"));
    expect(onOpenFile).toHaveBeenCalledWith("a.ts");
    expect(isCollapsed()).toBe(true);

    move(elsewhere(), 401);
    peekIt();
    fireEvent.click(screen.getByTestId("composer-dock-review"));
    expect(onReview).toHaveBeenCalledTimes(1);
    expect(isCollapsed()).toBe(true);
  });
});
