/**
 * Tests for `runGitPollTick` — the shared poll-tick body used by both the
 * session-start and session-change timers in bridge.ts.
 *
 * Regression guard for fix-stale-ctx-cwd-crash: the session-change timer used
 * to be a separate copy that dropped sendSessionNameIfChanged /
 * sendModelUpdateIfChanged, so renames + model changes stopped propagating
 * after a new/fork/resume. Both timers now route through this one function.
 * See also change: optimize-polling-hot-paths (E37 E38 X10).
 */
import { describe, it, expect, vi } from "vitest";
import { createGitPollState, runGitPollTick, type GitPollDeps } from "../git-poll.js";

function makeDeps(overrides: Partial<GitPollDeps> = {}): GitPollDeps {
  return {
    isActive: () => true,
    cachedCwd: () => "/repo",
    tickGit: vi.fn(),
    sendCwdMissingIfChanged: vi.fn(),
    sendSessionNameIfChanged: vi.fn(),
    sendModelUpdateIfChanged: vi.fn(),
    sendPiVersionIfChanged: vi.fn(() => true),
    state: createGitPollState(),
    log: vi.fn(),
    ...overrides,
  };
}

describe("runGitPollTick", () => {
  it("active + cwd present: fires all checks", async () => {
    const deps = makeDeps();
    await runGitPollTick(deps);
    expect(deps.tickGit).toHaveBeenCalledWith("/repo");
    expect(deps.sendCwdMissingIfChanged).toHaveBeenCalledWith("/repo");
    expect(deps.sendSessionNameIfChanged).toHaveBeenCalledTimes(1);
    expect(deps.sendModelUpdateIfChanged).toHaveBeenCalledTimes(1);
    expect(deps.sendPiVersionIfChanged).toHaveBeenCalledTimes(1); // tick 1
  });

  it("name + model checks fire even when cwd is absent (stale-ctx swap)", async () => {
    const deps = makeDeps({ cachedCwd: () => undefined });
    await runGitPollTick(deps);
    // git/cwd skipped — they need a directory
    expect(deps.tickGit).not.toHaveBeenCalled();
    expect(deps.sendCwdMissingIfChanged).not.toHaveBeenCalled();
    // but name + model still propagate — the regression this guards
    expect(deps.sendSessionNameIfChanged).toHaveBeenCalledTimes(1);
    expect(deps.sendModelUpdateIfChanged).toHaveBeenCalledTimes(1);
  });

  it("inactive: no-op, nothing fires", async () => {
    const deps = makeDeps({ isActive: () => false });
    await runGitPollTick(deps);
    expect(deps.tickGit).not.toHaveBeenCalled();
    expect(deps.sendCwdMissingIfChanged).not.toHaveBeenCalled();
    expect(deps.sendSessionNameIfChanged).not.toHaveBeenCalled();
    expect(deps.sendModelUpdateIfChanged).not.toHaveBeenCalled();
  });

  it("reads cachedCwd fresh each tick (post-session-change cwd swap)", async () => {
    let cwd: string | undefined = "/old";
    const deps = makeDeps({ cachedCwd: () => cwd });
    await runGitPollTick(deps);
    cwd = "/new";
    await runGitPollTick(deps);
    expect(deps.tickGit).toHaveBeenNthCalledWith(1, "/old");
    expect(deps.tickGit).toHaveBeenNthCalledWith(2, "/new");
  });

  it("E38: the pi version is read on ticks 1, 11, 21 only", async () => {
    const deps = makeDeps();
    const readOn: number[] = [];
    (deps.sendPiVersionIfChanged as any) = vi.fn(() => {
      readOn.push(deps.state.tick);
      return true;
    });
    for (let i = 0; i < 21; i++) await runGitPollTick(deps);
    expect(readOn).toEqual([1, 11, 21]);
  });

  it("E38: a failed read on tick 11 is retried on tick 12", async () => {
    const deps = makeDeps();
    const readOn: number[] = [];
    (deps.sendPiVersionIfChanged as any) = vi.fn(() => {
      readOn.push(deps.state.tick);
      return deps.state.tick !== 11;
    });
    for (let i = 0; i < 13; i++) await runGitPollTick(deps);
    expect(readOn).toEqual([1, 11, 12]);
  });

  it("X10: a rejecting git tick is logged once; the rest of the tick and the next tick still run", async () => {
    const deps = makeDeps({ tickGit: vi.fn(async () => { throw new Error("boom"); }) });
    await runGitPollTick(deps);
    await runGitPollTick(deps);
    expect(deps.log).toHaveBeenCalledTimes(1);
    expect(deps.tickGit).toHaveBeenCalledTimes(2);
    expect(deps.sendSessionNameIfChanged).toHaveBeenCalledTimes(2);
    expect(deps.sendCwdMissingIfChanged).toHaveBeenCalledTimes(2);
  });
});
