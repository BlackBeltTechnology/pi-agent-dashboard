import { describe, it, expect } from "vitest";
import { mapEventToProtocol, redactCompactionEntry } from "../event-forwarder.js";

describe("mapEventToProtocol", () => {
  const sessionId = "test-session-1";

  it("should map a message_update event", () => {
    const piEvent = {
      type: "message_update",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Hello world" }],
      },
    };

    const result = mapEventToProtocol(sessionId, piEvent);
    expect(result.type).toBe("event_forward");
    expect(result.sessionId).toBe(sessionId);
    expect(result.event.eventType).toBe("message_update");
    expect(result.event.timestamp).toBeGreaterThan(0);
    expect(result.event.data).toEqual(piEvent);
  });

  it("should map a tool_execution_start event", () => {
    const piEvent = {
      type: "tool_execution_start",
      toolCallId: "tc1",
      toolName: "bash",
      args: { command: "ls -la" },
    };

    const result = mapEventToProtocol(sessionId, piEvent);
    expect(result.event.eventType).toBe("tool_execution_start");
    expect(result.event.data.toolName).toBe("bash");
  });

  it("should map an agent_start event", () => {
    const piEvent = { type: "agent_start" };
    const result = mapEventToProtocol(sessionId, piEvent);
    expect(result.event.eventType).toBe("agent_start");
  });

  it("should map an agent_end event", () => {
    const piEvent = { type: "agent_end", messages: [] };
    const result = mapEventToProtocol(sessionId, piEvent);
    expect(result.event.eventType).toBe("agent_end");
  });

  it("should map a turn_end event", () => {
    const piEvent = {
      type: "turn_end",
      turnIndex: 2,
      message: { role: "assistant", content: [] },
      toolResults: [],
    };
    const result = mapEventToProtocol(sessionId, piEvent);
    expect(result.event.eventType).toBe("turn_end");
  });

  it("should map a session_compact event", () => {
    const piEvent = {
      type: "session_compact",
      compactionEntry: { summary: "compacted" },
      fromExtension: false,
    };
    const result = mapEventToProtocol(sessionId, piEvent);
    expect(result.event.eventType).toBe("session_compact");
  });

  it("should handle unknown event types gracefully", () => {
    const piEvent = { type: "some_future_event", data: 123 };
    const result = mapEventToProtocol(sessionId, piEvent);
    expect(result.event.eventType).toBe("some_future_event");
    expect(result.event.data).toEqual(piEvent);
  });

  it("should map an entry_persisted event (per fix-per-message-fork)", () => {
    const piEvent = {
      type: "entry_persisted",
      entryId: "abc-123",
      nonce: "n-7",
    };
    const result = mapEventToProtocol(sessionId, piEvent);
    expect(result.type).toBe("event_forward");
    expect(result.sessionId).toBe(sessionId);
    expect(result.event.eventType).toBe("entry_persisted");
    expect(result.event.data).toMatchObject({
      type: "entry_persisted",
      entryId: "abc-123",
      nonce: "n-7",
    });
  });

  it("should map a message_end event with nonce (per fix-per-message-fork)", () => {
    const piEvent = {
      type: "message_end",
      message: { role: "assistant", content: "hi", id: "asst-9" },
      entryId: "asst-9",
      nonce: "n-7",
    };
    const result = mapEventToProtocol(sessionId, piEvent);
    expect(result.event.eventType).toBe("message_end");
    expect((result.event.data as any).nonce).toBe("n-7");
    expect((result.event.data as any).entryId).toBe("asst-9");
  });

  it("should strip non-serializable fields", () => {
    const piEvent = {
      type: "test_event",
      signal: new AbortController().signal, // not serializable
      text: "hello",
    };
    const result = mapEventToProtocol(sessionId, piEvent);
    // The signal should be stripped during serialization
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("signal");
    expect(JSON.parse(serialized).event.data.text).toBe("hello");
  });
});

/**
 * `redactCompactionEntry` — the bridge's `session_compact` forwarding policy
 * (applied at the bridge's session_compact handling site, NOT inside the
 * generic `mapEventToProtocol`; design D7).
 *
 * See change: filter-system-role-message-forwarding (D6/D7, E7–E9, X1, X3).
 */
describe("redactCompactionEntry", () => {
  const sessionId = "test-session-1";

  it("E7: strips compactionEntry and leaks neither marker", () => {
    const piEvent: Record<string, unknown> = {
      type: "session_compact",
      reason: "threshold",
      compactionEntry: {
        systemMessage: { sections: { persona: "SYSPROMPT-MARKER" } },
        summary: `${"s".repeat(64 * 1024)}SUMMARY-MARKER`,
      },
    };
    const result = mapEventToProtocol(sessionId, redactCompactionEntry(piEvent));

    expect("compactionEntry" in (result.event.data as Record<string, unknown>)).toBe(false);
    const wire = JSON.stringify(result);
    expect(wire).not.toContain("SYSPROMPT-MARKER");
    expect(wire).not.toContain("SUMMARY-MARKER");
  });

  it("E8: every consumer-visible field survives redaction", () => {
    const piEvent: Record<string, unknown> = {
      type: "session_compact",
      reason: "threshold",
      willRetry: false,
      fromExtension: false,
      compactionEntry: { summary: "gone" },
    };
    const result = mapEventToProtocol(sessionId, redactCompactionEntry(piEvent));
    const data = result.event.data as Record<string, unknown>;

    expect(result.event.eventType).toBe("session_compact");
    expect(data.reason).toBe("threshold");
    expect(data.willRetry).toBe(false);
    expect(data.fromExtension).toBe(false);
  });

  it("E9: an absent compactionEntry is not fabricated", () => {
    const piEvent: Record<string, unknown> = { type: "session_compact", reason: "manual" };
    const redacted = redactCompactionEntry(piEvent);

    expect(redacted).toEqual({ type: "session_compact", reason: "manual" });
    expect("compactionEntry" in redacted).toBe(false);
  });

  it("X1: pi's event object is untouched and the forwarded payload is a distinct object", () => {
    const original: Record<string, unknown> = {
      type: "session_compact",
      compactionEntry: { systemMessage: { sections: {} }, summary: "kept" },
    };
    const redacted = redactCompactionEntry(original);

    expect(redacted).not.toBe(original);
    expect("compactionEntry" in original).toBe(true);
    expect((original.compactionEntry as Record<string, unknown>).summary).toBe("kept");
  });

  it("X3: a malformed compactionEntry (null / string) is dropped without throwing", () => {
    for (const compactionEntry of [null, "not-an-object"]) {
      const piEvent: Record<string, unknown> = { type: "session_compact", compactionEntry };
      let redacted: Record<string, unknown> | undefined;
      expect(() => {
        redacted = redactCompactionEntry(piEvent);
      }).not.toThrow();
      expect("compactionEntry" in (redacted as Record<string, unknown>)).toBe(false);
    }
  });
});
