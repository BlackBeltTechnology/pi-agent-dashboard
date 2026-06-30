/**
 * Tests for `runGitPollTick` — the shared git + name/model poll-tick body used
 * by both the session-start and session-change timers in bridge.ts.
 *
 * Regression guard for fix-stale-ctx-cwd-crash: the session-change timer used
 * to be a separate copy that dropped sendSessionNameIfChanged /
 * sendModelUpdateIfChanged, so renames + model changes stopped propagating
 * after a new/fork/resume. Both timers now route through this one function, so
 * asserting name/model fire here proves they fire after a session change too.
 */
import { describe, it, expect, vi } from "vitest";
import { runGitPollTick, type GitPollDeps } from "../git-poll.js";

function makeDeps(overrides: Partial<GitPollDeps> = {}): GitPollDeps {
  return {
    isActive: () => true,
    cachedCwd: () => "/repo",
    sendGitInfoIfChanged: vi.fn(),
    sendCwdMissingIfChanged: vi.fn(),
    sendSessionNameIfChanged: vi.fn(),
    sendModelUpdateIfChanged: vi.fn(),
    sendPiVersionIfChanged: vi.fn(),
    ...overrides,
  };
}

describe("runGitPollTick", () => {
  it("active + cwd present: fires all four checks", () => {
    const deps = makeDeps();
    runGitPollTick(deps);
    expect(deps.sendGitInfoIfChanged).toHaveBeenCalledWith("/repo");
    expect(deps.sendCwdMissingIfChanged).toHaveBeenCalledWith("/repo");
    expect(deps.sendSessionNameIfChanged).toHaveBeenCalledTimes(1);
    expect(deps.sendModelUpdateIfChanged).toHaveBeenCalledTimes(1);
    expect(deps.sendPiVersionIfChanged).toHaveBeenCalledTimes(1);
  });

  it("name + model checks fire even when cwd is absent (stale-ctx swap)", () => {
    const deps = makeDeps({ cachedCwd: () => undefined });
    runGitPollTick(deps);
    // git/cwd skipped — they need a directory
    expect(deps.sendGitInfoIfChanged).not.toHaveBeenCalled();
    expect(deps.sendCwdMissingIfChanged).not.toHaveBeenCalled();
    // but name + model still propagate — the regression this guards
    expect(deps.sendSessionNameIfChanged).toHaveBeenCalledTimes(1);
    expect(deps.sendModelUpdateIfChanged).toHaveBeenCalledTimes(1);
  });

  it("inactive: no-op, nothing fires", () => {
    const deps = makeDeps({ isActive: () => false });
    runGitPollTick(deps);
    expect(deps.sendGitInfoIfChanged).not.toHaveBeenCalled();
    expect(deps.sendCwdMissingIfChanged).not.toHaveBeenCalled();
    expect(deps.sendSessionNameIfChanged).not.toHaveBeenCalled();
    expect(deps.sendModelUpdateIfChanged).not.toHaveBeenCalled();
  });

  it("reads cachedCwd fresh each tick (post-session-change cwd swap)", () => {
    let cwd: string | undefined = "/old";
    const deps = makeDeps({ cachedCwd: () => cwd });
    runGitPollTick(deps);
    cwd = "/new";
    runGitPollTick(deps);
    expect(deps.sendGitInfoIfChanged).toHaveBeenNthCalledWith(1, "/old");
    expect(deps.sendGitInfoIfChanged).toHaveBeenNthCalledWith(2, "/new");
    // name/model fired on both ticks regardless of the cwd swap
    expect(deps.sendModelUpdateIfChanged).toHaveBeenCalledTimes(2);
  });
});
