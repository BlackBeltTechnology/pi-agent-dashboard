import { describe, it, expect } from "vitest";
import type {
  ExtensionToServerMessage,
  ServerToExtensionMessage,
} from "../protocol.js";
import type {
  ServerToBrowserMessage,
  BrowserToServerMessage,
} from "../browser-protocol.js";
import type {
  DashboardSession,
  DashboardEvent,
  SessionSource,
  SessionStatus,
  CommandInfo,
  ApiResponse,
  ModelInfo,
} from "../types.js";

describe("Protocol message serialization round-trip", () => {
  it("should serialize/deserialize extension→server messages", () => {
    const messages: ExtensionToServerMessage[] = [
      {
        type: "session_register",
        sessionId: "s1",
        cwd: "/home/user/project",
        source: "tui",
        model: "claude-sonnet-4-20250514",
        thinkingLevel: "medium",
      },
      {
        type: "session_unregister",
        sessionId: "s1",
      },
      {
        type: "session_heartbeat",
        sessionId: "s1",
      },
      {
        type: "event_forward",
        sessionId: "s1",
        event: {
          eventType: "message_update",
          timestamp: Date.now(),
          data: { text: "Hello" },
        },
      },
      {
        type: "commands_list",
        sessionId: "s1",
        commands: [
          { name: "test", description: "Run tests", source: "extension" },
        ],
      },
      {
        type: "extension_ui_request",
        sessionId: "s1",
        requestId: "req-1",
        method: "confirm",
        params: { title: "Allow?", message: "Delete files?" },
      },

    ];

    for (const msg of messages) {
      const json = JSON.stringify(msg);
      const parsed = JSON.parse(json) as ExtensionToServerMessage;
      expect(parsed).toEqual(msg);
      expect(parsed.type).toBe(msg.type);
    }
  });

  it("should serialize/deserialize server→extension messages", () => {
    const messages: ServerToExtensionMessage[] = [
      {
        type: "send_prompt",
        sessionId: "s1",
        text: "Hello agent",
      },
      {
        type: "abort",
        sessionId: "s1",
      },
      {
        type: "request_commands",
        sessionId: "s1",
      },
      {
        type: "request_state_sync",
        sessionId: "s1",
      },
      {
        type: "stop_after_turn",
        sessionId: "s1",
      },
      {
        type: "extension_ui_response",
        sessionId: "s1",
        requestId: "req-1",
        result: { confirmed: true },
      },
      {
        type: "extension_ui_response",
        sessionId: "s1",
        requestId: "req-2",
        cancelled: true,
      },
      // See change: fix-restart-bridge-auto-start-race
      {
        type: "server_restarting",
        reason: "restart",
        quiesceMs: 5000,
      },
      {
        type: "server_restarting",
        reason: "shutdown",
        quiesceMs: 60000,
      },
    ];

    for (const msg of messages) {
      const json = JSON.stringify(msg);
      const parsed = JSON.parse(json) as ServerToExtensionMessage;
      expect(parsed).toEqual(msg);
      expect(parsed.type).toBe(msg.type);
    }
  });

  it("should serialize/deserialize server→browser messages", () => {
    const messages: ServerToBrowserMessage[] = [
      {
        type: "session_added",
        session: {
          id: "s1",
          cwd: "/project",
          source: "tui",
          status: "active",
          model: "claude-sonnet-4-20250514",
          thinkingLevel: "medium",
          startedAt: Date.now(),
        },
      },
      {
        type: "session_updated",
        sessionId: "s1",
        updates: { status: "streaming" },
      },
      {
        type: "session_removed",
        sessionId: "s1",
      },
      {
        type: "event",
        sessionId: "s1",
        seq: 42,
        event: {
          eventType: "message_update",
          timestamp: Date.now(),
          data: { text: "hi" },
        },
      },
      {
        type: "event_replay",
        sessionId: "s1",
        events: [],
        isLast: true,
      },
      {
        type: "commands_list",
        sessionId: "s1",
        commands: [],
      },
      {
        type: "extension_ui_request",
        sessionId: "s1",
        requestId: "req-2",
        method: "notify",
        params: { message: "done", level: "info" },
      },
    ];

    for (const msg of messages) {
      const json = JSON.stringify(msg);
      const parsed = JSON.parse(json) as ServerToBrowserMessage;
      expect(parsed).toEqual(msg);
      expect(parsed.type).toBe(msg.type);
    }
  });

  it("should serialize/deserialize browser→server messages", () => {
    const messages: BrowserToServerMessage[] = [
      {
        type: "subscribe",
        sessionId: "s1",
        lastSeq: 0,
      },
      {
        type: "unsubscribe",
        sessionId: "s1",
      },
      {
        type: "send_prompt",
        sessionId: "s1",
        text: "Hello",
      },
      {
        type: "abort",
        sessionId: "s1",
      },
      {
        type: "stop_after_turn",
        sessionId: "s1",
      },
      {
        type: "request_commands",
        sessionId: "s1",
      },
      {
        type: "fetch_content",
        sessionId: "s1",
        seq: 42,
      },
      {
        type: "extension_ui_response",
        sessionId: "s1",
        requestId: "req-1",
        result: { value: "Option A" },
      },
    ];

    for (const msg of messages) {
      const json = JSON.stringify(msg);
      const parsed = JSON.parse(json) as BrowserToServerMessage;
      expect(parsed).toEqual(msg);
      expect(parsed.type).toBe(msg.type);
    }
  });
});

describe("Shared data model types", () => {
  it("should have correct SessionSource values", () => {
    const sources: SessionSource[] = ["tui", "zed", "tmux", "dashboard", "unknown"];
    expect(sources).toHaveLength(5);
  });

  it("should have correct SessionStatus values", () => {
    const statuses: SessionStatus[] = ["active", "streaming", "ended"];
    expect(statuses).toHaveLength(3);
  });

  it("ModelInfo carries supportedThinkingLevels through a JSON round-trip", () => {
    const model: ModelInfo = {
      provider: "anthropic",
      id: "claude",
      supportedThinkingLevels: ["medium", "high"],
    };
    const round = JSON.parse(JSON.stringify(model)) as ModelInfo;
    expect(round.supportedThinkingLevels).toEqual(["medium", "high"]);
    // Optional: absent field survives as undefined.
    const bare: ModelInfo = { provider: "x", id: "y" };
    expect(JSON.parse(JSON.stringify(bare)).supportedThinkingLevels).toBeUndefined();
  });

  it("should construct valid ApiResponse", () => {
    const success: ApiResponse<{ id: string }> = {
      success: true,
      data: { id: "123" },
    };
    const error: ApiResponse = {
      success: false,
      error: "Not found",
    };
    expect(success.success).toBe(true);
    expect(error.success).toBe(false);
  });
});
