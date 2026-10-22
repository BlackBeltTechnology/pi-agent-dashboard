/**
 * Changes and Queue lanes of the composer dock, through the real lane hooks.
 * Covers the worktree identity segment (moved from the composer strip), the
 * Changes header/actions/body, and the Queue lane header + embedded cycler.
 * Test-plan #E9 (identity) #E16 (lane half); tasks 4.1, 6.1.
 * See change: add-composer-dock.
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeSession, renderLanesDock, stubSessionDiffFetch } from "./dock-harness.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const file = (path: string, over: Record<string, unknown> = {}) => ({
  path,
  changes: [],
  origin: "edit",
  sessionOwned: true,
  previewable: true,
  additions: 3,
  deletions: 1,
  ...over,
});
const diff = (files: unknown[], extra: Record<string, unknown> = {}) => ({
  body: { success: true, data: { files, isGitRepo: true, ...extra } },
});
// fixed-tick-waits: opt-out — macrotask yield that lets mocked fetch promises settle inside act
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const toggle = (key: string) => document.querySelector<HTMLButtonElement>(`[data-dock-toggle="${key}"]`) as HTMLButtonElement;

const WT = { mainPath: "/main", name: "os-x", base: "develop" };
const ST = (over: Partial<NonNullable<DashboardSession["gitStatus"]>> = {}) => ({ dirtyCount: 0, staged: 0, unstaged: 0, untracked: 0, ahead: 0, behind: 0, ...over });

async function renderChanges(session: DashboardSession, extra: Record<string, unknown> = {}, files: unknown[] = [], resp: Record<string, unknown> = {}) {
  const fetchMock = stubSessionDiffFetch(() => diff(files, resp));
  const utils = renderLanesDock({ input: { session, working: false, openspecHasDir: false, openspecPending: false, ...extra } });
  await settle();
  return { ...utils, fetchMock };
}
const changesLane = () => screen.getByRole("group", { name: "Changes" });

describe("Changes lane identity segment (#E9, moved from the strip)", () => {
  const renderGit = (over: Partial<DashboardSession>) => renderChanges(makeSession({ gitWorktree: WT, gitBranch: "os/x", ...over }));

  it("(a) dirty 3 ahead 2 → branch, base, 3 changed files, ↑2, no ↓; the tooltip names worktree and main checkout", async () => {
    await renderGit({ gitStatus: ST({ dirtyCount: 3, ahead: 2 }) });
    expect(screen.getByTestId("composer-git-branch").textContent).toContain("os/x");
    expect(screen.getByTestId("composer-git-base").textContent).toContain("develop");
    expect(screen.getByTestId("composer-git-dirty").textContent).toContain("3 changed files");
    expect(screen.getByTestId("composer-git-ahead").textContent).toContain("↑2");
    expect(screen.queryByTestId("composer-git-behind")).toBeNull();
    expect(screen.getByTestId("composer-git-identity").getAttribute("title")).toBe("os-x — /main");
  });

  it("(b) base absent → no ←", async () => {
    await renderGit({ gitWorktree: { mainPath: "/main", name: "os-x" } });
    expect(screen.queryByTestId("composer-git-base")).toBeNull();
  });

  it("(c) all zero → 'no local changes', never 'in sync'", async () => {
    await renderGit({ gitStatus: ST() });
    expect(screen.getByTestId("composer-git-clean").textContent).toContain("no local changes");
    expect(screen.getByTestId("composer-git-identity").textContent).not.toMatch(/in sync/i);
  });

  it("(d) status absent → neither drift nor a no-changes marker", async () => {
    await renderGit({});
    for (const id of ["composer-git-clean", "composer-git-dirty", "composer-git-ahead"]) expect(screen.queryByTestId(id)).toBeNull();
  });

  it("(e) branch absent → no ⎇ text", async () => {
    await renderGit({ gitBranch: undefined });
    expect(screen.queryByTestId("composer-git-branch")).toBeNull();
    expect(screen.getByTestId("composer-git-identity").textContent).not.toContain("⎇");
  });

  it("main checkout: no identity segment, `N files changed` instead", async () => {
    await renderChanges(makeSession(), {}, [file("a.ts"), file("b.ts"), file("c.ts"), file("d.ts")], { totalAdditions: 12, totalDeletions: 4 });
    expect(screen.queryByTestId("composer-git-identity")).toBeNull();
    expect(changesLane().textContent).toContain("4 files changed");
    expect(changesLane().textContent).toContain("+12");
    expect(changesLane().textContent).toContain("\u22124");
  });
});

describe("Changes lane header actions and body (4.1, 4.2)", () => {
  const files = [file("packages/client/src/App.tsx", { additions: 64, deletions: 20 }), file("README.md")];

  it("Review opens the diff view and does not toggle the lane", async () => {
    const onReview = vi.fn();
    await renderChanges(makeSession(), { onReview }, files);
    expect(toggle("changes").getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByTestId("composer-dock-review"));
    expect(onReview).toHaveBeenCalledTimes(1);
    expect(toggle("changes").getAttribute("aria-expanded")).toBe("false");
    expect(toggle("changes").contains(screen.getByTestId("composer-dock-review"))).toBe(false);
  });

  it("activating a file row opens that file's diff", async () => {
    const onOpenFile = vi.fn();
    await renderChanges(makeSession(), { onOpenFile }, files);
    fireEvent.click(toggle("changes"));
    await settle();
    const row = screen.getAllByTestId("composer-dock-row").find((r) => r.textContent?.includes("App.tsx")) as HTMLElement;
    fireEvent.click(within(row).getByTestId("composer-dock-file-diff"));
    expect(onOpenFile).toHaveBeenCalledWith("packages/client/src/App.tsx");
  });

  it("deltas carry their sign characters, not only colour (+64 −20)", async () => {
    await renderChanges(makeSession(), {}, files);
    fireEvent.click(toggle("changes"));
    await settle();
    const row = screen.getAllByTestId("composer-dock-row").find((r) => r.textContent?.includes("App.tsx")) as HTMLElement;
    expect(row.textContent).toContain("+64");
    expect(row.textContent).toContain("\u221220");
  });

  it("expanding inside the 2 s window sets one pending refetch, not an immediate request", async () => {
    const { fetchMock } = await renderChanges(makeSession(), {}, files);
    const before = fetchMock.mock.calls.length;
    fireEvent.click(toggle("changes"));
    await settle();
    // Inside the 2 s window of the first request: one pending refetch, not an immediate one.
    expect(fetchMock.mock.calls.length).toBe(before);
    expect(screen.getAllByTestId("composer-dock-row")).toHaveLength(2);
  });

  it("unclaimed changes end the body with one line naming their count", async () => {
    await renderChanges(makeSession(), { onReview: vi.fn() }, files, { otherChanges: [file("x"), file("y"), file("z")] });
    fireEvent.click(toggle("changes"));
    await settle();
    const line = screen.getByTestId("composer-dock-other-changes");
    expect(line.textContent).toContain("3 other changes");
    expect(within(line).getByRole("button", { name: "Show" })).toBeTruthy();
  });

  it("out-of-cwd rows list without a diff link", async () => {
    await renderChanges(makeSession(), { onOpenFile: vi.fn() }, [...files, file("/etc/hosts", { previewable: false, additions: undefined, deletions: undefined })]);
    fireEvent.click(toggle("changes"));
    await settle();
    const rows = screen.getAllByTestId("composer-dock-row");
    expect(rows).toHaveLength(3);
    const out = rows.find((r) => r.textContent?.includes("hosts")) as HTMLElement;
    expect(within(out).queryByTestId("composer-dock-file-diff")).toBeNull();
    expect(changesLane().textContent).toContain("2 files changed");
  });
});

describe("Queue lane (6.1, #E16)", () => {
  const entries = (n: number) => Array.from({ length: n }, (_, i) => ({ text: `follow-up ${i + 1}`, imageCount: 0 }));
  const withQueue = (n: number) => makeSession({ pendingQueues: { steering: [], followUp: entries(n) } } as never);
  const render = (session: DashboardSession, extra: Record<string, unknown> = {}) => {
    stubSessionDiffFetch(() => diff([]));
    return renderLanesDock({ input: { session, working: false, openspecHasDir: false, openspecPending: false, ...extra } });
  };
  const queueLane = () => screen.getByRole("group", { name: "Queue" });

  it("1 follow-up → `1 queued follow-up`, no Clear all", () => {
    render(withQueue(1), { onClearFollowUps: vi.fn() });
    expect(queueLane().textContent).toContain("1 queued follow-up");
    expect(queueLane().textContent).not.toContain("1 queued follow-ups");
    expect(within(queueLane()).queryByTestId("queue-followup-clear-all")).toBeNull();
  });

  it("2 follow-ups → `2 queued follow-ups · delivered when the agent finishes the turn`; Clear all calls onClearAll", () => {
    const onClearFollowUps = vi.fn();
    render(withQueue(2), { onClearFollowUps });
    expect(queueLane().textContent).toContain("2 queued follow-ups");
    expect(queueLane().textContent).toContain("delivered when the agent finishes the turn");
    fireEvent.click(within(queueLane()).getByTestId("queue-followup-clear-all"));
    expect(onClearFollowUps).toHaveBeenCalledTimes(1);
    expect(toggle("queue").getAttribute("aria-expanded")).toBe("false");
  });

  it("expanding hosts the embedded cycler: position, no subtitle, no second Clear all", () => {
    render(withQueue(3), { onClearFollowUps: vi.fn() });
    fireEvent.click(toggle("queue"));
    const panel = screen.getByTestId("queue-panel");
    expect(panel.getAttribute("data-embedded")).toBe("true");
    expect(within(panel).getByTestId("queue-followup-position").textContent).toContain("3 of 3");
    expect(within(panel).queryByTestId("queue-followup-clear-all")).toBeNull();
    expect(panel.textContent).not.toContain("delivered when the agent finishes the turn");
    expect(screen.getAllByTestId("queue-followup-clear-all")).toHaveLength(1); // the lane header's
  });

  it("the cycler keeps the attachment indicator inside the lane", () => {
    render(makeSession({ pendingQueues: { steering: [], followUp: [{ text: "with images", imageCount: 2 }] } } as never));
    fireEvent.click(toggle("queue"));
    expect(screen.getByTestId("queue-chip-followup").textContent).toBe("with images");
    expect(screen.getByTestId("queue-followup-attachments").textContent).toContain("2");
  });

  it("an empty queue leaves no Queue lane", () => {
    render(withQueue(0));
    expect(screen.queryByRole("group", { name: "Queue" })).toBeNull();
  });
});
