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

describe("replayEntriesAsEvents — ib-greeting singleton (change: replace-replayed-greeting)", () => {
  function greetingEvents(events: ReturnType<typeof replayEntriesAsEvents>) {
    return events.filter((e) => (e.event.data as any).message?.customType === "ib-greeting");
  }

  it("T1: three historical greetings replay as exactly one latest greeting", () => {
    const events = replayEntriesAsEvents("sess-1", [
      greetingEntry("g1", "A"),
      greetingEntry("g2", "B"),
      greetingEntry("g3", "C"),
    ]);
    const ge = greetingEvents(events);
    expect(ge.map((e) => e.event.eventType)).toEqual(["message_start", "message_end"]);
    for (const e of ge) {
      expect((e.event.data as any).message.content).toBe("C");
      expect((e.event.data as any).message.customType).toBe("ib-greeting");
      expect((e.event.data as any).entryId).toBe("g3");
    }
  });

  it("T2: unrelated custom messages replay unchanged alongside a collapsed greeting", () => {
    const events = replayEntriesAsEvents("sess-1", [
      greetingEntry("g1", "A"),
      customMessageEntry("c1", "note-one", true),
      greetingEntry("g2", "B"),
    ]);
    const ge = greetingEvents(events);
    expect(ge).toHaveLength(2); // one start + one end
    expect((ge[0].event.data as any).message.content).toBe("B");

    const noteEvents = events.filter((e) => (e.event.data as any).message?.customType === "x-note");
    expect(noteEvents).toHaveLength(2); // its own start + end, unchanged
    for (const e of noteEvents) {
      expect((e.event.data as any).message.content).toBe("note-one");
      expect((e.event.data as any).entryId).toBe("c1");
    }
  });

  it("T2b: the single greeting occupies the first greeting's slot (opener, not tail)", () => {
    const events = replayEntriesAsEvents("sess-1", [
      greetingEntry("g1", "A"),
      customMessageEntry("c1", "note-one", true),
      greetingEntry("g2", "B"),
    ]);
    // The greeting pair must precede the x-note pair (first greeting was first).
    const idxGreeting = events.findIndex((e) => (e.event.data as any).message?.customType === "ib-greeting");
    const idxNote = events.findIndex((e) => (e.event.data as any).message?.customType === "x-note");
    expect(idxGreeting).toBeGreaterThanOrEqual(0);
    expect(idxNote).toBeGreaterThan(idxGreeting);
  });

  it("T3: no greeting leaves replay unchanged (no singleton handling)", () => {
    const events = replayEntriesAsEvents("sess-1", [
      customMessageEntry("c1", "note-one", true),
      customMessageEntry("c2", "note-two", true),
    ]);
    const noteEvents = events.filter((e) => (e.event.data as any).message?.customType === "x-note");
    expect(noteEvents).toHaveLength(4); // two entries × (start + end)
    expect(greetingEvents(events)).toHaveLength(0);
  });

  it("T4: a hidden greeting (display:false) is never emitted", () => {
    const hidden = { ...greetingEntry("g1", "A"), display: false };
    const events = replayEntriesAsEvents("sess-1", [hidden]);
    expect(greetingEvents(events)).toHaveLength(0);
    expect(events).toHaveLength(0);
  });
});
