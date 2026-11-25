// @vitest-environment jsdom
/**
 * UI state keyed by stable id across a refresh (test-plan S92): an open disclosure,
 * the log filter and the focused control survive a refetch that replaces every
 * object; a task moving sections keeps its open disclosure; a filter on a vanished
 * member resets to "all" with an inline note. See change: add-agent-teams-ui.
 */
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flush, type Mounted, mountView } from "./team-view-harness.js";
import { mail, member, snap, task } from "./view-fixtures.js";

let m: Mounted | undefined;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  m?.unmount();
  m = undefined;
  cleanup();
  vi.useRealTimers();
});

const base = () =>
  snap({
    rev: 1,
    members: [member("alice", "busy", { sessionId: "S-a" }), member("bob", "idle", { sessionId: "S-b" })],
    tasks: [task("3", "pending", { description: "details of three" }), task("4", "pending")],
    mail: [mail(1, { from: "bob", to: "lead", text: "from bob" }), mail(2, { from: "alice", to: "lead", text: "from alice" })],
    mailTotal: 2,
  });
const tab = (n: string) => fireEvent.click(screen.getByRole("tab", { name: new RegExp(n) }));
const refetch = async () => {
  m?.store.signalReconnect();
  await flush(600);
};
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("state across a refresh (S92)", () => {
  it("open disclosure, filter and focus survive an unchanged-identity refresh (every object replaced)", async () => {
    m = await mountView(base());
    tab("Tasks");
    fireEvent.click(document.querySelector('[data-task="3"] [data-testid=team-task-toggle]') as HTMLElement);
    tab("Messages");
    fireEvent.change(screen.getByLabelText("Member"), { target: { value: "bob" } });
    tab("Members");
    const link = document.querySelector('[data-member="alice"] [data-testid=team-member-open-subagent]') as HTMLElement;
    link.focus();
    expect(document.activeElement).toBe(link);

    m.server.snapshot = { ...clone(base()), rev: 2 };
    await refetch();
    expect(m.store.getTeam("t1")?.snapshot?.rev).toBe(2);

    expect(document.querySelector('[data-task="3"] [data-testid=team-task-details]')?.textContent).toContain("details of three");
    expect((screen.getByLabelText("Member") as HTMLSelectElement).value).toBe("bob");
    expect(document.activeElement).toBe(link);
    expect(link.isConnected).toBe(true);
  });

  it("a task moving Pending → In progress keeps its open disclosure (state keyed by task id)", async () => {
    m = await mountView(base());
    tab("Tasks");
    fireEvent.click(document.querySelector('[data-task="3"] [data-testid=team-task-toggle]') as HTMLElement);
    const moved = clone(base());
    moved.rev = 2;
    moved.tasks = [task("3", "in_progress", { owner: "alice", description: "details of three" }), task("4", "pending")];
    m.server.snapshot = moved;
    await refetch();
    const card = document.querySelector('[data-task="3"]') as HTMLElement;
    expect(card.closest('[data-testid="team-board-section-in_progress"]')).not.toBeNull();
    expect(card.querySelector("[data-testid=team-task-details]")?.textContent).toContain("details of three");
  });

  it("a filter on a vanished member resets to all with an inline note; the other state stays", async () => {
    m = await mountView(base());
    tab("Tasks");
    fireEvent.click(document.querySelector('[data-task="4"] [data-testid=team-task-toggle]') as HTMLElement);
    tab("Messages");
    fireEvent.change(screen.getByLabelText("Member"), { target: { value: "bob" } });
    const gone = clone(base());
    gone.rev = 2;
    gone.members = [member("alice", "busy", { sessionId: "S-a" })];
    m.server.snapshot = gone;
    await refetch();
    expect((screen.getByLabelText("Member") as HTMLSelectElement).value).toBe("all");
    expect(screen.getByTestId("team-log-vanished").textContent).toContain("bob left the team");
    expect(document.querySelector('[data-task="4"] [data-testid=team-task-details]')).not.toBeNull();
  });

  it("the selected tab survives a refresh", async () => {
    m = await mountView(base());
    tab("Messages");
    m.server.snapshot = { ...clone(base()), rev: 2 };
    await refetch();
    expect(screen.getByRole("tab", { name: /Messages/ }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("cross-links", () => {
  it("a member's current task link switches to Tasks and focuses the card; '+N more' filters the board", async () => {
    m = await mountView(
      snap({ members: [member("alice", "busy")], tasks: [task("2", "in_progress", { owner: "alice" }), task("5", "in_progress", { owner: "alice" }), task("7", "pending", { owner: "bob" })] }),
    );
    fireEvent.click(screen.getByTestId("team-member-task"));
    await flush(50);
    expect(screen.getByRole("tab", { name: /Tasks/ }).getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement?.id).toBe("team-task-2");
    tab("Members");
    fireEvent.click(screen.getByTestId("team-member-more"));
    expect(screen.getByRole("tab", { name: /Tasks/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("team-board-filter").textContent).toContain("alice");
    expect(screen.getAllByTestId("team-task-card")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Show all tasks" }));
    expect(screen.getAllByTestId("team-task-card")).toHaveLength(3);
  });
});
