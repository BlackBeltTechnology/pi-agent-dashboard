/**
 * Custom-entry + custom-message rows (change:
 * render-inline-reasoning-and-custom-entries).
 *
 * Two ingestion surfaces, ONE row shape (`role: "custom"`):
 * - `message_end` with `message.role === "custom"` (pi.sendMessage)
 * - `custom_entry` protocol event (pi.appendEntry, forwarded by the bridge
 *   or synthesized by state-replay)
 *
 * Covers test-plan E1 (display exclusion), E2 (truncation ceiling),
 * E8 (flow-event defense-in-depth), X1 (non-serializable payload),
 * X2 (content-array edges), X3 (oversized payload) and the D9
 * turn-boundary classification.
 */
import { describe, expect, it } from "vitest";
import { createInitialState, reduceEvent, type SessionState } from "../chat/event-reducer.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";

function applyEvents(events: DashboardEvent[]): SessionState {
  return events.reduce((s, e) => reduceEvent(s, e), createInitialState());
}

function customMessageEnd(overrides: Record<string, unknown> = {}, timestamp = 1): DashboardEvent {
  return {
    eventType: "message_end",
    timestamp,
    data: {
      message: { role: "custom", customType: "my-ext:note", content: "hello", ...overrides },
    },
  };
}

function customEntryEvent(data: unknown, customType = "my-ext:state", timestamp = 2): DashboardEvent {
  return {
    eventType: "custom_entry",
    timestamp,
    data: { customType, data, entryId: "e1" },
  };
}

function customRows(state: SessionState) {
  return state.messages.filter((m) => m.role === "custom");
}

describe("message_end role=custom — display exclusion (E1)", () => {
  it("display:true appends exactly one custom row with customType + body", () => {
    const state = applyEvents([customMessageEnd({ display: true })]);
    const rows = customRows(state);
    expect(rows).toHaveLength(1);
    expect(rows[0].customType).toBe("my-ext:note");
    expect(rows[0].content).toBe("hello");
  });

  it("display:false appends NOTHING (LLM-context-only contract)", () => {
    const state = applyEvents([customMessageEnd({ display: false })]);
    expect(customRows(state)).toHaveLength(0);
  });

  it("display ABSENT renders (exact === false check, never truthiness)", () => {
    // A truthy check would drop untyped extensions that omit the flag.
    const state = applyEvents([customMessageEnd({ display: undefined })]);
    expect(customRows(state)).toHaveLength(1);
  });

  it("does not disturb the assistant message_end arms (no thinking reconstruction, no stamping)", () => {
    const state = applyEvents([customMessageEnd({ content: [{ type: "text", text: "hi" }] })]);
    // The custom branch must not touch streamingText / assistant state.
    expect(state.streamingText).toBe("");
    expect(state.messages).toHaveLength(1);
  });

  it("refuses customType flow-event on the message arm too (label-spoofing parity with E8)", () => {
    const state = applyEvents([customMessageEnd({ customType: "flow-event", display: true })]);
    expect(customRows(state)).toHaveLength(0);
  });

  it("caps a payload of very long lines at the byte ceiling (security advisory #2)", () => {
    const huge = "x".repeat(100_000);
    const state = applyEvents([customMessageEnd({ content: huge })]);
    const row = customRows(state)[0];
    expect(row.content.length).toBeLessThanOrEqual(64_000);
    expect(row.content.endsWith("x")).toBe(true); // tail kept, where signal lives
  });
});

describe("body extraction (D4) + content-array edges (X2)", () => {
  it("joins text parts and notes image parts as [image]", () => {
    const state = applyEvents([
      customMessageEnd({
        content: [
          { type: "text", text: "line one" },
          { type: "image", data: "base64stuff", mimeType: "image/png" },
          { type: "text", text: "line two" },
        ],
        display: true,
      }),
    ]);
    const row = customRows(state)[0];
    expect(row.content).toContain("line one");
    expect(row.content).toContain("[image]");
    expect(row.content).toContain("line two");
    expect(row.content).not.toContain("base64stuff");
  });

  it("image-only content yields a non-empty [image] body without crashing", () => {
    const state = applyEvents([
      customMessageEnd({
        content: [{ type: "image", data: "abc", mimeType: "image/png" }],
        display: true,
      }),
    ]);
    const row = customRows(state)[0];
    expect(row.content.trim()).toBe("[image]");
  });

  it("string content passes through as-is", () => {
    const state = applyEvents([customMessageEnd({ content: "plain" })]);
    expect(customRows(state)[0].content).toBe("plain");
  });
});

describe("custom_entry event — appendEntry surface (D2)", () => {
  it("appends the same row shape: customType label + JSON body + entryId", () => {
    const state = applyEvents([customEntryEvent({ branch: "main", commits: 3 })]);
    const rows = customRows(state);
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("custom");
    expect(rows[0].customType).toBe("my-ext:state");
    expect(rows[0].content).toContain('"branch": "main"');
    expect(rows[0].entryId).toBe("e1");
  });

  it("string data renders as-is; undefined data renders empty without throwing", () => {
    const s1 = applyEvents([customEntryEvent("just a string")]);
    expect(customRows(s1)[0].content).toBe("just a string");
    const s2 = applyEvents([customEntryEvent(undefined)]);
    expect(customRows(s2)).toHaveLength(1);
    expect(customRows(s2)[0].content).toBe("");
  });

  it("ignores customType flow-event (E8 defense-in-depth — pi-flows owns its card)", () => {
    const state = applyEvents([customEntryEvent({ seq: 0 }, "flow-event")]);
    expect(customRows(state)).toHaveLength(0);
  });
});

describe("truncation ceiling at row creation (E2, X3)", () => {
  function lines(n: number): string {
    return Array.from({ length: n }, (_, i) => `L${i + 1}`).join("\n");
  }

  it("200-line payload: no marker", () => {
    const state = applyEvents([customMessageEnd({ content: lines(200) })]);
    const row = customRows(state)[0];
    expect(row.content.startsWith("«")).toBe(false);
    expect(row.content.split("\n")).toHaveLength(200);
  });

  it("201-line payload: «1 earlier lines hidden» + last 200 lines", () => {
    const state = applyEvents([customMessageEnd({ content: lines(201) })]);
    const row = customRows(state)[0];
    const outLines = row.content.split("\n");
    expect(outLines[0]).toBe("«1 earlier lines hidden»");
    expect(outLines).toHaveLength(201); // marker + 200 lines
    expect(outLines[1]).toBe("L2");
    expect(outLines[outLines.length - 1]).toBe("L201");
  });

  it("10,000-line payload truncates to the last-200 form (no unbounded DOM growth)", () => {
    const state = applyEvents([customMessageEnd({ content: lines(10_000) })]);
    const row = customRows(state)[0];
    expect(row.content.split("\n")).toHaveLength(201);
    expect(row.content.endsWith("L10000")).toBe(true);
  });
});

describe("non-serializable payload (X1)", () => {
  it("circular data falls back to String() without throwing", () => {
    const circular: Record<string, unknown> = { name: "a" };
    circular.self = circular;
    const state = applyEvents([customEntryEvent(circular)]);
    const rows = customRows(state);
    expect(rows).toHaveLength(1);
    expect(rows[0].customType).toBe("my-ext:state");
    expect(rows[0].content.length).toBeGreaterThan(0);
  });
});

describe("turn-boundary classification (D9)", () => {
  it("custom is NOT a boundary: it does not block the flushed-assistant-row stamp", () => {
    // Streaming text → tool start flushes it into an unstamped assistant row
    // → a custom row lands between → assistant message_end must still stamp
    // the flushed row. If "custom" were in TURN_BOUNDARY_ROLES the scan would
    // stop at the custom row and the stamp would fail.
    const state = applyEvents([
      {
        eventType: "message_update",
        timestamp: 1,
        data: { message: { role: "assistant", content: [{ type: "text", text: "working" }] } },
      },
      { eventType: "tool_execution_start", timestamp: 2, data: { toolCallId: "t1", toolName: "bash", args: {} } },
      customMessageEnd({}, 3),
      {
        eventType: "message_end",
        timestamp: 4,
        data: { entryId: "a1", message: { role: "assistant", content: [{ type: "text", text: "working" }] } },
      },
    ]);
    const flushed = state.messages.find((m) => m.id === "flush-t1");
    expect(flushed).toBeDefined();
    expect(flushed?.entryId).toBe("a1");
  });
});

describe("replay idempotency", () => {
  it("reducing the same custom sequence twice from initial state produces equal messages[]", () => {
    const events = [
      customMessageEnd({ display: true }),
      customEntryEvent({ a: 1 }),
    ];
    const once = applyEvents(events);
    const twice = applyEvents(events);
    expect(twice.messages).toEqual(once.messages);
  });
});

// ── add-custom-event-group-filters: server-stamped groupId rides the row ──
describe("groupId stamping (task 7.1/7.2, D1)", () => {
  it("custom_entry rows carry the server-stamped groupId", () => {
    const state = applyEvents([
      {
        eventType: "custom_entry",
        timestamp: 3,
        data: { customType: "om.observations.recorded", data: { x: 1 }, entryId: "g1", groupId: "memory" },
      },
    ]);
    const rows = customRows(state);
    expect(rows).toHaveLength(1);
    expect(rows[0].groupId).toBe("memory");
  });

  it("message_end role=custom rows carry the server-stamped groupId", () => {
    const state = applyEvents([
      {
        eventType: "message_end",
        timestamp: 4,
        data: { message: { role: "custom", customType: "om.x", content: "b", display: true, groupId: "memory" } },
      },
    ]);
    const rows = customRows(state);
    expect(rows).toHaveLength(1);
    expect(rows[0].groupId).toBe("memory");
  });

  it("an un-annotated row has NO groupId — the gate treats it as the other catch-all", () => {
    const state = applyEvents([customEntryEvent({ any: true })]);
    const rows = customRows(state);
    expect(rows).toHaveLength(1);
    expect(rows[0].groupId).toBeUndefined();
  });

  it("a non-string groupId is dropped, never stamped", () => {
    const state = applyEvents([
      {
        eventType: "custom_entry",
        timestamp: 5,
        data: { customType: "x.y", data: 1, entryId: "g2", groupId: 42 },
      },
    ]);
    expect(customRows(state)[0].groupId).toBeUndefined();
  });
});
