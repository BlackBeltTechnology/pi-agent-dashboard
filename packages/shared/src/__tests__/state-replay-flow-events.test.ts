/**
 * Replay of plugin-declared persisted entries (change: replay-persisted-flow-runs;
 * generalised by update-flows-plugin D3). A plugin manifest declares
 * `replayEntryTypes`; core replays each record `{ seq, eventType, data, ...extra }`
 * as an event_forward carrying eventType + data verbatim, ordered by seq, and keeps
 * declared types out of the generic custom paths. Core names no entry type, so the
 * declared set is a parameter here (test-plan E10–E14, X8).
 */
import { describe, it, expect } from "vitest";
import { replayEntriesAsEvents } from "../state-replay.js";

const TS = "2026-04-27T07:26:25.000Z";
const FLOWS = { replayEntryTypes: ["flow-event"] };

function declaredEntry(
  customType: string,
  id: string,
  seq: number,
  eventType: unknown,
  data: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  return { type: "custom", customType, id, parentId: "root", timestamp: TS, data: { seq, eventType, data, ...extra } };
}

function flowEventEntry(id: string, seq: number, eventType: string, data: Record<string, unknown>, flowRunId = "run-1") {
  return declaredEntry("flow-event", id, seq, eventType, data, { flowRunId });
}

const userMsg = { type: "message", id: "u1", timestamp: TS, message: { role: "user", content: [{ type: "text", text: "go" }] } };
const asstMsg = { type: "message", id: "a1", parentId: "u1", timestamp: TS, message: { role: "assistant", content: [{ type: "text", text: "hi" }] } };

describe("replayEntriesAsEvents — declared plugin entries", () => {
  it("replays a declared fixture type seq-ordered; an undeclared type emits nothing (E10)", () => {
    const entries = [
      declaredEntry("demo-event", "d2", 2, "flow_tool_call", { toolName: "read" }),
      declaredEntry("demo-event", "d0", 0, "flow_started", { flowName: "demo" }),
      declaredEntry("demo-event", "d1", 1, "flow_agent_started", { stepId: "s" }),
      declaredEntry("other-event", "o0", 0, "flow_complete", {}),
    ];
    const stats = { pluginEntriesReplayed: 0 };
    const events = replayEntriesAsEvents("sess-1", entries, undefined, { replayEntryTypes: ["demo-event"], stats });
    const fwd = events.filter((e) => e.event.eventType !== "custom_entry");
    expect(fwd.map((e) => e.event.eventType)).toEqual(["flow_started", "flow_agent_started", "flow_tool_call"]);
    expect(fwd.map((e) => e.event.data)).toEqual([
      { type: "flow_started", flowName: "demo" },
      { type: "flow_agent_started", stepId: "s" },
      { type: "flow_tool_call", toolName: "read" },
    ]);
    expect(stats.pluginEntriesReplayed).toBe(3);
    // The undeclared type takes the generic custom path, never a protocol replay.
    expect(events.filter((e) => e.event.eventType === "flow_complete")).toHaveLength(0);
  });

  it("skips malformed records without throwing (E11)", () => {
    const entries = [
      { type: "custom", customType: "demo-event", id: "b0", timestamp: TS, data: { seq: 0, data: {} } },
      declaredEntry("demo-event", "b1", 1, 42, {}),
      declaredEntry("demo-event", "b2", 2, null, {}),
      declaredEntry("demo-event", "ok", 3, "flow_complete", {}),
    ];
    let events: ReturnType<typeof replayEntriesAsEvents> = [];
    expect(() => {
      events = replayEntriesAsEvents("sess-1", entries, undefined, { replayEntryTypes: ["demo-event"] });
    }).not.toThrow();
    expect(events.map((e) => e.event.eventType)).toEqual(["flow_complete"]);
  });

  it("ignores extra record fields such as flowRunId (E12)", () => {
    const events = replayEntriesAsEvents(
      "sess-1",
      [flowEventEntry("f0", 0, "flow_started", { flowName: "research" })],
      undefined,
      FLOWS,
    );
    expect(events).toHaveLength(1);
    expect(events[0].event.eventType).toBe("flow_started");
    expect(events[0].event.data).toEqual({ type: "flow_started", flowName: "research" });
    expect(JSON.stringify(events)).not.toContain("flowRunId");
  });

  it("excludes declared types from the generic paths; other output unchanged (E13)", () => {
    const base = [
      userMsg,
      { type: "model_change", id: "m1", timestamp: TS, provider: "anthropic", modelId: "claude" },
      asstMsg,
      { type: "custom_message", id: "cm", timestamp: TS, customType: "my-ext:note", content: "hi" },
      { type: "custom", customType: "e2e:note", id: "n1", timestamp: TS, data: { x: 1 } },
    ];
    const withFlow = [...base.slice(0, 2), flowEventEntry("f0", 0, "flow_started", { flowName: "d" }), ...base.slice(2)];
    const strip = (evs: ReturnType<typeof replayEntriesAsEvents>) =>
      evs.filter((e) => !e.event.eventType.startsWith("flow_")).map((e) => ({ t: e.event.eventType, d: e.event.data }));
    const without = replayEntriesAsEvents("sess-1", base, undefined, FLOWS);
    const withEvents = replayEntriesAsEvents("sess-1", withFlow, undefined, FLOWS);
    expect(strip(withEvents)).toEqual(strip(without));
    expect(
      withEvents.filter((e) => e.event.eventType === "custom_entry" && (e.event.data as any).customType === "flow-event"),
    ).toHaveLength(0);
    expect(withEvents.filter((e) => e.event.eventType === "flow_started")).toHaveLength(1);
    // A declared custom_message is also kept off the generic row path.
    const msgEvents = replayEntriesAsEvents(
      "sess-1",
      [{ type: "custom_message", id: "x", timestamp: TS, customType: "flow-event", content: "spoof" }],
      undefined,
      FLOWS,
    );
    expect(msgEvents).toHaveLength(0);
  });

  it("hides a disabled plugin's entries: nothing replayed, no custom_entry (E14, G5)", () => {
    const entries = [
      userMsg,
      flowEventEntry("f0", 0, "flow_started", { flowName: "d" }),
      flowEventEntry("f1", 1, "flow_agent_started", { stepId: "s" }),
      flowEventEntry("f2", 2, "flow_complete", {}),
    ];
    const events = replayEntriesAsEvents("sess-1", entries, undefined, { replayEntryTypes: [], hiddenEntryTypes: ["flow-event"] });
    expect(events.filter((e) => e.event.eventType.startsWith("flow_"))).toHaveLength(0);
    expect(events.filter((e) => e.event.eventType === "custom_entry")).toHaveLength(0);
    expect(events.map((e) => e.event.eventType)).toEqual(
      replayEntriesAsEvents("sess-1", [userMsg]).map((e) => e.event.eventType),
    );
  });

  it("replays nothing for a flow-first session not yet flushed (X8, KNOWN BLOCKER)", () => {
    const entries = [userMsg, asstMsg];
    let events: ReturnType<typeof replayEntriesAsEvents> = [];
    expect(() => {
      events = replayEntriesAsEvents("sess-1", entries, undefined, FLOWS);
    }).not.toThrow();
    expect(events.filter((e) => e.event.eventType.startsWith("flow_"))).toHaveLength(0);
    expect(events.map((e) => e.event.eventType)).toEqual(
      replayEntriesAsEvents("sess-1", entries).map((e) => e.event.eventType),
    );
  });

  it("without a declared set a plugin entry is a generic custom entry (core names no type)", () => {
    const events = replayEntriesAsEvents("sess-1", [flowEventEntry("f0", 0, "flow_started", {})]);
    expect(events.map((e) => e.event.eventType)).toEqual(["custom_entry"]);
  });
});

// ── custom entries + custom messages (render-inline-reasoning-and-custom-entries, E6) ──
describe("replayEntriesAsEvents — custom entries + custom messages (E6)", () => {
  const BASE = { id: "c1", parentId: "root", timestamp: "2026-04-27T07:26:25.000Z" };

  it("synthesizes message_end role=custom for a display:true custom_message entry", () => {
    const events = replayEntriesAsEvents("sess-1", [
      { ...BASE, type: "custom_message", customType: "my-ext:note", content: "hello", display: true },
    ]);
    const ends = events.filter((e) => e.event.eventType === "message_end");
    expect(ends).toHaveLength(1);
    const msg = (ends[0].event.data as any).message;
    expect(msg.role).toBe("custom");
    expect(msg.customType).toBe("my-ext:note");
    expect(msg.content).toBe("hello");
    expect((ends[0].event.data as any).entryId).toBe("c1");
  });

  it("emits NO event for a display:false custom_message (exact === false check)", () => {
    const events = replayEntriesAsEvents("sess-1", [
      { ...BASE, type: "custom_message", customType: "my-ext:note", content: "llm-only", display: false },
    ]);
    expect(events).toHaveLength(0);
  });

  it("synthesizes the event when display is ABSENT (absent flag is not false)", () => {
    const events = replayEntriesAsEvents("sess-1", [
      { ...BASE, type: "custom_message", customType: "my-ext:note", content: "untyped" },
    ]);
    expect(events.filter((e) => e.event.eventType === "message_end")).toHaveLength(1);
  });

  it("synthesizes custom_entry {customType, data, entryId} for a generic type:custom entry", () => {
    const events = replayEntriesAsEvents("sess-1", [
      { ...BASE, type: "custom", customType: "my-ext:state", data: { branch: "main" } },
    ]);
    const entries = events.filter((e) => e.event.eventType === "custom_entry");
    expect(entries).toHaveLength(1);
    expect(entries[0].event.data).toEqual({
      type: "custom_entry",
      customType: "my-ext:state",
      data: { branch: "main" },
      entryId: "c1",
    });
  });

  it("keeps a declared type on its seq-sorted path and emits NO custom_entry for it", () => {
    const events = replayEntriesAsEvents("sess-1", [
      flowEventEntry("f0", 0, "flow_started", { flowName: "demo" }),
    ], undefined, FLOWS);
    expect(events.filter((e) => e.event.eventType === "custom_entry")).toHaveLength(0);
    expect(events.filter((e) => e.event.eventType === "flow_started")).toHaveLength(1);
  });
});
