/**
 * Tests for `sendGitInfoIfChanged` gitStatus payload + dedup.
 * See change: add-session-uncommitted-indicator-and-commit.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { gatherGitInfo, gatherGitStatus } = vi.hoisted(() => ({
  gatherGitInfo: vi.fn(),
  gatherGitStatus: vi.fn(),
}));

vi.mock("../vcs-info.js", () => ({ gatherGitInfo, gatherGitStatus }));

import { sendGitInfoIfChanged } from "../model-tracker.js";
import type { BridgeContext } from "../bridge-context.js";
import type { GitStatus } from "@blackbelt-technology/pi-dashboard-shared/types.js";

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

const CLEAN: GitStatus = { dirtyCount: 0, staged: 0, unstaged: 0, untracked: 0, ahead: 0, behind: 0 };
const DIRTY: GitStatus = { dirtyCount: 3, staged: 1, unstaged: 2, untracked: 0, ahead: 0, behind: 0 };

describe("sendGitInfoIfChanged — gitStatus", () => {
  beforeEach(() => {
    gatherGitInfo.mockReset();
    gatherGitStatus.mockReset();
    gatherGitInfo.mockReturnValue({ gitBranch: "main" });
  });

  it("includes gitStatus in the payload", () => {
    const { bc, send } = makeBc();
    gatherGitStatus.mockReturnValue(DIRTY);
    sendGitInfoIfChanged(bc, "/repo");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ type: "git_info_update", gitStatus: DIRTY });
  });

  it("does not re-emit when branch + status unchanged", () => {
    const { bc, send } = makeBc();
    gatherGitStatus.mockReturnValue(DIRTY);
    sendGitInfoIfChanged(bc, "/repo");
    sendGitInfoIfChanged(bc, "/repo");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("re-emits when only the status changes (branch stable)", () => {
    const { bc, send } = makeBc();
    gatherGitStatus.mockReturnValueOnce(CLEAN).mockReturnValueOnce(DIRTY);
    sendGitInfoIfChanged(bc, "/repo");
    sendGitInfoIfChanged(bc, "/repo");
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toMatchObject({ gitStatus: DIRTY });
  });

  it("omits gitStatus when the probe is inconclusive", () => {
    const { bc, send } = makeBc();
    gatherGitStatus.mockReturnValue(undefined);
    sendGitInfoIfChanged(bc, "/repo");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].gitStatus).toBeUndefined();
  });
});
