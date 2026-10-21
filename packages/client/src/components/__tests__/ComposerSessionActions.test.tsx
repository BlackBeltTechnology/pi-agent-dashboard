/**
 * OpenSpec lane (and the Context lane) of the composer dock, assembled by
 * `useComposerDockLanes` from `ComposerSessionActions.tsx` and rendered by the
 * real `ComposerDock`. Replaces the composer strip's tests: the same gating,
 * primaries and slot wiring, now as dock lanes.
 *
 * Test-plan #E12–#E18 #X2; tasks 5.1–5.3, 6.2.
 * See change: add-composer-dock.
 */
import { ComposerContextGroup } from "@blackbelt-technology/dashboard-plugin-runtime";
import { createSlotRegistry } from "@blackbelt-technology/dashboard-plugin-runtime/host";
import type { DashboardSession, OpenSpecChange, OpenSpecConfig } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { ChangeState, deriveChangeState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isComposerWorking } from "../../lib/chat/composer-liveness.js";
import { __resetArchiveCache } from "../../lib/openspec/archive-cache.js";
import { absentData, archiveEntry, knownData, makeChange, stubArchiveApi } from "../../test-support/attachmentHarness.js";
import {
  hasStandInItems,
  resetStandIn,
  STAND_IN_FRAME_TYPE,
  STAND_IN_PLUGIN_ID,
  StandInBadge,
  setStandInStatus,
} from "../../test-support/statusGateStandIn.js";
import { type LanesHarnessProps, makeSession as makeDockSession, renderLanesDock } from "../chat/__tests__/dock-harness.js";
import type { ComposerDockLanesInput } from "../chat/useComposerDockLanes.js";
import { deriveOpenSpecActions } from "../openspec/openspec-actions.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetStandIn();
});

function makeSession(over: Partial<DashboardSession> = {}): DashboardSession {
  return makeDockSession({ model: "claude", startedAt: Date.now(), ...over } as Partial<DashboardSession>);
}

const planningArtifacts = [{ id: "proposal" as const, status: "ready" as const }];
const implementingArtifacts = [
  { id: "proposal" as const, status: "done" as const },
  { id: "design" as const, status: "done" as const },
  { id: "specs" as const, status: "done" as const },
];

function implementingChange(): OpenSpecChange {
  return { name: "add-auth", status: "in-progress", completedTasks: 4, totalTasks: 12, artifacts: implementingArtifacts };
}
function completeChange(): OpenSpecChange {
  return { name: "add-auth", status: "complete", completedTasks: 12, totalTasks: 12, artifacts: implementingArtifacts };
}

type LaneProps = Partial<Omit<ComposerDockLanesInput, "working">> & { working?: boolean };

/** `/api/session-diff` (empty), `/api/openspec/tasks` and the archive list, all stubbed. */
function stubApis(tasks?: (url: string) => { ok: boolean; body: unknown }) {
  __resetArchiveCache();
  const fn = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/api/openspec/tasks")) {
      const r = tasks?.(u) ?? { ok: true, body: { success: true, data: { tasks: [], groups: [] } } };
      return { ok: r.ok, json: async () => r.body } as Response;
    }
    if (u.includes("/api/session-diff")) return { ok: true, json: async () => ({ success: true, data: { files: [], isGitRepo: true } }) } as Response;
    return { ok: true, json: async () => ({ success: true, data: [] }) } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

beforeEach(() => {
  stubApis();
});

function renderLane(props: LaneProps, opts: Omit<LanesHarnessProps, "input"> = {}) {
  const session = props.session;
  const working = props.working ?? isComposerWorking(session?.status ?? "idle", false);
  return renderLanesDock({ input: { ...props, session, working }, ...opts });
}

const lane = () => screen.getByRole("group", { name: "OpenSpec" });
const quietLane = () => screen.queryByRole("group", { name: "OpenSpec" });
const inLane = (id: string) => within(lane()).getByTestId(id);
const openMenu = () => fireEvent.click(within(lane()).getByTestId("composer-openspec-overflow-btn"));
const menu = () => screen.getByTestId("composer-openspec-overflow-menu");
// fixed-tick-waits: opt-out — macrotask yield that lets mocked fetch promises settle inside act; assertions follow via findBy/waitFor
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe("OpenSpec lane — gate and unattached state", () => {
  it("renders no dock when the session is undefined", () => {
    renderLane({ session: undefined });
    expect(screen.queryByTestId("composer-dock")).toBeNull();
  });

  it("unattached: an OpenSpec lane with Attach, Explore and ⋯, no lifecycle bar, not expandable", () => {
    renderLane({ session: makeSession(), changes: [], openspecHasDir: true });
    expect(lane()).toBeTruthy();
    expect((inLane("composer-explore-btn") as HTMLButtonElement).disabled).toBe(false);
    expect(within(lane()).queryByTestId("composer-archive-btn")).toBeNull();
    expect(within(lane()).queryByTestId("composer-openspec-stepper")).toBeNull();
    expect(lane().querySelector("[data-dock-toggle]")).toBeNull();
  });

  it("no lane (and no dock) when openspecHasDir is false and not pending", () => {
    renderLane({ session: makeSession(), changes: [], openspecHasDir: false, openspecPending: false });
    expect(quietLane()).toBeNull();
    expect(screen.queryByTestId("composer-dock")).toBeNull();
  });

  it.each([
    ["READY", { state: "READY" as const }, true],
    ["PENDING", { state: "PENDING" as const }, true],
    ["ABSENT", { state: "ABSENT" as const }, false],
    ["OPTED_OUT", { state: "OPTED_OUT" as const }, false],
  ])("readiness %s → lane shown: %s (readiness governs over hasDir)", (_n, openspecReadiness, shown) => {
    renderLane({ session: makeSession(), changes: [], openspecHasDir: true, openspecReadiness: openspecReadiness as never });
    expect(!!quietLane()).toBe(shown);
  });

  it("an ended session without a traceable attachment shows no OpenSpec lane", () => {
    renderLane({ session: makeSession({ status: "ended" }), changes: [], openspecHasDir: true });
    expect(quietLane()).toBeNull();
  });
});

describe("unattached OpenSpec lane (#E7)", () => {
  const three: OpenSpecChange[] = [
    implementingChange(),
    { name: "b", status: "in-progress", completedTasks: 0, totalTasks: 3, artifacts: implementingArtifacts },
    { name: "c", status: "complete", completedTasks: 3, totalTasks: 3, artifacts: implementingArtifacts },
  ];

  it.each([
    ["all", ["new", "propose", "explore", "apply", "archive"], true],
    ["core", ["propose", "explore", "apply", "archive"], false],
  ] as const)("wf %s, 3 changes → attach enabled; Explore; ⋯ per wf + Refresh; no stepper, no archive", (_n, workflows, hasNew) => {
    renderLane({
      session: makeSession(),
      changes: three,
      openspecHasDir: true,
      onAttach: () => {},
      onRefresh: () => {},
      openspecConfig: { workflows: [...workflows] } as OpenSpecConfig,
    });
    expect((inLane("composer-attach-chip") as HTMLButtonElement).disabled).toBe(false);
    expect(inLane("composer-explore-btn")).toBeTruthy();
    openMenu();
    expect(!!within(menu()).queryByTestId("composer-new-change-btn")).toBe(hasNew);
    expect(within(menu()).getByTestId("composer-propose-btn")).toBeTruthy();
    expect(within(menu()).getByTestId("composer-refresh-btn")).toBeTruthy();
    expect(within(lane()).queryByTestId("composer-openspec-stepper")).toBeNull();
    expect(within(lane()).queryByTestId("composer-archive-btn")).toBeNull();
  });

  it("Refresh from ⋯ calls onRefresh", () => {
    const onRefresh = vi.fn();
    renderLane({ session: makeSession(), changes: three, openspecHasDir: true, onRefresh });
    openMenu();
    fireEvent.click(within(menu()).getByTestId("composer-refresh-btn"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("0 changes → disabled 'No changes' chip", () => {
    renderLane({ session: makeSession(), changes: [], openspecHasDir: true, onAttach: () => {} });
    const chip = inLane("composer-attach-chip") as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
    expect(chip.textContent).toContain("No changes");
  });

  it("flat picker (no groups) → onAttach(name)", () => {
    const onAttach = vi.fn();
    renderLane({ session: makeSession(), changes: three, openspecHasDir: true, onAttach });
    fireEvent.click(inLane("composer-attach-chip"));
    fireEvent.click(screen.getByText("add-auth"));
    expect(onAttach).toHaveBeenCalledWith("add-auth");
  });

  it("grouped picker (groups present) → onAttach(name)", () => {
    const onAttach = vi.fn();
    renderLane({
      session: makeSession(),
      changes: three,
      openspecHasDir: true,
      onAttach,
      groups: [{ id: "g1", name: "Group 1" } as never],
      assignments: { "add-auth": "g1" },
    });
    fireEvent.click(inLane("composer-attach-chip"));
    fireEvent.click(screen.getByText("add-auth"));
    expect(onAttach).toHaveBeenCalledWith("add-auth");
  });
});

describe("attached OpenSpec lane (#E12)", () => {
  it("IMPLEMENTING 12/39 → title + `12/39 tasks`, letters bar, Apply primary, ⋯ lists Explore…, Open proposal, Refresh, Detach; no standalone Explore", () => {
    renderLane({
      session: makeSession({ attachedProposal: "add-auth" }),
      changes: [{ ...implementingChange(), completedTasks: 12, totalTasks: 39 }],
      openspecHasDir: true,
      onReadArtifact: vi.fn(),
      onRefresh: vi.fn(),
      onDetach: vi.fn(),
    });
    expect(inLane("composer-openspec-title").textContent).toBe("add-auth");
    expect(inLane("composer-openspec-counts").textContent).toBe("12/39 tasks");
    expect(inLane("composer-stepper-segment-tasks").textContent).toContain("12/39");
    expect(inLane("composer-apply-btn")).toBeTruthy();
    expect(within(lane()).queryByTestId("composer-explore-btn")).toBeNull();
    openMenu();
    const items = Array.from(menu().querySelectorAll("button")).map((b) => b.textContent?.trim());
    expect(items).toEqual(expect.arrayContaining(["Explore…", "Open proposal", "Refresh", "Detach"]));
    // Order: workflow items, then Open proposal + Refresh, then Detach last.
    expect(items.at(-1)).toBe("Detach");
  });

  it("Apply dispatches /skill:openspec-apply-change <name>", () => {
    const onSendPrompt = vi.fn();
    renderLane({ session: makeSession({ attachedProposal: "add-auth" }), changes: [implementingChange()], openspecHasDir: true, onSendPrompt });
    fireEvent.click(inLane("composer-apply-btn"));
    expect(onSendPrompt).toHaveBeenCalledWith("/skill:openspec-apply-change add-auth");
  });

  it("COMPLETE: Archive is the primary; Verify sits inside ⋯", () => {
    renderLane({ session: makeSession({ attachedProposal: "add-auth" }), changes: [completeChange()], openspecHasDir: true });
    const archive = inLane("composer-archive-btn") as HTMLButtonElement;
    expect(archive.disabled).toBe(false);
    expect(archive.getAttribute("aria-disabled")).toBeNull();
    expect(within(lane()).queryByTestId("composer-verify-btn")).toBeNull();
    openMenu();
    expect(menu().contains(screen.getByTestId("composer-verify-btn"))).toBe(true);
  });

  it("Detach from ⋯ calls onDetach; Explore… is reachable from ⋯", () => {
    const onDetach = vi.fn();
    renderLane({ session: makeSession({ attachedProposal: "add-auth" }), changes: [implementingChange()], openspecHasDir: true, onDetach });
    openMenu();
    expect(within(menu()).getByTestId("composer-explore-menu-item")).toBeTruthy();
    fireEvent.click(within(menu()).getByTestId("composer-detach-btn"));
    expect(onDetach).toHaveBeenCalledTimes(1);
  });

  it("Open proposal reads the proposal artifact", () => {
    const onReadArtifact = vi.fn();
    renderLane({ session: makeSession({ attachedProposal: "add-auth" }), changes: [implementingChange()], openspecHasDir: true, onReadArtifact });
    openMenu();
    fireEvent.click(within(menu()).getByTestId("composer-open-proposal-btn"));
    expect(onReadArtifact).toHaveBeenCalledWith("add-auth", "proposal");
  });

  it("⋯: focus lands on the first item, Escape returns focus to ⋯, portalled outside the lane", async () => {
    renderLane({ session: makeSession({ attachedProposal: "add-auth" }), changes: [implementingChange()], openspecHasDir: true, onReadArtifact: vi.fn() });
    const trigger = inLane("composer-openspec-overflow-btn");
    fireEvent.click(trigger);
    await act(async () => { await new Promise<void>((r) => requestAnimationFrame(() => r())); });
    expect(document.activeElement).toBe(menu().querySelector("button"));
    expect(lane().contains(menu())).toBe(false);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("composer-openspec-overflow-menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("lifecycle gating (E10): IMPLEMENTING 12/39 shows the count on the Tasks segment and a 31% fill", () => {
    renderLane({
      session: makeSession({ attachedProposal: "add-auth" }),
      changes: [{ ...implementingChange(), completedTasks: 12, totalTasks: 39 }],
      openspecHasDir: true,
    });
    expect(inLane("composer-stepper-segment-tasks").textContent).toContain("12/39");
    expect(inLane("composer-stepper-tasks-fill").style.width).toBe("31%");
    expect(within(lane()).queryByTestId("composer-archive-btn")).toBeNull();
  });

  it("skipped specs renders as skipped on the bar", () => {
    const c = { ...implementingChange(), artifacts: [...implementingArtifacts.slice(0, 2), { id: "specs" as const, status: "skipped" as const }] };
    renderLane({ session: makeSession({ attachedProposal: "add-auth" }), changes: [c], openspecHasDir: true });
    expect(inLane("composer-stepper-segment-specs").getAttribute("data-state")).toBe("skipped");
  });
});

describe("same primary and workflow items as the session card (#E13)", () => {
  const states: Array<[string, OpenSpecChange]> = [
    ["PLANNING", { name: "add-auth", status: "no-tasks", completedTasks: 0, totalTasks: 0, artifacts: planningArtifacts }],
    ["READY", { name: "add-auth", status: "no-tasks", completedTasks: 0, totalTasks: 12, artifacts: implementingArtifacts }],
    ["IMPLEMENTING", implementingChange()],
    ["COMPLETE", completeChange()],
  ];
  const configs: Array<[string, string[]]> = [
    ["all", ["explore", "propose", "new", "continue", "ff", "apply", "verify", "sync", "archive"]],
    ["core", ["explore", "propose", "apply", "archive"]],
    ["no-apply", ["continue", "ff", "verify", "archive"]],
    ["archive-only", ["archive"]],
    ["none", []],
  ];
  const ids = (els: Element[]) => els.map((e) => (e.getAttribute("data-testid") ?? "").replace(/^composer-/, ""));

  it.each(states.flatMap(([sName, change]) => configs.map(([cName, workflows]) => [sName, cName, change, workflows] as const)))(
    "%s × %s → same primary id; same workflow-item set",
    (_s, _c, change, workflows) => {
      const state = deriveChangeState(change);
      const card = deriveOpenSpecActions({
        attached: true,
        found: true,
        state,
        wf: (w) => workflows.includes(w),
        isEnded: false,
        working: false,
        showArchiveAnyway: false,
        includeDetach: true,
        idPrefix: "",
        error: undefined,
      });
      renderLane({
        session: makeSession({ attachedProposal: "add-auth" }),
        changes: [change],
        openspecHasDir: true,
        openspecConfig: { workflows } as OpenSpecConfig,
      });
      const primary = lane().querySelector("[data-emphasis]");
      expect(primary?.getAttribute("data-testid")?.replace(/^composer-/, "")).toBe(card.primary?.testId);
      openMenu();
      const workflowIds = ids(Array.from(menu().querySelectorAll("button"))).filter(
        (id) => id !== "open-proposal-btn" && id !== "refresh-btn" && id !== "detach-btn",
      );
      expect(workflowIds).toEqual(card.overflow.filter((a) => a.key !== "detach").map((a) => a.testId));
      expect(state).toBeDefined();
    },
  );

  it("every ChangeState was covered", () => {
    expect(states.map(([, c]) => deriveChangeState(c))).toEqual([ChangeState.PLANNING, ChangeState.READY, ChangeState.IMPLEMENTING, ChangeState.COMPLETE]);
  });
});

const WT = { mainPath: "/main", name: "feat-x", base: "develop" };
const MIN = 60_000;
const openPr = (checks: "passing" | "failing", over: Partial<DashboardSession> = {}): Partial<DashboardSession> => ({
  gitWorktree: WT,
  gitPrNumber: 747,
  gitPrUrl: "https://gh/pr/747",
  gitPrState: "open",
  gitPrDraft: false,
  gitPrChecks: checks,
  gitPrCheckedAt: Date.now() - 1 * MIN,
  ...over,
});

describe("single filled primary in the dock (#E14)", () => {
  const filled = () => Array.from(document.querySelectorAll("[data-emphasis='filled']")).map((e) => e.getAttribute("data-testid"));
  it.each([
    ["COMPLETE + passing", completeChange(), "passing", "worktree-action-merge"],
    ["IMPLEMENTING + passing", implementingChange(), "passing", "composer-apply-btn"],
    ["COMPLETE + failing", completeChange(), "failing", "composer-archive-btn"],
  ] as const)("%s → exactly one filled: %s", (_n, change, checks, expected) => {
    renderLane({ session: makeSession({ attachedProposal: "add-auth", ...openPr(checks) }), changes: [change], openspecHasDir: true });
    expect(filled()).toEqual([expected]);
  });

  it("green PR on a COMPLETE change: Merge filled, the OpenSpec primary outlined and enabled", () => {
    renderLane({ session: makeSession({ attachedProposal: "add-auth", ...openPr("passing") }), changes: [completeChange()], openspecHasDir: true });
    const archive = inLane("composer-archive-btn");
    expect(archive.getAttribute("data-emphasis")).toBe("outlined");
    expect(archive.getAttribute("aria-disabled")).toBeNull();
    expect((archive as HTMLButtonElement).disabled).toBe(false);
  });

  it("#X4: COMPLETE + open passing PR checked 20 min ago → Merge outlined, Archive filled", () => {
    renderLane({
      session: makeSession({ attachedProposal: "add-auth", ...openPr("passing", { gitPrCheckedAt: Date.now() - 20 * MIN }) }),
      changes: [completeChange()],
      openspecHasDir: true,
    });
    expect(filled()).toEqual(["composer-archive-btn"]);
    expect(screen.getByTestId("worktree-action-merge").getAttribute("data-emphasis")).toBe("outlined");
  });
});

describe("working state (streaming ∨ retrying) gates the lane (5.2, #F7)", () => {
  it("streaming: primary, ⋯ workflow items and Explore aria-disabled + focusable; Tasks inert; P/D/S, Open proposal, Detach, Refresh live", () => {
    const onSendPrompt = vi.fn();
    const onReadArtifact = vi.fn();
    renderLane({
      session: makeSession({ status: "streaming", attachedProposal: "add-auth" }),
      changes: [{ ...implementingChange(), completedTasks: 12, totalTasks: 39 }],
      openspecHasDir: true,
      onSendPrompt,
      onReadArtifact,
      onRefresh: vi.fn(),
      onDetach: vi.fn(),
    });
    const apply = inLane("composer-apply-btn") as HTMLButtonElement;
    expect(apply.getAttribute("aria-disabled")).toBe("true");
    expect(apply.disabled).toBe(false);
    expect(apply.getAttribute("title")).toBe("Session is streaming");
    fireEvent.click(apply);
    expect(onSendPrompt).not.toHaveBeenCalled();
    fireEvent.click(inLane("composer-stepper-segment-tasks"));
    expect(screen.queryByTestId("tasks-popover")).toBeNull();
    fireEvent.click(inLane("composer-stepper-segment-proposal"));
    expect(onReadArtifact).toHaveBeenCalledWith("add-auth", "proposal");
    openMenu();
    expect(within(menu()).getByTestId("composer-explore-menu-item").getAttribute("aria-disabled")).toBe("true");
    for (const id of ["composer-open-proposal-btn", "composer-refresh-btn", "composer-detach-btn"]) {
      expect(within(menu()).getByTestId(id).getAttribute("aria-disabled"), id).toBeNull();
    }
  });

  it.each([
    ["idle", "active", false, false],
    ["streaming", "streaming", false, true],
    ["retrying", "active", true, true],
  ] as const)("%s → OpenSpec primary / Push / Merge gated iff working; the segment stays live", (_n, status, retrying, gated) => {
    const onReadArtifact = vi.fn();
    renderLane({
      session: makeSession({ status, attachedProposal: "add-auth", ...openPr("passing") }),
      changes: [completeChange()],
      openspecHasDir: true,
      working: status === "streaming" || retrying,
      onReadArtifact,
    });
    for (const id of ["composer-archive-btn", "worktree-action-push", "worktree-action-merge"]) {
      const el = screen.getByTestId(id) as HTMLButtonElement;
      expect(el.getAttribute("aria-disabled"), id).toBe(gated ? "true" : null);
      expect(el.disabled, id).toBe(false); // focusable
      if (gated) expect(el.getAttribute("title"), id).toBe("Session is streaming");
    }
    if (gated) expect(document.querySelectorAll("[data-emphasis='filled']")).toHaveLength(0);
    fireEvent.click(inLane("composer-stepper-segment-proposal"));
    expect(onReadArtifact).toHaveBeenCalledWith("add-auth", "proposal");
  });

  it.each([
    ["server ended + retryState", "ended", true, null],
    ["server idle + retryState", "idle", true, "true"],
  ] as const)("working fed by isComposerWorking: %s → gated=%s", (_n, status, retrying, gated) => {
    renderLane({
      session: makeSession({ status, attachedProposal: "add-auth", ...openPr("passing") }),
      changes: [completeChange()],
      openspecHasDir: true,
      working: isComposerWorking(status, retrying),
    });
    for (const id of ["worktree-action-push", "worktree-action-merge"]) {
      expect(screen.getByTestId(id).getAttribute("aria-disabled"), id).toBe(gated);
    }
  });
});

describe("non-live attachments keep a traceable lane (#E15, resolve-archived-attached-proposal)", () => {
  const base = { openspecReadiness: { state: "READY" as const }, onReadArtifact: vi.fn(), onDetach: vi.fn() };
  const items = () => Array.from(menu().querySelectorAll("button")).map((b) => b.textContent?.trim());

  it("E15: ended session attached to an archived change → name, `Archived 2026-10-01`, archive letters, ⋯ with only Detach; no bar or primary", async () => {
    stubArchiveApi({ "/repo": [archiveEntry("2026-10-01-add-auth")] });
    renderLane({ session: makeSession({ status: "ended", attachedProposal: "add-auth" }), changes: [], ...base, onRefresh: vi.fn() }, {
      openspecMap: { "/repo": knownData() },
    });
    await screen.findByTestId("attachment-archived-badge");
    expect(inLane("composer-openspec-title").textContent).toBe("add-auth");
    expect(inLane("attachment-archived-badge").textContent).toBe("Archived 2026-10-01");
    expect(within(lane()).getAllByRole("button").some((b) => /^[PDT]$/.test(b.textContent?.trim() ?? ""))).toBe(true);
    openMenu();
    expect(items()).toEqual(["Detach"]);
    expect(within(lane()).queryByTestId("composer-lifecycle")).toBeNull();
    expect(lane().querySelector("[data-emphasis]")).toBeNull();
  });

  it("active in the main checkout (removed worktree): Detach-only ⋯, no Open proposal", async () => {
    stubArchiveApi({});
    renderLane(
      {
        session: makeSession({ cwd: "/repo/.worktrees/os-x", status: "ended", attachedProposal: "x", gitWorktree: { mainPath: "/repo", name: "os-x" } as never }),
        changes: [],
        ...base,
      },
      { openspecMap: { "/repo/.worktrees/os-x": absentData(), "/repo": knownData(makeChange("x")) } },
    );
    await screen.findByTestId("attachment-main-checkout-badge");
    openMenu();
    expect(items()).toEqual(["Detach"]);
  });

  it("unresolved (OpenSpec data not settled yet): no Open proposal, Detach offered", () => {
    stubArchiveApi({});
    renderLane({ session: makeSession({ attachedProposal: "add-auth" }), changes: [], ...base, onRefresh: vi.fn() });
    openMenu();
    expect(within(menu()).queryByTestId("composer-open-proposal-btn")).toBeNull();
    expect(within(menu()).getByTestId("composer-detach-btn")).toBeTruthy();
  });

  it("live active attachment offers Open proposal", () => {
    stubArchiveApi({});
    renderLane({ session: makeSession({ attachedProposal: "add-auth" }), changes: [implementingChange()], ...base });
    openMenu();
    expect(within(menu()).getByTestId("composer-open-proposal-btn")).toBeTruthy();
  });
});

describe("expanded body (5.3, X2)", () => {
  const tasksOf = (n: number, done = 1) => ({
    success: true,
    data: {
      groups: ["1"],
      tasks: Array.from({ length: n }, (_, i) => ({ id: `1.${i + 1}`, text: `Task number ${i + 1}`, done: i < done, line: i + 3, group: "1" })),
    },
  });
  const expand = () => fireEvent.click(lane().querySelector("[data-dock-toggle=openspec]") as HTMLElement);
  const taskCalls = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.filter(([u]) => String(u).includes("/api/openspec/tasks")).length;
  const props = (change: OpenSpecChange): LaneProps => ({
    session: makeSession({ attachedProposal: "add-auth" }),
    changes: [change],
    openspecHasDir: true,
    onReadArtifact: vi.fn(),
  });

  it("fetches on expand and lists the last done + next open tasks with numbers and shapes; footer `N more · Open tasks.md`", async () => {
    const fetchMock = stubApis(() => ({ ok: true, body: tasksOf(9, 2) }));
    renderLane(props(implementingChange()));
    expect(taskCalls(fetchMock)).toBe(0); // nothing is fetched while collapsed
    expand();
    await flush();
    expect(taskCalls(fetchMock)).toBe(1);
    const rows = screen.getAllByTestId("composer-openspec-task");
    // 1 last done + 5 next open
    expect(rows).toHaveLength(6);
    expect(rows[0]?.getAttribute("data-done")).toBe("true");
    expect(rows[0]?.textContent).toContain("1.2");
    expect(rows[1]?.getAttribute("data-done")).toBe("false");
    expect(rows[1]?.textContent).toContain("1.3");
    expect(rows.every((r) => r.querySelector("svg"))).toBe(true); // a shape, not only a colour
    expect(screen.getByTestId("composer-openspec-more-tasks").textContent).toContain("2 more");
    expect(screen.getByTestId("composer-openspec-open-tasks").textContent).toContain("Open tasks.md");
  });

  it("Open tasks.md reads the tasks artifact", async () => {
    stubApis(() => ({ ok: true, body: tasksOf(2, 0) }));
    const p = props(implementingChange());
    renderLane(p);
    expand();
    await flush();
    fireEvent.click(screen.getByTestId("composer-openspec-open-tasks"));
    expect(p.onReadArtifact).toHaveBeenCalledWith("add-auth", "tasks");
  });

  it("cache hit on re-expand; invalidated when done/total changes", async () => {
    const fetchMock = stubApis(() => ({ ok: true, body: tasksOf(4, 1) }));
    const first = props(implementingChange());
    const view = renderLane(first);
    expand();
    await flush();
    expect(taskCalls(fetchMock)).toBe(1);
    expand(); // collapse
    expand(); // expand again → cache hit
    await flush();
    expect(taskCalls(fetchMock)).toBe(1);
    expect(screen.getAllByTestId("composer-openspec-task").length).toBeGreaterThan(0);

    // Collapsed; 4/12 → 5/12 makes the cached list stale: the next expand refetches.
    expand();
    view.rerenderLanes({ input: { ...first, session: first.session, working: false, changes: [{ ...implementingChange(), completedTasks: 5 }] } });
    expand();
    await flush();
    expect(taskCalls(fetchMock)).toBe(2);
    expand();
    expand(); // same 5/12 again: cache hit
    await flush();
    expect(taskCalls(fetchMock)).toBe(2);
  });

  it("X2: a 404 shows `Couldn't load tasks` with Retry and Open tasks.md; the header keeps the primary", async () => {
    const fetchMock = stubApis(() => ({ ok: false, body: { success: false, error: "not found" } }));
    renderLane(props(implementingChange()));
    expand();
    await flush();
    expect(screen.getByText("Couldn't load tasks")).toBeTruthy();
    expect(screen.getByTestId("composer-openspec-tasks-retry")).toBeTruthy();
    expect(screen.getByTestId("composer-openspec-open-tasks")).toBeTruthy();
    expect(inLane("composer-apply-btn")).toBeTruthy();
    // Retry refetches and recovers.
    fetchMock.mockClear();
    stubApis(() => ({ ok: true, body: tasksOf(3, 0) }));
    fireEvent.click(screen.getByTestId("composer-openspec-tasks-retry"));
    await flush();
    expect(screen.queryByText("Couldn't load tasks")).toBeNull();
    expect(screen.getAllByTestId("composer-openspec-task").length).toBe(3);
  });
});

// ── Context lane: composer-context-group + Status (task 6.2) ─────────────────

function contextGroupRegistry(button = false) {
  const registry = createSlotRegistry();
  registry.addClaim({
    pluginId: "quota",
    priority: 600,
    slot: "composer-context-group",
    Component: () => (
      <ComposerContextGroup label="Quota" testId="quota-context-group">
        {button ? (
          <button type="button" data-testid="ctx-btn">open</button>
        ) : (
          <span data-testid="quota-chip">5h 14%</span>
        )}
      </ComposerContextGroup>
    ),
  });
  return registry;
}

function badgeRegistry(button = false) {
  const registry = contextGroupRegistry(button);
  registry.addClaim({
    pluginId: "badge",
    priority: 100,
    slot: "session-card-badge",
    Component: () => (button ? <button type="button" data-testid="badge-btn">RUN</button> : <span data-testid="fake-badge">RUN</span>),
  });
  return registry;
}

const contextLane = () => screen.getByRole("group", { name: "Context" });
const precedes = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("Context lane (#E17, #E18, 6.2)", () => {
  it("the group renders after the Changes lane and before the Status group", () => {
    renderLane({ session: makeSession({ gitWorktree: WT }), changes: [], openspecHasDir: true }, { registry: badgeRegistry() });
    const changes = screen.getByRole("group", { name: "Changes" });
    const quota = screen.getByTestId("quota-context-group");
    const status = screen.getByTestId("composer-status-group-label");
    expect(precedes(changes, quota)).toBe(true);
    expect(precedes(quota, status)).toBe(true);
    expect(contextLane().contains(quota)).toBe(true);
  });

  it("E17: streaming disables the Status badge button; the Quota button stays enabled", () => {
    renderLane({ session: makeSession({ status: "streaming" }), changes: [], openspecHasDir: true }, { registry: badgeRegistry(true) });
    expect((screen.getByTestId("composer-status-group") as HTMLFieldSetElement).disabled).toBe(true);
    expect(screen.getByTestId("badge-btn").matches(":disabled")).toBe(true);
    const quota = screen.getByTestId("ctx-btn") as HTMLButtonElement;
    expect(quota.disabled).toBe(false);
    expect(quota.matches(":disabled")).toBe(false);
    expect(quota.closest("fieldset")).toBeNull();
    // Idle: the Status group is live again.
    cleanup();
    renderLane({ session: makeSession({ status: "active" }), changes: [], openspecHasDir: true }, { registry: badgeRegistry(true) });
    expect(screen.getByTestId("badge-btn").matches(":disabled")).toBe(false);
  });

  it("the lane renders for a context-group claim even with no other lane content, and is not expandable", () => {
    renderLane({ session: makeSession(), changes: [], openspecHasDir: false, openspecPending: false }, { registry: contextGroupRegistry() });
    expect(screen.getByTestId("quota-context-group")).toBeTruthy();
    expect(contextLane().querySelector("[data-dock-toggle]")).toBeNull();
    cleanup();
    renderLane({ session: makeSession(), changes: [], openspecHasDir: false, openspecPending: false }, { registry: createSlotRegistry() });
    expect(screen.queryByTestId("composer-dock")).toBeNull();
  });

  it("E18: two claims whose components return null leave no visible Context lane, label or container", async () => {
    const registry = createSlotRegistry();
    registry.addClaim({ pluginId: "empty-a", priority: 100, slot: "composer-context-group", Component: () => null });
    registry.addClaim({ pluginId: "empty-b", priority: 100, slot: "session-card-badge", Component: () => null });
    renderLane({ session: makeSession(), changes: [], openspecHasDir: false, openspecPending: false }, { registry });
    await flush();
    const el = screen.getByTestId("composer-dock-lane-context");
    expect(el.hasAttribute("hidden")).toBe(true);
    // The empty STATUS group's label stays in the DOM but under the hidden lane.
    expect(screen.getByTestId("composer-status-group-label").closest("[hidden]")).toBe(el);
    expect(screen.getByTestId("composer-status-group").childNodes.length).toBe(0);
    expect(screen.queryByRole("group", { name: "Context" })).toBeNull();
    // The dock itself leaves no chrome either.
    expect(screen.getByTestId("composer-dock").hasAttribute("hidden")).toBe(true);
  });

  describe("Status group follows a gated badge claim (fix-empty-status-subcard)", () => {
    function renderGated() {
      const registry = createSlotRegistry();
      registry.addClaim({ pluginId: STAND_IN_PLUGIN_ID, priority: 500, slot: "session-card-badge", Component: StandInBadge, shouldRender: hasStandInItems });
      return renderLane({ session: makeSession(), changes: [], openspecHasDir: true }, { registry });
    }
    const oneTab = {
      type: STAND_IN_FRAME_TYPE,
      auditSeq: 1,
      instances: [{ instanceId: "i1", profileDirectory: "OSS", host: "dashboard", state: "connected" as const, tabs: [{ tabId: 1, title: "T", url: "https://x.test", state: "live" as const }] }],
    };

    it("renders no STATUS label with zero tabs", () => {
      renderGated();
      expect(screen.queryByTestId("composer-status-group-label")).toBeNull();
    });

    it("renders the STATUS label + badge when a tab appears", () => {
      renderGated();
      act(() => setStandInStatus(oneTab));
      expect(screen.getByTestId("composer-status-group-label")).toBeTruthy();
      expect(screen.getByTestId("standin-badge")).toBeTruthy();
    });
  });
});

describe("lane test ids kept from the strip (D7)", () => {
  it("attached worktree session with a badge claim keeps the OpenSpec, Git and Status ids", () => {
    renderLane(
      { session: makeSession({ attachedProposal: "add-auth", gitWorktree: WT }), changes: [implementingChange()], openspecHasDir: true },
      { registry: badgeRegistry() },
    );
    for (const id of ["composer-openspec-container", "composer-git-container", "composer-git-group", "composer-status-container", "composer-status-group", "composer-status-group-label"]) {
      expect(screen.getByTestId(id), id).toBeTruthy();
    }
    expect(screen.getByTestId("composer-status-group").tagName).toBe("FIELDSET");
    for (const c of ["composer-openspec-container", "composer-git-container", "composer-status-container"]) {
      expect(screen.getByTestId(c).getAttribute("role")).toBe("group");
    }
    expect(screen.queryByTestId("composer-session-actions")).toBeNull();
  });
});
