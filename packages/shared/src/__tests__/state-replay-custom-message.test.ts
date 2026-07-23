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
