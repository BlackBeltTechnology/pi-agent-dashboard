import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import {
  createMemoryEventStore,
  exceedsSerializedSize,
} from "../memory-event-store.js";

function makeEvent(type: string = "test"): DashboardEvent {
  return { eventType: type, timestamp: Date.now(), data: {} };
}

describe("memory-event-store", () => {
  const neverPinned = () => false;

  it("inserts and retrieves events", () => {
    const store = createMemoryEventStore(neverPinned);
    const seq1 = store.insertEvent("s1", makeEvent("a"));
    const seq2 = store.insertEvent("s1", makeEvent("b"));
    expect(seq1).toBe(1);
    expect(seq2).toBe(2);

    const events = store.getEvents("s1", 1);
    expect(events).toHaveLength(2);
    expect(events[0].seq).toBe(1);
    expect(events[1].seq).toBe(2);
  });

  it("getEvents with minSeq filters correctly", () => {
    const store = createMemoryEventStore(neverPinned);
    store.insertEvent("s1", makeEvent());
    store.insertEvent("s1", makeEvent());
    store.insertEvent("s1", makeEvent());

    const events = store.getEvents("s1", 2);
    expect(events).toHaveLength(2);
    expect(events[0].seq).toBe(2);
  });

  it("getEvents returns empty for unknown session", () => {
    const store = createMemoryEventStore(neverPinned);
    expect(store.getEvents("unknown", 1)).toEqual([]);
  });

  it("getEvent retrieves single event", () => {
    const store = createMemoryEventStore(neverPinned);
    const evt = makeEvent("special");
    store.insertEvent("s1", evt);
    const result = store.getEvent("s1", 1);
    expect(result?.eventType).toBe("special");
  });

  it("getEvent returns undefined for missing", () => {
    const store = createMemoryEventStore(neverPinned);
    expect(store.getEvent("s1", 1)).toBeUndefined();
  });

  it("deleteEventsForSession clears buffer", () => {
    const store = createMemoryEventStore(neverPinned);
    store.insertEvent("s1", makeEvent());
    store.insertEvent("s1", makeEvent());
    const deleted = store.deleteEventsForSession("s1");
    expect(deleted).toBe(2);
    expect(store.getEvents("s1", 1)).toEqual([]);
    expect(store.hasEvents("s1")).toBe(false);
  });

  it("deleteEventsForSession returns 0 for unknown session", () => {
    const store = createMemoryEventStore(neverPinned);
    expect(store.deleteEventsForSession("unknown")).toBe(0);
  });

  it("hasEvents checks correctly", () => {
    const store = createMemoryEventStore(neverPinned);
    expect(store.hasEvents("s1")).toBe(false);
    store.insertEvent("s1", makeEvent());
    expect(store.hasEvents("s1")).toBe(true);
  });

  it("sessionCount tracks number of sessions", () => {
    const store = createMemoryEventStore(neverPinned);
    expect(store.sessionCount()).toBe(0);
    store.insertEvent("s1", makeEvent());
    store.insertEvent("s2", makeEvent());
    expect(store.sessionCount()).toBe(2);
  });

  it("assigns new seq numbers after deleteEventsForSession", () => {
    const store = createMemoryEventStore(neverPinned);
    store.insertEvent("s1", makeEvent());
    store.insertEvent("s1", makeEvent());
    store.deleteEventsForSession("s1");
    const seq = store.insertEvent("s1", makeEvent());
    expect(seq).toBe(1); // Resets after delete
  });

  describe("LRU eviction", () => {
    it("evicts least-recently-accessed when over limit", () => {
      const store = createMemoryEventStore(neverPinned, 3);
      store.insertEvent("s1", makeEvent());
      store.insertEvent("s2", makeEvent());
      store.insertEvent("s3", makeEvent());
      expect(store.sessionCount()).toBe(3);

      // s4 should cause eviction of s1 (oldest)
      store.insertEvent("s4", makeEvent());
      expect(store.sessionCount()).toBe(3);
      expect(store.hasEvents("s1")).toBe(false);
      expect(store.hasEvents("s4")).toBe(true);
    });

    it("skips pinned sessions during eviction", () => {
      const pinned = new Set(["s1"]);
      const store = createMemoryEventStore((id) => pinned.has(id), 3);
      store.insertEvent("s1", makeEvent());
      store.insertEvent("s2", makeEvent());
      store.insertEvent("s3", makeEvent());

      // s4 should cause eviction of s2 (s1 is pinned)
      store.insertEvent("s4", makeEvent());
      expect(store.hasEvents("s1")).toBe(true); // pinned, not evicted
      expect(store.hasEvents("s2")).toBe(false); // evicted
    });

    it("does not evict when all sessions are pinned", () => {
      const store = createMemoryEventStore(() => true, 2);
      store.insertEvent("s1", makeEvent());
      store.insertEvent("s2", makeEvent());
      store.insertEvent("s3", makeEvent());
      // All pinned — can't evict, so size exceeds limit
      expect(store.sessionCount()).toBe(3);
    });

    it("accessing events updates lastAccess to prevent eviction", async () => {
      const store = createMemoryEventStore(neverPinned, 3);
      store.insertEvent("s1", makeEvent());
      await new Promise((r) => setTimeout(r, 5));
      store.insertEvent("s2", makeEvent());
      await new Promise((r) => setTimeout(r, 5));
      store.insertEvent("s3", makeEvent());

      // Access s1 so it becomes most recent
      await new Promise((r) => setTimeout(r, 5));
      store.getEvents("s1", 1);

      // s4 should evict s2 (least recently accessed), not s1
      store.insertEvent("s4", makeEvent());
      expect(store.hasEvents("s1")).toBe(true);
      expect(store.hasEvents("s2")).toBe(false);
    });
  });

  describe("image data preservation", () => {
    it("preserves base64 image data when sibling mimeType exists", () => {
      // maxStringFieldSize = 100 so normal strings get truncated
      const store = createMemoryEventStore(neverPinned, 100, 5000, 100);
      const longBase64 = "A".repeat(500);
      const event: DashboardEvent = {
        eventType: "message_start",
        timestamp: Date.now(),
        data: {
          message: {
            role: "user",
            content: [
              { type: "image", data: longBase64, mimeType: "image/png" },
            ],
          },
        },
      };
      store.insertEvent("s1", event);
      const stored = store.getEvent("s1", 1);
      const content = (stored as any).data.message.content[0];
      expect(content.data).toBe(longBase64);
      expect(content.data).toHaveLength(500);
    });

    it("still truncates data field without mimeType sibling", () => {
      const store = createMemoryEventStore(neverPinned, 100, 5000, 100);
      const longString = "B".repeat(500);
      const event: DashboardEvent = {
        eventType: "test",
        timestamp: Date.now(),
        data: { payload: { data: longString } },
      };
      store.insertEvent("s1", event);
      const stored = store.getEvent("s1", 1);
      const val = (stored as any).data.payload.data as string;
      expect(val.length).toBeLessThan(500);
      expect(val).toContain("truncated");
    });

    it("skill invocation envelope survives string truncation with closing tag intact", () => {
      // Regression: /skill:<name> expands to a <skill ...>body</skill> envelope
      // whose body routinely exceeds the 4KB string cap. Naive mid-string
      // truncation destroyed the closing </skill> tag, so the client's
      // parseSkillBlock returned null and the message rendered as raw
      // pseudo-HTML (invisible). The truncator must cap the BODY but keep the
      // envelope well-formed. See change: bound-subagent-event-serialization
      // (skill regression fix).
      const store = createMemoryEventStore(neverPinned); // production defaults
      const bigBody = "Diagnose failed CI runs. ".repeat(2000); // ~50KB body
      const envelope = `<skill name="ci-troubleshoot" location="/u/.pi/skills/ci-troubleshoot/SKILL.md">\n${bigBody}\n</skill>\n\nplease check run 42`;
      const event: DashboardEvent = {
        eventType: "message_start",
        timestamp: Date.now(),
        data: { message: { role: "user", content: envelope } },
      };
      store.insertEvent("s1", event);
      const stored = store.getEvent("s1", 1) as any;
      expect(stored.data.__truncated).toBeUndefined();
      const content = stored.data.message.content as string;
      // Envelope must stay parseable: header, closing tag, and args intact.
      expect(content).toMatch(/^<skill name="ci-troubleshoot" location="[^"]+">\n/);
      expect(content).toMatch(/\n<\/skill>\n\nplease check run 42$/);
      // Body must actually be truncated (bounded).
      expect(content.length).toBeLessThan(10_000);
    });

    it("user message with a large pasted image survives the per-event size ceiling", () => {
      // Regression: the per-event total-size ceiling (DEFAULT_MAX_EVENT_DATA_SIZE)
      // counted preserved base64 image bytes, so ANY user message with a pasted
      // image (> 20KB base64) was replaced by the {__truncated} placeholder and
      // vanished from chat. Image blocks are deliberately preserved by the
      // string pass; the size walk must not count their bytes either.
      // See change: bound-subagent-event-serialization (regression fix).
      const store = createMemoryEventStore(neverPinned); // production defaults
      const bigImage = "A".repeat(100_000); // realistic pasted screenshot
      const event: DashboardEvent = {
        eventType: "message_start",
        timestamp: Date.now(),
        data: {
          message: {
            role: "user",
            content: [
              { type: "text", text: "here is the screenshot" },
              { type: "image", data: bigImage, mimeType: "image/png" },
            ],
          },
        },
      };
      store.insertEvent("s1", event);
      const stored = store.getEvent("s1", 1) as any;
      expect(stored.data.__truncated).toBeUndefined();
      expect(stored.data.message.role).toBe("user");
      expect(stored.data.message.content[1].data).toBe(bigImage);
    });

    it("truncates other fields alongside preserved image data", () => {
      const store = createMemoryEventStore(neverPinned, 100, 5000, 100);
      const longBase64 = "C".repeat(500);
      const longThinking = "D".repeat(5000);
      const event: DashboardEvent = {
        eventType: "message_start",
        timestamp: Date.now(),
        data: {
          message: {
            role: "user",
            content: [
              { type: "image", data: longBase64, mimeType: "image/png" },
            ],
          },
          thinking: longThinking,
        },
      };
      store.insertEvent("s1", event);
      const stored = store.getEvent("s1", 1);
      const content = (stored as any).data.message.content[0];
      expect(content.data).toBe(longBase64); // preserved
      const thinking = (stored as any).data.thinking as string;
      expect(thinking).toContain("truncated"); // truncated
      expect(thinking.length).toBeLessThan(longThinking.length); // shorter than original
    });
  });

  describe("getMaxSeq", () => {
    it("returns 0 for unknown session", () => {
      const store = createMemoryEventStore(neverPinned);
      expect(store.getMaxSeq("unknown")).toBe(0);
    });

    it("returns highest seq for session with events", () => {
      const store = createMemoryEventStore(neverPinned);
      store.insertEvent("s1", makeEvent());
      store.insertEvent("s1", makeEvent());
      store.insertEvent("s1", makeEvent());
      expect(store.getMaxSeq("s1")).toBe(3);
    });

    it("returns 0 after deleteEventsForSession", () => {
      const store = createMemoryEventStore(neverPinned);
      store.insertEvent("s1", makeEvent());
      store.insertEvent("s1", makeEvent());
      store.deleteEventsForSession("s1");
      expect(store.getMaxSeq("s1")).toBe(0);
    });

    it("returns correct seq after oldest events trimmed", () => {
      const store = createMemoryEventStore(neverPinned, 100, 3);
      store.insertEvent("s1", makeEvent());
      store.insertEvent("s1", makeEvent());
      store.insertEvent("s1", makeEvent());
      store.insertEvent("s1", makeEvent()); // seq 4, oldest (seq 1) trimmed
      expect(store.getMaxSeq("s1")).toBe(4);
    });
  });

  it("trims oldest events when per-session limit exceeded", () => {
    const store = createMemoryEventStore(neverPinned, 100, 3);
    store.insertEvent("s1", makeEvent("a"));
    store.insertEvent("s1", makeEvent("b"));
    store.insertEvent("s1", makeEvent("c"));
    store.insertEvent("s1", makeEvent("d"));

    const events = store.getEvents("s1", 1);
    expect(events).toHaveLength(3);
    // Oldest event (seq 1) should be trimmed
    expect(events[0].seq).toBe(2);
    expect(events[2].seq).toBe(4);
  });

  // See change: preserve-chat-head-on-event-trim.
  describe("essential chat events survive trimming (subagent flood)", () => {
    it("preserves message_start/message_end and drops oldest non-essential", () => {
      const store = createMemoryEventStore(neverPinned, 100, 3);
      store.insertEvent("s1", makeEvent("message_start")); // seq 1 (chat head)
      store.insertEvent("s1", makeEvent("message_end")); //   seq 2 (chat head)
      store.insertEvent("s1", makeEvent("tool_execution_start")); // seq 3 noise
      store.insertEvent("s1", makeEvent("subagent_started")); //     seq 4 noise

      const events = store.getEvents("s1", 1);
      expect(events).toHaveLength(3);
      // The chat head (seq 1, 2) is retained; the OLDEST non-essential (seq 3)
      // is dropped instead of the beginning of the chat.
      expect(events.map((e) => e.seq)).toEqual([1, 2, 4]);
      expect(events[0].event.eventType).toBe("message_start");
      expect(events[1].event.eventType).toBe("message_end");
    });

    it("drops all noise before touching essentials, then oldest essential under extreme pressure", () => {
      const store = createMemoryEventStore(neverPinned, 100, 3);
      // Interleave 4 chat events with 4 subagent/tool events — 8 total, cap 3.
      store.insertEvent("s1", makeEvent("message_start")); // 1
      store.insertEvent("s1", makeEvent("tool_execution_start")); // 2
      store.insertEvent("s1", makeEvent("subagent_started")); // 3
      store.insertEvent("s1", makeEvent("message_end")); // 4
      store.insertEvent("s1", makeEvent("tool_execution_end")); // 5
      store.insertEvent("s1", makeEvent("message_start")); // 6
      store.insertEvent("s1", makeEvent("subagent_completed")); // 7
      store.insertEvent("s1", makeEvent("message_end")); // 8

      const events = store.getEvents("s1", 1);
      // All 4 noise events are dropped first. Then 4 essentials remain > cap 3,
      // so the memory bound forces dropping the OLDEST essential (seq 1). In
      // practice the cap is 20000, so essentials never reach it and the whole
      // transcript is preserved; this only exercises the pathological fallback.
      expect(events.map((e) => e.event.eventType)).toEqual([
        "message_end",
        "message_start",
        "message_end",
      ]);
      expect(events.map((e) => e.seq)).toEqual([4, 6, 8]);
    });

    it("survives a subagent flood: chat head kept, buffer stays bounded", () => {
      const cap = 500; // slack = floor(500*0.05) = 25
      const store = createMemoryEventStore(neverPinned, 100, cap);
      // Two opening chat events, then a flood of 10k subagent/tool events.
      store.insertEvent("s1", makeEvent("message_start")); // seq 1 (chat head)
      store.insertEvent("s1", makeEvent("message_end")); //   seq 2 (chat head)
      for (let i = 0; i < 10_000; i++) {
        store.insertEvent("s1", makeEvent("tool_execution_start"));
      }

      const events = store.getEvents("s1", 1);
      // Buffer never exceeds cap + slack (hysteresis bound).
      expect(events.length).toBeLessThanOrEqual(cap + 25);
      // The opening chat events (seq 1, 2) are still present — the flood evicted
      // only its own oldest noise, never the chat head.
      expect(events[0].seq).toBe(1);
      expect(events[0].event.eventType).toBe("message_start");
      expect(events[1].seq).toBe(2);
      expect(events[1].event.eventType).toBe("message_end");
    });
  });

  describe("per-event serialized-size ceiling", () => {
    // Signature: createMemoryEventStore(isPinned, maxCachedSessions,
    //   maxEventsPerSession, maxStringFieldSize, maxEventDataSize)
    const CAP = 2_000;

    it("bounds an oversized deeply-nested subagent event before storage", () => {
      // maxStringFieldSize huge (no per-field truncation) so ONLY the
      // per-event size ceiling can bound this; deep nesting past depth 4.
      const store = createMemoryEventStore(neverPinned, 100, 20000, 1_000_000, CAP);
      // Build data nested past the depth-4 recursion limit, each level
      // carrying a large string, so aggregate >> CAP.
      let node: Record<string, unknown> = { leaf: "Z".repeat(50_000) };
      for (let i = 0; i < 8; i++) node = { big: "Y".repeat(20_000), next: node };
      const event: DashboardEvent = {
        eventType: "subagent_end",
        timestamp: Date.now(),
        data: { result: node },
      };
      store.insertEvent("s1", event);
      const stored = store.getEvent("s1", 1);
      // The stored event must serialize small (ceiling + small constant).
      const size = JSON.stringify(stored).length;
      expect(size).toBeLessThanOrEqual(CAP + 500);
      // eventType preserved for the client.
      expect(stored?.eventType).toBe("subagent_end");
    });

    it("stores under-ceiling events unchanged (no placeholder)", () => {
      const store = createMemoryEventStore(neverPinned, 100, 20000, 1_000_000, CAP);
      const event: DashboardEvent = {
        eventType: "message_end",
        timestamp: Date.now(),
        data: { text: "hello world" },
      };
      store.insertEvent("s1", event);
      const stored = store.getEvent("s1", 1) as any;
      expect(stored.data.text).toBe("hello world");
      expect(stored.data.__truncated).toBeUndefined();
    });

    it("truncates deep sub-trees rather than returning them raw", () => {
      // Small maxStringFieldSize; generous size ceiling so the depth escape,
      // not the ceiling, is what would (previously) leak the deep payload.
      const store = createMemoryEventStore(neverPinned, 100, 20000, 100, 10_000_000);
      const deepBig = "Q".repeat(50_000);
      const event: DashboardEvent = {
        eventType: "test",
        // depth: data(0) > a(1) > b(2) > c(3) > d(4) > e(5) — past the limit
        data: { a: { b: { c: { d: { e: { huge: deepBig } } } } } },
        timestamp: Date.now(),
      };
      store.insertEvent("s1", event);
      const stored = store.getEvent("s1", 1);
      const size = JSON.stringify(stored).length;
      // The deep 50k string must NOT survive whole.
      expect(size).toBeLessThan(deepBig.length);
    });

    it("preserves deep base64 image data even past the depth limit", () => {
      const store = createMemoryEventStore(neverPinned, 100, 20000, 100, 10_000_000);
      const img = "I".repeat(2_000);
      const event: DashboardEvent = {
        eventType: "message_start",
        data: { a: { b: { c: { d: { e: { data: img, mimeType: "image/png" } } } } } },
        timestamp: Date.now(),
      };
      store.insertEvent("s1", event);
      const stored = store.getEvent("s1", 1) as any;
      expect(stored.data.a.b.c.d.e.data).toBe(img);
    });

    it("the broadcast source (getEvent) is bounded for an over-ceiling event", () => {
      // event-wiring broadcasts eventStore.getEvent(seq); asserting getEvent is
      // bounded proves the broadcast JSON.stringify cannot allocate unbounded.
      const store = createMemoryEventStore(neverPinned, 100, 20000, 1_000_000, 2_000);
      const event: DashboardEvent = {
        eventType: "subagent_end",
        timestamp: Date.now(),
        data: { timeline: Array.from({ length: 500 }, () => "X".repeat(1_000)) },
      };
      const seq = store.insertEvent("s1", event);
      const broadcastPayload = store.getEvent("s1", seq);
      expect(JSON.stringify(broadcastPayload).length).toBeLessThanOrEqual(2_500);
    });
  });

  describe("exceedsSerializedSize (bounded early-exit guard)", () => {
    it("returns false for small values", () => {
      expect(exceedsSerializedSize({ a: 1, b: "hi" }, 1_000)).toBe(false);
    });

    it("returns true once the running total crosses the cap", () => {
      expect(exceedsSerializedSize({ big: "A".repeat(10_000) }, 1_000)).toBe(true);
    });

    it("early-exits without visiting the whole object", () => {
      // A huge tail after an already-over-cap head must never be walked. Use a
      // getter that throws if accessed to prove the walk stopped early.
      const trap: Record<string, unknown> = { head: "A".repeat(5_000) };
      Object.defineProperty(trap, "tail", {
        enumerable: true,
        get() {
          throw new Error("walked past the cap");
        },
      });
      expect(() => exceedsSerializedSize(trap, 1_000)).not.toThrow();
      expect(exceedsSerializedSize(trap, 1_000)).toBe(true);
    });

    it("tolerates cyclic references without infinite recursion", () => {
      const a: Record<string, unknown> = {};
      a.self = a;
      expect(exceedsSerializedSize(a, 1_000)).toBe(false);
    });
  });

  // See change: instrument-event-store-trim.
  describe("getTrimStats (store-shed telemetry)", () => {
    it("reports all-zero stats when nothing is trimmed or evicted", () => {
      const store = createMemoryEventStore(neverPinned);
      store.insertEvent("s1", makeEvent("tool_execution_end"));
      store.insertEvent("s1", makeEvent("message_start"));
      expect(store.getTrimStats()).toEqual({
        trimmedEvents: { total: 0, toolExecutionEnd: 0, bySession: {} },
        evictedSessions: 0,
      });
    });

    it("counts trimmed events, exactly the dropped tool_execution_end, per session", () => {
      // cap = 3, trimSlack = 0 → trims on every over-cap insert.
      const store = createMemoryEventStore(neverPinned, 100, 3);
      // seq1..3 fill the cap; message_* are essential (never dropped).
      store.insertEvent("s1", makeEvent("message_start")); // 1 essential
      store.insertEvent("s1", makeEvent("message_end")); // 2 essential
      store.insertEvent("s1", makeEvent("tool_execution_end")); // 3 noise
      // seq4: length 4 > 3 → drop oldest non-essential = seq3 (tool_execution_end).
      store.insertEvent("s1", makeEvent("tool_execution_start")); // 4
      // seq5: kept [1,2,4] + 5 = 4 > 3 → drop seq4 (tool_execution_start, not a te).
      store.insertEvent("s1", makeEvent("tool_execution_end")); // 5
      // seq6: kept [1,2,5] + 6 = 4 > 3 → drop seq5 (tool_execution_end).
      store.insertEvent("s1", makeEvent("tool_execution_start")); // 6

      const stats = store.getTrimStats();
      // Three drops total (seq3 te, seq4 tes, seq5 te); two were terminal.
      expect(stats.trimmedEvents.total).toBe(3);
      expect(stats.trimmedEvents.toolExecutionEnd).toBe(2);
      expect(stats.trimmedEvents.bySession).toEqual({ s1: 3 });
    });

    it("does not attribute drops to a session that stays under the cap", () => {
      const store = createMemoryEventStore(neverPinned, 100, 3);
      // s1 overshoots and trims; s2 stays under the cap.
      for (let i = 0; i < 5; i++) store.insertEvent("s1", makeEvent("tool_execution_end"));
      store.insertEvent("s2", makeEvent("tool_execution_end"));

      const stats = store.getTrimStats();
      expect(stats.trimmedEvents.bySession.s1).toBeGreaterThan(0);
      expect(stats.trimmedEvents.bySession.s2).toBeUndefined();
    });

    it("drops the bySession entry when its buffer is deleted or evicted", () => {
      // maxCachedSessions = 2 so a third session evicts the LRU one.
      const store = createMemoryEventStore(neverPinned, 2, 3);
      for (let i = 0; i < 5; i++) store.insertEvent("s1", makeEvent("tool_execution_end"));
      expect(store.getTrimStats().trimmedEvents.bySession.s1).toBeGreaterThan(0);
      // Explicit delete purges the per-session tally.
      store.deleteEventsForSession("s1");
      expect(store.getTrimStats().trimmedEvents.bySession.s1).toBeUndefined();
      // Re-trim s2, then evict it via LRU with s3/s4 → its tally is purged too.
      for (let i = 0; i < 5; i++) store.insertEvent("s2", makeEvent("tool_execution_end"));
      expect(store.getTrimStats().trimmedEvents.bySession.s2).toBeGreaterThan(0);
      store.insertEvent("s3", makeEvent());
      store.insertEvent("s4", makeEvent()); // evicts s2 (LRU)
      expect(store.hasEvents("s2")).toBe(false);
      expect(store.getTrimStats().trimmedEvents.bySession.s2).toBeUndefined();
      // The cumulative global total is NOT reset by eviction/deletion.
      expect(store.getTrimStats().trimmedEvents.total).toBeGreaterThan(0);
    });

    it("counts cross-session LRU evictions", () => {
      const store = createMemoryEventStore(neverPinned, 3); // maxCachedSessions = 3
      store.insertEvent("s1", makeEvent());
      store.insertEvent("s2", makeEvent());
      store.insertEvent("s3", makeEvent());
      expect(store.getTrimStats().evictedSessions).toBe(0);
      // s4 pushes over the LRU cap → evict 1 (s1).
      store.insertEvent("s4", makeEvent());
      expect(store.getTrimStats().evictedSessions).toBe(1);
      // s5 evicts another.
      store.insertEvent("s5", makeEvent());
      expect(store.getTrimStats().evictedSessions).toBe(2);
    });
  });
});
