/**
 * `useDockDiff` scheduler + the Changes lane header it feeds.
 * Test-plan #E8 #E9 #E10 #X1 #X4 #X5 #X8 #P3 (+ coalescing, back-off of task 4.3).
 * See change: add-composer-dock (tasks 4.1–4.3).
 */
import type { FileDiffEntry, SessionDiffResponse } from "@blackbelt-technology/pi-dashboard-shared/diff-types.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LanesDockHarness, makeSession, stubSessionDiffFetch } from "../../components/chat/__tests__/dock-harness.js";
import {
  DOCK_DIFF_SERVER_CAP,
  DOCK_DIFF_SETTLE_MS,
  DOCK_DIFF_SLOW_MS,
  DOCK_DIFF_WINDOW_MS,
  useDockDiff,
} from "../useDockDiff.js";

const file = (path: string, additions?: number, deletions?: number, over: Partial<FileDiffEntry> = {}): FileDiffEntry => ({
  path,
  changes: [],
  origin: "edit",
  sessionOwned: true,
  previewable: true,
  ...(additions !== undefined ? { additions } : {}),
  ...(deletions !== undefined ? { deletions } : {}),
  ...over,
});

const response = (files: FileDiffEntry[], over: Partial<SessionDiffResponse> = {}): { body: unknown } => ({
  body: { success: true, data: { files, isGitRepo: true, ...over } satisfies SessionDiffResponse },
});

const four = [file("a.ts", 60, 10), file("b.ts", 40, 20), file("c.ts", 20, 3), file("d.ts", 0, 0)];

const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type Input = { working: boolean; dirty: number | undefined };
const mount = (initial: Input = { working: false, dirty: 0 }) =>
  renderHook(({ working, dirty }: Input) => useDockDiff({ sessionId: "s1", working, dirtyCount: dirty }), { initialProps: initial });

describe("scheduler", () => {
  it("loads once for a session, immediately", async () => {
    const fetchMock = stubSessionDiffFetch(() => response(four, { totalAdditions: 120, totalDeletions: 33 }));
    const hook = mount();
    await tick(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(hook.result.current.count).toBe(4);
    expect(hook.result.current.totals).toEqual({ additions: 120, deletions: 33 });
  });

  it("X5: turn end and a dirty-count change within 1 s send exactly one request", async () => {
    const fetchMock = stubSessionDiffFetch(() => response(four));
    const hook = mount({ working: true, dirty: 0 });
    await tick(0);
    await tick(DOCK_DIFF_WINDOW_MS + 500); // initial request settled, window passed
    fetchMock.mockClear();
    hook.rerender({ working: false, dirty: 0 }); // falling edge
    await tick(400);
    hook.rerender({ working: false, dirty: 3 }); // dirty count, 0.4 s later
    await tick(DOCK_DIFF_WINDOW_MS + DOCK_DIFF_SETTLE_MS + 1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("X4: a trigger 3 s into a 4 s request runs exactly one further request after it settles", async () => {
    let calls = 0;
    const startedAt: number[] = [];
    const settledAt: number[] = [];
    const fetchMock = stubSessionDiffFetch(async () => {
      calls += 1;
      startedAt.push(Date.now());
      // fixed-tick-waits: opt-out — mock fetch stalls under fake timers to exercise the in-flight coalescing timer behaviour itself
      if (calls === 1) await new Promise((r) => setTimeout(r, 4000));
      settledAt.push(Date.now());
      return response(four);
    });
    const hook = mount({ working: true, dirty: 0 });
    await tick(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await tick(3000);
    hook.rerender({ working: false, dirty: 0 }); // 3 s after the request started
    await tick(900); // settle delay elapsed, request still stalled
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await tick(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(startedAt[1]).toBeGreaterThanOrEqual(settledAt[0] as number);
  });

  it("P3a: 10 dirty-count changes in 3 s while working send no request until working ends", async () => {
    const fetchMock = stubSessionDiffFetch(() => response(four));
    const hook = mount({ working: true, dirty: 0 });
    await tick(0);
    await tick(DOCK_DIFF_WINDOW_MS + 500);
    fetchMock.mockClear();
    for (let i = 1; i <= 10; i++) {
      hook.rerender({ working: true, dirty: i });
      await tick(300);
    }
    expect(fetchMock).toHaveBeenCalledTimes(0);
    hook.rerender({ working: false, dirty: 10 });
    await tick(DOCK_DIFF_SETTLE_MS + 100);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("P3b: the same flapping while idle sends at most 2 requests in 3 s", async () => {
    const fetchMock = stubSessionDiffFetch(() => response(four));
    const hook = mount({ working: false, dirty: 0 });
    await tick(0);
    await tick(DOCK_DIFF_WINDOW_MS + 500);
    fetchMock.mockClear();
    for (let i = 1; i <= 10; i++) {
      hook.rerender({ working: false, dirty: i });
      await tick(300);
    }
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(2);
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("coalesces: Retry spam inside the window yields one pending refetch that runs once", async () => {
    const fetchMock = stubSessionDiffFetch(() => response(four));
    const hook = mount();
    await tick(0);
    fetchMock.mockClear();
    act(() => {
      hook.result.current.retry();
      hook.result.current.retry();
      hook.result.current.refreshOnExpand();
    });
    await tick(DOCK_DIFF_WINDOW_MS - 100);
    expect(fetchMock).toHaveBeenCalledTimes(0); // still inside the window of the first request
    await tick(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await tick(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("back-off (4.3): a request slower than the budget doubles the window; a fast one resets it", async () => {
    let slow = true;
    const startedAt: number[] = [];
    stubSessionDiffFetch(async () => {
      startedAt.push(Date.now());
      // fixed-tick-waits: opt-out — mock fetch stalls under fake timers to exercise the back-off timer behaviour itself
      if (slow) await new Promise((r) => setTimeout(r, DOCK_DIFF_SLOW_MS + 100));
      return response(four);
    });
    const hook = mount();
    await tick(0);
    await tick(DOCK_DIFF_SLOW_MS + 100); // slow request #1 settles → streak 1 → window 4 s
    act(() => hook.result.current.retry());
    await tick(DOCK_DIFF_WINDOW_MS + 500); // 2 s window is NOT enough any more
    expect(startedAt).toHaveLength(1);
    await tick(DOCK_DIFF_WINDOW_MS * 2); // 4 s after the first start
    expect(startedAt).toHaveLength(2);
    expect((startedAt[1] as number) - (startedAt[0] as number)).toBeGreaterThanOrEqual(DOCK_DIFF_WINDOW_MS * 2);

    slow = false;
    await tick(DOCK_DIFF_SLOW_MS + 100); // #2 (slow) settles → streak 2 → window 8 s
    act(() => hook.result.current.retry());
    await tick(DOCK_DIFF_WINDOW_MS * 4 + 100);
    expect(startedAt).toHaveLength(3); // fast #3 resets the streak
    await tick(10);
    act(() => hook.result.current.retry());
    await tick(DOCK_DIFF_WINDOW_MS + 100);
    expect(startedAt).toHaveLength(4); // back to the base 2 s window
  });

  it("a different session starts from nothing and never shows the previous files", async () => {
    stubSessionDiffFetch((url) => (url.includes("sessionId=s2") ? response([file("only-s2.ts", 1, 1)]) : response(four)));
    const hook = renderHook(({ id }: { id: string }) => useDockDiff({ sessionId: id, working: false, dirtyCount: 0 }), {
      initialProps: { id: "s1" },
    });
    await tick(0);
    expect(hook.result.current.count).toBe(4);
    hook.rerender({ id: "s2" });
    expect(hook.result.current.count).toBe(0);
    await tick(0);
    expect(hook.result.current.files.map((f) => f.path)).toEqual(["only-s2.ts"]);
  });
});

describe("header model", () => {
  it("E8: 4 in-cwd files +120 −33 count apart from the out-of-cwd entry", async () => {
    stubSessionDiffFetch(() =>
      response([...four, file("/etc/hosts", undefined, undefined, { previewable: false })], { totalAdditions: 120, totalDeletions: 33 }),
    );
    const hook = mount();
    await tick(0);
    expect(hook.result.current.count).toBe(4);
    expect(hook.result.current.outOfCwd).toHaveLength(1);
    expect(hook.result.current.totals).toEqual({ additions: 120, deletions: 33 });
  });

  it("E9: exactly the server cap reads as capped", async () => {
    stubSessionDiffFetch(() => response(Array.from({ length: DOCK_DIFF_SERVER_CAP }, (_, i) => file(`f${i}.ts`, 1, 0))));
    const hook = mount();
    await tick(0);
    expect(hook.result.current.count).toBe(200);
    expect(hook.result.current.capped).toBe(true);
  });

  it("E10: no totals and no per-file counts → totals null (count only)", async () => {
    stubSessionDiffFetch(() => response([file("a.txt"), file("b.txt"), file("c.txt")], { isGitRepo: false }));
    const hook = mount();
    await tick(0);
    expect(hook.result.current.count).toBe(3);
    expect(hook.result.current.totals).toBeNull();
  });

  it("without server totals the per-file counts are summed over the in-cwd files", async () => {
    stubSessionDiffFetch(() => response([file("a.ts", 5, 1), file("b.ts", 7, 2), file("/x", 100, 100, { previewable: false })]));
    const hook = mount();
    await tick(0);
    expect(hook.result.current.totals).toEqual({ additions: 12, deletions: 3 });
  });
});

// ── the Changes lane header, rendered through the real lane hook ──────────────

const WT = { mainPath: "/main", name: "os-x", base: "develop" };
const lanesInput = (session: DashboardSession) => ({ session, working: false });
const renderChanges = (session: DashboardSession) => {
  render(createElement(LanesDockHarness, { input: lanesInput(session) }));
  return act(async () => { await vi.advanceTimersByTimeAsync(0); });
};
const header = () => screen.getByRole("group", { name: "Changes" });

describe("Changes lane header (E8–E10, X8, X1)", () => {
  it("E8: worktree header reads `4 files +120 −33`; the out-of-cwd row has no diff link", async () => {
    stubSessionDiffFetch(() =>
      response([...four, file("/etc/hosts", undefined, undefined, { previewable: false })], { totalAdditions: 120, totalDeletions: 33 }),
    );
    await renderChanges(makeSession({ gitWorktree: WT, gitBranch: "os/x" }));
    expect(header().textContent).toContain("4 files +120 \u221233");
    fireEvent.click(header().querySelector("[data-dock-toggle=changes]") as HTMLElement);
    await tick(0);
    const rows = screen.getAllByTestId("composer-dock-row");
    expect(rows).toHaveLength(5);
    expect(rows.filter((r) => r.querySelector("[data-testid=composer-dock-file-diff]"))).toHaveLength(0); // no onOpenFile wired
  });

  it("E9: 200 owned files read `200+`", async () => {
    stubSessionDiffFetch(() => response(Array.from({ length: 200 }, (_, i) => file(`f${i}.ts`, 1, 0))));
    await renderChanges(makeSession());
    expect(header().textContent).toContain("200+ files changed");
  });

  it("E10: no totals → `3 files changed` with no + or − values", async () => {
    stubSessionDiffFetch(() => response([file("a.txt"), file("b.txt"), file("c.txt")], { isGitRepo: false }));
    await renderChanges(makeSession());
    expect(header().textContent).toContain("3 files changed");
    expect(header().textContent).not.toMatch(/[+\u2212]/);
  });

  it("X8: a diff that lists 9 files shows 9 files whatever the transcript holds", async () => {
    stubSessionDiffFetch(() => response(Array.from({ length: 9 }, (_, i) => file(`f${i}.ts`, 2, 1)), { totalAdditions: 18, totalDeletions: 9 }));
    await renderChanges(makeSession());
    expect(header().textContent).toContain("9 files changed");
  });

  it("X1: a failed refetch keeps the 4 files and totals with one inline error + Retry; Retry recovers", async () => {
    let mode: "good" | "bad" | "five" = "good";
    stubSessionDiffFetch(() => {
      if (mode === "bad") return { ok: false, body: { success: false, error: "HTTP 500" } };
      if (mode === "five") return response([...four, file("e.ts", 1, 1)], { totalAdditions: 122, totalDeletions: 34 });
      return response(four, { totalAdditions: 120, totalDeletions: 33 });
    });
    const input = { session: makeSession({ id: "s1" }), working: true };
    const view = render(createElement(LanesDockHarness, { input }));
    await tick(0);
    await tick(DOCK_DIFF_WINDOW_MS + 500);
    expect(header().textContent).toContain("4 files changed");
    mode = "bad";
    view.rerender(createElement(LanesDockHarness, { input: { ...input, working: false } })); // session stops working
    await tick(DOCK_DIFF_SETTLE_MS + 100);
    fireEvent.click(header().querySelector("[data-dock-toggle=changes]") as HTMLElement);
    await tick(DOCK_DIFF_WINDOW_MS + 100);
    expect(header().textContent).toContain("4 files changed");
    expect(header().textContent).toContain("+120");
    expect(screen.getAllByText("Couldn't refresh changes")).toHaveLength(1);
    mode = "five";
    fireEvent.click(screen.getByTestId("composer-dock-changes-retry"));
    await tick(DOCK_DIFF_WINDOW_MS + 100);
    expect(header().textContent).toContain("5 files changed");
    expect(screen.queryByText("Couldn't refresh changes")).toBeNull();
  });
});
