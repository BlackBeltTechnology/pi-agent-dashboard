/**
 * handleStopAfterTurn forwards a graceful-stop message to the session's
 * bridge via piGateway.sendToSession.
 *
 * See change: adopt-pi-071-072-073-features (B.2).
 */
import { describe, expect, it } from "vitest";
import type { BrowserHandlerContext } from "../handler-context.js";
import { handleStopAfterTurn, handleSubagentResyncRequest } from "../session-action-handler.js";

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
