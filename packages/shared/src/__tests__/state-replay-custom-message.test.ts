/**
 * Replay of persisted display-flagged custom messages (generic capability, no
 * product vocabulary). A CustomMessageEntry (type:"custom_message") whose
 * `display` is not exactly `false` replays as the same `message_end` the live
 * path forwards, so the reducer rebuilds one assistant-side row keyed by its
 * entryId. A `display:false` entry is context-only and replays to nothing.
 * Several such entries replay in persisted (chronological) order, which is what
 * lets a reset-and-rebuild replay reproduce emission order.
 * See change: merge-dashboard-develop.
 */
import { describe, expect, it } from "vitest";
import { replayEntriesAsEvents } from "../state-replay.js";

function customMessageEntry(
  id: string,
  content: unknown,
  display: boolean | undefined,
  ts = "2026-04-27T07:26:25.000Z",
  customType = "x-note",
) {
  return { type: "custom_message", id, parentId: "root", timestamp: ts, customType, content, display };
}

function messageEnds(events: ReturnType<typeof replayEntriesAsEvents>) {
  return events.filter((e) => e.event.eventType === "message_end");
}

describe("replayEntriesAsEvents — persisted custom messages", () => {
  it("T1: a display:true custom_message replays to one message_end carrying its entryId", () => {
    const events = replayEntriesAsEvents("sess-1", [customMessageEntry("c1", "hello", true)]);
    const ends = messageEnds(events);
    expect(ends).toHaveLength(1);
    const m = (ends[0].event.data as any).message;
    expect(m.role).toBe("custom");
    expect(m.customType).toBe("x-note");
    expect(m.display).toBe(true);
    expect(m.content).toBe("hello");
    expect((ends[0].event.data as any).entryId).toBe("c1");
  });

  it("T2: a display:false custom_message replays to nothing", () => {
    const events = replayEntriesAsEvents("sess-1", [customMessageEntry("c1", "secret", false)]);
    expect(events).toHaveLength(0);
  });

  it("T3: an ABSENT display flag still renders (only an exact false hides)", () => {
    const events = replayEntriesAsEvents("sess-1", [customMessageEntry("c1", "shown", undefined)]);
    expect(messageEnds(events)).toHaveLength(1);
  });

  it("T4: a flow-event custom_message is never claimed by this arm", () => {
    const events = replayEntriesAsEvents("sess-1", [
      customMessageEntry("c1", "x", true, "2026-04-27T07:26:25.000Z", "flow-event"),
    ]);
    expect(messageEnds(events)).toHaveLength(0);
  });

  it("T5: three persisted display messages replay in chronological (A,B,C) order", () => {
    const events = replayEntriesAsEvents("sess-1", [
      customMessageEntry("c1", "A", true, "2026-04-27T07:26:25.000Z"),
      customMessageEntry("c2", "B", true, "2026-04-27T07:26:26.000Z"),
      customMessageEntry("c3", "C", true, "2026-04-27T07:26:27.000Z"),
    ]);
    expect(
      messageEnds(events).map((e) => ({
        content: (e.event.data as any).message.content,
        entryId: (e.event.data as any).entryId,
      })),
    ).toEqual([
      { content: "A", entryId: "c1" },
      { content: "B", entryId: "c2" },
      { content: "C", entryId: "c3" },
    ]);
  });

  it("T6: a display message WITH details replays carrying them intact", () => {
    const entry = { ...customMessageEntry("c1", "A", true), details: { kind: "note", glyph: "clock" } };
    const events = replayEntriesAsEvents("sess-1", [entry]);
    const ends = messageEnds(events);
    expect(ends).toHaveLength(1);
    expect((ends[0].event.data as any).message.details).toEqual({ kind: "note", glyph: "clock" });
  });

  it("T7: a non-flow-event type:'custom' entry replays as a custom_entry, not a message", () => {
    const events = replayEntriesAsEvents("sess-1", [
      { type: "custom", customType: "some-extension-state", id: "x1", parentId: "root", timestamp: "2026-04-27T07:26:25.000Z", data: { count: 3 } },
    ]);
    expect(messageEnds(events)).toHaveLength(0);
    expect(events.map((e) => e.event.eventType)).toEqual(["custom_entry"]);
  });
});
