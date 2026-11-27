// @vitest-environment jsdom
/**
 * Team view touch points of an in-process team (test-plan S107 / S108 / S110 / S111, tasks 10.1–10.4):
 * a member without `sessionId` opens its subagent view by `childAgentId` and offers no session link
 * or chat input; the header names the mode and states the parallelism bound only when
 * `maxTeammates` exceeds `maxConcurrent`; a slot-queued teammate shows a 1-based position. Asserts the
 * stable `data-testid` / `data-status` contract (never translated copy, except where the text IS the
 * requirement). Mirrors the Playwright spec `tests/e2e/team/team-inproc.spec.ts` at component level.
 * See change: add-agent-teams-in-process.
 */
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MembersGrid, type MembersGridProps } from "../MembersGrid.js";
import { TeamHeader, type TeamHeaderProps } from "../TeamHeader.js";
import { member, renderHost, snap } from "./view-fixtures.js";

afterEach(cleanup);

const LEAD = "S-lead";
const inproc = (over: Parameters<typeof snap>[0] = {}) => snap({ mode: "in-process", leadSessionId: LEAD, maxTeammates: 5, maxConcurrent: 4, ...over });
const child = (name: string, status: Parameters<typeof member>[1], over: Parameters<typeof member>[2] = {}) => member(name, status, { childAgentId: `agent-${name}`, ...over });

function grid(s = inproc({ members: [child("bob", "busy"), child("eve", "idle")] }), over: Partial<MembersGridProps> = {}) {
  const props: MembersGridProps = { snap: s, notes: {}, pending: new Set(), onStop: vi.fn(), onFocusTask: vi.fn(), onShowMemberTasks: vi.fn(), ...over };
  return { ...renderHost(<MembersGrid {...props} />), props };
}
const row = (name: string) => document.querySelector(`[data-testid="team-member-card"][data-member="${name}"]`) as HTMLElement;

function header(s = inproc()) {
  const props: TeamHeaderProps = { snap: s, shutdownPending: false, shutdownNote: undefined, onShutdown: vi.fn(), onBack: vi.fn() };
  return renderHost(<TeamHeader {...props} />);
}

describe("member row (S107, task 10.1)", () => {
  it("offers Open subagent view by childAgentId on the lead's session route, and no session link, composer or chat input", () => {
    grid(inproc({ members: [child("bob", "busy"), child("eve", "idle", { childAgentId: "a/b?c" })] }));
    const open = within(row("bob")).getByTestId("team-member-open-subagent");
    expect(open.tagName).toBe("A");
    expect(open.getAttribute("href")).toBe(`/session/${LEAD}/subagent/agent-bob`);
    expect(open.textContent).toBe("Open subagent view");
    expect(within(row("eve")).getByTestId("team-member-open-subagent").getAttribute("href")).toBe(`/session/${LEAD}/subagent/${encodeURIComponent("a/b?c")}`);
    for (const name of ["bob", "eve"]) {
      expect(row(name).textContent).not.toContain("Open session");
      expect(row(name).querySelector("textarea, input, [contenteditable]")).toBeNull();
      expect(row(name).querySelector('a[href^="/session/"]:not([href*="/subagent/"])')).toBeNull();
    }
  });

  it("the action has an accessible name that includes the member, and is reachable by keyboard (a native link)", () => {
    grid();
    const open = within(row("bob")).getByTestId("team-member-open-subagent");
    expect(open.getAttribute("aria-label")).toBe("Open subagent view of bob");
    expect(open.getAttribute("tabindex")).toBeNull();
    open.focus();
    expect(document.activeElement).toBe(open);
  });

  it("a member with a sessionId keeps its session link (session team unchanged)", () => {
    grid(snap({ members: [member("a", "idle", { sessionId: "S-a" })] }));
    expect(within(row("a")).getByTestId("team-member-open-subagent").getAttribute("href")).toBe("/session/S-a");
    expect(row("a").textContent).toContain("Open session");
  });

  it("neither a session nor a childAgentId (or no lead session to route through) shows the 'session removed' text, no link", () => {
    grid(inproc({ members: [member("ghost", "gone"), child("orphan", "gone")], leadSessionId: undefined }));
    for (const name of ["ghost", "orphan"]) {
      expect(within(row(name)).queryByTestId("team-member-open-subagent")).toBeNull();
      expect(within(row(name)).getByText("session removed")).toBeTruthy();
    }
  });

  it("a gone in-process member keeps its action and shows the reason", () => {
    grid(inproc({ members: [child("bob", "gone", { goneReason: "stopped" })] }));
    expect(within(row("bob")).getByTestId("team-member-status").getAttribute("data-status")).toBe("gone");
    expect(within(row("bob")).getByTestId("team-member-open-subagent")).toBeTruthy();
    expect(row("bob").textContent).toContain("stopped");
  });
});

describe("status and queue position (S107, S111, task 10.4)", () => {
  it("team-member-status carries data-status for every status plus glyph+text (no colour-only status)", () => {
    const statuses = ["spawning", "idle", "busy", "shutdown_pending", "disconnected", "gone", "failed"] as const;
    grid(inproc({ members: statuses.map((s) => child(`m-${s}`, s)) }));
    for (const s of statuses) {
      const pill = within(row(`m-${s}`)).getByTestId("team-member-status");
      expect(pill.getAttribute("data-status")).toBe(s);
      expect(pill.textContent?.trim().length).toBeGreaterThan(2);
    }
  });

  it("a slot-queued teammate shows spawning plus its 1-based position as text; a started one shows none", () => {
    grid(inproc({ members: [child("c", "spawning", { queuePosition: 1 }), child("d", "spawning", { queuePosition: 2 }), child("a", "busy")] }));
    expect(within(row("c")).getByTestId("team-member-status").getAttribute("data-status")).toBe("spawning");
    expect(within(row("c")).getByTestId("team-member-queue").textContent).toBe("Queued — position 1");
    expect(within(row("d")).getByTestId("team-member-queue").textContent).toBe("Queued — position 2");
    expect(within(row("a")).queryByTestId("team-member-queue")).toBeNull();
  });

  it("never renders position 0, a negative, fractional or non-numeric position, nor a position on a non-spawning member", () => {
    const bad = [0, -1, 1.5, Number.NaN, "2" as unknown as number];
    grid(inproc({ members: [...bad.map((q, i) => child(`s${i}`, "spawning", { queuePosition: q })), child("idleq", "idle", { queuePosition: 3 })] }));
    expect(screen.queryAllByTestId("team-member-queue")).toHaveLength(0);
  });

  it("an idle member that re-queued for a continued run keeps data-status idle and shows no spawning-only position", () => {
    grid(inproc({ members: [child("a", "idle", { queuePosition: 1 })] }));
    expect(within(row("a")).getByTestId("team-member-status").getAttribute("data-status")).toBe("idle");
  });

  it("the queue text is announced politely so a position change is heard", () => {
    grid(inproc({ members: [child("c", "spawning", { queuePosition: 3 })] }));
    expect(within(row("c")).getByTestId("team-member-queue").getAttribute("role")).toBe("status");
  });
});

describe("header (S108, tasks 10.2 / 10.4)", () => {
  it("names the mode (team-header-mode)", () => {
    header();
    expect(screen.getByTestId("team-header-mode").textContent).toBe("Mode: in-process");
  });

  it.each([
    { maxTeammates: 5, maxConcurrent: 4, bound: true, n: 4 },
    { maxTeammates: 6, maxConcurrent: 2, bound: true, n: 2 },
    { maxTeammates: 4, maxConcurrent: 4, bound: false, n: 0 },
    { maxTeammates: 3, maxConcurrent: 4, bound: false, n: 0 },
  ])("maxTeammates $maxTeammates vs maxConcurrent $maxConcurrent → bound shown: $bound", ({ maxTeammates, maxConcurrent, bound, n }) => {
    header(inproc({ maxTeammates, maxConcurrent }));
    const parallel = screen.queryByTestId("team-header-parallel");
    if (!bound) {
      expect(parallel).toBeNull();
      return;
    }
    expect(parallel?.textContent).toContain(`At most ${n} run in parallel`);
    expect(parallel?.getAttribute("data-bound")).toBe(String(n));
  });

  it("an in-process team without the bound inputs (older server, or availability not reported) shows no bound", () => {
    header(inproc({ maxTeammates: undefined, maxConcurrent: undefined }));
    expect(screen.queryByTestId("team-header-parallel")).toBeNull();
    cleanup();
    header(inproc({ maxTeammates: 5, maxConcurrent: undefined }));
    expect(screen.queryByTestId("team-header-parallel")).toBeNull();
  });

  it("rejects malformed bound inputs (0, negative, fractional) instead of stating a nonsense bound", () => {
    for (const maxConcurrent of [0, -2, 1.5, Number.NaN]) {
      header(inproc({ maxTeammates: 5, maxConcurrent }));
      expect(screen.queryByTestId("team-header-parallel")).toBeNull();
      cleanup();
    }
  });

  it("a session team keeps the live 'working in parallel' count under team-header-parallel (contract of add-agent-teams-ui)", () => {
    header(snap({ mode: "session", members: [member("a", "busy"), member("b", "busy")] }));
    expect(screen.getByTestId("team-header-parallel").textContent).toBe("2 working in parallel");
    expect(screen.getByTestId("team-header-parallel").hasAttribute("data-bound")).toBe(false);
  });

  it("an unbounded in-process team still shows how many members work, under a different id", () => {
    header(inproc({ maxTeammates: 4, maxConcurrent: 4, members: [child("a", "busy"), child("b", "idle")] }));
    expect(screen.getByTestId("team-header-working").textContent).toBe("1 working in parallel");
  });
});
