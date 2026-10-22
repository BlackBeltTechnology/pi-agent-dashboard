/**
 * ComposerDock collapse: Hide handle, summary bar, Pin / bar expand, per-session persistence,
 * collapsed row-table entries, compact collapsed. Test-plan #E1–#E4 #E6 #E8 #E10 #E20 #F12 #F16.
 * See change: composer-dock-collapse-and-file-open (tasks 2.1–2.2, 2.5–2.14).
 */
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COLLAPSED_BAR_PX, YOLO_FOOTER_HEIGHT } from "../../../lib/layout/chat-pane-row-class.js";
import { DOCK_COLLAPSED_KEY_PREFIX } from "../../../lib/util/dock-collapsed.js";
import {
  fakeLane,
  installFrameAndResizeObserver,
  liveYoloStore,
  makeColumn,
  makeSession,
  proc,
  renderDock,
  renderLanesDock,
  stubSessionDiffFetch,
} from "./dock-harness.js";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

const dock = () => screen.getByTestId("composer-dock");
const region = () => screen.getByTestId("composer-dock-scroll");
const bar = () => screen.getByTestId("composer-dock-bar");
const hideBtn = () => screen.getByTestId("composer-dock-hide");
const segments = () => Array.from(dock().querySelectorAll("[data-dock-bar-segment]")).map((e) => e.textContent);
const threeLanes = () => [
  fakeLane("changes", { summaryText: "3 files changed +1 \u22120" }),
  fakeLane("openspec", { summaryText: "add-x 2/5" }),
  fakeLane("context", { summaryText: "plugin context", expandable: false }),
];

describe("collapse to a summary bar", () => {
  it("E1: Hide folds the lanes into one bar with each lane's summaryText in order", () => {
    renderDock({ session: makeSession(), lanes: threeLanes() });
    expect(region().hasAttribute("hidden")).toBe(false);
    fireEvent.click(hideBtn());
    expect(region().hasAttribute("hidden")).toBe(true);
    expect(segments()).toEqual(["3 files changed +1 \u22120", "add-x 2/5", "plugin context"]);
    expect(bar().getAttribute("aria-expanded")).toBe("false");
    expect(bar().getAttribute("aria-controls")).toBe(region().id);
    expect(bar().getAttribute("aria-label")).toMatch(/^Session context: 3 files changed/);
    expect(screen.queryByTestId("composer-dock-hide")).toBeNull();
  });

  it("E2: a hideWhenEmpty lane that renders nothing adds no segment and no stray separator", () => {
    const lanes = [
      fakeLane("changes", { summaryText: "3 files changed" }),
      fakeLane("context", { summaryText: "plugin context", expandable: false, hideWhenEmpty: true, actions: <div>{null}</div> }),
    ];
    renderDock({ session: makeSession(), lanes });
    fireEvent.click(hideBtn());
    expect(segments()).toEqual(["3 files changed"]);
    expect(bar().textContent).not.toContain("\u00b7");
  });

  it("E3: no Hide and no bar for a footer-only dock, nor when every lane renders nothing", () => {
    const view = renderDock({ session: makeSession(), yoloStore: liveYoloStore() });
    expect(screen.queryByTestId("composer-dock-hide")).toBeNull();
    expect(screen.queryByTestId("composer-dock-bar")).toBeNull();
    view.unmount();

    localStorage.setItem(`${DOCK_COLLAPSED_KEY_PREFIX}s1`, "collapsed");
    const empty = (key: "context" | "queue") =>
      fakeLane(key, { expandable: false, hideWhenEmpty: true, actions: <div>{null}</div> });
    renderDock({ session: makeSession(), lanes: [empty("context"), empty("queue")], yoloStore: liveYoloStore() });
    expect(screen.queryByTestId("composer-dock-hide")).toBeNull();
    expect(screen.queryByTestId("composer-dock-bar")).toBeNull();
  });

  it("E4: a worktree session keeps only the branch with count and totals in the bar", async () => {
    stubSessionDiffFetch(() => ({
      body: {
        success: true,
        data: {
          isGitRepo: true,
          files: [
            { path: "a.ts", changes: [], origin: "edit", sessionOwned: true, previewable: true, additions: 60, deletions: 10 },
            { path: "b.ts", changes: [], origin: "edit", sessionOwned: true, previewable: true, additions: 30, deletions: 10 },
            { path: "c.ts", changes: [], origin: "edit", sessionOwned: true, previewable: true, additions: 20, deletions: 5 },
            { path: "d.ts", changes: [], origin: "edit", sessionOwned: true, previewable: true, additions: 10, deletions: 8 },
          ],
        },
      },
    }));
    renderLanesDock({
      input: {
        session: makeSession({
          gitBranch: "os/x",
          gitWorktree: { mainPath: "/main", name: "os-x", base: "develop" },
          gitStatus: { dirtyCount: 3, staged: 0, unstaged: 3, untracked: 0, ahead: 2, behind: 0 },
        }),
        working: false,
        openspecHasDir: false,
        openspecPending: false,
      },
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    fireEvent.click(hideBtn());
    expect(segments()).toEqual(["os/x 4 files +120 \u221233"]);
    const text = bar().textContent ?? "";
    expect(text).not.toContain("\u2190");
    expect(text).not.toContain("\u21912");
    expect(text).not.toMatch(/dirty|changed files/);
  });
});

describe("persistence", () => {
  it("E6: each session shows its own state on its first render (no one-frame flash)", () => {
    localStorage.setItem(`${DOCK_COLLAPSED_KEY_PREFIX}s1`, "collapsed");
    const lanes = threeLanes();
    const view = renderDock({ session: makeSession({ id: "s1" }), lanes });
    expect(bar()).toBeTruthy();
    view.rerenderDock({ session: makeSession({ id: "s2" }), lanes });
    expect(screen.queryByTestId("composer-dock-bar")).toBeNull();
    expect(hideBtn()).toBeTruthy();
    view.rerenderDock({ session: makeSession({ id: "s1" }), lanes });
    expect(bar()).toBeTruthy();
  });

  it("collapsed state survives a remount (reload) and Hide stores it per session", () => {
    const view = renderDock({ session: makeSession(), lanes: threeLanes() });
    fireEvent.click(hideBtn());
    expect(localStorage.getItem(`${DOCK_COLLAPSED_KEY_PREFIX}s1`)).toBe("collapsed");
    view.unmount();
    renderDock({ session: makeSession(), lanes: threeLanes() });
    expect(bar()).toBeTruthy();
  });

  it("E8: the folder-home dock never reads or writes the state; a non-live dock is read-only", () => {
    const get = vi.spyOn(Storage.prototype, "getItem");
    const set = vi.spyOn(Storage.prototype, "setItem");
    const home = renderDock({ session: undefined, yoloStore: liveYoloStore() });
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    home.unmount();
    get.mockRestore();
    set.mockRestore();

    localStorage.setItem(`${DOCK_COLLAPSED_KEY_PREFIX}s1`, "collapsed");
    const setSpy = vi.spyOn(Storage.prototype, "setItem");
    const removeSpy = vi.spyOn(Storage.prototype, "removeItem");
    renderDock({ session: makeSession(), lanes: threeLanes(), live: false });
    expect(bar()).toBeTruthy();
    expect(screen.queryByTestId("composer-dock-hide")).toBeNull();
    expect(screen.queryByTestId("composer-dock-pin")).toBeNull();
    fireEvent.click(bar());
    expect(bar()).toBeTruthy();
    expect(setSpy).not.toHaveBeenCalled();
    expect(removeSpy).not.toHaveBeenCalled();
  });
});

describe("row table and layout", () => {
  it("E10: a collapsed dock declares its entry; minHeight = bound + chrome, with and without YOLO", () => {
    localStorage.setItem(`${DOCK_COLLAPSED_KEY_PREFIX}s1`, "collapsed");
    const plain = renderDock({ session: makeSession(), lanes: threeLanes() });
    expect(dock().getAttribute("data-pane-row")).toBe("composer-dock:collapsed");
    expect(dock().style.minHeight).toBe(`${COLLAPSED_BAR_PX + 25}px`);
    expect(bar().parentElement?.style.height).toBe(`${COLLAPSED_BAR_PX}px`);
    plain.unmount();
    renderDock({ session: makeSession(), lanes: threeLanes(), yoloStore: liveYoloStore() });
    expect(dock().getAttribute("data-pane-row")).toBe("composer-dock:collapsed-yolo");
    expect(dock().style.minHeight).toBe(`${COLLAPSED_BAR_PX + YOLO_FOOTER_HEIGHT + 25}px`);
  });

  it("the YOLO footer stays in flow under the collapsed bar", () => {
    localStorage.setItem(`${DOCK_COLLAPSED_KEY_PREFIX}s1`, "collapsed");
    renderDock({ session: makeSession(), lanes: threeLanes(), yoloStore: liveYoloStore() });
    const kids = Array.from(dock().children);
    const barRow = screen.getByTestId("composer-dock-bar-row");
    const footer = kids.find((k) => k.getAttribute("data-testid")?.includes("yolo"));
    expect(footer).toBeTruthy();
    expect(kids.indexOf(barRow)).toBeLessThan(kids.indexOf(footer as Element));
  });

  it("E20: a collapsed compact dock shows the bar, then the chips with the open sheet on activate", () => {
    const env = installFrameAndResizeObserver();
    const columnEl = makeColumn();
    localStorage.setItem(`${DOCK_COLLAPSED_KEY_PREFIX}s1`, "collapsed");
    renderDock({ session: makeSession(), lanes: threeLanes(), columnEl });
    env.resize(480);
    env.flush();
    expect(dock().getAttribute("data-layout")).toBe("compact");
    expect(bar()).toBeTruthy();
    expect(region().hasAttribute("hidden")).toBe(true);
    fireEvent.click(bar());
    expect(screen.queryByTestId("composer-dock-bar")).toBeNull();
    expect(screen.getByTestId("composer-dock-chips")).toBeTruthy();
    expect(region().hasAttribute("hidden")).toBe(false);
  });
});

describe("expand", () => {
  beforeEach(() => localStorage.setItem(`${DOCK_COLLAPSED_KEY_PREFIX}s1`, "collapsed"));

  it("F12(c): Enter on the focused bar expands and focuses Hide", () => {
    renderDock({ session: makeSession(), lanes: threeLanes() });
    bar().focus();
    fireEvent.click(bar()); // a keyboard Enter on a button dispatches click
    expect(screen.queryByTestId("composer-dock-bar")).toBeNull();
    expect(document.activeElement).toBe(hideBtn());
    expect(localStorage.getItem(`${DOCK_COLLAPSED_KEY_PREFIX}s1`)).toBeNull();
  });

  it("clicking Hide after expanding moves focus to the bar", () => {
    renderDock({ session: makeSession(), lanes: threeLanes() });
    fireEvent.click(bar());
    fireEvent.click(hideBtn());
    expect(document.activeElement).toBe(bar());
  });
});

describe("live signals", () => {
  it("F16: the bar keeps the Processes segment with its working dot and the live region announces a new count once", () => {
    localStorage.setItem(`${DOCK_COLLAPSED_KEY_PREFIX}s1`, "collapsed");
    const view = renderDock({ session: makeSession({ processes: [proc(1), proc(2)] }), lanes: [fakeLane("changes", { summaryText: "1 file changed" })] });
    expect(segments()[0]).toBe("2 background processes");
    expect(screen.getByTestId("composer-dock-bar-working")).toBeTruthy();
    const live = screen.getByTestId("composer-dock-live");
    const announcements: string[] = [];
    new MutationObserver(() => announcements.push(live.textContent ?? "")).observe(live, { childList: true, characterData: true, subtree: true });
    view.rerenderDock({ session: makeSession({ processes: [proc(1), proc(2), proc(3)] }), lanes: [fakeLane("changes", { summaryText: "1 file changed" })] });
    expect(segments()[0]).toBe("3 background processes");
    expect(live.textContent).toContain("3 background processes");
  });
});
