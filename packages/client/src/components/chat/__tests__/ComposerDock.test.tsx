/**
 * ComposerDock shell: lane order/omission, disclosure semantics, accordion,
 * compact mode, live region, YOLO footer, Processes header.
 * Test-plan #E1 #E2 #E4 #E5 #E6 #E22 #P2 #P4 #F1–#F6 #F11 #X7 #X9.
 * #E1 (all five real lanes), #E3 and #E11 run the real lane hooks
 * (`useComposerDockLanes`); lane-level cases live in `ComposerDock.lanes.test.tsx`.
 * See change: add-composer-dock (tasks 2.1–2.5, 3.1, 4.1, 4.2, 10.1–10.3, 10.10).
 */

import fs from "node:fs";
import path from "node:path";
import { ComposerContextGroup } from "@blackbelt-technology/dashboard-plugin-runtime";
import { createSlotRegistry } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandInput } from "../CommandInput.js";
import {
  addFakeGroup,
  bash,
  DockHarness,
  type DockHarnessAccordion,
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

// Render-count spies for #P2: wrap the hook and the lane body so a re-render is observable.
vi.mock("../ProcessesLane.js", async (orig) => {
  const actual = await orig<typeof import("../ProcessesLane.js")>();
  return { ...actual, useProcessesLane: vi.fn(actual.useProcessesLane) };
});
vi.mock("../ProcessesLaneBody.js", async (orig) => {
  const actual = await orig<typeof import("../ProcessesLaneBody.js")>();
  return { ...actual, ProcessesLaneBody: vi.fn(actual.ProcessesLaneBody) };
});

import { useProcessesLane } from "../ProcessesLane.js";
import { ProcessesLaneBody } from "../ProcessesLaneBody.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.documentElement.style.fontSize = "";
  document.body.innerHTML = "";
});

const dock = () => screen.getByTestId("composer-dock");
const toggle = (key: string) => dock().querySelector<HTMLButtonElement>(`[data-dock-toggle="${key}"]`) as HTMLButtonElement;
/** The lanes' own `role=group` containers (plugin groups nested inside a lane are not lanes). */
const laneNames = () => Array.from(dock().querySelectorAll("[data-dock-lane][role=group]")).map((g) => g.getAttribute("aria-label"));

describe("lane order and omission (E1, E2)", () => {
  it("E1: five lanes render as role=group in the fixed order, whatever order they are handed in", () => {
    const session = makeSession({ processes: [proc(11), proc(12)] });
    renderDock({
      session,
      lanes: [fakeLane("context"), fakeLane("queue"), fakeLane("openspec"), fakeLane("changes")],
    });
    expect(laneNames()).toEqual(["Processes", "Changes", "OpenSpec", "Queue", "Context"]);
  });

  it("E2: a quiet session renders no dock element (the always-mounted claim mount adds no DOM)", () => {
    const registry = createSlotRegistry();
    addFakeGroup(registry, { report: null });
    const { container } = renderDock({ session: makeSession(), registry });
    expect(screen.queryByTestId("composer-dock")).toBeNull();
    expect(container.innerHTML).toBe("");
  });

  it("an empty lane leaves no trace; null / false lanes are dropped", () => {
    renderDock({ session: makeSession(), lanes: [fakeLane("queue"), null, false, undefined] });
    expect(laneNames()).toEqual(["Queue"]);
    expect(screen.queryByText(/Processes/)).toBeNull();
  });
});

describe("disclosure semantics (2.1)", () => {
  it("an expandable header is one toggle with aria-expanded/aria-controls; actions are siblings that never toggle", () => {
    const onAction = vi.fn();
    renderDock({
      session: makeSession(),
      lanes: [fakeLane("changes", { actions: <button type="button" data-testid="lane-action" onClick={onAction}>Review</button> })],
    });
    const t = toggle("changes");
    expect(t.getAttribute("aria-expanded")).toBe("false");
    expect(t.contains(screen.getByTestId("lane-action"))).toBe(false);
    fireEvent.click(screen.getByTestId("lane-action"));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(t.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(t);
    expect(t.getAttribute("aria-expanded")).toBe("true");
    const body = document.getElementById(t.getAttribute("aria-controls") as string);
    expect(body).toBeTruthy();
    expect(within(body as HTMLElement).getByTestId("fake-body-changes")).toBeTruthy();
    fireEvent.click(screen.getByTestId("lane-action"));
    expect(t.getAttribute("aria-expanded")).toBe("true");
  });

  it("a non-expandable lane has no disclosure control", () => {
    renderDock({ session: makeSession(), lanes: [fakeLane("context", { expandable: false })] });
    expect(dock().querySelector("button[aria-expanded]")).toBeNull();
  });
});

describe("accordion (F1–F4)", () => {
  const lanes = () => [fakeLane("changes"), fakeLane("queue")];

  it("F1: expanding Changes collapses Processes", () => {
    renderDock({ session: makeSession({ processes: [proc(1)] }), lanes: lanes() });
    fireEvent.click(toggle("processes"));
    expect(toggle("processes").getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle("changes"));
    expect(toggle("changes").getAttribute("aria-expanded")).toBe("true");
    expect(toggle("processes").getAttribute("aria-expanded")).toBe("false");
  });

  it("F2: a new process does not expand any lane", () => {
    const { rerenderDock } = renderDock({ session: makeSession({ processes: [proc(1)] }), lanes: lanes() });
    rerenderDock({ session: makeSession({ processes: [proc(1), proc(2)] }), lanes: lanes() });
    for (const k of ["processes", "changes", "queue"]) expect(toggle(k).getAttribute("aria-expanded")).toBe("false");
  });

  it("F3: returning to a previously expanded session shows every lane collapsed", () => {
    const s1 = makeSession({ id: "s1" });
    const { rerenderDock } = renderDock({ session: s1, lanes: lanes() });
    fireEvent.click(toggle("changes"));
    expect(toggle("changes").getAttribute("aria-expanded")).toBe("true");
    rerenderDock({ session: makeSession({ id: "s2" }), lanes: lanes() });
    expect(toggle("changes").getAttribute("aria-expanded")).toBe("false");
    rerenderDock({ session: s1, lanes: lanes() });
    for (const k of ["changes", "queue"]) expect(toggle(k).getAttribute("aria-expanded")).toBe("false");
  });

  it("F4: a lane that left while open comes back collapsed", () => {
    const ref: { current: DockHarnessAccordion | null } = { current: null };
    const { rerenderDock } = renderDock({ session: makeSession({ processes: [proc(1)] }), accordionRef: ref });
    fireEvent.click(toggle("processes"));
    expect(ref.current?.openLane).toBe("processes");
    rerenderDock({ session: makeSession({ processes: [] }), accordionRef: ref });
    expect(screen.queryByTestId("composer-dock")).toBeNull();
    expect(ref.current?.openLane).toBeNull();
    rerenderDock({ session: makeSession({ processes: [proc(2)] }), accordionRef: ref });
    expect(toggle("processes").getAttribute("aria-expanded")).toBe("false");
  });
});

describe("Processes header (E5, E22, X9, X7)", () => {
  const header = () => screen.getByRole("group", { name: "Processes" });

  it("E5a: mixed header reads `6 running` with `3 subagents · 1 command · 2 background`", () => {
    const registry = createSlotRegistry();
    addFakeGroup(registry, { report: { count: 3, noun: "subagents" } });
    renderDock({ session: makeSession({ processes: [proc(1), proc(2)] }), processes: { commands: [bash("t1")], onKill: vi.fn() }, registry });
    expect(header().textContent).toContain("6 running");
    expect(header().textContent).toContain("3 subagents · 1 command · 2 background");
  });

  it("E5b: background only → `2 background processes`, no group headings in the body", () => {
    renderDock({ session: makeSession({ processes: [proc(1), proc(2)] }) });
    expect(header().textContent).toContain("2 background processes");
    fireEvent.click(toggle("processes"));
    expect(screen.queryByTestId("composer-dock-group-heading")).toBeNull();
    expect(screen.getAllByTestId("composer-dock-row")).toHaveLength(2);
  });

  it("E5c: one command → `1 command`", () => {
    renderDock({ session: makeSession(), processes: { commands: [bash("t1")], onKill: vi.fn() } });
    expect(header().textContent).toContain("1 command");
    expect(header().textContent).not.toContain("running");
  });

  it("E5d: plugin-only count renders the lane collapsed, naming 2 subagents", () => {
    const registry = createSlotRegistry();
    addFakeGroup(registry, { report: { count: 2, noun: "subagents" } });
    renderDock({ session: makeSession(), registry });
    expect(header().textContent).toContain("2 subagents");
    expect(toggle("processes").getAttribute("aria-expanded")).toBe("false");
  });

  it("E22: the row action reads Kill; the composer's stop affordance reads Stop", () => {
    renderDock({ session: makeSession({ status: "streaming" as never, processes: [proc(7)] }) });
    fireEvent.click(toggle("processes"));
    expect(within(screen.getByTestId("composer-dock-row")).getByRole("button").textContent).toBe("Kill");
    render(<CommandInput commands={[]} onSend={vi.fn()} onAbort={vi.fn()} sessionStatus="streaming" />);
    expect(screen.getByTestId("stop-button").getAttribute("aria-label")).toBe("Stop");
  });

  it("X9: without a plugin claim, Commands and Background groups only; no subagent group", () => {
    renderDock({ session: makeSession({ processes: [proc(1), proc(2)] }), processes: { commands: [bash("t1")], onKill: vi.fn() } });
    fireEvent.click(toggle("processes"));
    const headings = screen.getAllByTestId("composer-dock-group-heading").map((h) => h.textContent);
    expect(headings).toEqual(["Commands", "Background"]);
    expect(screen.queryByText(/subagent/i)).toBeNull();
  });

  it("X7: a reconnect snapshot replaces the list; the lane stays expanded", () => {
    const { rerenderDock } = renderDock({ session: makeSession({ processes: [proc(1, { command: "old-job" })] }) });
    fireEvent.click(toggle("processes"));
    expect(screen.getAllByTestId("composer-dock-row")).toHaveLength(1);
    rerenderDock({ session: makeSession({ processes: [proc(2, { command: "snapshot-job" })] }) });
    const rows = screen.getAllByTestId("composer-dock-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain("snapshot-job");
    expect(toggle("processes").getAttribute("aria-expanded")).toBe("true");
  });
});

describe("live region (2.5, F6)", () => {
  beforeEach(() => vi.useFakeTimers());

  it("F6: an elapsed tick changes no live-region text; a count change announces once", () => {
    const { rerenderDock } = renderDock({ session: makeSession({ processes: [proc(1, { elapsedMs: 59_000 }), proc(2, { elapsedMs: 59_000 })] }) });
    const live = screen.getByTestId("composer-dock-live");
    expect(live.getAttribute("aria-live")).toBe("polite");
    const before = live.textContent;
    const seen: string[] = [];
    const observer = new MutationObserver(() => seen.push(live.textContent ?? ""));
    observer.observe(live, { childList: true, characterData: true, subtree: true });
    act(() => vi.advanceTimersByTime(2_000));
    expect(live.textContent).toBe(before);
    expect(observer.takeRecords()).toHaveLength(0);
    rerenderDock({ session: makeSession({ processes: [proc(1), proc(2), proc(3)] }) });
    expect(live.textContent).toContain("3 background");
    expect(observer.takeRecords()).toHaveLength(1);
    observer.disconnect();
  });

  it("the live region is a sibling of the lanes, never an ancestor of lanes or the YOLO footer", () => {
    renderDock({ session: makeSession({ processes: [proc(1)] }), yoloStore: liveYoloStore() });
    const live = screen.getByTestId("composer-dock-live");
    expect(live.contains(screen.getByTestId("composer-dock-scroll"))).toBe(false);
    expect(live.contains(screen.getByTestId("yolo-composer-strip"))).toBe(false);
    const footer = screen.getByTestId("yolo-composer-strip");
    for (let el: HTMLElement | null = footer; el; el = el.parentElement) {
      expect(el.getAttribute("role")).not.toBe("status");
      expect(el.getAttribute("aria-live") ?? "off").toBe("off");
    }
  });
});

describe("render stability (P2)", () => {
  it("P2: ten 1 s ticks re-render neither ComposerDock nor the lane body (only elapsed leaves)", () => {
    vi.useFakeTimers();
    const session = makeSession({ processes: [proc(1), proc(2)] });
    renderDock({ session, processes: { commands: [bash("t1")], onKill: vi.fn() } });
    fireEvent.click(toggle("processes"));
    const hook = vi.mocked(useProcessesLane);
    const body = vi.mocked(ProcessesLaneBody);
    const hookCalls = hook.mock.calls.length;
    const bodyCalls = body.mock.calls.length;
    const elapsed = () => screen.getAllByTestId("composer-dock-row-elapsed")[0]?.textContent;
    const first = elapsed();
    for (let i = 0; i < 10; i++) act(() => vi.advanceTimersByTime(1_000));
    expect(elapsed()).not.toBe(first);
    expect(hook.mock.calls.length).toBe(hookCalls);
    expect(body.mock.calls.length).toBe(bodyCalls);
  });
});

describe("compact mode (E6, F5, F11, P4)", () => {
  const lanes = () => [fakeLane("changes", { renderBody: () => <button type="button" data-testid="inside-btn">inside</button> }), fakeLane("queue"), fakeLane("openspec"), fakeLane("context", { expandable: false })];
  const setup = (width = 800) => {
    const env = installFrameAndResizeObserver();
    const columnEl = makeColumn();
    const utils = renderDock({ session: makeSession({ processes: [proc(1)] }), lanes: lanes(), columnEl });
    env.resize(width);
    env.flush();
    return { env, ...utils };
  };
  const mode = () => dock().getAttribute("data-layout");

  it("E6: 521 and 520 px render rows; 519 px renders chips", () => {
    const { env } = setup(521);
    expect(mode()).toBe("rows");
    env.resize(520);
    env.flush();
    expect(mode()).toBe("rows");
    env.resize(519);
    env.flush();
    expect(mode()).toBe("compact");
    expect(screen.getByTestId("composer-dock-chips")).toBeTruthy();
  });

  it("the threshold follows the root font size (32.5rem)", () => {
    document.documentElement.style.fontSize = "32px"; // 1040 px threshold
    const { env } = setup(1000);
    expect(mode()).toBe("compact");
    env.resize(1041);
    env.flush();
    expect(mode()).toBe("rows");
  });

  it("every lane gets a chip with an accessible name naming lane and summary, including non-expandable ones", () => {
    setup(480);
    const chips = within(screen.getByTestId("composer-dock-chips")).getAllByRole("button");
    expect(chips.map((c) => c.getAttribute("aria-label"))).toEqual([
      "Processes: 1 background process",
      "Changes: changes summary",
      "OpenSpec: openspec summary",
      "Queue: queue summary",
      "Context: context summary",
    ]);
  });

  it("a chip opens a sheet below the chips with the lane's actions and body; the chip row is sticky", () => {
    setup(480);
    fireEvent.click(screen.getByTestId("composer-dock-chip-changes"));
    expect(screen.getByTestId("composer-dock-chip-changes").getAttribute("aria-expanded")).toBe("true");
    const sheet = screen.getByTestId("composer-dock-sheet");
    expect(sheet.getAttribute("aria-label")).toBe("Changes");
    expect(within(sheet).getByTestId("inside-btn")).toBeTruthy();
    expect(screen.getByTestId("composer-dock-chips").className).toContain("sticky");
    fireEvent.click(screen.getByTestId("composer-dock-chip-queue"));
    expect(screen.getByTestId("composer-dock-chip-changes").getAttribute("aria-expanded")).toBe("false");
  });

  it("a non-expandable lane's chip opens a sheet holding its header content", () => {
    setup(480);
    fireEvent.click(screen.getByTestId("composer-dock-chip-context"));
    expect(within(screen.getByTestId("composer-dock-sheet")).getByText("context title")).toBeTruthy();
  });

  it("F5a: focus inside the open lane moves to its chip on a flip; openLane survives", () => {
    const { env } = setup(800);
    fireEvent.click(toggle("changes"));
    screen.getByTestId("inside-btn").focus();
    expect(document.activeElement).toBe(screen.getByTestId("inside-btn"));
    env.resize(519);
    env.flush();
    const chip = screen.getByTestId("composer-dock-chip-changes");
    expect(chip.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("composer-dock-sheet")).toBeTruthy();
    expect(document.activeElement).toBe(chip);
  });

  it("F5b: 20 alternating 519/521 resizes never move focus off the textarea; the lane stays open", () => {
    const { env } = setup(800);
    fireEvent.click(toggle("changes"));
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    textarea.focus();
    for (let i = 0; i < 20; i++) {
      env.resize(i % 2 === 0 ? 519 : 521);
      env.flush();
      expect(document.activeElement).toBe(textarea);
      const open = dock().querySelector('[data-dock-toggle="changes"]');
      expect(open?.getAttribute("aria-expanded")).toBe("true");
    }
  });

  it("F11: at 375 px, 4 lanes render as 4 chips and YOLO is one full-width footer line, never a chip", () => {
    const env = installFrameAndResizeObserver();
    const columnEl = makeColumn();
    renderDock({
      session: makeSession(),
      lanes: [fakeLane("changes"), fakeLane("openspec"), fakeLane("queue"), fakeLane("context")],
      columnEl,
      yoloStore: liveYoloStore(),
    });
    env.resize(375);
    env.flush();
    expect(within(screen.getByTestId("composer-dock-chips")).getAllByRole("button")).toHaveLength(4);
    const footer = screen.getByTestId("yolo-composer-strip");
    expect(screen.getByTestId("composer-dock-chips").contains(footer)).toBe(false);
    expect(footer.className).toContain("w-full");
    expect(footer.className).toContain("h-8");
    expect(dock().querySelectorAll("[data-dock-toggle]")).toHaveLength(4);
  });

  it("P4: 60 observer callbacks inside one frame schedule one evaluation", () => {
    const { env } = setup(800);
    env.raf.mockClear();
    for (let i = 0; i < 60; i++) env.resize(700 - i);
    expect(env.raf).toHaveBeenCalledTimes(1);
    env.flush();
    expect(mode()).toBe("rows"); // last callback = 641 px
    env.resize(300);
    env.flush();
    expect(mode()).toBe("compact");
  });
});

describe("YOLO footer (2.4)", () => {
  it("the dock renders with the footer alone, outside the lane scroll region", () => {
    renderDock({ session: makeSession(), yoloStore: liveYoloStore() });
    expect(dock().getAttribute("data-footer-only")).toBe("true");
    expect(screen.queryByTestId("composer-dock-scroll")).toBeNull();
    expect(screen.getByTestId("yolo-composer-strip")).toBeTruthy();
  });

  it("with lanes, the footer is a flex-none sibling after the scroll region", () => {
    renderDock({ session: makeSession({ processes: [proc(1)] }), yoloStore: liveYoloStore() });
    const scroll = screen.getByTestId("composer-dock-scroll");
    const footer = screen.getByTestId("yolo-composer-strip");
    expect(scroll.contains(footer)).toBe(false);
    expect(footer.className).toContain("flex-none");
    expect(scroll.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("E4: a read-only archived view renders no dock and no YOLO footer", () => {
    render(
      <DockHarness
        session={makeSession({ processes: [proc(1)] })}
        cwd="/repo"
        readOnly
        yoloStore={liveYoloStore()}
      />,
    );
    expect(screen.queryByTestId("composer-dock")).toBeNull();
    expect(screen.queryByTestId("yolo-composer-strip")).toBeNull();
  });

  /**
   * E4, App side. App cannot be mounted in a unit test, so pin the structure the
   * archived read-only view depends on: the dock host is mounted inside the same
   * `!readOnly` gate as the composer, after the canvas anchor, and none of the
   * retired surfaces is rendered any more.
   * @structural-pin App.tsx cannot be mounted in a unit test
   */
  it("E4: App mounts the dock host inside the !readOnly composer gate, directly after the anchor", () => {
    const app = fs.readFileSync(path.resolve(__dirname, "../../../App.tsx"), "utf-8");
    const anchor = app.indexOf('data-testid="composer-stack-anchor"');
    const gate = app.indexOf("{!readOnly && (", anchor);
    const dockAt = app.indexOf("<ComposerDockHost", anchor);
    const input = app.indexOf("<CommandInput", anchor);
    expect(anchor).toBeGreaterThan(0);
    expect(gate).toBeGreaterThan(anchor);
    expect(dockAt).toBeGreaterThan(gate);
    expect(input).toBeGreaterThan(dockAt);
    // Nothing renders between the anchor and the dock except the gate.
    expect(app.slice(anchor, dockAt).match(/<[A-Z]\w*/g) ?? []).toEqual([]);
    for (const retired of ["<YoloComposerStrip", "<QueuePanel", "<StatusBar", "composer-context-strip", "<ComposerSessionActions"]) {
      expect(app, `${retired} is retired from App`).not.toContain(retired);
    }
  });

  it("out-of-scope cwd: no YOLO-only dock", () => {
    renderDock({ session: makeSession(), cwd: "/elsewhere", yoloStore: liveYoloStore("/repo") });
    expect(screen.queryByTestId("composer-dock")).toBeNull();
  });
});

// ── real lanes (useComposerDockLanes → ComposerDock) ─────────────────────────

const changed = (path: string, over: Record<string, unknown> = {}) => ({ path, changes: [], origin: "edit", sessionOwned: true, previewable: true, additions: 3, deletions: 1, ...over });
const diffOf = (files: unknown[]) => ({ body: { success: true, data: { files, isGitRepo: true, totalAdditions: 12, totalDeletions: 4 } } });
// fixed-tick-waits: opt-out — macrotask yield that lets mocked fetch promises settle inside act
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe("real lanes (E1, E3, E11)", () => {
  it("E1: processes, changes, OpenSpec, queue and context lanes render in the fixed order", async () => {
    stubSessionDiffFetch(() => diffOf([changed("a.ts"), changed("b.ts"), changed("c.ts"), changed("d.ts")]));
    const registry = createSlotRegistry();
    registry.addClaim({
      pluginId: "quota",
      priority: 600,
      slot: "composer-context-group",
      Component: () => (
        <ComposerContextGroup label="Quota" testId="quota-context-group">
          <span>5h 14%</span>
        </ComposerContextGroup>
      ),
    });
    const session = makeSession({
      attachedProposal: "add-auth",
      processes: [proc(11), proc(12)],
      pendingQueues: { steering: [], followUp: [{ text: "one", imageCount: 0 }, { text: "two", imageCount: 0 }] },
    } as never);
    renderLanesDock({
      input: {
        session,
        working: false,
        changes: [{ name: "add-auth", status: "in-progress", completedTasks: 1, totalTasks: 3, artifacts: [{ id: "proposal", status: "done" }, { id: "design", status: "done" }, { id: "specs", status: "done" }] }],
        openspecHasDir: true,
      },
      registry,
    });
    await settle();
    expect(laneNames()).toEqual(["Processes", "Changes", "OpenSpec", "Queue", "Context"]);
  });

  it("E2: a quiet session (no OpenSpec dir, no worktree, nothing running) renders no dock", async () => {
    stubSessionDiffFetch(() => diffOf([]));
    renderLanesDock({ input: { session: makeSession(), working: false, changes: [], openspecHasDir: false, openspecPending: false } });
    await settle();
    expect(screen.queryByTestId("composer-dock")).toBeNull();
  });

  it("E3: a worktree session with no changes still renders one Changes lane: branch, ← base, no-local-changes marker, worktree actions", async () => {
    stubSessionDiffFetch(() => diffOf([]));
    const zero = { dirtyCount: 0, staged: 0, unstaged: 0, untracked: 0, ahead: 0, behind: 0 };
    renderLanesDock({
      input: {
        session: makeSession({ gitBranch: "os/x", gitWorktree: { mainPath: "/main", name: "os-x", base: "develop" }, gitStatus: zero }),
        working: false,
        openspecHasDir: false,
        openspecPending: false,
      },
    });
    await settle();
    expect(laneNames()).toEqual(["Changes"]);
    const lane = screen.getByRole("group", { name: "Changes" });
    expect(within(lane).getByTestId("composer-git-branch").textContent).toContain("os/x");
    expect(within(lane).getByTestId("composer-git-base").textContent).toContain("develop");
    expect(within(lane).getByTestId("composer-git-clean").textContent).toContain("no local changes");
    expect(within(lane).getByTestId("worktree-actions-menu")).toBeTruthy();
    expect(lane.querySelector("[data-dock-toggle]")).toBeNull(); // nothing to expand
  });

  it("E11: a bash-artifact entry is marked `via bash`; a git-status entry is not", async () => {
    stubSessionDiffFetch(() => diffOf([changed("made.txt", { detectedVia: "bash-artifact", producedBy: "touch made.txt" }), changed("edited.ts", { detectedVia: "git-status" })]));
    renderLanesDock({ input: { session: makeSession(), working: false, openspecHasDir: false, openspecPending: false } });
    await settle();
    fireEvent.click(toggle("changes"));
    const rows = screen.getAllByTestId("composer-dock-row");
    expect(rows).toHaveLength(2);
    const made = rows.find((r) => r.textContent?.includes("made.txt")) as HTMLElement;
    const edited = rows.find((r) => r.textContent?.includes("edited.ts")) as HTMLElement;
    expect(made.textContent).toContain("via bash");
    expect(edited.textContent).not.toContain("via bash");
  });
});
