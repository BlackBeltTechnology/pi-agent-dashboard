/**
 * `sendGitInfoIfChanged` gitStatus payload + dedup, and the git tracker's
 * probe-result path (ordering, staleness, failure, allow-list).
 * See changes: add-session-uncommitted-indicator-and-commit,
 * optimize-polling-hot-paths (test-plan E24 E29 E30 E31 E33 E35 E37 X4 X5).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitStatus } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { BridgeContext } from "../bridge-context.js";
import { createGitTracker } from "../git-tracker.js";
import { resetReconnectCaches, sendGitInfoIfChanged } from "../model-tracker.js";
import { __resetPollCostForTests, pollCost } from "../poll-cost.js";
import { GitFactsCache, type HeadBranchReader, type StaticGitFacts } from "../vcs-info.js";

const CLEAN: GitStatus = { dirtyCount: 0, staged: 0, unstaged: 0, untracked: 0, ahead: 0, behind: 0 };
const DIRTY: GitStatus = { dirtyCount: 3, staged: 1, unstaged: 2, untracked: 0, ahead: 0, behind: 0 };

function makeBc() {
  const send = vi.fn();
  const bc = {
    sessionId: "s1",
    connection: { send },
    lastGitBranch: undefined,
    lastGitPrNumber: undefined,
    lastGitWorktreeJson: undefined,
    lastGitStatusJson: undefined,
  } as unknown as BridgeContext;
  return { bc, send };
}

describe("sendGitInfoIfChanged — gitStatus", () => {
  const info = { gitBranch: "main" };

  it("includes gitStatus in the payload", () => {
    const { bc, send } = makeBc();
    sendGitInfoIfChanged(bc, { info, status: DIRTY });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ type: "git_info_update", gitStatus: DIRTY });
  });

  it("does not re-emit when branch + status unchanged", () => {
    const { bc, send } = makeBc();
    sendGitInfoIfChanged(bc, { info, status: DIRTY });
    sendGitInfoIfChanged(bc, { info, status: DIRTY });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("re-emits when only the status changes (branch stable)", () => {
    const { bc, send } = makeBc();
    sendGitInfoIfChanged(bc, { info, status: CLEAN });
    sendGitInfoIfChanged(bc, { info, status: DIRTY });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toMatchObject({ gitStatus: DIRTY });
  });

  it("omits gitStatus when the probe is inconclusive", () => {
    const { bc, send } = makeBc();
    sendGitInfoIfChanged(bc, { info, status: undefined });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].gitStatus).toBeUndefined();
  });
});

// ── tracker ───────────────────────────────────────────────────────────────────

const FACTS: StaticGitFacts = { remoteUrl: undefined, roots: null, gitDir: "/r/.git", dotGitStamp: "s" };

function harness(opts: { status?: () => Promise<any>; head?: { value: string | undefined }; evaluateAsync?: () => Promise<StaticGitFacts> } = {}) {
  const { bc, send } = makeBc();
  const head = opts.head ?? { value: "main" };
  const evaluate = vi.fn(() => FACTS);
  const evaluateAsync = vi.fn(opts.evaluateAsync ?? (async () => FACTS));
  const stampBox = { value: "s" };
  const facts = new GitFactsCache({ evaluate, evaluateAsync, stamp: () => stampBox.value });
  const statusProbe = vi.fn(opts.status ?? (async () => ({ ok: true, value: CLEAN })));
  const observe = vi.fn();
  (bc as any).prStatus = { observe, tuple: () => ({}), refresh: vi.fn(), dispose: vi.fn(), invocations: () => 0 };
  const watchSpy = vi.fn();
  let active = true;
  const reader: HeadBranchReader = { read: () => head.value, reset: () => {} };
  const tracker = createGitTracker({
    getBc: () => bc,
    applyBc: () => {},
    isActive: () => active,
    facts,
    statusProbe: statusProbe as any,
    headReader: () => reader,
    watch: ((...a: unknown[]) => { watchSpy(...a); return { close: () => {}, on: () => ({}) as any }; }) as any,
  });
  return { tracker, bc, send, head, statusProbe, evaluate, evaluateAsync, observe, watchSpy, stampBox, facts, setActive: (v: boolean) => (active = v) };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  __resetPollCostForTests();
});
afterEach(() => vi.useRealTimers());

describe("git tracker — first evaluation and probe path", () => {
  it("E21: first evaluation sends branch + worktree key without status, then the probe sends status", async () => {
    const h = harness();
    h.tracker.evaluateFirst(h.bc, "/r");
    expect(h.send).toHaveBeenCalledTimes(1);
    const first = h.send.mock.calls[0][0];
    expect(first).toMatchObject({ type: "git_info_update", gitBranch: "main", gitWorktree: null });
    expect(first.gitStatus).toBeUndefined();
    await vi.advanceTimersByTimeAsync(800);
    expect(h.send).toHaveBeenCalledTimes(2);
    expect(h.send.mock.calls[1][0]).toMatchObject({ gitStatus: CLEAN });
    h.tracker.dispose();
  });

  it("E34: re-evaluating (resume into the same clean repo) re-sends status — the diff cache was reset", async () => {
    const h = harness();
    h.tracker.evaluateFirst(h.bc, "/r");
    await vi.advanceTimersByTimeAsync(800);
    h.send.mockClear();
    h.tracker.evaluateFirst(h.bc, "/r"); // new session, same repo
    await vi.advanceTimersByTimeAsync(3_000); // fast lane spacing ≥ 2 s
    const last = h.send.mock.calls.at(-1)![0];
    expect(last).toMatchObject({ gitStatus: CLEAN });
    h.tracker.dispose();
  });

  it("E35: reconnect cache reset + first evaluation → fast probe; update carries gitStatus", async () => {
    const h = harness();
    h.tracker.evaluateFirst(h.bc, "/r");
    await vi.advanceTimersByTimeAsync(800);
    h.send.mockClear();
    resetReconnectCaches(h.bc);
    h.tracker.evaluateFirst(h.bc, "/r");
    await vi.advanceTimersByTimeAsync(2_800);
    expect(h.send.mock.calls.some((c) => c[0].gitStatus)).toBe(true);
    h.tracker.dispose();
  });

  it("E37: no sync facts probe after the first evaluation (20 ticks)", async () => {
    const h = harness();
    h.tracker.evaluateFirst(h.bc, "/r");
    for (let i = 0; i < 20; i++) {
      h.tracker.tick(h.bc, "/r");
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(h.evaluate).toHaveBeenCalledTimes(1);
    h.tracker.dispose();
  });

  it("E18: the facts are re-probed asynchronously on tick 10 only", async () => {
    const h = harness();
    h.tracker.evaluateFirst(h.bc, "/r");
    for (let i = 1; i <= 9; i++) h.tracker.tick(h.bc, "/r");
    expect(h.evaluateAsync).not.toHaveBeenCalled();
    h.tracker.tick(h.bc, "/r");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.evaluateAsync).toHaveBeenCalledTimes(1);
    h.tracker.dispose();
  });

  it("E31: a branch change seen by the tick is sent (branch + status) within 4 s", async () => {
    const h = harness();
    h.tracker.evaluateFirst(h.bc, "/r");
    await vi.advanceTimersByTimeAsync(800);
    h.send.mockClear();
    h.head.value = "topic";
    h.tracker.tick(h.bc, "/r");
    await vi.advanceTimersByTimeAsync(4_000);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send.mock.calls[0][0]).toMatchObject({ gitBranch: "topic" });
    h.tracker.dispose();
  });

  it("E29: HEAD moved while the probe ran → result discarded, one more probe sent coherent", async () => {
    let release!: (v: any) => void;
    let first = true;
    const h = harness({
      status: () => {
        if (first) {
          first = false;
          return new Promise((r) => (release = r));
        }
        return Promise.resolve({ ok: true, value: DIRTY });
      },
    });
    h.tracker.evaluateFirst(h.bc, "/r");
    await vi.advanceTimersByTimeAsync(800); // probe 1 in flight
    h.send.mockClear();
    h.head.value = "topic";
    release({ ok: true, value: CLEAN });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.statusProbe).toHaveBeenCalledTimes(2);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send.mock.calls[0][0]).toMatchObject({ gitBranch: "topic", gitStatus: DIRTY });
    h.tracker.dispose();
  });

  it("E30: cwd changes mid-probe → the old probe's result is dropped", async () => {
    let release!: (v: any) => void;
    const h = harness({ status: () => new Promise((r) => (release = r)) });
    h.tracker.evaluateFirst(h.bc, "/old");
    await vi.advanceTimersByTimeAsync(800);
    h.send.mockClear();
    h.tracker.evaluateFirst(h.bc, "/new");
    h.send.mockClear();
    release({ ok: true, value: DIRTY });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.send.mock.calls.some((c) => c[0].gitStatus === DIRTY)).toBe(false);
    h.tracker.dispose();
  });

  it("X4/E33: a failed status probe sends without gitStatus and PR observation still runs", async () => {
    const h = harness({ status: async () => ({ ok: false, error: { kind: "timeout" } }) });
    h.tracker.evaluateFirst(h.bc, "/r");
    h.observe.mockClear();
    await vi.advanceTimersByTimeAsync(800);
    expect(h.observe).toHaveBeenCalled();
    expect(h.send.mock.calls.every((c) => c[0].gitStatus === undefined)).toBe(true);
    // the next request proceeds
    h.tracker.tick(h.bc, "/r");
    await vi.advanceTimersByTimeAsync(11_000);
    expect(h.statusProbe.mock.calls.length).toBeGreaterThanOrEqual(2);
    h.tracker.dispose();
  });

  it("X5: a probe settling after dispose sends nothing and re-arms nothing", async () => {
    let release!: (v: any) => void;
    const h = harness({ status: () => new Promise((r) => (release = r)) });
    h.tracker.evaluateFirst(h.bc, "/r");
    await vi.advanceTimersByTimeAsync(800);
    h.send.mockClear();
    h.tracker.dispose();
    release({ ok: true, value: DIRTY });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.send).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("E24: read-only tools (any casing) request no probe; mutating/unknown tools do", async () => {
    const h = harness();
    h.tracker.evaluateFirst(h.bc, "/r");
    await vi.advanceTimersByTimeAsync(800);
    h.statusProbe.mockClear();
    for (const t of ["read", "Read", "glob", "ls", "GREP", "find"]) h.tracker.onToolEnd(t);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.statusProbe).not.toHaveBeenCalled();
    for (const t of ["edit", "mcp__x__y"]) h.tracker.onToolEnd(t);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.statusProbe).toHaveBeenCalledTimes(1);
    expect(pollCost.pollGitProbesTool).toBe(1);
    h.tracker.dispose();
  });

  it("not a git repo: nothing is sent and no probe is requested", async () => {
    const h = harness({ head: { value: undefined } });
    // the sync detectBranch fallback finds no repo at this path
    h.tracker.evaluateFirst(h.bc, "/definitely/not/a/repo/xyz");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.statusProbe).not.toHaveBeenCalled();
    h.tracker.dispose();
  });

  it("B3: a refresh arriving while a facts re-probe is in flight is not lost — one follow-up re-probe runs", async () => {
    let release!: (f: StaticGitFacts) => void;
    let calls = 0;
    const h = harness({
      evaluateAsync: () => {
        calls += 1;
        return calls === 1 ? new Promise<StaticGitFacts>((r) => (release = r)) : Promise.resolve(FACTS);
      },
    });
    h.tracker.evaluateFirst(h.bc, "/r");
    h.tracker.refresh(); // starts re-probe #1 (hangs)
    h.tracker.refresh(); // arrives mid-flight
    h.tracker.refresh(); // coalesces with the previous one
    await vi.advanceTimersByTimeAsync(0);
    expect(h.evaluateAsync).toHaveBeenCalledTimes(1);
    release(FACTS);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.evaluateAsync).toHaveBeenCalledTimes(2);
    h.tracker.dispose();
  });

  it("B4: a stamp-triggered re-probe re-attaches the watcher even when the facts compare equal", async () => {
    const h = harness();
    h.tracker.evaluateFirst(h.bc, "/r");
    expect(h.watchSpy).toHaveBeenCalledTimes(1);
    h.stampBox.value = "replaced"; // .git replaced at the same path: facts equal, stamp differs
    h.tracker.tick(h.bc, "/r");
    await vi.advanceTimersByTimeAsync(0);
    expect(h.evaluateAsync).toHaveBeenCalledTimes(1);
    expect(h.watchSpy).toHaveBeenCalledTimes(2);
    h.tracker.dispose();
  });

  it("B3: a stale in-flight facts re-probe never overwrites a newer same-cwd evaluation", async () => {
    const OLD: StaticGitFacts = { ...FACTS, remoteUrl: "git@old:o/r.git" };
    const NEW: StaticGitFacts = { ...FACTS, remoteUrl: "git@new:o/r.git" };
    let release!: (f: StaticGitFacts) => void;
    const h = harness({ evaluateAsync: () => new Promise<StaticGitFacts>((r) => (release = r)) });
    h.tracker.evaluateFirst(h.bc, "/r");
    h.tracker.refresh(); // in-flight async re-probe of the OLD session
    await vi.advanceTimersByTimeAsync(0);
    (h.evaluate as any).mockReturnValue(NEW);
    h.tracker.evaluateFirst(h.bc, "/r"); // new session, same cwd: installs NEW synchronously
    release(OLD); // the older probe settles afterwards
    await vi.advanceTimersByTimeAsync(0);
    expect(h.facts.get("/r")?.remoteUrl).toBe("git@new:o/r.git"); // the older probe did not overwrite it
    h.tracker.dispose();
  });
});
