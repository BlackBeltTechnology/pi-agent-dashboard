/**
 * `buildPushPayload` — pure, classifies the trigger from (eventType, after,
 * payload) and builds the small session-linking payload.
 * Harness: pure unit style of `is-unread-trigger.test.ts`.
 * See change: add-server-push-notifications (test-plan #E17–#E20).
 */
import { describe, expect, it } from "vitest";
import { buildPushPayload } from "../push/build-push-payload.js";

const session = (over: Record<string, unknown> = {}) =>
  ({ id: "abc-123", name: "fix-login", cwd: "/home/u/proj/fix", model: "claude-opus-5", ...over }) as any;

describe("buildPushPayload", () => {
  it("ask_user with a session name → exact payload (test-plan #E17)", () => {
    const p = buildPushPayload(session(), {
      eventType: "tool_execution_start",
      after: { status: "streaming", currentTool: "ask_user" },
      payload: { toolName: "ask_user" },
    });
    expect(p).toEqual({
      type: "session_attention",
      trigger: "input",
      sessionId: "abc-123",
      title: "fix-login: waiting for input",
      body: "claude-opus-5",
      url: "/session/abc-123",
    });
  });

  it("empty name falls back to the cwd basename; streaming→idle is turn_end (test-plan #E18)", () => {
    const p = buildPushPayload(session({ name: "", cwd: "/home/u/proj/api" }), {
      eventType: "agent_end",
      after: { status: "idle", currentTool: null },
      payload: {},
    });
    expect(p.title).toBe("api: turn finished");
    expect(p.trigger).toBe("turn_end");
  });

  it.each([
    [0, 0],
    [1, 1],
    [200, 200],
    [201, 201],
  ])("crash error of %i chars → body length %i (test-plan #E19)", (len, bodyLen) => {
    const err = "e".repeat(len);
    const p = buildPushPayload(session(), {
      eventType: "agent_end",
      after: { status: "idle", currentTool: null },
      payload: { error: len === 0 ? true : err },
    });
    expect(p.trigger).toBe("crash");
    expect(p.title).toBe("fix-login: crashed");
    expect(p.body.length).toBe(bodyLen);
    if (len <= 200) expect(p.body).toBe(err);
    else expect(p.body).toBe(`${"e".repeat(200)}…`);
  });

  it("prompt_request with no payload and currentTool ask_user → input, no throw (test-plan #E20)", () => {
    const p = buildPushPayload(session(), {
      eventType: "prompt_request",
      after: { status: "streaming", currentTool: "ask_user" },
      payload: undefined,
    });
    expect(p.trigger).toBe("input");
    expect(p.title).toBe("fix-login: waiting for input");
  });

  it("an unknown model yields an empty body", () => {
    const p = buildPushPayload(session({ model: undefined }), {
      eventType: "agent_end",
      after: { status: "idle", currentTool: null },
    });
    expect(p.body).toBe("");
  });

  it("an Error-like object crash uses its message", () => {
    const p = buildPushPayload(session(), {
      eventType: "agent_end",
      after: { status: "idle" },
      payload: { error: { message: "rate limited" } },
    });
    expect(p.body).toBe("rate limited");
  });
});
