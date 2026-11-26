// @vitest-environment jsdom
/**
 * MembersGrid (test-plan S15 current task, S12 status text, S121 test ids, S61 inert
 * text, S118 degraded member, S37 Stop visibility): the decided mock's members TABLE.
 * See change: add-agent-teams-ui.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { currentTasks, MembersGrid, type MembersGridProps } from "../MembersGrid.js";
import { member, snap, task } from "./view-fixtures.js";

afterEach(cleanup);

function grid(over: Partial<MembersGridProps> = {}, s = snap()) {
  const props: MembersGridProps = { snap: s, notes: {}, pending: new Set(), onStop: vi.fn(), onFocusTask: vi.fn(), onShowMemberTasks: vi.fn(), ...over };
  return { ...render(<MembersGrid {...props} />), props };
}
const row = (name: string) => document.querySelector(`[data-testid="team-member-card"][data-member="${name}"]`) as HTMLElement;

describe("current task (S15)", () => {
  it("0 → no task line; 1 → `#3 title`; idle-with-#3 keeps the idle text AND the task", () => {
    grid({}, snap({ members: [member("a", "busy"), member("b", "idle"), member("c", "idle")], tasks: [task("3", "in_progress", { owner: "b", title: "Port it" })] }));
    expect(within(row("a")).getByText("No current task")).toBeTruthy();
    expect(within(row("b")).getByTestId("team-member-task").textContent).toBe("#3 Port it");
    expect(within(row("b")).getByTestId("team-member-status").textContent).toContain("Idle");
    expect(within(row("b")).queryByTestId("team-member-more")).toBeNull();
  });

  it("2 tasks → lowest id plus '+1 more' that opens the board filtered to the member; the task link focuses the card", () => {
    const { props } = grid({}, snap({ members: [member("a", "busy")], tasks: [task("12", "in_progress", { owner: "a" }), task("4", "in_progress", { owner: "a" })] }));
    expect(within(row("a")).getByTestId("team-member-task").textContent).toBe("#4 Task 4");
    const more = within(row("a")).getByTestId("team-member-more");
    expect(more.textContent).toBe("+1 more");
    fireEvent.click(more);
    expect(props.onShowMemberTasks).toHaveBeenCalledWith("a");
    fireEvent.click(within(row("a")).getByTestId("team-member-task"));
    expect(props.onFocusTask).toHaveBeenCalledWith("4");
  });

  it("currentTasks sorts numerically and ignores other owners and states", () => {
    const tasks = [task("10", "in_progress", { owner: "a" }), task("9", "in_progress", { owner: "a" }), task("1", "pending", { owner: "a" }), task("2", "in_progress", { owner: "b" })];
    expect(currentTasks(tasks, "a").map((t) => t.id)).toEqual(["9", "10"]);
  });
});

describe("status, folder, session link (S12, S14, S121)", () => {
  it("every status shows glyph + text with the contract test ids", () => {
    const statuses = ["spawning", "idle", "busy", "shutdown_pending", "disconnected", "gone", "failed"] as const;
    grid({}, snap({ members: statuses.map((s) => member(`m-${s}`, s)) }));
    for (const s of statuses) {
      const pill = within(row(`m-${s}`)).getByTestId("team-member-status");
      expect(pill.getAttribute("data-status")).toBe(s);
      expect(pill.textContent?.length).toBeGreaterThan(2);
    }
  });

  it("an unknown member status renders as text, not a crash", () => {
    grid({}, snap({ members: [member("x", "weird" as never)] }));
    expect(within(row("x")).getByTestId("team-member-status").textContent).toContain("Unknown");
  });

  it("folder is relative to the lead folder; session link is encoded, a missing session reads 'session removed'", () => {
    grid({}, snap({ members: [member("a", "idle", { cwd: "/ws/lead/sub", sessionId: "S/../x?y" }), member("b", "gone", { cwd: "/ws/lead-other" })] }));
    expect(row("a").textContent).toContain("sub");
    const link = within(row("a")).getByTestId("team-member-open-subagent");
    expect(link.getAttribute("href")).toBe(`/session/${encodeURIComponent("S/../x?y")}`);
    expect(within(row("b")).queryByTestId("team-member-open-subagent")).toBeNull();
    expect(within(row("b")).getByText("session removed")).toBeTruthy();
    expect(row("b").textContent).toContain("/ws/lead-other");
  });

  it("is a real table with a caption and column headers", () => {
    grid();
    expect(screen.getByRole("table", { name: "Team members" })).toBeTruthy();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Member", "Status", "Model", "Working on", "Folder", "Actions"]);
  });

  it("empty member list shows the empty state", () => {
    grid({}, snap({ members: [] }));
    expect(screen.getByTestId("team-members-empty").textContent).toContain("No members yet");
  });
});

describe("Stop visibility (S37) and inline notes", () => {
  it("Stop only for busy ∧ control ∧ team not closing/closed", () => {
    const cases: Array<[string, boolean, boolean]> = [
      ["active", true, true],
      ["orphaned", true, true],
      ["closing", true, false],
      ["closed", true, false],
      ["active", false, false],
    ];
    for (const [status, control, expected] of cases) {
      const { unmount } = grid({}, snap({ status: status as never, viewerCanControl: control, members: [member("a", "busy"), member("b", "idle")] }));
      expect(within(row("a")).queryByTestId("team-member-stop") !== null, `${status}/${control}`).toBe(expected);
      expect(within(row("b")).queryByTestId("team-member-stop")).toBeNull();
      unmount();
    }
  });

  it("click calls onStop; pending disables the button; a note renders inline, described by the button", () => {
    const { props, rerender } = grid({}, snap({ members: [member("a", "busy")] }));
    fireEvent.click(within(row("a")).getByTestId("team-member-stop"));
    expect(props.onStop).toHaveBeenCalledWith("a");
    rerender(<MembersGrid {...props} pending={new Set(["a"])} notes={{ a: "forbidden" }} />);
    const btn = within(row("a")).getByTestId("team-member-stop") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    const err = within(row("a")).getByTestId("team-member-stop-error");
    expect(err.textContent).toContain("permission");
    expect(btn.getAttribute("aria-describedby")).toBe(err.id);
  });
});

describe("degraded member (S118)", () => {
  it("names the condition as text; an unknown value is shown, not a crash", () => {
    grid({}, snap({ members: [member("a", "idle", { degraded: "guard_unavailable" }), member("b", "idle", { degraded: "foo" })] }));
    expect(within(row("a")).getByTestId("team-member-degraded").textContent).toContain("safety guard is unavailable");
    expect(within(row("b")).getByTestId("team-member-degraded").textContent).toContain("foo");
  });
});

describe("inert peer text (S61)", () => {
  it("member name, role, model, cwd and task title are literal text", () => {
    const evil = "<img src=x onerror=alert(1)>";
    grid({}, snap({ members: [member("a", "busy", { role: evil, model: "**bold**", cwd: "[x](javascript:alert(1))" })], tasks: [task("1", "in_progress", { owner: "a", title: "<script>x</script>" })] }));
    const html = row("a");
    expect(html.textContent).toContain(evil);
    expect(html.textContent).toContain("**bold**");
    expect(html.textContent).toContain("<script>x</script>");
    expect(html.querySelector("img,script,b,strong")).toBeNull();
    expect(html.querySelector('a[href^="javascript"]')).toBeNull();
  });
});
