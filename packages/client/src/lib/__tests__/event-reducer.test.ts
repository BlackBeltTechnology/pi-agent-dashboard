import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import { addInteractiveRequest, applyPromptReceived, type ChatMessage, createInitialState, deriveBannerState, dismissInteractiveRequest, extractAgentEndError, findLastUserPrompt, type PendingPrompt, reduceEvent, resolveInteractiveRequest, type SessionState, toDisplayString } from "../chat/event-reducer.js";

function applyEvents(events: DashboardEvent[]): SessionState {
  return events.reduce((s, e) => reduceEvent(s, e), createInitialState());
}

describe("eventReducer", () => {
  // D8 / test-plan X6: the retired `ChatMessage.view` field is gone. An OLD
  // serialized session whose messages still carry `view` must replay inertly —
  // the reducer never reads it, nothing throws, other fields stay intact, and
  // no inline card is produced. See change: open-view-command-in-editor-pane.
  it("X6 ignores a legacy `view` field on a message during replay (no throw, fields intact)", () => {
    const legacy = createInitialState();
    // A message persisted while `view` existed, cast past the (now narrower) type.
    legacy.messages.push({
      id: "m1",
      role: "user",
      content: "hello",
      timestamp: 1,
      view: { kind: "file", cwd: "/p", path: "a.ts" },
    } as unknown as ChatMessage);
    // A subsequent event re-reduces the state; must not throw on the stray field.
    const next = reduceEvent(legacy, {
      eventType: "message_start",
      timestamp: 2,
      data: { message: { role: "user", content: [{ type: "text", text: "again" }] } },
    } as DashboardEvent);
    expect(next.messages).toHaveLength(2);
    // Original message's real fields intact; the `view` field is inert.
    expect(next.messages[0]).toMatchObject({ id: "m1", role: "user", content: "hello" });
  });

  it("should start with empty state", () => {
    const state = createInitialState();
    expect(state.messages).toHaveLength(0);
    expect(state.isStreaming).toBe(false);
    expect(state.status).toBe("idle");
  });

  it("should add user messages from message_start", () => {
    const state = applyEvents([
      {
        eventType: "message_start",
        timestamp: Date.now(),
        data: {
          message: {
            role: "user",
            content: [{ type: "text", text: "Hello" }],
          },
        },
      },
    ]);

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].role).toBe("user");
    expect(state.messages[0].content).toBe("Hello");
    expect(state.messages[0].images).toBeUndefined();
  });

  it("should extract images from user message content", () => {
    const state = applyEvents([
      {
        eventType: "message_start",
        timestamp: Date.now(),
        data: {
          message: {
            role: "user",
            content: [
              { type: "text", text: "Check this image" },
              { type: "image", data: "abc123", mimeType: "image/png" },
            ],
          },
        },
      },
    ]);

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].content).toBe("Check this image");
    expect(state.messages[0].images).toHaveLength(1);
    expect(state.messages[0].images![0]).toEqual({ data: "abc123", mimeType: "image/png" });
  });

  it("should skip image blocks with missing data or mimeType", () => {
    const state = applyEvents([
      {
        eventType: "message_start",
        timestamp: Date.now(),
        data: {
          message: {
            role: "user",
            content: [
              { type: "text", text: "test" },
              { type: "image", data: "", mimeType: "image/png" },
              { type: "image", data: "valid", mimeType: undefined },
              { type: "image", data: "good", mimeType: "image/jpeg" },
            ],
          },
        },
      },
    ]);

    expect(state.messages[0].images).toHaveLength(1);
    expect(state.messages[0].images![0]).toEqual({ data: "good", mimeType: "image/jpeg" });
  });

  it("should handle user message with string content (no array)", () => {
    const state = applyEvents([
      {
        eventType: "message_start",
        timestamp: Date.now(),
        data: {
          message: {
            role: "user",
            content: "plain string message",
          },
        },
      },
    ]);

    expect(state.messages[0].content).toBe("plain string message");
    expect(state.messages[0].images).toBeUndefined();
  });

  it("should track streaming text from message_update", () => {
    const state = applyEvents([
      {
        eventType: "agent_start",
        timestamp: Date.now(),
        data: {},
      },
      {
        eventType: "message_update",
        timestamp: Date.now(),
        data: {
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Hello world" }],
          },
        },
      },
    ]);

    expect(state.isStreaming).toBe(true);
    expect(state.streamingText).toBe("Hello world");
  });

  it("should finalize assistant message on message_end", () => {
    const state = applyEvents([
      {
        eventType: "agent_start",
        timestamp: Date.now(),
        data: {},
      },
      {
        eventType: "message_update",
        timestamp: Date.now(),
        data: {
          message: {
            role: "assistant",
            content: [{ type: "text", text: "Final answer" }],
          },
        },
      },
      {
        eventType: "message_end",
        timestamp: Date.now(),
        data: {
          message: { role: "assistant" },
        },
      },
    ]);

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].role).toBe("assistant");
    expect(state.messages[0].content).toBe("Final answer");
    expect(state.streamingText).toBe("");
  });

  it("should add tool message to messages[] on tool_execution_start with status running and args", () => {
    const state = applyEvents([
      {
        eventType: "tool_execution_start",
        timestamp: Date.now(),
        data: {
          toolCallId: "tc1",
          toolName: "bash",
          args: { command: "ls" },
        },
      },
    ]);

    // toolCalls Map still works
    expect(state.toolCalls.get("tc1")).toBeDefined();
    expect(state.toolCalls.get("tc1")!.toolName).toBe("bash");
    expect(state.toolCalls.get("tc1")!.status).toBe("running");
    expect(state.currentTool).toBe("bash");

    // Message added immediately on start
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].id).toBe("tool-tc1");
    expect(state.messages[0].role).toBe("toolResult");
    expect(state.messages[0].toolName).toBe("bash");
    expect(state.messages[0].toolStatus).toBe("running");
    expect(state.messages[0].args).toEqual({ command: "ls" });
  });

  it("should update existing tool message result on tool_execution_update", () => {
    const state = applyEvents([
      {
        eventType: "tool_execution_start",
        timestamp: Date.now(),
        data: { toolCallId: "tc1", toolName: "bash", args: { command: "ls" } },
      },
      {
        eventType: "tool_execution_update",
        timestamp: Date.now(),
        data: { toolCallId: "tc1", toolName: "bash", partialResult: "file1.ts\nfile2.ts" },
      },
    ]);

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].result).toBe("file1.ts\nfile2.ts");
    expect(state.messages[0].toolStatus).toBe("running");
  });

  it("should update existing tool message in-place on tool_execution_end (no duplicate)", () => {
    const state = applyEvents([
      {
        eventType: "tool_execution_start",
        timestamp: Date.now(),
        data: { toolCallId: "tc1", toolName: "read", args: { path: "file.ts" } },
      },
      {
        eventType: "tool_execution_end",
        timestamp: Date.now(),
        data: { toolCallId: "tc1", toolName: "read", isError: false, result: "file content here" },
      },
    ]);

    expect(state.toolCalls.get("tc1")!.status).toBe("complete");
    expect(state.currentTool).toBeUndefined();
    // Only 1 message (updated in-place, not duplicated)
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].role).toBe("toolResult");
    expect(state.messages[0].toolName).toBe("read");
    expect(state.messages[0].toolStatus).toBe("complete");
    expect(state.messages[0].result).toBe("file content here");
    expect(state.messages[0].args).toEqual({ path: "file.ts" });
  });

  // Truncation now keeps the LAST 200 lines + a marker (pi 0.73 bash streaming
  // UX). See change: adopt-pi-071-072-073-features.
  it("should truncate large tool result to last 200 lines + marker", () => {
    const longResult = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join("\n");
    const state = applyEvents([
      {
        eventType: "tool_execution_start",
        timestamp: Date.now(),
        data: { toolCallId: "tc1", toolName: "bash", args: { command: "cat bigfile" } },
      },
      {
        eventType: "tool_execution_end",
        timestamp: Date.now(),
        data: { toolCallId: "tc1", toolName: "bash", isError: false, result: longResult },
      },
    ]);

    const lines = state.messages[0].result!.split("\n");
    expect(lines.length).toBe(201); // marker + last 200
    expect(lines[0]).toBe("«100 earlier lines hidden»");
    expect(lines[lines.length - 1]).toBe("line 300");
  });

  it("should truncate large partial result to last 200 lines on tool_execution_update", () => {
    const longResult = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join("\n");
    const state = applyEvents([
      {
        eventType: "tool_execution_start",
        timestamp: Date.now(),
        data: { toolCallId: "tc1", toolName: "bash", args: { command: "cat bigfile" } },
      },
      {
        eventType: "tool_execution_update",
        timestamp: Date.now(),
        data: { toolCallId: "tc1", toolName: "bash", partialResult: longResult },
      },
    ]);

    const lines = state.messages[0].result!.split("\n");
    expect(lines.length).toBe(201);
    expect(lines[0]).toBe("«100 earlier lines hidden»");
  });

  it("should extract toolDetails from structured partialResult object", () => {
    const state = applyEvents([
      {
        eventType: "tool_execution_start",
        timestamp: Date.now(),
        data: { toolCallId: "tc1", toolName: "Agent", args: { prompt: "Fix bug", subagent_type: "Explore" } },
      },
      {
        eventType: "tool_execution_update",
        timestamp: Date.now(),
        data: {
          toolCallId: "tc1",
          toolName: "Agent",
          partialResult: {
            content: [{ type: "text", text: "3 tool uses..." }],
            details: { displayName: "Explore", status: "running", toolUses: 3, durationMs: 5000 },
          },
        },
      },
    ]);

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].result).toBe("3 tool uses...");
    expect(state.messages[0].toolDetails).toEqual({
      displayName: "Explore",
      status: "running",
      toolUses: 3,
      durationMs: 5000,
    });
  });

  it("should handle string partialResult unchanged", () => {
    const state = applyEvents([
      {
        eventType: "tool_execution_start",
        timestamp: Date.now(),
        data: { toolCallId: "tc1", toolName: "bash", args: { command: "ls" } },
      },
      {
        eventType: "tool_execution_update",
        timestamp: Date.now(),
        data: { toolCallId: "tc1", toolName: "bash", partialResult: "output line" },
      },
    ]);

    expect(state.messages[0].result).toBe("output line");
    expect(state.messages[0].toolDetails).toBeUndefined();
  });

  it("should set status to ended on agent_end, then idle on agent_settled", () => {
    // agent_end is now the INTERMEDIATE terminal; agent_settled resolves idle.
    // See change: adopt-pi-074-080-features (A.1).
    const ended = applyEvents([
      { eventType: "agent_start", timestamp: Date.now(), data: {} },
      { eventType: "agent_end", timestamp: Date.now(), data: { messages: [] } },
    ]);
    expect(ended.status).toBe("ended");
    expect(ended.isStreaming).toBe(false);

    const settled = applyEvents([
      { eventType: "agent_start", timestamp: Date.now(), data: {} },
      { eventType: "agent_end", timestamp: Date.now(), data: { messages: [] } },
      { eventType: "agent_settled", timestamp: Date.now(), data: {} },
    ]);
    expect(settled.status).toBe("idle");
    expect(settled.isStreaming).toBe(false);
  });

  it("should handle a full conversation sequence", () => {
    const now = Date.now();
    const state = applyEvents([
      // User message
      {
        eventType: "message_start",
        timestamp: now,
        data: { message: { role: "user", content: [{ type: "text", text: "Fix the bug" }] } },
      },
      // Agent starts
      { eventType: "agent_start", timestamp: now + 1, data: {} },
      // Assistant streams
      {
        eventType: "message_update",
        timestamp: now + 2,
        data: { message: { role: "assistant", content: [{ type: "text", text: "I'll fix it" }] } },
      },
      // Tool call
      {
        eventType: "tool_execution_start",
        timestamp: now + 3,
        data: { toolCallId: "tc1", toolName: "edit", args: {} },
      },
      {
        eventType: "tool_execution_end",
        timestamp: now + 4,
        data: { toolCallId: "tc1", toolName: "edit", isError: false },
      },
      // Message finalized
      {
        eventType: "message_end",
        timestamp: now + 5,
        data: { message: { role: "assistant" } },
      },
      // Agent ends, then settles (bridge guarantees one terminal settle).
      { eventType: "agent_end", timestamp: now + 6, data: { messages: [] } },
      { eventType: "agent_settled", timestamp: now + 7, data: {} },
    ]);

    expect(state.messages).toHaveLength(3); // user + tool (added on start, updated on end) + assistant
    expect(state.status).toBe("idle");
  });

  it("should accumulate tokens and cost from stats_update", () => {
    const state = applyEvents([
      {
        eventType: "stats_update",
        timestamp: Date.now(),
        data: {
          tokensIn: 1000,
          tokensOut: 500,
          cost: 0.01,
        },
      },
      {
        eventType: "stats_update",
        timestamp: Date.now(),
        data: {
          tokensIn: 800,
          tokensOut: 300,
          cost: 0.005,
        },
      },
    ]);

    expect(state.tokensIn).toBe(1800);
    expect(state.tokensOut).toBe(800);
    expect(state.cost).toBeCloseTo(0.015);
  });

  it("should populate turnStats from stats_update with turnUsage", () => {
    const state = applyEvents([
      {
        eventType: "stats_update",
        timestamp: Date.now(),
        data: {
          tokensIn: 1000,
          tokensOut: 500,
          cost: 0.01,
          turnUsage: {
            input: 1000,
            output: 500,
            cacheRead: 200,
            cacheWrite: 100,
          },
        },
      },
    ]);

    expect(state.turnStats).toHaveLength(1);
    expect(state.turnStats[0]).toMatchObject({
      input: 1000,
      output: 500,
      cacheRead: 200,
      cacheWrite: 100,
    });
  });

  it("should populate contextUsage from stats_update", () => {
    const state = applyEvents([
      {
        eventType: "stats_update",
        timestamp: Date.now(),
        data: {
          tokensIn: 1000,
          tokensOut: 500,
          cost: 0.01,
          contextUsage: { tokens: 19100, contextWindow: 256000 },
        },
      },
    ]);

    expect(state.contextUsage).toEqual({ tokens: 19100, contextWindow: 256000 });
  });

  it("should cap turnStats at 50 entries", () => {
    const events = Array.from({ length: 60 }, (_, i) => ({
      eventType: "stats_update" as const,
      timestamp: Date.now() + i,
      data: {
        tokensIn: 100,
        tokensOut: 50,
        cost: 0.001,
        turnUsage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
      },
    }));

    const state = applyEvents(events);
    expect(state.turnStats).toHaveLength(50);
  });

  it("should handle stats_update without turnUsage gracefully", () => {
    const state = applyEvents([
      {
        eventType: "stats_update",
        timestamp: Date.now(),
        data: { tokensIn: 500, tokensOut: 200, cost: 0.005 },
      },
    ]);

    expect(state.turnStats).toHaveLength(0);
    expect(state.tokensIn).toBe(500);
    expect(state.tokensOut).toBe(200);
  });

  it("should convert object results to string in tool_execution_end", () => {
    const state = applyEvents([
      {
        eventType: "tool_execution_start",
        timestamp: Date.now(),
        data: { toolCallId: "tc-obj", toolName: "bash", args: { command: "ls" } },
      },
      {
        eventType: "tool_execution_end",
        timestamp: Date.now(),
        data: {
          toolCallId: "tc-obj",
          result: { stdout: "file.txt", stderr: "" },
          isError: false,
        },
      },
    ]);

    const toolMsg = state.messages.find((m) => m.toolCallId === "tc-obj");
    expect(toolMsg?.result).not.toContain("[object Object]");
    expect(toolMsg?.result).toContain("file.txt");
  });

  it("should convert content-block array results to text", () => {
    const state = applyEvents([
      {
        eventType: "tool_execution_start",
        timestamp: Date.now(),
        data: { toolCallId: "tc-blocks", toolName: "read", args: { path: "f.txt" } },
      },
      {
        eventType: "tool_execution_end",
        timestamp: Date.now(),
        data: {
          toolCallId: "tc-blocks",
          result: [{ type: "text", text: "hello world" }],
          isError: false,
        },
      },
    ]);

    const toolMsg = state.messages.find((m) => m.toolCallId === "tc-blocks");
    expect(toolMsg?.result).toBe("hello world");
  });

  it("should convert { content: [...] } wrapper results to text", () => {
    const state = applyEvents([
      {
        eventType: "tool_execution_start",
        timestamp: Date.now(),
        data: { toolCallId: "tc-wrap", toolName: "bash", args: { command: "echo hi" } },
      },
      {
        eventType: "tool_execution_end",
        timestamp: Date.now(),
        data: {
          toolCallId: "tc-wrap",
          result: { content: [{ type: "text", text: "hi\n" }] },
          isError: false,
        },
      },
    ]);

    const toolMsg = state.messages.find((m) => m.toolCallId === "tc-wrap");
    expect(toolMsg?.result).toBe("hi\n");
  });

  it("should extract images from tool_execution_end with image content blocks", () => {
    const state = applyEvents([
      {
        eventType: "tool_execution_start",
        timestamp: Date.now(),
        data: { toolCallId: "tc-img", toolName: "read", args: { path: "photo.png" } },
      },
      {
        eventType: "tool_execution_end",
        timestamp: Date.now(),
        data: {
          toolCallId: "tc-img",
          result: {
            content: [
              { type: "text", text: "Read image file [image/png]" },
              { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
            ],
          },
          isError: false,
        },
      },
    ]);

    const toolMsg = state.messages.find((m) => m.toolCallId === "tc-img");
    expect(toolMsg?.result).toBe("Read image file [image/png]");
    expect(toolMsg?.images).toEqual([{ data: "iVBORw0KGgo=", mimeType: "image/png" }]);
  });

  it("should not set images for text-only tool_execution_end", () => {
    const state = applyEvents([
      {
        eventType: "tool_execution_start",
        timestamp: Date.now(),
        data: { toolCallId: "tc-txt", toolName: "read", args: { path: "file.ts" } },
      },
      {
        eventType: "tool_execution_end",
        timestamp: Date.now(),
        data: {
          toolCallId: "tc-txt",
          result: { content: [{ type: "text", text: "const x = 1;" }] },
          isError: false,
        },
      },
    ]);

    const toolMsg = state.messages.find((m) => m.toolCallId === "tc-txt");
    expect(toolMsg?.result).toBe("const x = 1;");
    expect(toolMsg?.images).toBeUndefined();
  });

  it("should extract images from pre-extracted images field (state-replay)", () => {
    const state = applyEvents([
      {
        eventType: "tool_execution_start",
        timestamp: Date.now(),
        data: { toolCallId: "tc-replay", toolName: "read", args: { path: "img.jpg" } },
      },
      {
        eventType: "tool_execution_end",
        timestamp: Date.now(),
        data: {
          toolCallId: "tc-replay",
          result: "Read image file [image/jpeg]",
          images: [{ data: "abc123", mimeType: "image/jpeg" }],
          isError: false,
        },
      },
    ]);

    const toolMsg = state.messages.find((m) => m.toolCallId === "tc-replay");
    expect(toolMsg?.images).toEqual([{ data: "abc123", mimeType: "image/jpeg" }]);
  });
});

describe("model_select event", () => {
  it("should update model from model_select", () => {
    const state = applyEvents([
      {
        eventType: "model_select",
        timestamp: Date.now(),
        data: {
          type: "model_select",
          model: { provider: "anthropic", id: "claude-opus-4-6" },
        },
      },
    ]);
    expect(state.model).toBe("anthropic/claude-opus-4-6");
  });

  it("should update thinkingLevel from model_select event data", () => {
    const state = applyEvents([
      {
        eventType: "model_select",
        timestamp: Date.now(),
        data: {
          type: "model_select",
          model: { provider: "anthropic", id: "claude-opus-4-6" },
          thinkingLevel: "high",
        },
      },
    ]);
    expect(state.model).toBe("anthropic/claude-opus-4-6");
    expect(state.thinkingLevel).toBe("high");
  });
});

describe("thinking events", () => {
  it("should initialize streamingThinking to empty string", () => {
    const state = createInitialState();
    expect(state.streamingThinking).toBe("");
  });

  it("should reset streamingThinking on thinking_start", () => {
    let state = createInitialState();
    state = { ...state, streamingThinking: "leftover" };
    state = reduceEvent(state, {
      eventType: "message_update",
      timestamp: Date.now(),
      data: {
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "thinking_start", contentIndex: 0 },
      },
    });
    expect(state.streamingThinking).toBe("");
  });

  it("should accumulate thinking deltas", () => {
    let state = createInitialState();
    state = reduceEvent(state, {
      eventType: "message_update",
      timestamp: Date.now(),
      data: {
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "thinking_start", contentIndex: 0 },
      },
    });
    state = reduceEvent(state, {
      eventType: "message_update",
      timestamp: Date.now(),
      data: {
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "Let me think" },
      },
    });
    state = reduceEvent(state, {
      eventType: "message_update",
      timestamp: Date.now(),
      data: {
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: " about this..." },
      },
    });
    expect(state.streamingThinking).toBe("Let me think about this...");
  });

  it("should create thinking message on thinking_end and reset streamingThinking", () => {
    let state = createInitialState();
    state = reduceEvent(state, {
      eventType: "message_update",
      timestamp: Date.now(),
      data: {
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "thinking_start", contentIndex: 0 },
      },
    });
    state = reduceEvent(state, {
      eventType: "message_update",
      timestamp: Date.now(),
      data: {
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "Deep reasoning here" },
      },
    });
    const ts = Date.now();
    state = reduceEvent(state, {
      eventType: "message_update",
      timestamp: ts,
      data: {
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: "Deep reasoning here" },
      },
    });
    expect(state.streamingThinking).toBe("");
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].role).toBe("thinking");
    expect(state.messages[0].content).toBe("Deep reasoning here");
    expect(state.messages[0].timestamp).toBe(ts);
  });

  it("should skip creating thinking message when streamingThinking is empty", () => {
    let state = createInitialState();
    state = reduceEvent(state, {
      eventType: "message_update",
      timestamp: Date.now(),
      data: {
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "thinking_start", contentIndex: 0 },
      },
    });
    // thinking_end with no deltas
    state = reduceEvent(state, {
      eventType: "message_update",
      timestamp: Date.now(),
      data: {
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: "" },
      },
    });
    expect(state.messages).toHaveLength(0);
    expect(state.streamingThinking).toBe("");
  });

  it("should handle multiple thinking blocks in sequence", () => {
    let state = createInitialState();
    // First thinking block
    state = reduceEvent(state, {
      eventType: "message_update",
      timestamp: Date.now(),
      data: {
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "thinking_start", contentIndex: 0 },
      },
    });
    state = reduceEvent(state, {
      eventType: "message_update",
      timestamp: Date.now(),
      data: {
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "First thought" },
      },
    });
    state = reduceEvent(state, {
      eventType: "message_update",
      timestamp: Date.now(),
      data: {
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: "First thought" },
      },
    });
    // Second thinking block
    state = reduceEvent(state, {
      eventType: "message_update",
      timestamp: Date.now(),
      data: {
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "thinking_start", contentIndex: 1 },
      },
    });
    state = reduceEvent(state, {
      eventType: "message_update",
      timestamp: Date.now(),
      data: {
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "thinking_delta", contentIndex: 1, delta: "Second thought" },
      },
    });
    state = reduceEvent(state, {
      eventType: "message_update",
      timestamp: Date.now(),
      data: {
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "thinking_end", contentIndex: 1, content: "Second thought" },
      },
    });
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0].role).toBe("thinking");
    expect(state.messages[0].content).toBe("First thought");
    expect(state.messages[1].role).toBe("thinking");
    expect(state.messages[1].content).toBe("Second thought");
  });

  // See change: reconstruct-reasoning-on-replay. On reopen, state-replay emits
  // no thinking_* events — the reasoning is inline in the finalized message's
  // content blocks, and the reducer must rebuild the thinking rows.
  describe("reasoning reconstruction on replay (reopened session)", () => {
    it("rebuilds a thinking row from message_end content, before the text", () => {
      // applyEvents => reduceEvent with no opts => isLive=false (replay path).
      const content = [
        { type: "thinking", thinking: "Let me reason about this." },
        { type: "text", text: "Here is the answer." },
      ];
      const state = applyEvents([
        { eventType: "message_update", timestamp: 1000, data: { message: { role: "assistant", content } } },
        { eventType: "message_end", timestamp: 1000, data: { message: { role: "assistant", content }, entryId: "e1" } },
      ]);
      expect(state.messages.map((m) => m.role)).toEqual(["thinking", "assistant"]);
      expect(state.messages[0].content).toBe("Let me reason about this.");
      expect(state.messages[0].streamedLive).toBe(false);
      expect(state.messages[1].content).toBe("Here is the answer.");
    });

    it("rebuilds multiple thinking rows in content order", () => {
      const content = [
        { type: "thinking", thinking: "First" },
        { type: "thinking", thinking: "Second" },
        { type: "text", text: "Done" },
      ];
      const state = applyEvents([
        { eventType: "message_update", timestamp: 1, data: { message: { role: "assistant", content } } },
        { eventType: "message_end", timestamp: 1, data: { message: { role: "assistant", content } } },
      ]);
      const thinking = state.messages.filter((m) => m.role === "thinking");
      expect(thinking.map((m) => m.content)).toEqual(["First", "Second"]);
    });

    it("does NOT double-create on the LIVE path (isLive=true)", () => {
      // Live: thinking_end already pushed the row; the terminal message_end
      // carries the same thinking block in content but must be ignored.
      let state = createInitialState();
      const live = (e: DashboardEvent) => { state = reduceEvent(state, e, { isLive: true }); };
      live({ eventType: "message_update", timestamp: 1, data: { message: { role: "assistant", content: [] }, assistantMessageEvent: { type: "thinking_start", contentIndex: 0 } } });
      live({ eventType: "message_update", timestamp: 1, data: { message: { role: "assistant", content: [] }, assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "streamed reasoning" } } });
      live({ eventType: "message_update", timestamp: 1, data: { message: { role: "assistant", content: [] }, assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: "streamed reasoning" } } });
      live({ eventType: "message_update", timestamp: 1, data: { message: { role: "assistant", content: [{ type: "thinking", thinking: "streamed reasoning" }, { type: "text", text: "answer" }] } } });
      live({ eventType: "message_end", timestamp: 1, data: { message: { role: "assistant", content: [{ type: "thinking", thinking: "streamed reasoning" }, { type: "text", text: "answer" }] } } });
      const thinking = state.messages.filter((m) => m.role === "thinking");
      expect(thinking).toHaveLength(1);
      expect(thinking[0].content).toBe("streamed reasoning");
    });

    it("does NOT double-create when streamed thinking is followed by a non-live message_end (default isLive)", () => {
      // Regression: a turn can stream thinking_* (pushing one thinking row)
      // and then reach a message_end whose opts.isLive is not true (the
      // default). `!isLive` alone let reconstruction fire again → duplicate.
      // The dedupe guard keys on "does a thinking row for this turn already
      // exist?", so exactly one row survives.
      // See change: fix-double-thinking-row-on-replay-reconstruction.
      const content = [
        { type: "thinking", thinking: "streamed reasoning" },
        { type: "text", text: "answer" },
      ];
      const state = applyEvents([
        { eventType: "message_update", timestamp: 1, data: { message: { role: "assistant", content: [] }, assistantMessageEvent: { type: "thinking_start", contentIndex: 0 } } },
        { eventType: "message_update", timestamp: 1, data: { message: { role: "assistant", content: [] }, assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "streamed reasoning" } } },
        { eventType: "message_update", timestamp: 1, data: { message: { role: "assistant", content: [] }, assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: "streamed reasoning" } } },
        { eventType: "message_end", timestamp: 1, data: { message: { role: "assistant", content } } },
      ]);
      const thinking = state.messages.filter((m) => m.role === "thinking");
      expect(thinking).toHaveLength(1);
      expect(thinking[0].content).toBe("streamed reasoning");
      expect(state.messages.map((m) => m.role)).toEqual(["thinking", "assistant"]);
    });
  });

  it("should store full reasoning text without truncation", () => {
    const longThinking = "x".repeat(10000);
    let state = createInitialState();
    state = reduceEvent(state, {
      eventType: "message_update",
      timestamp: Date.now(),
      data: {
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "thinking_start", contentIndex: 0 },
      },
    });
    state = reduceEvent(state, {
      eventType: "message_update",
      timestamp: Date.now(),
      data: {
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: longThinking },
      },
    });
    state = reduceEvent(state, {
      eventType: "message_update",
      timestamp: Date.now(),
      data: {
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: longThinking },
      },
    });
    expect(state.messages[0].content).toHaveLength(10000);
  });

  it("should not interfere with text streaming during thinking", () => {
    let state = createInitialState();
    state = reduceEvent(state, { eventType: "agent_start", timestamp: Date.now(), data: {} });
    // Thinking happens
    state = reduceEvent(state, {
      eventType: "message_update",
      timestamp: Date.now(),
      data: {
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "thinking_start", contentIndex: 0 },
      },
    });
    state = reduceEvent(state, {
      eventType: "message_update",
      timestamp: Date.now(),
      data: {
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "reasoning" },
      },
    });
    state = reduceEvent(state, {
      eventType: "message_update",
      timestamp: Date.now(),
      data: {
        message: { role: "assistant", content: [] },
        assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: "reasoning" },
      },
    });
    // Then text streams
    state = reduceEvent(state, {
      eventType: "message_update",
      timestamp: Date.now(),
      data: {
        message: { role: "assistant", content: [{ type: "text", text: "Here is the answer" }] },
        assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "Here is the answer" },
      },
    });
    expect(state.messages).toHaveLength(1); // thinking message
    expect(state.messages[0].role).toBe("thinking");
    expect(state.streamingText).toBe("Here is the answer");
    expect(state.streamingThinking).toBe("");
  });
});

describe("pendingPrompt", () => {
  it("should initialize pendingPrompt as undefined", () => {
    const state = createInitialState();
    expect(state.pendingPrompt).toBeUndefined();
  });

  it("should preserve pendingPrompt through unrelated events", () => {
    const pending: PendingPrompt = { status: "sending", text: "Hello" };
    let state = createInitialState();
    state = { ...state, pendingPrompt: pending };

    // stats_update should not clear pendingPrompt
    state = reduceEvent(state, {
      eventType: "stats_update",
      timestamp: Date.now(),
      data: { tokensIn: 100, tokensOut: 50, cost: 0.001 },
    });
    expect(state.pendingPrompt).toEqual(pending);

    // agent_end SHOULD clear pendingPrompt (error handling safety net)
    state = reduceEvent(state, {
      eventType: "agent_end",
      timestamp: Date.now(),
      data: { messages: [] },
    });
    expect(state.pendingPrompt).toBeUndefined();
  });

  it("should clear pendingPrompt on message_start with role user", () => {
    const pending: PendingPrompt = { status: "sending", text: "Fix the bug" };
    let state = createInitialState();
    state = { ...state, pendingPrompt: pending };

    state = reduceEvent(state, {
      eventType: "message_start",
      timestamp: Date.now(),
      data: {
        message: {
          role: "user",
          content: [{ type: "text", text: "Fix the bug" }],
        },
      },
    });
    expect(state.pendingPrompt).toBeUndefined();
  });

  it("should clear pendingPrompt on agent_start", () => {
    const pending: PendingPrompt = { status: "sending", text: "Do something" };
    let state = createInitialState();
    state = { ...state, pendingPrompt: pending };

    state = reduceEvent(state, {
      eventType: "agent_start",
      timestamp: Date.now(),
      data: {},
    });
    expect(state.pendingPrompt).toBeUndefined();
  });

  it("should not clear pendingPrompt on message_start with non-user role", () => {
    const pending: PendingPrompt = { status: "sending", text: "Hello" };
    let state = createInitialState();
    state = { ...state, pendingPrompt: pending };

    // message_start for assistant should not clear
    state = reduceEvent(state, {
      eventType: "message_start",
      timestamp: Date.now(),
      data: {
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hi there" }],
        },
      },
    });
    expect(state.pendingPrompt).toEqual(pending);
  });

  it("should clear pendingPrompt on bash_output event", () => {
    const pending: PendingPrompt = { status: "sending", text: "!!ls" };
    let state = createInitialState();
    state = { ...state, pendingPrompt: pending };

    state = reduceEvent(state, {
      eventType: "bash_output",
      timestamp: Date.now(),
      data: { command: "ls", output: "file.txt", exitCode: 0, excludeFromContext: true },
    });
    expect(state.pendingPrompt).toBeUndefined();
  });

  it("should clear pendingPrompt on command_feedback event", () => {
    const pending: PendingPrompt = { status: "sending", text: "/compact" };
    let state = createInitialState();
    state = { ...state, pendingPrompt: pending };

    state = reduceEvent(state, {
      eventType: "command_feedback",
      timestamp: Date.now(),
      data: { command: "/compact", status: "started" },
    });
    expect(state.pendingPrompt).toBeUndefined();
  });

  it("should store delivery field on pendingPrompt", () => {
    const pending: PendingPrompt = { status: "sending", text: "Focus", delivery: "steer" };
    let state = createInitialState();
    state = { ...state, pendingPrompt: pending };
    expect(state.pendingPrompt).toEqual({ status: "sending", text: "Focus", delivery: "steer" });
  });

  it("should preserve delivery field on pendingPrompt through unrelated events", () => {
    const pending: PendingPrompt = { status: "sending", text: "Later", delivery: "followUp" };
    let state = createInitialState();
    state = { ...state, pendingPrompt: pending };

    state = reduceEvent(state, {
      eventType: "stats_update",
      timestamp: Date.now(),
      data: { tokensIn: 10, tokensOut: 5, contextUsage: { tokens: 100 } },
    });
    expect(state.pendingPrompt).toEqual({ status: "sending", text: "Later", delivery: "followUp" });
  });

  it("should clear pendingPrompt with delivery on message_start (role: user)", () => {
    const pending: PendingPrompt = { status: "sending", text: "Now", delivery: "steer" };
    let state = createInitialState();
    state = { ...state, pendingPrompt: pending };

    state = reduceEvent(state, {
      eventType: "message_start",
      timestamp: Date.now(),
      data: {
        message: {
          role: "user",
          content: [{ type: "text", text: "Now" }],
        },
      },
    });
    expect(state.pendingPrompt).toBeUndefined();
  });

  it("should clear pendingPrompt with delivery on agent_start", () => {
    const pending: PendingPrompt = { status: "sending", text: "Go", delivery: "steer" };
    let state = createInitialState();
    state = { ...state, pendingPrompt: pending };

    state = reduceEvent(state, {
      eventType: "agent_start",
      timestamp: Date.now(),
      data: {},
    });
    expect(state.pendingPrompt).toBeUndefined();
  });

  it("should clear pendingPrompt with delivery on agent_end", () => {
    const pending: PendingPrompt = { status: "sending", text: "Done", delivery: "followUp" };
    let state = createInitialState();
    state = { ...state, pendingPrompt: pending };

    state = reduceEvent(state, {
      eventType: "agent_end",
      timestamp: Date.now(),
      data: { messages: [] },
    });
    expect(state.pendingPrompt).toBeUndefined();
  });

  it("should clear pendingPrompt with delivery on bash_output", () => {
    const pending: PendingPrompt = { status: "sending", text: "!!ls", delivery: "followUp" };
    let state = createInitialState();
    state = { ...state, pendingPrompt: pending };

    state = reduceEvent(state, {
      eventType: "bash_output",
      timestamp: Date.now(),
      data: { stdout: "file.txt", stderr: "", exitCode: 0 },
    });
    expect(state.pendingPrompt).toBeUndefined();
  });

  it("should clear pendingPrompt with delivery on command_feedback", () => {
    const pending: PendingPrompt = { status: "sending", text: "/compact", delivery: "steer" };
    let state = createInitialState();
    state = { ...state, pendingPrompt: pending };

    state = reduceEvent(state, {
      eventType: "command_feedback",
      timestamp: Date.now(),
      data: { command: "/compact", status: "started" },
    });
    expect(state.pendingPrompt).toBeUndefined();
  });
});

// Bridge `prompt_received` ack handling. See change: optimistic-prompt-progress.
describe("applyPromptReceived", () => {
  it("fresh:true promotes a sending pendingPrompt to sent", () => {
    const state: SessionState = { ...createInitialState(), pendingPrompt: { text: "hi", status: "sending" } };
    const next = applyPromptReceived(state, true);
    expect(next.pendingPrompt).toEqual({ text: "hi", status: "sent" });
  });

  it("fresh:false drops pendingPrompt entirely (raced mid-turn)", () => {
    const state: SessionState = { ...createInitialState(), pendingPrompt: { text: "hi", status: "sending" } };
    const next = applyPromptReceived(state, false);
    expect(next.pendingPrompt).toBeUndefined();
  });

  it("is a no-op when no pendingPrompt exists", () => {
    const state = createInitialState();
    expect(applyPromptReceived(state, true)).toBe(state);
    expect(applyPromptReceived(state, false)).toBe(state);
  });

  it("fresh:true is idempotent on an already-sent prompt", () => {
    const state: SessionState = { ...createInitialState(), pendingPrompt: { text: "hi", status: "sent" } };
    expect(applyPromptReceived(state, true)).toBe(state);
  });
});

describe("toDisplayString", () => {
  it("returns empty string for null/undefined", () => {
    expect(toDisplayString(null)).toBe("");
    expect(toDisplayString(undefined)).toBe("");
  });

  it("returns string as-is", () => {
    expect(toDisplayString("hello")).toBe("hello");
  });

  it("extracts text from content block arrays", () => {
    const blocks = [
      { type: "text", text: "line 1" },
      { type: "text", text: "line 2" },
    ];
    expect(toDisplayString(blocks)).toBe("line 1\nline 2");
  });

  it("extracts text from { content: [...] } wrapper object", () => {
    const wrapped = {
      content: [{ type: "text", text: "hello from wrapper" }],
    };
    expect(toDisplayString(wrapped)).toBe("hello from wrapper");
  });

  it("JSON-stringifies plain objects", () => {
    expect(toDisplayString({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it("converts numbers to string", () => {
    expect(toDisplayString(42)).toBe("42");
  });
});

describe("bash_output events", () => {
  it("should add bashOutput message from bash_output event", () => {
    const state = applyEvents([
      {
        eventType: "bash_output",
        timestamp: 1000,
        data: { command: "ls -la", output: "file.txt", exitCode: 0, excludeFromContext: false },
      },
    ]);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].role).toBe("bashOutput");
    expect(state.messages[0].content).toBe("file.txt");
    expect((state.messages[0].args as any).command).toBe("ls -la");
    expect((state.messages[0].args as any).exitCode).toBe(0);
    expect((state.messages[0].args as any).excludeFromContext).toBe(false);
  });

  it("should mark silent bash with excludeFromContext", () => {
    const state = applyEvents([
      {
        eventType: "bash_output",
        timestamp: 1000,
        data: { command: "docker ps", output: "CONTAINER ID", exitCode: 0, excludeFromContext: true },
      },
    ]);
    expect((state.messages[0].args as any).excludeFromContext).toBe(true);
  });
});

describe("command_feedback events", () => {
  it("should add commandFeedback message from command_feedback event", () => {
    const state = applyEvents([
      {
        eventType: "command_feedback",
        timestamp: 1000,
        data: { command: "/compact", status: "started" },
      },
    ]);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].role).toBe("commandFeedback");
    expect((state.messages[0].args as any).command).toBe("/compact");
    expect((state.messages[0].args as any).status).toBe("started");
  });

  it("should include error message in commandFeedback", () => {
    const state = applyEvents([
      {
        eventType: "command_feedback",
        timestamp: 1000,
        data: { command: "/compact", status: "error", message: "Already compacted" },
      },
    ]);
    expect(state.messages[0].content).toBe("Already compacted");
    expect((state.messages[0].args as any).status).toBe("error");
  });

  describe("addInteractiveRequest deduplication", () => {
    it("should ignore duplicate requestId", () => {
      const initial = createInitialState();
      const params = { title: "Continue?", message: "" };

      const s1 = addInteractiveRequest(initial, "req-1", "confirm", params);
      expect(s1.interactiveRequests).toHaveLength(1);
      expect(s1.messages).toHaveLength(1);

      // Same requestId again — should be a no-op
      const s2 = addInteractiveRequest(s1, "req-1", "confirm", params);
      expect(s2).toBe(s1); // exact same reference
      expect(s2.interactiveRequests).toHaveLength(1);
      expect(s2.messages).toHaveLength(1);
    });

    it("should ignore duplicate pending request with same method+title but different requestId", () => {
      const initial = createInitialState();

      const s1 = addInteractiveRequest(initial, "req-1", "confirm", { title: "Continue?" });
      // Different requestId, same method+title (recursive proxy scenario)
      const s2 = addInteractiveRequest(s1, "req-2", "confirm", { title: "Continue?" });
      expect(s2).toBe(s1);
      expect(s2.interactiveRequests).toHaveLength(1);
    });

    it("should allow same title after previous request is resolved", () => {
      const initial = createInitialState();

      const s1 = addInteractiveRequest(initial, "req-1", "confirm", { title: "Continue?" });
      const s2 = resolveInteractiveRequest(s1, "req-1", true);
      // Same title but previous is resolved — should allow
      const s3 = addInteractiveRequest(s2, "req-2", "confirm", { title: "Continue?" });
      expect(s3.interactiveRequests).toHaveLength(2);
    });

    it("should allow different titles", () => {
      const initial = createInitialState();

      const s1 = addInteractiveRequest(initial, "req-1", "confirm", { title: "A" });
      const s2 = addInteractiveRequest(s1, "req-2", "confirm", { title: "B" });
      expect(s2.interactiveRequests).toHaveLength(2);
      expect(s2.messages).toHaveLength(2);
    });
  });

  describe("dismissInteractiveRequest", () => {
    it("should transition pending request to dismissed", () => {
      const initial = createInitialState();
      const s1 = addInteractiveRequest(initial, "req-1", "confirm", { title: "Continue?" });
      const s2 = dismissInteractiveRequest(s1, "req-1");

      expect(s2.interactiveRequests[0].status).toBe("dismissed");
      expect((s2.messages[0].args as any).status).toBe("dismissed");
    });

    it("should not change already resolved requests", () => {
      const initial = createInitialState();
      const s1 = addInteractiveRequest(initial, "req-1", "confirm", { title: "Continue?" });
      const s2 = resolveInteractiveRequest(s1, "req-1", { confirmed: true });
      const s3 = dismissInteractiveRequest(s2, "req-1");

      expect(s3).toBe(s2); // No change — same reference
      expect(s3.interactiveRequests[0].status).toBe("resolved");
    });

    it("should not change already cancelled requests", () => {
      const initial = createInitialState();
      const s1 = addInteractiveRequest(initial, "req-1", "confirm", { title: "Continue?" });
      const s2 = resolveInteractiveRequest(s1, "req-1", undefined, true);
      const s3 = dismissInteractiveRequest(s2, "req-1");

      expect(s3).toBe(s2);
      expect(s3.interactiveRequests[0].status).toBe("cancelled");
    });

    it("should return same state for unknown requestId", () => {
      const initial = createInitialState();
      const s1 = addInteractiveRequest(initial, "req-1", "confirm", { title: "Continue?" });
      const s2 = dismissInteractiveRequest(s1, "unknown-id");

      expect(s2).toBe(s1);
    });
  });

  describe("duration tracking", () => {
    it("should store startedAt on tool_execution_start messages", () => {
      const state = applyEvents([
        {
          eventType: "tool_execution_start",
          timestamp: 1000,
          data: { toolCallId: "tc-1", toolName: "bash", args: { command: "npm test" } },
        },
      ]);
      const toolMsg = state.messages.find((m) => m.toolCallId === "tc-1");
      expect(toolMsg?.startedAt).toBe(1000);
    });

    it("should compute duration on tool_execution_end", () => {
      const state = applyEvents([
        {
          eventType: "tool_execution_start",
          timestamp: 1000,
          data: { toolCallId: "tc-1", toolName: "bash", args: { command: "npm test" } },
        },
        {
          eventType: "tool_execution_end",
          timestamp: 4500,
          data: { toolCallId: "tc-1", result: "ok" },
        },
      ]);
      const toolMsg = state.messages.find((m) => m.toolCallId === "tc-1");
      expect(toolMsg?.duration).toBe(3500);
    });

    it("should store startedAt and duration on thinking messages", () => {
      const state = applyEvents([
        {
          eventType: "message_update",
          timestamp: 2000,
          data: { assistantMessageEvent: { type: "thinking_start", contentIndex: 0 } },
        },
        {
          eventType: "message_update",
          timestamp: 2500,
          data: { assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "reasoning..." } },
        },
        {
          eventType: "message_update",
          timestamp: 5000,
          data: { assistantMessageEvent: { type: "thinking_end", contentIndex: 0 } },
        },
      ]);
      const thinkingMsg = state.messages.find((m) => m.role === "thinking");
      expect(thinkingMsg?.startedAt).toBe(2000);
      expect(thinkingMsg?.duration).toBe(3000);
    });

    it("should track thinkingStartedAt for live counter during streaming", () => {
      const state = applyEvents([
        {
          eventType: "message_update",
          timestamp: 2000,
          data: { assistantMessageEvent: { type: "thinking_start", contentIndex: 0 } },
        },
        {
          eventType: "message_update",
          timestamp: 2500,
          data: { assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "still thinking" } },
        },
      ]);
      // While still streaming, thinkingStartedAt is set
      expect(state.thinkingStartedAt).toBe(2000);
      expect(state.streamingThinking).toBe("still thinking");
    });

    it("should clear thinkingStartedAt on thinking_end", () => {
      const state = applyEvents([
        {
          eventType: "message_update",
          timestamp: 2000,
          data: { assistantMessageEvent: { type: "thinking_start", contentIndex: 0 } },
        },
        {
          eventType: "message_update",
          timestamp: 2500,
          data: { assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "done" } },
        },
        {
          eventType: "message_update",
          timestamp: 5000,
          data: { assistantMessageEvent: { type: "thinking_end", contentIndex: 0 } },
        },
      ]);
      expect(state.thinkingStartedAt).toBeUndefined();
    });
  });

  describe("input streamingBehavior (surface-input-streaming-behavior)", () => {
    const userStart = (text: string): DashboardEvent => ({
      eventType: "message_start",
      timestamp: 2000,
      data: { message: { role: "user", content: [{ type: "text", text }] } },
    });
    const inputEvent = (
      source: string | undefined,
      streamingBehavior?: "steer" | "followUp",
    ): DashboardEvent => ({
      eventType: "input",
      timestamp: 1000,
      data: { source, text: "hi", ...(streamingBehavior ? { streamingBehavior } : {}) },
    });

    it("stamps streamingBehavior=steer onto the next interactive user message", () => {
      const state = applyEvents([inputEvent("interactive", "steer"), userStart("do X")]);
      const user = state.messages.find((m) => m.role === "user")!;
      expect(user.streamingBehavior).toBe("steer");
      expect(state.pendingInputBehavior).toBeUndefined();
    });

    it("stamps streamingBehavior=followUp onto the next interactive user message", () => {
      const state = applyEvents([inputEvent("interactive", "followUp"), userStart("do Y")]);
      const user = state.messages.find((m) => m.role === "user")!;
      expect(user.streamingBehavior).toBe("followUp");
    });

    it("idle interactive input (no streamingBehavior) leaves the user message unstamped", () => {
      const state = applyEvents([inputEvent("interactive", undefined), userStart("hello")]);
      const user = state.messages.find((m) => m.role === "user")!;
      expect(user.streamingBehavior).toBeUndefined();
    });

    it("does not stamp for source=rpc", () => {
      const state = applyEvents([inputEvent("rpc", "steer"), userStart("cmd")]);
      const user = state.messages.find((m) => m.role === "user")!;
      expect(user.streamingBehavior).toBeUndefined();
      expect(state.pendingInputBehavior).toBeUndefined();
    });

    it("does not stamp for source=extension", () => {
      const state = applyEvents([inputEvent("extension", "followUp"), userStart("injected")]);
      const user = state.messages.find((m) => m.role === "user")!;
      expect(user.streamingBehavior).toBeUndefined();
    });

    it("input event does not render a rawEvent card (Decision 4)", () => {
      const state = applyEvents([inputEvent("interactive", "steer")]);
      expect(state.messages.filter((m) => m.role === "rawEvent")).toHaveLength(0);
    });

    it("clears the correlation slot so a later user message is not re-stamped", () => {
      const state = applyEvents([
        inputEvent("interactive", "steer"),
        userStart("first"),
        userStart("second"),
      ]);
      const users = state.messages.filter((m) => m.role === "user");
      expect(users[0].streamingBehavior).toBe("steer");
      expect(users[1].streamingBehavior).toBeUndefined();
    });
  });

  describe("unknown / raw events", () => {
    it("should render unknown event types as rawEvent messages", () => {
      const state = applyEvents([
        {
          eventType: "some_extension_event",
          timestamp: 1000,
          data: { foo: "bar", count: 42 },
        },
      ]);
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0].role).toBe("rawEvent");
      expect(state.messages[0].toolName).toBe("some_extension_event");
      expect(JSON.parse(state.messages[0].content)).toEqual({ foo: "bar", count: 42 });
    });

    it("should not create rawEvent for known event types", () => {
      const state = applyEvents([
        {
          eventType: "turn_end",
          timestamp: 1000,
          data: {},
        },
      ]);
      // turn_end is handled but doesn't produce a message
      expect(state.messages.filter(m => m.role === "rawEvent")).toHaveLength(0);
    });
  });

  describe("Agent tool calls", () => {
    it("should track Agent tool_execution_start with subagent args", () => {
      const state = applyEvents([
        {
          eventType: "tool_execution_start",
          timestamp: 1000,
          data: {
            toolCallId: "agent-1",
            toolName: "Agent",
            args: { prompt: "Explore the codebase", subagent_type: "Explore", description: "Codebase exploration" },
          },
        },
      ]);

      expect(state.messages).toHaveLength(1);
      expect(state.messages[0].toolName).toBe("Agent");
      expect(state.messages[0].toolCallId).toBe("agent-1");
      expect(state.messages[0].toolStatus).toBe("running");
      expect(state.messages[0].args).toEqual({
        prompt: "Explore the codebase",
        subagent_type: "Explore",
        description: "Codebase exploration",
      });
      expect(state.currentTool).toBe("Agent");
    });

    it("should update Agent tool with structured partialResult (details + content)", () => {
      const state = applyEvents([
        {
          eventType: "tool_execution_start",
          timestamp: 1000,
          data: { toolCallId: "agent-1", toolName: "Agent", args: { prompt: "Fix it" } },
        },
        {
          eventType: "tool_execution_update",
          timestamp: 2000,
          data: {
            toolCallId: "agent-1",
            toolName: "Agent",
            partialResult: {
              content: [{ type: "text", text: "Investigating files..." }],
              details: { displayName: "Explore", status: "running", toolUses: 2, durationMs: 1000 },
            },
          },
        },
      ]);

      expect(state.messages).toHaveLength(1);
      expect(state.messages[0].result).toBe("Investigating files...");
      expect(state.messages[0].toolDetails).toEqual({
        displayName: "Explore",
        status: "running",
        toolUses: 2,
        durationMs: 1000,
      });
    });

    it("should complete Agent tool with duration", () => {
      const state = applyEvents([
        {
          eventType: "tool_execution_start",
          timestamp: 1000,
          data: { toolCallId: "agent-1", toolName: "Agent", args: { prompt: "Plan changes" } },
        },
        {
          eventType: "tool_execution_end",
          timestamp: 5000,
          data: {
            toolCallId: "agent-1",
            toolName: "Agent",
            result: "Done: 3 files analyzed",
            isError: false,
          },
        },
      ]);

      expect(state.messages).toHaveLength(1);
      expect(state.messages[0].toolStatus).toBe("complete");
      expect(state.messages[0].result).toBe("Done: 3 files analyzed");
      expect(state.messages[0].duration).toBe(4000);
      expect(state.currentTool).toBeUndefined();
    });

    it("should update toolDetails.status to completed when tool_execution_end has no details (live events)", () => {
      const state = applyEvents([
        {
          eventType: "tool_execution_start",
          timestamp: 1000,
          data: { toolCallId: "agent-1", toolName: "Agent", args: { prompt: "Explore" } },
        },
        {
          eventType: "tool_execution_update",
          timestamp: 2000,
          data: {
            toolCallId: "agent-1",
            toolName: "Agent",
            partialResult: {
              content: [{ type: "text", text: "Working..." }],
              details: { displayName: "Explore", status: "running", toolUses: 1, durationMs: 1000 },
            },
          },
        },
        {
          eventType: "tool_execution_end",
          timestamp: 5000,
          data: {
            toolCallId: "agent-1",
            toolName: "Agent",
            result: "Done",
            isError: false,
            // No details field — this is what pi core sends for live events
          },
        },
      ]);

      expect(state.messages).toHaveLength(1);
      expect(state.messages[0].toolStatus).toBe("complete");
      // toolDetails.status should be updated to "completed", not stuck on "running"
      expect(state.messages[0].toolDetails?.status).toBe("completed");
    });

    it("should update toolDetails.status to error when tool_execution_end has isError and no details", () => {
      const state = applyEvents([
        {
          eventType: "tool_execution_start",
          timestamp: 1000,
          data: { toolCallId: "agent-1", toolName: "Agent", args: { prompt: "Explore" } },
        },
        {
          eventType: "tool_execution_update",
          timestamp: 2000,
          data: {
            toolCallId: "agent-1",
            toolName: "Agent",
            partialResult: {
              content: [{ type: "text", text: "Working..." }],
              details: { displayName: "Explore", status: "running", toolUses: 1 },
            },
          },
        },
        {
          eventType: "tool_execution_end",
          timestamp: 5000,
          data: {
            toolCallId: "agent-1",
            toolName: "Agent",
            result: "Error occurred",
            isError: true,
          },
        },
      ]);

      expect(state.messages[0].toolStatus).toBe("error");
      expect(state.messages[0].toolDetails?.status).toBe("error");
    });

    it("should handle Agent tool error", () => {
      const state = applyEvents([
        {
          eventType: "tool_execution_start",
          timestamp: 1000,
          data: { toolCallId: "agent-1", toolName: "Agent", args: { prompt: "Do something" } },
        },
        {
          eventType: "tool_execution_end",
          timestamp: 3000,
          data: {
            toolCallId: "agent-1",
            toolName: "Agent",
            result: "Agent failed: timeout",
            isError: true,
          },
        },
      ]);

      expect(state.messages).toHaveLength(1);
      expect(state.messages[0].toolStatus).toBe("error");
      expect(state.messages[0].result).toBe("Agent failed: timeout");
    });

    it("should handle multiple sequential Agent calls", () => {
      const state = applyEvents([
        {
          eventType: "tool_execution_start",
          timestamp: 1000,
          data: { toolCallId: "agent-1", toolName: "Agent", args: { prompt: "Explore" } },
        },
        {
          eventType: "tool_execution_end",
          timestamp: 2000,
          data: { toolCallId: "agent-1", toolName: "Agent", result: "Done", isError: false },
        },
        {
          eventType: "tool_execution_start",
          timestamp: 3000,
          data: { toolCallId: "agent-2", toolName: "Agent", args: { prompt: "Implement" } },
        },
        {
          eventType: "tool_execution_end",
          timestamp: 4000,
          data: { toolCallId: "agent-2", toolName: "Agent", result: "Implemented", isError: false },
        },
      ]);

      const agentMessages = state.messages.filter(m => m.toolName === "Agent");
      expect(agentMessages).toHaveLength(2);
      expect(agentMessages[0].toolCallId).toBe("agent-1");
      expect(agentMessages[1].toolCallId).toBe("agent-2");
      expect(agentMessages.every(m => m.toolStatus === "complete")).toBe(true);
    });
  });

  describe("subagent lifecycle events", () => {
    it("should track subagent_created", () => {
      const state = applyEvents([
        {
          eventType: "subagent_created",
          timestamp: 1000,
          data: { id: "sub-1", type: "Explore", description: "Search codebase" },
        },
      ]);

      expect(state.subagents.size).toBe(1);
      const sub = state.subagents.get("sub-1")!;
      expect(sub.id).toBe("sub-1");
      expect(sub.type).toBe("Explore");
      expect(sub.description).toBe("Search codebase");
      expect(sub.status).toBe("created");
    });

    it("should transition subagent to running on subagent_started", () => {
      const state = applyEvents([
        {
          eventType: "subagent_created",
          timestamp: 1000,
          data: { id: "sub-1", type: "Explore", description: "Search codebase" },
        },
        {
          eventType: "subagent_started",
          timestamp: 2000,
          data: { id: "sub-1" },
        },
      ]);

      expect(state.subagents.get("sub-1")!.status).toBe("running");
      // Preserves original fields
      expect(state.subagents.get("sub-1")!.type).toBe("Explore");
      expect(state.subagents.get("sub-1")!.description).toBe("Search codebase");
    });

    it("should handle subagent_started without prior created event", () => {
      const state = applyEvents([
        {
          eventType: "subagent_started",
          timestamp: 1000,
          data: { id: "sub-1", type: "Plan", description: "Plan architecture" },
        },
      ]);

      const sub = state.subagents.get("sub-1")!;
      expect(sub.status).toBe("running");
      expect(sub.type).toBe("Plan");
    });

    it("should mark subagent as completed with result metadata", () => {
      const state = applyEvents([
        {
          eventType: "subagent_created",
          timestamp: 1000,
          data: { id: "sub-1", type: "Explore", description: "Search" },
        },
        {
          eventType: "subagent_started",
          timestamp: 2000,
          data: { id: "sub-1" },
        },
        {
          eventType: "subagent_completed",
          timestamp: 5000,
          data: {
            id: "sub-1",
            result: "Found 5 relevant files",
            durationMs: 3000,
            tokens: { input: 1000, output: 500, total: 1500 },
            toolUses: 4,
          },
        },
      ]);

      const sub = state.subagents.get("sub-1")!;
      expect(sub.status).toBe("completed");
      expect(sub.result).toBe("Found 5 relevant files");
      expect(sub.durationMs).toBe(3000);
      expect(sub.tokens).toEqual({ input: 1000, output: 500, total: 1500 });
      expect(sub.toolUses).toBe(4);
    });

    it("should mark subagent as failed with error", () => {
      const state = applyEvents([
        {
          eventType: "subagent_created",
          timestamp: 1000,
          data: { id: "sub-1", type: "general-purpose", description: "Fix bug" },
        },
        {
          eventType: "subagent_started",
          timestamp: 2000,
          data: { id: "sub-1" },
        },
        {
          eventType: "subagent_failed",
          timestamp: 4000,
          data: {
            id: "sub-1",
            error: "Max turns exceeded",
            durationMs: 2000,
          },
        },
      ]);

      const sub = state.subagents.get("sub-1")!;
      expect(sub.status).toBe("failed");
      expect(sub.error).toBe("Max turns exceeded");
      expect(sub.durationMs).toBe(2000);
    });

    it("should track multiple concurrent subagents", () => {
      const state = applyEvents([
        {
          eventType: "subagent_created",
          timestamp: 1000,
          data: { id: "sub-1", type: "Explore", description: "Search files" },
        },
        {
          eventType: "subagent_created",
          timestamp: 1000,
          data: { id: "sub-2", type: "Plan", description: "Plan changes" },
        },
        {
          eventType: "subagent_started",
          timestamp: 1500,
          data: { id: "sub-1" },
        },
        {
          eventType: "subagent_started",
          timestamp: 1500,
          data: { id: "sub-2" },
        },
        {
          eventType: "subagent_completed",
          timestamp: 3000,
          data: { id: "sub-1", result: "Done exploring", durationMs: 1500 },
        },
        {
          eventType: "subagent_failed",
          timestamp: 4000,
          data: { id: "sub-2", error: "Timeout", durationMs: 2500 },
        },
      ]);

      expect(state.subagents.size).toBe(2);
      expect(state.subagents.get("sub-1")!.status).toBe("completed");
      expect(state.subagents.get("sub-2")!.status).toBe("failed");
    });

    it("should default type and description when missing", () => {
      const state = applyEvents([
        {
          eventType: "subagent_created",
          timestamp: 1000,
          data: { id: "sub-1" },
        },
      ]);

      const sub = state.subagents.get("sub-1")!;
      expect(sub.type).toBe("unknown");
      expect(sub.description).toBe("");
    });

    // --- Phase-1 forward-compat fields (add-subagent-inspector) ---

    it("subagent_started without `entries` leaves field undefined", () => {
      const state = applyEvents([
        {
          eventType: "subagent_started",
          timestamp: 1000,
          data: { id: "sub-1", type: "Explore", description: "" },
        },
      ]);
      const sub = state.subagents.get("sub-1")!;
      expect(sub.entries).toBeUndefined();
      expect(sub.activity).toBeUndefined();
    });

    it("subagent_started with `details.entries` stores the array", () => {
      const entries = [
        { kind: "tool" as const, toolName: "Read", input: { path: "/x" }, output: "...", ts: 1 },
        { kind: "text" as const, text: "Done.", ts: 2 },
      ];
      const state = applyEvents([
        {
          eventType: "subagent_started",
          timestamp: 1000,
          data: {
            id: "sub-1",
            type: "Explore",
            description: "",
            details: { entries, activity: "reading /x", displayName: "my-agent" },
          },
        },
      ]);
      const sub = state.subagents.get("sub-1")!;
      expect(sub.entries).toEqual(entries);
      expect(sub.activity).toBe("reading /x");
      expect(sub.displayName).toBe("my-agent");
    });

    it("consecutive subagent_started events REPLACE entries (cumulative semantic)", () => {
      const first = [{ kind: "tool" as const, toolName: "Read", input: {}, ts: 1 }];
      const second = [
        { kind: "tool" as const, toolName: "Read", input: {}, ts: 1 },
        { kind: "tool" as const, toolName: "Bash", input: {}, ts: 2 },
        { kind: "text" as const, text: "hi", ts: 3 },
      ];
      const state = applyEvents([
        {
          eventType: "subagent_started",
          timestamp: 1000,
          data: { id: "s", type: "x", description: "", details: { entries: first } },
        },
        {
          eventType: "subagent_started",
          timestamp: 2000,
          data: { id: "s", type: "x", description: "", details: { entries: second } },
        },
      ]);
      const sub = state.subagents.get("s")!;
      expect(sub.entries).toEqual(second);
      expect(sub.entries!.length).toBe(3);
    });

    it("records `startedAt` from event.timestamp on subagent_started", () => {
      const state = applyEvents([
        {
          eventType: "subagent_started",
          timestamp: 1234,
          data: { id: "s", type: "x", description: "" },
        },
      ]);
      expect(state.subagents.get("s")!.startedAt).toBe(1234);
    });

    // --- D3: empty-array overwrite guard (fix-subagent-live-detail-reliability) ---

    it("empty-array frame does NOT clobber a populated timeline", () => {
      const three = [
        { kind: "tool" as const, toolName: "Read", input: {}, ts: 1 },
        { kind: "tool" as const, toolName: "Bash", input: {}, ts: 2 },
        { kind: "text" as const, text: "hi", ts: 3 },
      ];
      const state = applyEvents([
        {
          eventType: "subagent_started",
          timestamp: 1000,
          data: { id: "s", type: "x", description: "", details: { entries: three } },
        },
        {
          eventType: "subagent_started",
          timestamp: 2000,
          data: { id: "s", type: "x", description: "", details: { entries: [] } },
        },
      ]);
      const sub = state.subagents.get("s")!;
      expect(sub.entries).toEqual(three);
      expect(sub.entries!.length).toBe(3);
    });

    it("non-empty frame replaces the timeline wholesale", () => {
      const three = [
        { kind: "tool" as const, toolName: "Read", input: {}, ts: 1 },
        { kind: "tool" as const, toolName: "Bash", input: {}, ts: 2 },
        { kind: "text" as const, text: "hi", ts: 3 },
      ];
      const five = [
        ...three,
        { kind: "tool" as const, toolName: "Grep", input: {}, ts: 4 },
        { kind: "text" as const, text: "done", ts: 5 },
      ];
      const state = applyEvents([
        {
          eventType: "subagent_started",
          timestamp: 1000,
          data: { id: "s", type: "x", description: "", details: { entries: three } },
        },
        {
          eventType: "subagent_started",
          timestamp: 2000,
          data: { id: "s", type: "x", description: "", details: { entries: five } },
        },
      ]);
      const sub = state.subagents.get("s")!;
      expect(sub.entries).toEqual(five);
      expect(sub.entries!.length).toBe(5);
    });
  });

  // §12: tool_execution_end backfills the subagents map for replayed/refreshed
  // sessions. The producer persists full AgentDetails inside ToolResultMessage.
  // details; state-replay.ts threads that into a tool_execution_end event;
  // this branch in the reducer writes the subagent state back into the map.
  describe("§12 tool_execution_end subagent backfill", () => {
    it("replayed completed Agent run populates the subagents map", () => {
      const state = applyEvents([
        {
          eventType: "tool_execution_start",
          timestamp: 1000,
          data: { toolCallId: "tc1", toolName: "Agent", args: { prompt: "do work" } },
        },
        {
          eventType: "tool_execution_end",
          timestamp: 5000,
          data: {
            toolCallId: "tc1",
            toolName: "Agent",
            isError: false,
            result: "Done.",
            details: {
              agentId: "sub_abc",
              displayName: "explorer",
              entries: [{ kind: "text", text: "hi", ts: 1 }],
              durationMs: 4200,
              tokensUsage: { input: 500, output: 200, total: 700 },
              toolUses: 7,
              agentMdPath: "/home/u/.pi/agent/agents/Explore.md",
            },
          },
        },
      ]);

      const sub = state.subagents.get("sub_abc");
      expect(sub).toBeDefined();
      expect(sub!.status).toBe("completed");
      expect(sub!.result).toBe("Done.");
      expect(sub!.entries).toEqual([{ kind: "text", text: "hi", ts: 1 }]);
      expect(sub!.durationMs).toBe(4200);
      expect(sub!.tokens).toEqual({ input: 500, output: 200, total: 700 });
      expect(sub!.toolUses).toBe(7);
      expect(sub!.displayName).toBe("explorer");
      expect(sub!.agentMdPath).toBe("/home/u/.pi/agent/agents/Explore.md");
    });

    it("replayed failed Agent run populates with status=failed and error from data.result", () => {
      const state = applyEvents([
        {
          eventType: "tool_execution_start",
          timestamp: 1000,
          data: { toolCallId: "tc1", toolName: "Agent", args: {} },
        },
        {
          eventType: "tool_execution_end",
          timestamp: 2000,
          data: {
            toolCallId: "tc1",
            toolName: "Agent",
            isError: true,
            result: "aborted by user",
            details: { agentId: "sub_xyz" },
          },
        },
      ]);
      const sub = state.subagents.get("sub_xyz");
      expect(sub).toBeDefined();
      expect(sub!.status).toBe("failed");
      expect(sub!.error).toBe("aborted by user");
    });

    it("backfill merges with prior live state without overwriting non-undefined fields", () => {
      // Live subagent_started arrives first with displayName "liveName"
      // Then a tool_execution_end backfill arrives with displayName undefined.
      // The merged state should keep "liveName".
      const state = applyEvents([
        {
          eventType: "subagent_started",
          timestamp: 1000,
          data: { id: "sub_abc", type: "general", description: "d", details: { displayName: "liveName" } },
        },
        {
          eventType: "tool_execution_start",
          timestamp: 1500,
          data: { toolCallId: "tc1", toolName: "Agent", args: {} },
        },
        {
          eventType: "tool_execution_end",
          timestamp: 2000,
          data: {
            toolCallId: "tc1",
            toolName: "Agent",
            isError: false,
            result: "ok",
            // displayName intentionally absent in this details payload
            details: { agentId: "sub_abc", durationMs: 1234 },
          },
        },
      ]);
      const sub = state.subagents.get("sub_abc")!;
      expect(sub.displayName).toBe("liveName"); // not clobbered
      expect(sub.durationMs).toBe(1234); // updated
      expect(sub.status).toBe("completed"); // updated by backfill
    });

    it("backfill is a no-op for non-Agent tools", () => {
      const before = createInitialState();
      const state = applyEvents([
        {
          eventType: "tool_execution_start",
          timestamp: 1000,
          data: { toolCallId: "tc1", toolName: "bash", args: { command: "ls" } },
        },
        {
          eventType: "tool_execution_end",
          timestamp: 2000,
          data: {
            toolCallId: "tc1",
            toolName: "bash",
            isError: false,
            result: "file1\nfile2",
            details: { foo: "bar" },
          },
        },
      ]);
      expect(state.subagents.size).toBe(before.subagents.size); // unchanged
    });

    it("backfill is a no-op when details.agentId is missing", () => {
      const state = applyEvents([
        {
          eventType: "tool_execution_start",
          timestamp: 1000,
          data: { toolCallId: "tc1", toolName: "Agent", args: {} },
        },
        {
          eventType: "tool_execution_end",
          timestamp: 2000,
          data: {
            toolCallId: "tc1",
            toolName: "Agent",
            isError: false,
            result: "done",
            details: { somethingElse: "yes" }, // no agentId
          },
        },
      ]);
      expect(state.subagents.size).toBe(0);
    });

    it("existing toolDetails write path remains intact (regression guard)", () => {
      // The pre-existing tool_execution_end behavior writes data.details to
      // next.messages[idx].toolDetails. Verify backfill does not break that.
      const state = applyEvents([
        {
          eventType: "tool_execution_start",
          timestamp: 1000,
          data: { toolCallId: "tc1", toolName: "Agent", args: { prompt: "p" } },
        },
        {
          eventType: "tool_execution_end",
          timestamp: 2000,
          data: {
            toolCallId: "tc1",
            toolName: "Agent",
            isError: false,
            result: "ok",
            details: { agentId: "sub_abc", displayName: "explorer" },
          },
        },
      ]);
      const toolMsg = state.messages.find((m) => m.toolCallId === "tc1");
      expect(toolMsg?.toolDetails).toBeDefined();
      expect((toolMsg?.toolDetails as Record<string, unknown>).agentId).toBe("sub_abc");
      expect(state.subagents.get("sub_abc")?.displayName).toBe("explorer");
    });
  });

  // Change: resolve-subagent-inspector-by-session-id — dual-index the reduced
  // SubagentState under both the v4 agentId and the v7 runner agentSessionId so
  // the inspector resolves a deep-link by either id.
  describe("agentSessionId dual-index", () => {
    it("E1: dual-indexes a started frame under both ids (same ref; id stays canonical)", () => {
      const state = applyEvents([
        {
          eventType: "subagent_started",
          timestamp: 1000,
          data: { id: "A", type: "Explore", description: "d", details: { agentSessionId: "S" } },
        },
      ]);
      const byAgentId = state.subagents.get("A");
      const bySession = state.subagents.get("S");
      expect(byAgentId).toBeDefined();
      expect(bySession).toBe(byAgentId); // SAME reference
      expect(byAgentId!.id).toBe("A"); // canonical v4 id, even via the v7 key
      expect(byAgentId!.agentSessionId).toBe("S");
    });

    it("E1b: a later update via one key is visible via the other (paired ref)", () => {
      const state = applyEvents([
        {
          eventType: "subagent_created",
          timestamp: 1000,
          data: { id: "A", type: "Explore", description: "d", details: { agentSessionId: "S" } },
        },
        {
          eventType: "subagent_completed",
          timestamp: 2000,
          data: { id: "A", result: "ok", details: { agentSessionId: "S" } },
        },
      ]);
      expect(state.subagents.get("A")!.status).toBe("completed");
      expect(state.subagents.get("S")!.status).toBe("completed");
      expect(state.subagents.get("S")).toBe(state.subagents.get("A"));
    });

    it("E2: single-key when the frame carries no agentSessionId (no alias)", () => {
      const state = applyEvents([
        {
          eventType: "subagent_started",
          timestamp: 1000,
          data: { id: "A", type: "Explore", description: "d" },
        },
      ]);
      expect(state.subagents.get("A")).toBeDefined();
      expect(state.subagents.get("A")!.agentSessionId).toBeUndefined();
      expect(state.subagents.size).toBe(1); // exactly one key for the run
    });

    it("E3: backfill dual-indexes a completed Agent run under both ids", () => {
      const state = applyEvents([
        {
          eventType: "tool_execution_start",
          timestamp: 1000,
          data: { toolCallId: "tc1", toolName: "Agent", args: {} },
        },
        {
          eventType: "tool_execution_end",
          timestamp: 2000,
          data: {
            toolCallId: "tc1",
            toolName: "Agent",
            isError: false,
            result: "done",
            details: { agentId: "A", agentSessionId: "S" },
          },
        },
      ]);
      const byAgentId = state.subagents.get("A");
      const bySession = state.subagents.get("S");
      expect(byAgentId).toBeDefined();
      expect(bySession).toBe(byAgentId);
      expect(byAgentId!.id).toBe("A");
      expect(byAgentId!.agentSessionId).toBe("S");
    });

    it("E4: backfill single-key when the end details carry no agentSessionId", () => {
      const state = applyEvents([
        {
          eventType: "tool_execution_start",
          timestamp: 1000,
          data: { toolCallId: "tc1", toolName: "Agent", args: {} },
        },
        {
          eventType: "tool_execution_end",
          timestamp: 2000,
          data: {
            toolCallId: "tc1",
            toolName: "Agent",
            isError: false,
            result: "done",
            details: { agentId: "A" },
          },
        },
      ]);
      expect(state.subagents.get("A")).toBeDefined();
      expect(state.subagents.size).toBe(1);
    });

    it("E6: an unknown id (neither agentId nor agentSessionId) resolves to undefined", () => {
      const state = applyEvents([
        {
          eventType: "subagent_started",
          timestamp: 1000,
          data: { id: "A", type: "Explore", description: "d", details: { agentSessionId: "S" } },
        },
      ]);
      expect(state.subagents.get("unknown-id")).toBeUndefined();
    });

    it("X1: graceful degrade — no agentSessionId anywhere → reducer creates no alias key", () => {
      const state = applyEvents([
        {
          eventType: "subagent_started",
          timestamp: 1000,
          data: { id: "A", type: "Explore", description: "d" },
        },
        {
          eventType: "subagent_completed",
          timestamp: 2000,
          data: { id: "A", result: "ok" },
        },
      ]);
      expect(state.subagents.get("A")).toBeDefined();
      expect(state.subagents.size).toBe(1); // no S alias
    });
  });
});

describe("turnIndex tracking", () => {
  it("should assign turnIndex to last user message on stats_update with turnUsage", () => {
    const state = applyEvents([
      {
        eventType: "message_start",
        timestamp: 1000,
        data: { message: { role: "user", content: [{ type: "text", text: "Hello" }] } },
      },
      {
        eventType: "stats_update",
        timestamp: 2000,
        data: {
          tokensIn: 100,
          tokensOut: 50,
          cost: 0.001,
          turnUsage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
        },
      },
    ]);

    expect(state.messages[0].turnIndex).toBe(0);
    expect(state.turnCount).toBe(1);
  });

  it("should increment turnIndex across multiple turns", () => {
    const state = applyEvents([
      {
        eventType: "message_start",
        timestamp: 1000,
        data: { message: { role: "user", content: [{ type: "text", text: "Turn 1" }] } },
      },
      {
        eventType: "stats_update",
        timestamp: 2000,
        data: { tokensIn: 100, tokensOut: 50, cost: 0.001, turnUsage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 } },
      },
      {
        eventType: "message_start",
        timestamp: 3000,
        data: { message: { role: "user", content: [{ type: "text", text: "Turn 2" }] } },
      },
      {
        eventType: "stats_update",
        timestamp: 4000,
        data: { tokensIn: 200, tokensOut: 80, cost: 0.002, turnUsage: { input: 200, output: 80, cacheRead: 0, cacheWrite: 0 } },
      },
    ]);

    const userMsgs = state.messages.filter((m) => m.role === "user");
    expect(userMsgs[0].turnIndex).toBe(0);
    expect(userMsgs[1].turnIndex).toBe(1);
    expect(state.turnCount).toBe(2);
  });

  it("should not assign turnIndex on stats_update without turnUsage", () => {
    const state = applyEvents([
      {
        eventType: "message_start",
        timestamp: 1000,
        data: { message: { role: "user", content: [{ type: "text", text: "Hello" }] } },
      },
      {
        eventType: "stats_update",
        timestamp: 2000,
        data: { tokensIn: 100, tokensOut: 50, cost: 0.001 },
      },
    ]);

    expect(state.messages[0].turnIndex).toBeUndefined();
    expect(state.turnCount).toBe(0);
  });

  it("should not double-assign turnIndex to already-indexed user message", () => {
    // Two stats_update for the same turn should not change the index
    const state = applyEvents([
      {
        eventType: "message_start",
        timestamp: 1000,
        data: { message: { role: "user", content: [{ type: "text", text: "Hello" }] } },
      },
      {
        eventType: "stats_update",
        timestamp: 2000,
        data: { tokensIn: 100, tokensOut: 50, cost: 0.001, turnUsage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 } },
      },
      {
        eventType: "stats_update",
        timestamp: 3000,
        data: { tokensIn: 100, tokensOut: 50, cost: 0.001, turnUsage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 } },
      },
    ]);

    // First stats_update assigns turnIndex 0, second sees it's already set and skips
    expect(state.messages[0].turnIndex).toBe(0);
    expect(state.turnCount).toBe(1);
  });

  it("should store entryId on user message from message_start", () => {
    const state = applyEvents([
      {
        eventType: "message_start",
        timestamp: 1000,
        data: { message: { role: "user", content: [{ type: "text", text: "Hi" }] }, entryId: "entry-u1" },
      },
    ]);
    expect(state.messages[0].entryId).toBe("entry-u1");
  });

  it("should store entryId on assistant message from message_end", () => {
    const state = applyEvents([
      {
        eventType: "message_update",
        timestamp: 1000,
        data: { type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "Hello" }] } },
      },
      {
        eventType: "message_end",
        timestamp: 2000,
        data: { message: { role: "assistant" }, entryId: "entry-a1" },
      },
    ]);
    const assistant = state.messages.find(m => m.role === "assistant");
    expect(assistant?.entryId).toBe("entry-a1");
  });

  it("should leave entryId undefined when not present in event data", () => {
    const state = applyEvents([
      {
        eventType: "message_start",
        timestamp: 1000,
        data: { message: { role: "user", content: [{ type: "text", text: "Hi" }] } },
      },
    ]);
    expect(state.messages[0].entryId).toBeUndefined();
  });
});

describe("extractAgentEndError", () => {
  it("returns errorMessage when last message has stopReason error", () => {
    expect(extractAgentEndError({
      messages: [{ role: "assistant", stopReason: "error", errorMessage: "Rate limit exceeded", content: [] }],
    })).toBe("Rate limit exceeded");
  });

  it("returns fallback when errorMessage is missing", () => {
    expect(extractAgentEndError({
      messages: [{ role: "assistant", stopReason: "error", content: [] }],
    })).toBe("An unknown error occurred");
  });

  it("returns undefined for normal stopReason", () => {
    expect(extractAgentEndError({
      messages: [{ role: "assistant", stopReason: "end_turn", content: [] }],
    })).toBeUndefined();
  });

  it("returns undefined for empty messages", () => {
    expect(extractAgentEndError({ messages: [] })).toBeUndefined();
  });

  it("returns undefined for missing messages", () => {
    expect(extractAgentEndError({})).toBeUndefined();
  });

  it("inspects only the last message", () => {
    expect(extractAgentEndError({
      messages: [
        { role: "assistant", stopReason: "error", errorMessage: "first" },
        { role: "assistant", stopReason: "end_turn" },
      ],
    })).toBeUndefined();
  });
});

describe("lastError extraction from agent_end", () => {
  it("should set lastError when agent_end has stopReason error", () => {
    const state = applyEvents([
      {
        eventType: "agent_end",
        timestamp: 1000,
        data: {
          messages: [
            {
              role: "assistant",
              stopReason: "error",
              errorMessage: "Rate limit exceeded",
              content: [],
            },
          ],
        },
      },
    ]);
    expect(state.lastError).toEqual({ message: "Rate limit exceeded", timestamp: 1000 });
    // agent_end sets the intermediate "ended"; lastError extraction is a
    // preserved agent_end side-effect. See change: adopt-pi-074-080-features.
    expect(state.status).toBe("ended");
    expect(state.isStreaming).toBe(false);
  });

  it("should not set lastError when agent_end has normal stopReason", () => {
    const state = applyEvents([
      {
        eventType: "agent_end",
        timestamp: 1000,
        data: {
          messages: [
            {
              role: "assistant",
              stopReason: "end_turn",
              content: [],
            },
          ],
        },
      },
    ]);
    expect(state.lastError).toBeUndefined();
  });

  it("should not set lastError when agent_end has no messages", () => {
    const state = applyEvents([
      { eventType: "agent_end", timestamp: 1000, data: {} },
    ]);
    expect(state.lastError).toBeUndefined();
  });

  it("should not set lastError when agent_end has empty messages array", () => {
    const state = applyEvents([
      { eventType: "agent_end", timestamp: 1000, data: { messages: [] } },
    ]);
    expect(state.lastError).toBeUndefined();
  });

  it("should use fallback message when errorMessage is missing", () => {
    const state = applyEvents([
      {
        eventType: "agent_end",
        timestamp: 1000,
        data: {
          messages: [
            { role: "assistant", stopReason: "error", content: [] },
          ],
        },
      },
    ]);
    expect(state.lastError).toBeDefined();
    expect(state.lastError!.message).toBeTruthy();
  });

  it("should NOT clear lastError on agent_start (deferred-clear lifecycle)", () => {
    let state = applyEvents([
      {
        eventType: "agent_end",
        timestamp: 1000,
        data: {
          messages: [
            { role: "assistant", stopReason: "error", errorMessage: "Quota exceeded", content: [] },
          ],
        },
      },
    ]);
    expect(state.lastError).toBeDefined();

    state = reduceEvent(state, {
      eventType: "agent_start",
      timestamp: 2000,
      data: {},
    });
    // Persists across the retry/continuation turn's start.
    expect(state.lastError).toBeDefined();
    expect(state.lastError!.message).toBe("Quota exceeded");
  });

  it("clears lastError on a confirmed non-error message_end (real pi-ai stopReason 'stop')", () => {
    let state = applyEvents([
      {
        eventType: "agent_end",
        timestamp: 1000,
        data: { messages: [{ role: "assistant", stopReason: "error", errorMessage: "Quota exceeded", content: [] }] },
      },
    ]);
    expect(state.lastError).toBeDefined();
    // Retry/continuation turn starts — error still set.
    state = reduceEvent(state, { eventType: "agent_start", timestamp: 2000, data: {} });
    expect(state.lastError).toBeDefined();
    // Assistant finishes cleanly — error clears. pi-ai emits "stop" on the wire.
    state = reduceEvent(state, {
      eventType: "message_end",
      timestamp: 2100,
      data: { message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "done" }] } },
    });
    expect(state.lastError).toBeUndefined();
  });

  it("also clears lastError on the Anthropic-normalized 'end_turn' stopReason", () => {
    let state = applyEvents([
      {
        eventType: "agent_end",
        timestamp: 1000,
        data: { messages: [{ role: "assistant", stopReason: "error", errorMessage: "boom", content: [] }] },
      },
    ]);
    state = reduceEvent(state, { eventType: "agent_start", timestamp: 2000, data: {} });
    state = reduceEvent(state, {
      eventType: "message_end",
      timestamp: 2100,
      data: { message: { role: "assistant", stopReason: "end_turn", content: [{ type: "text", text: "done" }] } },
    });
    expect(state.lastError).toBeUndefined();
  });

  it("does NOT clear lastError on a mid-turn tool_use message_end", () => {
    let state = applyEvents([
      {
        eventType: "agent_end",
        timestamp: 1000,
        data: { messages: [{ role: "assistant", stopReason: "error", errorMessage: "boom", content: [] }] },
      },
    ]);
    state = reduceEvent(state, { eventType: "agent_start", timestamp: 2000, data: {} });
    state = reduceEvent(state, {
      eventType: "message_end",
      timestamp: 2100,
      data: { message: { role: "assistant", stopReason: "tool_use", content: [{ type: "text", text: "calling tool" }] } },
    });
    // Mid-turn stop must not clear — the turn can still error afterward.
    expect(state.lastError).toBeDefined();
    expect(state.lastError!.message).toBe("boom");
  });

  it("failed retry updates lastError without a hidden intermediate frame", () => {
    let state = applyEvents([
      {
        eventType: "agent_end",
        timestamp: 1000,
        data: { messages: [{ role: "assistant", stopReason: "error", errorMessage: "first boom", content: [] }] },
      },
    ]);
    expect(state.lastError!.message).toBe("first boom");
    state = reduceEvent(state, { eventType: "agent_start", timestamp: 2000, data: {} });
    // error still visible during the retry attempt (no flash to undefined)
    expect(state.lastError!.message).toBe("first boom");
    state = reduceEvent(state, {
      eventType: "agent_end",
      timestamp: 3000,
      data: { messages: [{ role: "assistant", stopReason: "error", errorMessage: "second boom", content: [] }] },
    });
    expect(state.lastError).toEqual({ message: "second boom", timestamp: 3000 });
  });

  it("does NOT clear lastError on an agent_end that paused at a tool_use stop", () => {
    let state = applyEvents([
      {
        eventType: "agent_end",
        timestamp: 1000,
        data: { messages: [{ role: "assistant", stopReason: "error", errorMessage: "boom", content: [] }] },
      },
    ]);
    state = reduceEvent(state, { eventType: "agent_start", timestamp: 2000, data: {} });
    // pi yields at an interactive ask_user tool: agent_end with a tool_use last
    // message. This is a pause, not a confirmed-good response.
    state = reduceEvent(state, {
      eventType: "agent_end",
      timestamp: 3000,
      data: { messages: [{ role: "assistant", stopReason: "tool_use", content: [] }] },
    });
    expect(state.lastError).toBeDefined();
    expect(state.lastError!.message).toBe("boom");
  });

  it("clears lastError on a clean agent_end (end_turn terminal stop)", () => {
    let state = applyEvents([
      {
        eventType: "agent_end",
        timestamp: 1000,
        data: { messages: [{ role: "assistant", stopReason: "error", errorMessage: "Quota exceeded", content: [] }] },
      },
    ]);
    expect(state.lastError).toBeDefined();
    state = reduceEvent(state, { eventType: "agent_start", timestamp: 2000, data: {} });
    state = reduceEvent(state, {
      eventType: "agent_end",
      timestamp: 3000,
      data: { messages: [{ role: "assistant", stopReason: "stop", content: [] }] },
    });
    expect(state.lastError).toBeUndefined();
  });

  it("should extract error from last message in multi-message array", () => {
    const state = applyEvents([
      {
        eventType: "agent_end",
        timestamp: 1000,
        data: {
          messages: [
            { role: "user", content: [{ type: "text", text: "Hi" }] },
            { role: "assistant", stopReason: "error", errorMessage: "Service overloaded", content: [] },
          ],
        },
      },
    ]);
    expect(state.lastError).toEqual({ message: "Service overloaded", timestamp: 1000 });
  });
});

describe("pendingPrompt safety", () => {
  it("should clear pendingPrompt on agent_end", () => {
    let state = createInitialState();
    state = { ...state, pendingPrompt: { text: "Fix the bug", status: "sending" } };

    state = reduceEvent(state, {
      eventType: "agent_end",
      timestamp: 1000,
      data: {},
    });
    expect(state.pendingPrompt).toBeUndefined();
  });

  it("should clear pendingPrompt on agent_end even when error occurs", () => {
    let state = createInitialState();
    state = { ...state, pendingPrompt: { text: "Fix the bug", status: "sending" } };

    state = reduceEvent(state, {
      eventType: "agent_end",
      timestamp: 1000,
      data: {
        messages: [
          { role: "assistant", stopReason: "error", errorMessage: "Quota exceeded", content: [] },
        ],
      },
    });
    expect(state.pendingPrompt).toBeUndefined();
    expect(state.lastError).toBeDefined();
  });
});

describe("findLastUserPrompt (Retry button)", () => {
  const make = (overrides: Partial<ChatMessage>): ChatMessage => ({
    id: overrides.id ?? "x",
    role: overrides.role ?? "user",
    content: overrides.content ?? "",
    timestamp: overrides.timestamp ?? 0,
    ...overrides,
  });

  it("returns null on empty history", () => {
    expect(findLastUserPrompt([])).toBeNull();
  });

  it("returns null when no user message exists", () => {
    expect(
      findLastUserPrompt([
        make({ role: "assistant", content: "hi" }),
        make({ role: "toolResult", content: "x" }),
      ]),
    ).toBeNull();
  });

  it("returns the last user message text", () => {
    const result = findLastUserPrompt([
      make({ role: "user", content: "first" }),
      make({ role: "assistant", content: "reply" }),
      make({ role: "user", content: "second" }),
    ]);
    expect(result).toEqual({ text: "second" });
  });

  it("skips trailing non-user roles to find the last user message", () => {
    const result = findLastUserPrompt([
      make({ role: "user", content: "hello" }),
      make({ role: "assistant", content: "err" }),
    ]);
    expect(result).toEqual({ text: "hello" });
  });

  it("skips interactiveUi rows (e.g. ask_user responses)", () => {
    const result = findLastUserPrompt([
      make({ role: "user", content: "real prompt" }),
      make({ role: "interactiveUi", content: "ask_user response" }),
    ]);
    expect(result).toEqual({ text: "real prompt" });
  });

  it("includes images mapped to wire shape with type:'image'", () => {
    const result = findLastUserPrompt([
      make({
        role: "user",
        content: "caption",
        images: [{ data: "AAAA", mimeType: "image/png" }],
      }),
    ]);
    expect(result).toEqual({
      text: "caption",
      images: [{ type: "image", data: "AAAA", mimeType: "image/png" }],
    });
  });

  it("omits the images key when the user message had none", () => {
    const result = findLastUserPrompt([
      make({ role: "user", content: "plain text" }),
    ]);
    expect(result).toEqual({ text: "plain text" });
    expect("images" in result!).toBe(false);
  });
});

describe("auto_retry events (provider-retry-state)", () => {
  it("sets retryState on auto_retry_start", () => {
    let state = createInitialState();
    state = reduceEvent(state, {
      eventType: "auto_retry_start",
      timestamp: 5000,
      data: { attempt: 1, maxAttempts: 3, delayMs: 2000, errorMessage: "rate limit exceeded" },
    });
    expect(state.retryState).toEqual({
      attempt: 1,
      maxAttempts: 3,
      delayMs: 2000,
      reason: "rate limit exceeded",
      startedAt: 5000,
    });
    expect(state.lastError).toBeUndefined();
  });

  it("clears retryState on auto_retry_end with success", () => {
    let state = createInitialState();
    state = reduceEvent(state, {
      eventType: "auto_retry_start",
      timestamp: 5000,
      data: { attempt: 1, maxAttempts: 3, delayMs: 2000, errorMessage: "rate limit" },
    });
    state = reduceEvent(state, {
      eventType: "auto_retry_end",
      timestamp: 6000,
      data: { success: true, attempt: 2 },
    });
    expect(state.retryState).toBeUndefined();
    expect(state.lastError).toBeUndefined();
  });

  it("clears retryState and surfaces lastError on auto_retry_end with failure", () => {
    let state = createInitialState();
    state = reduceEvent(state, {
      eventType: "auto_retry_start",
      timestamp: 5000,
      data: { attempt: 1, maxAttempts: 3, delayMs: 2000, errorMessage: "rate limit" },
    });
    state = reduceEvent(state, {
      eventType: "auto_retry_end",
      timestamp: 7000,
      data: { success: false, attempt: 3, finalError: "Rate limit exceeded" },
    });
    expect(state.retryState).toBeUndefined();
    expect(state.lastError).toEqual({ message: "Rate limit exceeded", timestamp: 7000 });
  });

  it("does not overwrite existing lastError on auto_retry_end failure", () => {
    let state = createInitialState();
    state.lastError = { message: "earlier error", timestamp: 100 };
    state = reduceEvent(state, {
      eventType: "auto_retry_start",
      timestamp: 5000,
      data: { attempt: 1, maxAttempts: 3, delayMs: 2000, errorMessage: "rate limit" },
    });
    state = reduceEvent(state, {
      eventType: "auto_retry_end",
      timestamp: 7000,
      data: { success: false, finalError: "new error" },
    });
    expect(state.retryState).toBeUndefined();
    expect(state.lastError).toEqual({ message: "earlier error", timestamp: 100 });
  });

  it("agent_start defensively clears stale retryState", () => {
    let state = createInitialState();
    state = reduceEvent(state, {
      eventType: "auto_retry_start",
      timestamp: 5000,
      data: { attempt: 1, maxAttempts: 3, delayMs: 2000, errorMessage: "x" },
    });
    state = reduceEvent(state, { eventType: "agent_start", timestamp: 6000, data: {} });
    expect(state.retryState).toBeUndefined();
  });

  it("agent_end defensively clears retryState while still extracting lastError", () => {
    let state = createInitialState();
    state = reduceEvent(state, {
      eventType: "auto_retry_start",
      timestamp: 5000,
      data: { attempt: 1, maxAttempts: 3, delayMs: 2000, errorMessage: "x" },
    });
    state = reduceEvent(state, {
      eventType: "agent_end",
      timestamp: 8000,
      data: {
        messages: [
          { role: "assistant", stopReason: "error", errorMessage: "final boom", content: [] },
        ],
      },
    });
    expect(state.retryState).toBeUndefined();
    expect(state.lastError).toEqual({ message: "final boom", timestamp: 8000 });
  });

  it("auto_retry_end without prior retryState is a no-op", () => {
    let state = createInitialState();
    state = reduceEvent(state, {
      eventType: "auto_retry_end",
      timestamp: 6000,
      data: { success: false, finalError: "stale" },
    });
    expect(state.retryState).toBeUndefined();
    expect(state.lastError).toBeUndefined();
  });

  // Defense-in-depth guard against (yellow + red) banner overlap.
  // See change: fix-retry-banner-stuck-on-limit-exceeded.
  describe("auto_retry_start defensive guard against banner overlap", () => {
    it("drops auto_retry_start when lastError is fresh same-turn (≤1500ms, not streaming)", () => {
      let state = createInitialState();
      state.lastError = { message: "...quota exhausted...", timestamp: 1_000_000 };
      state.isStreaming = false;
      state = reduceEvent(state, {
        eventType: "auto_retry_start",
        timestamp: 1_000_500, // 500ms later
        data: { attempt: 1, maxAttempts: -1, delayMs: -1, errorMessage: "429" },
      });
      expect(state.retryState).toBeUndefined();
      expect(state.lastError).toEqual({ message: "...quota exhausted...", timestamp: 1_000_000 });
    });

    it("does NOT drop auto_retry_start when lastError is stale carry-over (>1500ms old)", () => {
      let state = createInitialState();
      state.lastError = { message: "earlier turn", timestamp: 1_000_000 };
      state.isStreaming = false;
      state = reduceEvent(state, {
        eventType: "auto_retry_start",
        timestamp: 1_010_000, // 10s later
        data: { attempt: 1, maxAttempts: -1, delayMs: -1, errorMessage: "rate limit" },
      });
      expect(state.retryState).toBeDefined();
      expect(state.retryState!.reason).toBe("rate limit");
      expect(state.lastError).toEqual({ message: "earlier turn", timestamp: 1_000_000 });
    });

    it("does NOT drop auto_retry_start when streaming (isStreaming=true)", () => {
      let state = createInitialState();
      state.lastError = { message: "fresh but mid-stream", timestamp: 1_000_000 };
      state.isStreaming = true;
      state = reduceEvent(state, {
        eventType: "auto_retry_start",
        timestamp: 1_000_500,
        data: { attempt: 1, maxAttempts: -1, delayMs: -1, errorMessage: "x" },
      });
      expect(state.retryState).toBeDefined();
    });

    it("does NOT drop auto_retry_start when lastError is undefined", () => {
      let state = createInitialState();
      state.lastError = undefined;
      state.isStreaming = false;
      state = reduceEvent(state, {
        eventType: "auto_retry_start",
        timestamp: 5000,
        data: { attempt: 1, maxAttempts: -1, delayMs: -1, errorMessage: "x" },
      });
      expect(state.retryState).toBeDefined();
    });

    it("does NOT drop auto_retry_start when lastError is exactly at the boundary (1500ms old)", () => {
      // Boundary case: with `<=` semantics, exactly 1500ms drops; 1501ms keeps.
      let state = createInitialState();
      state.lastError = { message: "boundary", timestamp: 1_000_000 };
      state.isStreaming = false;
      state = reduceEvent(state, {
        eventType: "auto_retry_start",
        timestamp: 1_001_501, // 1501ms later
        data: { attempt: 1, maxAttempts: -1, delayMs: -1, errorMessage: "x" },
      });
      expect(state.retryState).toBeDefined();
    });
  });
});

// See change: unify-status-banner-and-terminal-limit-stop.
describe("deriveBannerState (unified SessionBanner selector)", () => {
  it("returns hidden when neither retryState nor lastError is set", () => {
    const s = createInitialState();
    expect(deriveBannerState(s)).toEqual({ variant: "hidden" });
  });

  it("returns retry-only composition when retryState is set", () => {
    const s = createInitialState();
    s.retryState = {
      attempt: 3,
      maxAttempts: -1,
      delayMs: -1,
      reason: "rate limit",
      startedAt: 1700000000000,
    };
    expect(deriveBannerState(s)).toEqual({
      retry: {
        attempt: 3,
        maxAttempts: -1,
        delayMs: -1,
        startedAt: 1700000000000,
        reason: "rate limit",
      },
    });
  });

  it("returns error anchor (kind error) for a generic lastError", () => {
    const s = createInitialState();
    s.lastError = { message: "fetch failed: ECONNRESET", timestamp: 1 };
    expect(deriveBannerState(s)).toEqual({
      error: { kind: "error", message: "fetch failed: ECONNRESET" },
    });
  });

  it("returns error anchor (kind error) — NEVER limit-exceeded — for a billing/quota string", () => {
    const s = createInitialState();
    s.lastError = { message: "monthly_spending_cap exceeded", timestamp: 1 };
    expect(deriveBannerState(s)).toEqual({
      error: { kind: "error", message: "monthly_spending_cap exceeded" },
    });
  });

  it("composes error anchor + retry sub-line when both are set", () => {
    const s = createInitialState();
    s.retryState = {
      attempt: 2,
      maxAttempts: -1,
      delayMs: -1,
      reason: "rate limit",
      startedAt: 0,
    };
    s.lastError = { message: "429", timestamp: 1 };
    const banner = deriveBannerState(s);
    expect(banner).toEqual({
      error: { kind: "error", message: "429" },
      retry: { attempt: 2, maxAttempts: -1, delayMs: -1, startedAt: 0, reason: "rate limit" },
    });
  });

  it("every error string — billing/quota or generic — resolves to kind error", () => {
    const cases: string[] = [
      "usage_limit_reached",
      "quota_exceeded",
      "insufficient_quota",
      "credit balance too low",
      "monthly_spending_cap",
      "reset after 12h",
      "fetch failed",
      "tool execution failed",
      "429 too many requests",
    ];
    for (const msg of cases) {
      const s = createInitialState();
      s.lastError = { message: msg, timestamp: 1 };
      const banner = deriveBannerState(s);
      expect("error" in banner && banner.error?.kind, msg).toBe("error");
    }
  });
});

// See change: unify-error-retry-lifecycle.
describe("error-lifecycle: composed surface end-to-end", () => {
  function bannerHas(s: SessionState): { error: boolean; retry: boolean } {
    const b = deriveBannerState(s);
    return { error: "error" in b && !!b.error, retry: "retry" in b && !!b.retry };
  }

  it("error → retry-on-top → fail (no flicker) → retry → confirmed-good clear", () => {
    let s: SessionState = createInitialState();
    // 1. Turn fails terminally — error anchor appears.
    s = reduceEvent(s, {
      eventType: "agent_end",
      timestamp: 1000,
      data: { messages: [{ role: "assistant", stopReason: "error", errorMessage: "429 rate limited", content: [] }] },
    });
    expect(bannerHas(s)).toEqual({ error: true, retry: false });

    // 2. Retry/continuation turn starts — error anchor persists (no optimistic
    //    clear on agent_start), isStreaming flips true.
    s = reduceEvent(s, { eventType: "agent_start", timestamp: 2000, data: {} });
    expect(s.lastError!.message).toBe("429 rate limited");

    // 3. Auto-retry begins ON TOP of the persistent error anchor (composed).
    //    isStreaming is true so the fresh-error guard does not drop it.
    s = reduceEvent(s, {
      eventType: "auto_retry_start",
      timestamp: 2100,
      data: { attempt: 2, maxAttempts: -1, delayMs: -1, errorMessage: "429 rate limited" },
    });
    expect(bannerHas(s)).toEqual({ error: true, retry: true });
    expect(s.lastError!.message).toBe("429 rate limited");

    // 4. The retry fails again — error updates WITHOUT a hidden frame.
    s = reduceEvent(s, {
      eventType: "agent_end",
      timestamp: 2400,
      data: { messages: [{ role: "assistant", stopReason: "error", errorMessage: "still 429", content: [] }] },
    });
    expect(bannerHas(s)).toEqual({ error: true, retry: false });
    expect(s.lastError!.message).toBe("still 429");

    // 5. Manual retry: new turn starts (error still visible).
    s = reduceEvent(s, { eventType: "agent_start", timestamp: 3000, data: {} });
    expect(s.lastError!.message).toBe("still 429");

    // 6. Confirmed-good response clears the whole surface (real pi-ai 'stop').
    s = reduceEvent(s, {
      eventType: "message_end",
      timestamp: 3100,
      data: { message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "fixed" }] } },
    });
    expect(bannerHas(s)).toEqual({ error: false, retry: false });
    expect(deriveBannerState(s)).toEqual({ variant: "hidden" });
  });
});

// See change: unify-status-banner-and-terminal-limit-stop.
describe("manual retry visual-dedup (ChatMessage.retriedFrom)", () => {
  it("flags new user message that duplicates the prior user text after an error", () => {
    let state: SessionState = createInitialState();
    // First user message arrives.
    state = reduceEvent(state, {
      eventType: "message_start",
      timestamp: 1000,
      data: { message: { role: "user", content: "fix the bug" }, entryId: "u1" },
    });
    // agent_end fires with an error.
    state = reduceEvent(state, {
      eventType: "agent_end",
      timestamp: 1100,
      data: {
        messages: [{ role: "assistant", stopReason: "error", errorMessage: "fetch failed" }],
      },
    });
    expect(state.lastError?.message).toBe("fetch failed");

    // Retry button: same text, fresh message_start.
    state = reduceEvent(state, {
      eventType: "message_start",
      timestamp: 2000,
      data: { message: { role: "user", content: "fix the bug" }, entryId: "u2" },
    });
    const lastMsg = state.messages[state.messages.length - 1]!;
    expect(lastMsg.role).toBe("user");
    expect(lastMsg.content).toBe("fix the bug");
    expect(lastMsg.retriedFrom).toBe("u1");
  });

  it("does NOT flag identical re-send when prior turn ended successfully", () => {
    let state: SessionState = createInitialState();
    state = reduceEvent(state, {
      eventType: "message_start",
      timestamp: 1000,
      data: { message: { role: "user", content: "ping" }, entryId: "u1" },
    });
    state = reduceEvent(state, {
      eventType: "agent_end",
      timestamp: 1100,
      data: {
        messages: [{ role: "assistant", stopReason: "end_turn" }],
      },
    });
    // No lastError set, so dedup must not fire.
    state = reduceEvent(state, {
      eventType: "message_start",
      timestamp: 2000,
      data: { message: { role: "user", content: "ping" }, entryId: "u2" },
    });
    const lastMsg = state.messages[state.messages.length - 1]!;
    expect(lastMsg.retriedFrom).toBeUndefined();
  });

  it("does NOT flag when new text differs from prior user text", () => {
    let state: SessionState = createInitialState();
    state = reduceEvent(state, {
      eventType: "message_start",
      timestamp: 1000,
      data: { message: { role: "user", content: "fix bug" }, entryId: "u1" },
    });
    state = reduceEvent(state, {
      eventType: "agent_end",
      timestamp: 1100,
      data: {
        messages: [{ role: "assistant", stopReason: "error", errorMessage: "x" }],
      },
    });
    state = reduceEvent(state, {
      eventType: "message_start",
      timestamp: 2000,
      data: { message: { role: "user", content: "fix the bug" }, entryId: "u2" },
    });
    const lastMsg = state.messages[state.messages.length - 1]!;
    expect(lastMsg.retriedFrom).toBeUndefined();
  });

  it("does not flag the FIRST user message (no prior user to dedup against)", () => {
    let state: SessionState = createInitialState();
    state = reduceEvent(state, {
      eventType: "message_start",
      timestamp: 1000,
      data: { message: { role: "user", content: "hello" }, entryId: "u1" },
    });
    expect(state.messages[0]!.retriedFrom).toBeUndefined();
  });
});
