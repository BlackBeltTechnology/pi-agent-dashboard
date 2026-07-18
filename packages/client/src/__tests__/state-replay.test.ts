import { describe, it, expect } from "vitest";
import { replayEntriesAsEvents } from "@blackbelt-technology/pi-dashboard-shared/state-replay.js";
import { createInitialState, reduceEvent } from "../lib/chat/event-reducer.js";

describe("replayEntriesAsEvents", () => {
  it("should convert user message entry to message_start event", () => {
    const entries = [
      {
        type: "message",
        id: "e1",
        parentId: null,
        timestamp: "2025-01-01T00:00:00Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "Hello world" }],
        },
      },
    ];

    const events = replayEntriesAsEvents("sess-1", entries);
    expect(events).toHaveLength(1);
    expect(events[0].event.eventType).toBe("message_start");
    expect((events[0].event.data as any).message.role).toBe("user");
  });

  it("should convert assistant message entry to message_update + message_end events", () => {
    const entries = [
      {
        type: "message",
        id: "e1",
        parentId: null,
        timestamp: "2025-01-01T00:00:00Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hi there" }],
        },
      },
    ];

    const events = replayEntriesAsEvents("sess-1", entries);
    expect(events).toHaveLength(2);
    expect(events[0].event.eventType).toBe("message_update");
    expect(events[1].event.eventType).toBe("message_end");
  });

  it("should convert assistant tool calls to tool_execution_start events", () => {
    const entries = [
      {
        type: "message",
        id: "e1",
        parentId: null,
        timestamp: "2025-01-01T00:00:00Z",
        message: {
          role: "assistant",
          content: [
            { type: "toolCall", id: "tc-1", name: "bash", arguments: '{"command":"ls"}' },
            { type: "text", text: "Let me check" },
          ],
        },
      },
    ];

    const events = replayEntriesAsEvents("sess-1", entries);
    // tool_execution_start + message_update + message_end + tool_execution_end (orphaned)
    expect(events).toHaveLength(4);
    expect(events[0].event.eventType).toBe("tool_execution_start");
    expect((events[0].event.data as any).toolName).toBe("bash");
    expect((events[0].event.data as any).args).toEqual({ command: "ls" });
    expect(events[3].event.eventType).toBe("tool_execution_end");
  });

  it("should convert tool result message to tool_execution_end", () => {
    // Real pi structure: toolCallId and toolName at message level
    const entries = [
      {
        type: "message",
        id: "e1",
        parentId: null,
        timestamp: "2025-01-01T00:00:00Z",
        message: {
          role: "toolResult",
          toolCallId: "tc-1",
          toolName: "bash",
          content: [{ type: "text", text: "file1.txt\nfile2.txt" }],
          isError: false,
        },
      },
    ];

    const events = replayEntriesAsEvents("sess-1", entries);
    expect(events).toHaveLength(1);
    expect(events[0].event.eventType).toBe("tool_execution_end");
    expect((events[0].event.data as any).toolCallId).toBe("tc-1");
    expect((events[0].event.data as any).toolName).toBe("bash");
    expect((events[0].event.data as any).result).toBe("file1.txt\nfile2.txt");
    expect((events[0].event.data as any).isError).toBe(false);
  });

  it("should return empty array for empty entries", () => {
    expect(replayEntriesAsEvents("sess-1", [])).toEqual([]);
  });

  it("should skip unknown entry types", () => {
    const entries = [
      { type: "custom", id: "e1", customType: "foo", data: {} },
      { type: "compaction", id: "e2", summary: "..." },
    ];
    expect(replayEntriesAsEvents("sess-1", entries)).toEqual([]);
  });

  it("should generate stats_update event from assistant message with usage data", () => {
    const entries = [
      {
        type: "message",
        id: "e1",
        parentId: null,
        timestamp: "2025-01-01T00:00:00Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello" }],
          usage: {
            input: 100,
            output: 50,
            cacheRead: 80,
            cacheWrite: 20,
            cost: { total: 0.005 },
          },
        },
      },
    ];

    const events = replayEntriesAsEvents("sess-1", entries);
    // message_update + message_end + stats_update
    expect(events).toHaveLength(3);
    expect(events[2].event.eventType).toBe("stats_update");
    const data = events[2].event.data as any;
    expect(data.tokensIn).toBe(100);
    expect(data.tokensOut).toBe(50);
    expect(data.cost).toBe(0.005);
    expect(data.turnUsage).toEqual({
      input: 100,
      output: 50,
      cacheRead: 80,
      cacheWrite: 20,
    });
  });

  it("should use knownContextWindow over inferred value when provided", () => {
    // Regression: pi's JSONL has no contextUsage events, so replay falls
    // back to inferContextWindow(modelId) which pins Claude to 200k. When
    // the caller knows the real value (e.g. server has it persisted in
    // .meta.json from a live turn_end), it must override the heuristic.
    const entries = [
      { type: "model_change", modelId: "claude-sonnet-4-20250514", timestamp: "2025-01-01T00:00:00Z" },
      {
        type: "message",
        id: "e1",
        timestamp: "2025-01-01T00:00:00Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hi" }],
          usage: { input: 1, output: 1, totalTokens: 500_000 },
        },
      },
    ];

    const events = replayEntriesAsEvents("sess-1", entries, 1_000_000);
    const stats = events.find((e) => e.event.eventType === "stats_update");
    expect(stats).toBeDefined();
    const data = stats!.event.data as any;
    expect(data.contextUsage.contextWindow).toBe(1_000_000);
  });

  it("should fall back to inferred contextWindow when knownContextWindow is undefined", () => {
    const entries = [
      { type: "model_change", modelId: "claude-sonnet-4-20250514", timestamp: "2025-01-01T00:00:00Z" },
      {
        type: "message",
        id: "e1",
        timestamp: "2025-01-01T00:00:00Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "hi" }],
          usage: { input: 1, output: 1, totalTokens: 100 },
        },
      },
    ];

    const events = replayEntriesAsEvents("sess-1", entries);
    const stats = events.find((e) => e.event.eventType === "stats_update");
    const data = stats!.event.data as any;
    expect(data.contextUsage.contextWindow).toBe(200_000); // legacy heuristic
  });

  it("should not generate stats_update when assistant message has no usage", () => {
    const entries = [
      {
        type: "message",
        id: "e1",
        parentId: null,
        timestamp: "2025-01-01T00:00:00Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello" }],
        },
      },
    ];

    const events = replayEntriesAsEvents("sess-1", entries);
    // Only message_update + message_end, no stats_update
    expect(events).toHaveLength(2);
    expect(events.every(e => e.event.eventType !== "stats_update")).toBe(true);
  });

  it("should emit tool_execution_end for orphaned tool calls (killed mid-execution)", () => {
    const entries = [
      {
        type: "message", id: "e1", parentId: null,
        timestamp: "2025-01-01T00:00:00Z",
        message: { role: "user", content: [{ type: "text", text: "Run something" }] },
      },
      {
        type: "message", id: "e2", parentId: "e1",
        timestamp: "2025-01-01T00:00:01Z",
        message: {
          role: "assistant",
          content: [
            { type: "toolCall", id: "tc-1", name: "bash", arguments: '{"command":"sleep 100"}' },
          ],
        },
      },
      // No toolResult — agent was killed mid-execution
    ];

    const events = replayEntriesAsEvents("sess-1", entries);
    const types = events.map((e) => e.event.eventType);
    // Should auto-close the orphaned tool call
    expect(types).toContain("tool_execution_end");
    const endEvent = events.find(e => e.event.eventType === "tool_execution_end");
    expect((endEvent!.event.data as any).toolCallId).toBe("tc-1");
    expect((endEvent!.event.data as any).toolName).toBe("bash");
  });

  it("should handle a full conversation sequence", () => {
    const entries = [
      {
        type: "message", id: "e1", parentId: null,
        timestamp: "2025-01-01T00:00:00Z",
        message: { role: "user", content: [{ type: "text", text: "List files" }] },
      },
      {
        type: "message", id: "e2", parentId: "e1",
        timestamp: "2025-01-01T00:00:01Z",
        message: {
          role: "assistant",
          content: [
            { type: "toolCall", id: "tc-1", name: "bash", arguments: '{"command":"ls"}' },
            { type: "text", text: "Running ls" },
          ],
        },
      },
      {
        type: "message", id: "e3", parentId: "e2",
        timestamp: "2025-01-01T00:00:02Z",
        message: {
          role: "toolResult",
          toolCallId: "tc-1",
          toolName: "bash",
          content: [{ type: "text", text: "a.txt" }],
          isError: false,
        },
      },
      {
        type: "message", id: "e4", parentId: "e3",
        timestamp: "2025-01-01T00:00:03Z",
        message: { role: "assistant", content: [{ type: "text", text: "Found a.txt" }] },
      },
    ];

    const events = replayEntriesAsEvents("sess-1", entries);
    const types = events.map((e) => e.event.eventType);
    expect(types).toEqual([
      "message_start",        // user message
      "tool_execution_start", // tool call from assistant
      "message_update",       // assistant message (streaming)
      "message_end",          // assistant message (finalize)
      "tool_execution_end",   // tool result
      "message_update",       // final assistant message (streaming)
      "message_end",          // final assistant message (finalize)
    ]);
  });

  it("should include entryId in message_start event for user messages", () => {
    const entries = [
      {
        type: "message",
        id: "user-entry-abc",
        parentId: null,
        timestamp: "2025-01-01T00:00:00Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "Hello" }],
        },
      },
    ];

    const events = replayEntriesAsEvents("sess-1", entries);
    expect(events).toHaveLength(1);
    expect(events[0].event.eventType).toBe("message_start");
    expect((events[0].event.data as any).entryId).toBe("user-entry-abc");
  });

  it("should include entryId in message_end event for assistant messages", () => {
    const entries = [
      {
        type: "message",
        id: "assistant-entry-def",
        parentId: null,
        timestamp: "2025-01-01T00:00:00Z",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hi there" }],
        },
      },
    ];

    const events = replayEntriesAsEvents("sess-1", entries);
    const endEvent = events.find(e => e.event.eventType === "message_end");
    expect(endEvent).toBeDefined();
    expect((endEvent!.event.data as any).entryId).toBe("assistant-entry-def");
  });

  it("should extract image blocks from toolResult into images field", () => {
    const entries = [
      {
        type: "message",
        id: "e1",
        parentId: null,
        timestamp: "2025-01-01T00:00:00Z",
        message: {
          role: "toolResult",
          toolCallId: "tc-1",
          toolName: "read",
          content: [
            { type: "text", text: "Read image file [image/png]" },
            { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" },
          ],
          isError: false,
        },
      },
    ];

    const events = replayEntriesAsEvents("sess-1", entries);
    expect(events).toHaveLength(1);
    const data = events[0].event.data as any;
    expect(data.result).toBe("Read image file [image/png]");
    expect(data.images).toEqual([{ data: "iVBORw0KGgo=", mimeType: "image/png" }]);
  });

  it("should not include images field for text-only toolResult", () => {
    const entries = [
      {
        type: "message",
        id: "e1",
        parentId: null,
        timestamp: "2025-01-01T00:00:00Z",
        message: {
          role: "toolResult",
          toolCallId: "tc-1",
          toolName: "read",
          content: [{ type: "text", text: "file contents here" }],
          isError: false,
        },
      },
    ];

    const events = replayEntriesAsEvents("sess-1", entries);
    const data = events[0].event.data as any;
    expect(data.result).toBe("file contents here");
    expect(data.images).toBeUndefined();
  });

  it("should extract multiple image blocks from toolResult", () => {
    const entries = [
      {
        type: "message",
        id: "e1",
        parentId: null,
        timestamp: "2025-01-01T00:00:00Z",
        message: {
          role: "toolResult",
          toolCallId: "tc-1",
          toolName: "read",
          content: [
            { type: "text", text: "Read image file" },
            { type: "image", data: "abc123", mimeType: "image/png" },
            { type: "image", data: "def456", mimeType: "image/jpeg" },
          ],
          isError: false,
        },
      },
    ];

    const events = replayEntriesAsEvents("sess-1", entries);
    const data = events[0].event.data as any;
    expect(data.images).toEqual([
      { data: "abc123", mimeType: "image/png" },
      { data: "def456", mimeType: "image/jpeg" },
    ]);
  });

  it("should replay Agent tool call with args and details", () => {
    const entries = [
      {
        type: "message",
        id: "e1",
        parentId: null,
        timestamp: "2025-01-01T00:00:00Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "tc-agent-1",
              name: "Agent",
              arguments: { prompt: "List files", subagent_type: "Explore", description: "File listing" },
            },
          ],
        },
      },
      {
        type: "message",
        id: "e2",
        parentId: "e1",
        timestamp: "2025-01-01T00:00:06Z",
        message: {
          role: "toolResult",
          toolCallId: "tc-agent-1",
          toolName: "Agent",
          content: [{ type: "text", text: "Found 10 files" }],
          isError: false,
          details: {
            displayName: "Explore",
            description: "File listing",
            subagentType: "Explore",
            status: "completed",
            toolUses: 1,
            durationMs: 6000,
            tokens: "25k token",
          },
        },
      },
    ];

    const events = replayEntriesAsEvents("sess-1", entries);

    // Should have: tool_execution_start, message_update, message_end, tool_execution_end
    const startEvent = events.find(e => e.event.eventType === "tool_execution_start");
    const endEvent = events.find(e => e.event.eventType === "tool_execution_end");

    expect(startEvent).toBeDefined();
    expect(endEvent).toBeDefined();

    // Start should have args
    const startData = startEvent!.event.data as any;
    expect(startData.toolName).toBe("Agent");
    expect(startData.args.subagent_type).toBe("Explore");
    expect(startData.args.prompt).toBe("List files");

    // End should have details
    const endData = endEvent!.event.data as any;
    expect(endData.toolName).toBe("Agent");
    expect(endData.result).toBe("Found 10 files");
    expect(endData.details).toBeDefined();
    expect(endData.details.status).toBe("completed");
    expect(endData.details.displayName).toBe("Explore");
    expect(endData.details.durationMs).toBe(6000);
  });

  it("should produce correct Agent card state through full replay → reduce pipeline", () => {
    const entries = [
      {
        type: "message",
        id: "e1",
        parentId: null,
        timestamp: "2025-01-01T00:00:00Z",
        message: {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "tc-agent-1",
              name: "Agent",
              arguments: { prompt: "Explore codebase", subagent_type: "Explore", description: "Codebase scan" },
            },
          ],
        },
      },
      {
        type: "message",
        id: "e2",
        parentId: "e1",
        timestamp: "2025-01-01T00:00:06Z",
        message: {
          role: "toolResult",
          toolCallId: "tc-agent-1",
          toolName: "Agent",
          content: [{ type: "text", text: "Found 5 relevant files" }],
          isError: false,
          details: {
            displayName: "Explore",
            description: "Codebase scan",
            subagentType: "Explore",
            status: "completed",
            toolUses: 3,
            durationMs: 6000,
            modelName: "haiku 4.5",
            tokens: "25k token",
          },
        },
      },
    ];

    const events = replayEntriesAsEvents("sess-1", entries);
    const state = events.reduce(
      (s, msg) => reduceEvent(s, msg.event),
      createInitialState(),
    );

    // Find the Agent tool message
    const agentMsg = state.messages.find(m => m.toolName === "Agent");
    expect(agentMsg).toBeDefined();
    expect(agentMsg!.toolStatus).toBe("complete");
    expect(agentMsg!.result).toBe("Found 5 relevant files");
    expect(agentMsg!.args?.subagent_type).toBe("Explore");

    // toolDetails should have the completed status from details
    expect(agentMsg!.toolDetails).toBeDefined();
    expect(agentMsg!.toolDetails!.status).toBe("completed");
    expect(agentMsg!.toolDetails!.displayName).toBe("Explore");
    expect(agentMsg!.toolDetails!.durationMs).toBe(6000);
    expect(agentMsg!.toolDetails!.toolUses).toBe(3);
  });
});
