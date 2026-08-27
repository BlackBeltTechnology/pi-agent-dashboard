/**
 * Change: greet-as-assistant-message
 *
 * Replay of persisted display-flagged custom messages. A CustomMessageEntry
 * (type:"custom_message") with display:true replays as a message_start +
 * message_end pair so the reducer rebuilds one assistant-side row. A
 * display:false entry replays to nothing. type:"custom" (CustomEntry) that is
 * not a flow-event stays ignored.
 */
import { describe, it, expect } from "vitest";
import { replayEntriesAsEvents } from "../state-replay.js";

function customMessageEntry(id: string, content: unknown, display: boolean) {
  return {
    type: "custom_message",
    id,
    parentId: "root",
    timestamp: "2026-04-27T07:26:25.000Z",
    customType: "x-note",
    content,
    display,
  };
}

/** A persisted ib-greeting custom_message (change: replace-replayed-greeting). */
function greetingEntry(id: string, content: unknown, ts = "2026-04-27T07:26:25.000Z") {
  return {
    type: "custom_message",
    id,
    parentId: "root",
    timestamp: ts,
    customType: "ib-greeting",
    content,
    display: true,
  };
}

describe("replayEntriesAsEvents — persisted custom messages", () => {
  it("T5a: a display:true custom_message replays to a message_start + message_end pair", () => {
    const events = replayEntriesAsEvents("sess-1", [customMessageEntry("c1", "hello", true)]);
    const msgEvents = events.filter(
      (e) => e.event.eventType === "message_start" || e.event.eventType === "message_end",
    );
    expect(msgEvents.map((e) => e.event.eventType)).toEqual(["message_start", "message_end"]);
    for (const e of msgEvents) {
      const m = (e.event.data as any).message;
      expect(m.role).toBe("custom");
      expect(m.display).toBe(true);
      expect(m.content).toBe("hello");
      expect((e.event.data as any).entryId).toBe("c1");
    }
  });

  it("T5b: a display:false custom_message replays to nothing", () => {
    const events = replayEntriesAsEvents("sess-1", [customMessageEntry("c1", "secret", false)]);
    expect(events).toHaveLength(0);
  });

  it("T6: a non-flow-event type:'custom' entry still emits no event_forward", () => {
    const entries = [
      { type: "custom", customType: "some-extension-state", id: "x1", parentId: "root", timestamp: "2026-04-27T07:26:25.000Z", data: { count: 3 } },
    ];
    const events = replayEntriesAsEvents("sess-1", entries);
    expect(events).toHaveLength(0);
  });
});

describe("replayEntriesAsEvents — ib-greeting chronological chat history", () => {
  function greetingEvents(events: ReturnType<typeof replayEntriesAsEvents>) {
    return events.filter((e) => (e.event.data as any).message?.customType === "ib-greeting");
  }

  it("T1: three historical greetings replay as three chronological greeting pairs", () => {
    const events = replayEntriesAsEvents("sess-1", [
      greetingEntry("g1", "A"),
      greetingEntry("g2", "B"),
      greetingEntry("g3", "C"),
    ]);
    const ge = greetingEvents(events);
    expect(ge.map((e) => e.event.eventType)).toEqual([
      "message_start", "message_end", "message_start", "message_end", "message_start", "message_end",
    ]);
    expect(ge.filter((e) => e.event.eventType === "message_end").map((e) => ({
      content: (e.event.data as any).message.content,
      entryId: (e.event.data as any).entryId,
    }))).toEqual([
      { content: "A", entryId: "g1" },
      { content: "B", entryId: "g2" },
      { content: "C", entryId: "g3" },
    ]);
  });

  it("T2: unrelated custom messages replay unchanged alongside chronological greetings", () => {
    const events = replayEntriesAsEvents("sess-1", [
      greetingEntry("g1", "A"),
      customMessageEntry("c1", "note-one", true),
      greetingEntry("g2", "B"),
    ]);
    expect(events.filter((e) => e.event.eventType === "message_end").map((e) => ({
      customType: (e.event.data as any).message.customType,
      content: (e.event.data as any).message.content,
      entryId: (e.event.data as any).entryId,
    }))).toEqual([
      { customType: "ib-greeting", content: "A", entryId: "g1" },
      { customType: "x-note", content: "note-one", entryId: "c1" },
      { customType: "ib-greeting", content: "B", entryId: "g2" },
    ]);
  });

  it("T2b: greeting and x-note pairs stay interleaved in JSONL order", () => {
    const events = replayEntriesAsEvents("sess-1", [
      greetingEntry("g1", "A"),
      customMessageEntry("c1", "note-one", true),
      greetingEntry("g2", "B"),
    ]);
    const messageEvents = events.filter((e) => (e.event.data as any).message);
    expect(messageEvents.map((e) => (e.event.data as any).message.customType)).toEqual([
      "ib-greeting", "ib-greeting", "x-note", "x-note", "ib-greeting", "ib-greeting",
    ]);
  });

  it("T3: no greeting leaves replay unchanged", () => {
    const events = replayEntriesAsEvents("sess-1", [
      customMessageEntry("c1", "note-one", true),
      customMessageEntry("c2", "note-two", true),
    ]);
    const noteEvents = events.filter((e) => (e.event.data as any).message?.customType === "x-note");
    expect(noteEvents).toHaveLength(4);
    expect(greetingEvents(events)).toHaveLength(0);
  });

  it("T4: a hidden greeting (display:false) is never emitted", () => {
    const hidden = { ...greetingEntry("g1", "A"), display: false };
    const events = replayEntriesAsEvents("sess-1", [hidden]);
    expect(greetingEvents(events)).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it("T5: a persisted greeting WITH details replays carrying its details intact", () => {
    const withDetails = { ...greetingEntry("g1", "A"), details: { state: "awaiting-approval", glyph: "clock" } };
    const events = replayEntriesAsEvents("sess-1", [withDetails]);
    const ge = greetingEvents(events);
    expect(ge.map((e) => e.event.eventType)).toEqual(["message_start", "message_end"]);
    for (const e of ge) {
      const m = (e.event.data as any).message;
      expect(m.customType).toBe("ib-greeting");
      expect(m.details).toEqual({ state: "awaiting-approval", glyph: "clock" });
    }
  });

  it("T6: a greeting WITHOUT details injects no `details` key", () => {
    const events = replayEntriesAsEvents("sess-1", [greetingEntry("g1", "A")]);
    const ge = greetingEvents(events);
    expect(ge).toHaveLength(2);
    for (const e of ge) {
      const m = (e.event.data as any).message;
      expect("details" in m).toBe(false);
    }
  });
});
