// @vitest-environment jsdom
/**
 * TaskBoard (test-plan S16 deps/blocked, S17 counts/disclosure/read-only, S61 inert
 * text): grouped list on narrow viewports, stacked sections on wide ones.
 * See change: add-agent-teams-ui.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TaskBoard } from "../TaskBoard.js";
import { member, snap, task } from "./view-fixtures.js";

afterEach(cleanup);
const card = (id: string) => document.querySelector(`[data-testid="team-task-card"][data-task="${id}"]`) as HTMLElement;
const board = (s = snap(), extra: Partial<Parameters<typeof TaskBoard>[0]> = {}) => render(<TaskBoard snap={s} narrow={false} {...extra} />);

describe("dependencies and blocked marker (S16)", () => {
  it("pending dep → 'blocked' + chip 'waits for #2 — pending'; in progress reads 'in progress'", () => {
    board(snap({ tasks: [task("2", "pending"), task("5", "in_progress"), task("4", "pending", { blockedBy: ["2", "5"], blocked: true })] }));
    const c = card("4");
    expect(within(c).getByTestId("team-task-blocked").textContent).toContain("Blocked");
    const chips = within(c).getAllByTestId("team-task-dep").map((x) => x.textContent);
    expect(chips).toEqual(["waits for #2 — pending", "waits for #5 — in progress"]);
    expect(within(c).queryByTestId("team-task-unblocked")).toBeNull();
  });

  it("completed dep → 'unblocked' chip, no blocked marker", () => {
    board(snap({ tasks: [task("2", "completed"), task("4", "pending", { blockedBy: ["2"], blocked: false })] }));
    expect(within(card("4")).getByTestId("team-task-unblocked").textContent).toBe("unblocked");
    expect(within(card("4")).queryByTestId("team-task-blocked")).toBeNull();
  });

  it("dangling dependency → 'waits for #9 — missing'; the blocked marker still follows the SERVER flag", () => {
    const { unmount } = board(snap({ tasks: [task("4", "pending", { blockedBy: ["9"], blocked: false })] }));
    expect(within(card("4")).getByTestId("team-task-dep").textContent).toBe("waits for #9 — missing");
    expect(within(card("4")).queryByTestId("team-task-blocked")).toBeNull();
    expect(within(card("4")).queryByTestId("team-task-unblocked")).toBeNull();
    unmount();
    board(snap({ tasks: [task("4", "pending", { blockedBy: ["9"], blocked: true })] }));
    expect(within(card("4")).getByTestId("team-task-blocked")).toBeTruthy();
  });

  it("server blocked:true with every dep completed still shows blocked (server decides)", () => {
    board(snap({ tasks: [task("2", "completed"), task("4", "pending", { blockedBy: ["2"], blocked: true })] }));
    expect(within(card("4")).getByTestId("team-task-blocked")).toBeTruthy();
  });

  it("owner renders as text; absent owner reads 'unassigned'", () => {
    board(snap({ tasks: [task("1", "pending", { owner: "bob" }), task("2", "pending")] }));
    expect(within(card("1")).getByTestId("team-task-owner").textContent).toBe("bob");
    expect(within(card("2")).getByTestId("team-task-owner").textContent).toBe("unassigned");
  });
});

describe("counts, empty states, disclosure (S17)", () => {
  it("0 tasks → empty state", () => {
    board(snap({ tasks: [] }));
    expect(screen.getByTestId("team-tasks-empty").textContent).toContain("No tasks yet");
  });

  it("section counts are exact and an empty section shows 'None'", () => {
    board(snap({ tasks: [task("1", "completed"), task("2", "completed")] }));
    const counts = (s: string) => within(screen.getByTestId(`team-board-section-${s}`)).getByTestId("team-board-count").textContent;
    expect([counts("pending"), counts("in_progress"), counts("completed")]).toEqual(["0", "0", "2"]);
    expect(within(screen.getByTestId("team-board-section-pending")).getByText("None")).toBeTruthy();
  });

  it("50 tasks × 2 000 chars: closed disclosures do not mount description/result; the opened one does, as plain text", () => {
    const big = "x".repeat(2000);
    const tasks = Array.from({ length: 50 }, (_, i) => task(String(i + 1), i % 3 === 0 ? "pending" : i % 3 === 1 ? "in_progress" : "completed", { description: big, result: big }));
    board(snap({ tasks }));
    expect(document.body.textContent?.length ?? 0).toBeLessThan(20_000);
    expect(screen.getAllByTestId("team-task-card")).toHaveLength(50);
    fireEvent.click(within(card("1")).getByTestId("team-task-toggle"));
    const details = within(card("1")).getByTestId("team-task-details");
    expect(details.textContent).toContain(big);
    expect(within(card("1")).getByTestId("team-task-toggle").getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelectorAll('[data-testid="team-task-details"]')).toHaveLength(1);
  });

  it("is read-only: no draggable, no edit control", () => {
    board();
    expect(document.querySelector("[draggable],input,textarea,select")).toBeNull();
    expect(screen.queryByRole("button", { name: /edit|delete|assign/i })).toBeNull();
  });
});

describe("filter and layouts", () => {
  it("owner filter shows only that member's tasks and clears", () => {
    let cleared = 0;
    const s = snap({ members: [member("a"), member("b")], tasks: [task("1", "pending", { owner: "a" }), task("2", "pending", { owner: "b" })] });
    const { rerender } = board(s, { ownerFilter: "a", onClearFilter: () => cleared++ });
    expect(screen.getAllByTestId("team-task-card")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Show all tasks" }));
    expect(cleared).toBe(1);
    rerender(<TaskBoard snap={s} narrow={false} />);
    expect(screen.getAllByTestId("team-task-card")).toHaveLength(2);
  });

  it("narrow = grouped list: groups are disclosure buttons with counts, Completed folded by default", () => {
    render(<TaskBoard snap={snap()} narrow />);
    expect(screen.getByTestId("team-board").getAttribute("data-layout")).toBe("grouped");
    const done = within(screen.getByTestId("team-board-section-completed")).getAllByRole("button")[0] as HTMLElement;
    expect(done.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector('[data-task="1"]')).toBeNull();
    fireEvent.click(done);
    expect(document.querySelector('[data-task="1"]')).not.toBeNull();
    expect(within(screen.getByTestId("team-board-section-pending")).getAllByRole("button")[0]?.getAttribute("aria-expanded")).toBe("true");
  });

  it("focus request unfolds the group and focuses the card", async () => {
    render(<TaskBoard snap={snap()} narrow focus={{ id: "1", nonce: 1 }} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(document.activeElement?.id).toBe("team-task-1");
  });
});

describe("inert peer text (S61)", () => {
  it("title, description, result, owner and note are literal text", () => {
    const evil = "<img src=x onerror=alert(1)> **b** [x](javascript:alert(1)) https://evil.example/ &lt;b&gt;";
    board(snap({ tasks: [task("1", "pending", { title: evil, description: evil, result: evil, owner: evil, note: evil })] }));
    fireEvent.click(within(card("1")).getByTestId("team-task-toggle"));
    const c = card("1");
    expect(c.textContent).toContain(evil);
    expect(c.querySelector("img,script,a,b,strong,em")).toBeNull();
  });
});
