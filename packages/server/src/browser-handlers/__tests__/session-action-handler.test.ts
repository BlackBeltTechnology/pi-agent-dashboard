/**
 * handleStopAfterTurn forwards a graceful-stop message to the session's
 * bridge via piGateway.sendToSession.
 *
 * See change: adopt-pi-071-072-073-features (B.2).
 */
import { describe, expect, it } from "vitest";
import type { BrowserHandlerContext } from "../handler-context.js";
import {
  handleRetrySession,
  handleSendPrompt,
  handleStopAfterTurn,
  handleSubagentResyncRequest,
  isSessionProcessGone,
  shouldReopenDashboardZombie,
} from "../session-action-handler.js";

function makeCtx() {
  const sent: { sessionId: string; msg: unknown }[] = [];
  // A concrete `ws` identity: requester-scoped routing asserts that THIS
  // connection was registered, which an undefined `ws` would satisfy vacuously.
  // See change: reduce-subagent-details-payload.
  const ws = { id: "ws-fixture" };
  const ctx = {
    ws,
    piGateway: {
      sendToSession(sessionId: string, msg: unknown) {
        sent.push({ sessionId, msg });
      },
    },
  } as unknown as BrowserHandlerContext;
  return { ctx, sent, ws };
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

describe("handleSendPrompt retry routing", () => {
  it("forwards the hidden retry command to an already-active bridge instead of resume", async () => {
    const sent: { sessionId: string; msg: unknown }[] = [];
    const ctx = {
      sessionManager: {
        get: () => ({ id: "s1", status: "active", source: "tui", cwd: "/repo" }),
      },
      piGateway: {
        isSessionConnected: () => true,
        sendToSession(sessionId: string, msg: unknown) {
          sent.push({ sessionId, msg });
          return true;
        },
      },
      headlessPidRegistry: { getPid: () => undefined },
    } as unknown as BrowserHandlerContext;

    await handleSendPrompt(
      { type: "send_prompt", sessionId: "s1", text: "/__dashboard_retry" },
      ctx,
    );

    expect(sent).toEqual([{
      sessionId: "s1",
      msg: {
        type: "send_prompt",
        sessionId: "s1",
        text: "/__dashboard_retry",
        images: undefined,
        delivery: undefined,
      },
    }]);
  });
});

// test-plan #3: the first-class retry_session is forwarded to the owning bridge
// via an explicit gateway case; on undeliverable session it emits a structured
// retry_session_error to the sender (never a silent drop). See change:
// replace-dashboard-retry-command-with-protocol-message.
describe("handleRetrySession", () => {
  it("#3 forwards retry_session to the owning bridge, not the unknown-type default", () => {
    const sent: { sessionId: string; msg: unknown }[] = [];
    const ctx = {
      ws: { id: "ws1" },
      piGateway: {
        sendToSession(sessionId: string, msg: unknown) {
          sent.push({ sessionId, msg });
          return true;
        },
      },
      sendTo() {
        throw new Error("must not negative-ack on a delivered retry_session");
      },
    } as unknown as BrowserHandlerContext;

    handleRetrySession({ type: "retry_session", sessionId: "s1" }, ctx);

    expect(sent).toEqual([
      { sessionId: "s1", msg: { type: "retry_session", sessionId: "s1" } },
    ]);
  });

  it("emits retry_session_error to the sender when no bridge is reachable", () => {
    const errs: { target: unknown; msg: any }[] = [];
    const ws = { id: "ws1" };
    const ctx = {
      ws,
      piGateway: {
        sendToSession() {
          return false;
        },
      },
      sendTo(target: unknown, msg: unknown) {
        errs.push({ target, msg });
      },
    } as unknown as BrowserHandlerContext;

    handleRetrySession({ type: "retry_session", sessionId: "gone" }, ctx);

    expect(errs).toHaveLength(1);
    expect(errs[0].target).toBe(ws);
    expect(errs[0].msg).toMatchObject({ type: "retry_session_error", sessionId: "gone" });
    expect(typeof errs[0].msg.error).toBe("string");
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

  // The WS path casts parsed JSON straight to the message union, so these two
  // fields arrive unvalidated. See change: reduce-subagent-details-payload (C5).
  describe("untrusted requestId / reason", () => {
    it("registers the requester and forwards both fields when they are valid", () => {
      const { ctx, sent, ws } = makeCtx();
      const recorded: Array<[string, unknown]> = [];
      ctx.recordResyncRequester = (id, ws) => recorded.push([id, ws]);
      handleSubagentResyncRequest(
        { type: "subagent_resync_request", sessionId: "s1", agentId: "a1", requestId: "r1", reason: "cadence" },
        ctx,
      );
      expect(recorded).toEqual([["r1", ws]]);
      expect(recorded[0][1]).toBeDefined();
      expect(sent[0].msg).toEqual({
        type: "subagent_resync_request",
        sessionId: "s1",
        agentId: "a1",
        requestId: "r1",
        reason: "cadence",
      });
    });

    it.each([
      ["a number token", 42],
      ["an object token", { evil: true }],
      ["an empty token", ""],
      ["a null token", null],
    ])("drops %s: nothing registered, reply falls back to broadcast", (_label, requestId) => {
      const { ctx, sent } = makeCtx();
      let registered = 0;
      ctx.recordResyncRequester = () => {
        registered += 1;
      };
      handleSubagentResyncRequest(
        { type: "subagent_resync_request", sessionId: "s1", agentId: "a1", requestId } as never,
        ctx,
      );
      expect(registered).toBe(0);
      expect(sent[0].msg).toEqual({ type: "subagent_resync_request", sessionId: "s1", agentId: "a1" });
    });

    it("drops an unknown reason but keeps a valid requestId", () => {
      const { ctx, sent } = makeCtx();
      handleSubagentResyncRequest(
        { type: "subagent_resync_request", sessionId: "s1", agentId: "a1", requestId: "r1", reason: "hack" } as never,
        ctx,
      );
      expect(sent[0].msg).toEqual({
        type: "subagent_resync_request",
        sessionId: "s1",
        agentId: "a1",
        requestId: "r1",
      });
    });
  });
});
