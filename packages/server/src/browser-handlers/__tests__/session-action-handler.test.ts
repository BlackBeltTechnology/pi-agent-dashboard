/**
 * handleStopAfterTurn forwards a graceful-stop message to the session's
 * bridge via piGateway.sendToSession.
 *
 * See change: adopt-pi-071-072-073-features (B.2).
 */
import { describe, expect, it } from "vitest";
import type { BrowserHandlerContext } from "../handler-context.js";
import {
  handleStopAfterTurn,
  handleSubagentResyncRequest,
  isSessionProcessGone,
  shouldReopenDashboardZombie,
} from "../session-action-handler.js";

function makeCtx() {
  const sent: { sessionId: string; msg: unknown }[] = [];
  const ctx = {
    piGateway: {
      sendToSession(sessionId: string, msg: unknown) {
        sent.push({ sessionId, msg });
      },
    },
  } as unknown as BrowserHandlerContext;
  return { ctx, sent };
}

// A crash/OOM/kill-9 can leave a session record stuck at status "active" while
// its process is gone (no bridge, no keeper). Send/resume must recognize that
// zombie and reopen it instead of dropping the prompt forever.
// See change: resume-zombie-active-session.
describe("isSessionProcessGone", () => {
  it("is gone when neither the bridge nor the carrier is alive", () => {
    expect(isSessionProcessGone("s", () => false, () => false)).toBe(true);
  });
  it("is NOT gone when the bridge is connected", () => {
    expect(isSessionProcessGone("s", () => true, () => false)).toBe(false);
  });
  it("is NOT gone when the keeper carrier is alive (it will reconnect)", () => {
    expect(isSessionProcessGone("s", () => false, () => true)).toBe(false);
  });
});

describe("shouldReopenDashboardZombie", () => {
  const base = { status: "active", source: "dashboard", sessionFile: "/f.jsonl" };
  it("reopens a dashboard zombie: active status, dead process, has a sessionFile", () => {
    expect(shouldReopenDashboardZombie(base, true)).toBe(true);
  });
  it("does NOT reopen when the process is still alive", () => {
    expect(shouldReopenDashboardZombie(base, false)).toBe(false);
  });
  it("does NOT reopen a cli/TUI session (never give a live TUI a headless twin)", () => {
    expect(shouldReopenDashboardZombie({ ...base, source: "cli" }, true)).toBe(false);
  });
  it("does NOT reopen without a sessionFile (nothing to continue from)", () => {
    expect(shouldReopenDashboardZombie({ ...base, sessionFile: null }, true)).toBe(false);
  });
  it("leaves an already-ended session to the caller's ended path", () => {
    expect(shouldReopenDashboardZombie({ ...base, status: "ended" }, true)).toBe(false);
  });
});

describe("handleStopAfterTurn", () => {
  it("forwards stop_after_turn to the bridge with the matching shape", () => {
    const { ctx, sent } = makeCtx();
    handleStopAfterTurn({ type: "stop_after_turn", sessionId: "s1" }, ctx);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      sessionId: "s1",
      msg: { type: "stop_after_turn", sessionId: "s1" },
    });
  });
});

// See change: fix-subagent-live-detail-reliability (D2).
describe("handleSubagentResyncRequest", () => {
  it("forwards a subagent_resync_request to the owning bridge", () => {
    const { ctx, sent } = makeCtx();
    handleSubagentResyncRequest(
      { type: "subagent_resync_request", sessionId: "s1", agentId: "a1" },
      ctx,
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      sessionId: "s1",
      msg: { type: "subagent_resync_request", sessionId: "s1", agentId: "a1" },
    });
  });
});
