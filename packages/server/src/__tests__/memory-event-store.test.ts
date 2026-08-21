import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it, vi } from "vitest";
import {
  capString,
  createMemoryEventStore,
  DEFAULT_MAX_EVENT_DATA_SIZE,
  exceedsSerializedSize,
  measureBytes,
  reduceSubagentEvent,
  shrinkEntryToBudget,
} from "../persistence/memory-event-store.js";

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

    it("preserves nested-shape base64 image data (media_type sibling)", () => {
      // The per-field exemption must key off the SHAPE, not the literal key
      // `mimeType`: capping a nested `source.data` yields a base64 string that
      // no longer decodes, i.e. a broken image rather than a smaller one.
      // See change: fix-pasted-image-message-vanishes.
      const store = createMemoryEventStore(neverPinned, 100, 5000, 100);
      const longBase64 = "A".repeat(500);
      const event: DashboardEvent = {
        eventType: "message_start",
        timestamp: Date.now(),
        data: {
          message: {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: "image/png", data: longBase64 } },
            ],
          },
        },
      };
      store.insertEvent("s1", event);
      const stored = store.getEvent("s1", 1);
      const block = (stored as any).data.message.content[0];
      expect(block.source.data).toBe(longBase64);
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
      // capString is now head+tail: its generic marker names the hidden count.
      // See change: head-tail-truncate-subagent-event-timeline (D2).
      expect(val).toContain("hidden");
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

    it("large pasted image over the ceiling keeps the message, strips only the image bytes", () => {
      // Regression fix: a user chat message with a pasted screenshot bigger
      // than the per-event ceiling used to collapse to the {__truncated}
      // placeholder, which erases `data.message` entirely. The client's
      // `message_start` handler then saw no `message.role` and the row
      // VANISHED from chat history — text and all. The truncator now strips
      // the base64 image bytes in place while preserving the message envelope
      // (role, text block, image block POSITION + mime), so the message
      // survives. See change: fix-pasted-image-message-vanishes.
      const store = createMemoryEventStore(neverPinned); // production defaults
      // Sized off the constant so the case keeps tripping the ceiling when the
      // ceiling moves.
      const bigImage = "A".repeat(DEFAULT_MAX_EVENT_DATA_SIZE * 2);
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
      // Message survives (NOT the whole-event placeholder).
      expect(stored.data.__truncated).toBeUndefined();
      expect(stored.data.message.role).toBe("user");
      const content = stored.data.message.content;
      // Text block preserved verbatim.
      expect(content[0]).toEqual({ type: "text", text: "here is the screenshot" });
      // Image block keeps its POSITION + mime, but its bytes are stripped.
      expect(content[1].type).toBe("image");
      expect(content[1].mimeType).toBe("image/png");
      expect(content[1].data).toBe("");
      expect(content[1].imageTruncated).toBe(true);
      // And the stored event is under the ceiling.
      expect(Buffer.byteLength(JSON.stringify(stored.data))).toBeLessThanOrEqual(
        DEFAULT_MAX_EVENT_DATA_SIZE,
      );
    });

    it("large pasted image in the nested Anthropic source shape also keeps the message", () => {
      // Some provider/import paths carry the canonical Anthropic image block
      // shape `{ type:"image", source:{ type:"base64", media_type, data } }`
      // instead of the flat pi SDK shape. The truncator must reduce it too,
      // or the message vanishes exactly as in the flat case.
      // See change: fix-pasted-image-message-vanishes.
      const store = createMemoryEventStore(neverPinned);
      const bigImage = "A".repeat(DEFAULT_MAX_EVENT_DATA_SIZE * 2);
      const event: DashboardEvent = {
        eventType: "message_start",
        timestamp: Date.now(),
        data: {
          message: {
            role: "user",
            content: [
              { type: "text", text: "nested shape" },
              { type: "image", source: { type: "base64", media_type: "image/png", data: bigImage } },
            ],
          },
        },
      };
      store.insertEvent("s1", event);
      const stored = store.getEvent("s1", 1) as any;
      // The message survives (NOT the whole-event placeholder) and is bounded.
      expect(stored.data.__truncated).toBeUndefined();
      expect(stored.data.message.role).toBe("user");
      const img = stored.data.message.content[1];
      expect(img.type).toBe("image");
      // The nested media_type wrapper is preserved.
      expect(img.source.media_type).toBe("image/png");
      // The huge base64 is stripped out (bytes removed, position kept).
      expect(img.source.data).toBe("");
      expect(img.imageTruncated).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(stored.data))).toBeLessThanOrEqual(
        DEFAULT_MAX_EVENT_DATA_SIZE,
      );
    });

    it("still uses the whole-event placeholder when non-image content busts the ceiling", () => {
      // Defense-in-depth: image stripping is a targeted rescue, not a blanket
      // exemption. With the generic string pass disabled, a message whose TEXT
      // alone exceeds the ceiling still falls through to {__truncated}.
      // See change: fix-pasted-image-message-vanishes.
      // maxStringFieldSize = 0 disables per-field string capping so the huge
      // text block is not itself shortened.
      const store = createMemoryEventStore(neverPinned, undefined, undefined, 0);
      const hugeText = "T".repeat(DEFAULT_MAX_EVENT_DATA_SIZE * 2);
      const event: DashboardEvent = {
        eventType: "message_start",
        timestamp: Date.now(),
        data: {
          message: {
            role: "user",
            content: [
              { type: "text", text: hugeText },
              { type: "image", data: "A".repeat(1000), mimeType: "image/png" },
            ],
          },
        },
      };
      store.insertEvent("s1", event);
      const stored = store.getEvent("s1", 1) as any;
      expect(stored.data.__truncated).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(stored.data))).toBeLessThanOrEqual(
        DEFAULT_MAX_EVENT_DATA_SIZE,
      );
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

    // F12 — inline terminal lifecycle events are essential and survive trim as
    // a pair, so the reducer replays the card at its original stream position.
    // See change: preserve-inline-terminal-transcript (D3b).
    it("F12: an old inline open/close pair survives a flood in original order", () => {
      const store = createMemoryEventStore(neverPinned, 100, 5);
      store.insertEvent("s1", makeEvent("inline_terminal_open")); // seq 1
      store.insertEvent("s1", makeEvent("inline_terminal_close")); // seq 2
      for (let i = 0; i < 100; i++) {
        store.insertEvent("s1", makeEvent("tool_execution_start"));
      }
      const events = store.getEvents("s1", 1);
      const types = events.map((e) => e.event.eventType);
      expect(types).toContain("inline_terminal_open");
      expect(types).toContain("inline_terminal_close");
      // Neither dropped, and open precedes close (original position preserved).
      const openSeq = events.find((e) => e.event.eventType === "inline_terminal_open")!.seq;
      const closeSeq = events.find((e) => e.event.eventType === "inline_terminal_close")!.seq;
      expect(openSeq).toBe(1);
      expect(closeSeq).toBe(2);
      expect(openSeq).toBeLessThan(closeSeq);
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
        // Additive. See change: collapse-superseded-tool-execution-updates.
        collapsedUpdates: 0,
        // Additive. See change: reduce-subagent-details-payload (D6).
        subagentTicks: 0,
        subagentTickBytes: 0,
        subagentFatTicks: 0,
        subagentTickFatBytes: 0,
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

  // See change: head-tail-truncate-subagent-event-timeline.
  describe("subagent-timeline head+tail reduction", () => {
    // Pinned explicitly rather than mirroring DEFAULT_MAX_EVENT_DATA_SIZE: these
    // tests characterise the REDUCTION mechanism, so the ceiling must be small
    // enough that the fixtures trip it. Every store below is built with this
    // exact ceiling. See change: fit-attachments-for-display (task 5.4).
    const CEIL = 20_000;

    // Build a subagent `tool_execution_update` event: toolName Agent, entries at
    // partialResult.details.entries, streaming content at partialResult.content.
    function subagentEvent(opts: {
      entries: unknown[];
      prompt?: string;
      description?: string;
      contentText?: string;
      contentImage?: string;
      agentId?: string;
    }): DashboardEvent {
      return {
        eventType: "tool_execution_update",
        timestamp: Date.now(),
        data: {
          toolCallId: "tc1",
          toolName: "Agent",
          args: { prompt: opts.prompt ?? "do the task" },
          partialResult: {
            content: [
              ...(opts.contentText != null ? [{ type: "text", text: opts.contentText }] : []),
              ...(opts.contentImage != null
                ? [{ type: "image", data: opts.contentImage, mimeType: "image/png" }]
                : []),
            ],
            details: {
              agentId: opts.agentId ?? "ag1",
              description: opts.description ?? "explore",
              entries: opts.entries,
            },
          },
        },
      };
    }

    function toolEntry(i: number, outputSize: number): unknown {
      return {
        kind: "tool",
        toolName: "Read",
        input: { file_path: `/src/file-${i}.ts` },
        output: "X".repeat(outputSize),
        ts: 1000 + i,
      };
    }

    const bytesOf = (data: unknown) => Buffer.byteLength(JSON.stringify(data));

    // --- capString (E1, E2, E3) ---
    it("E1: capString keeps head + tail + a hidden marker", () => {
      const s = "H".repeat(500) + "M".repeat(600) + "T".repeat(500); // len maxSize+... 
      const maxSize = 1000;
      const long = "H".repeat(maxSize + 500);
      const out = capString(long, maxSize);
      expect(out).toContain(long.slice(0, 100)); // head present
      expect(out).toContain(long.slice(long.length - 100)); // tail present
      expect(out).toMatch(/hidden/);
      expect(out.length).toBeLessThanOrEqual(maxSize + 40); // ~marker length
      void s;
    });

    it("E2: capString is a no-op at or under the cap", () => {
      const s = "A".repeat(1000);
      expect(capString(s, 1000)).toBe(s);
      expect(capString(s, 2000)).toBe(s);
    });

    it("E3: capString preserves a skill-invocation envelope", () => {
      const body = "body ".repeat(5000);
      const env = `<skill name="ci" location="/u/.pi/SKILL.md">\n${body}\n</skill>\n\nargs here`;
      const out = capString(env, 1000);
      expect(out).toMatch(/^<skill name="ci" location="[^"]+">\n/);
      expect(out).toMatch(/\n<\/skill>\n\nargs here$/);
      expect(out.length).toBeLessThan(env.length);
    });

    // --- reduction via insertEvent (E4..E9, E12..E15) ---
    it("E4: keeps first + last entries + a text sentinel, not {__truncated}", () => {
      const store = createMemoryEventStore(neverPinned, undefined, undefined, undefined, CEIL);
      const entries = Array.from({ length: 30 }, (_, i) => toolEntry(i, 1500));
      store.insertEvent("s1", subagentEvent({ entries }));
      const stored = store.getEvent("s1", 1) as any;
      expect(stored.data.__truncated).toBeUndefined();
      const kept = stored.data.partialResult.details.entries as any[];
      expect(kept[0].input.file_path).toBe("/src/file-0.ts"); // head
      const sentinel = kept.find((e) => e.kind === "text" && /steps hidden/.test(e.text));
      expect(sentinel).toBeTruthy();
      const last = kept[kept.length - 1];
      expect(last.input.file_path).toBe("/src/file-29.ts"); // final entry retained
      expect(bytesOf(stored.data)).toBeLessThanOrEqual(CEIL);
    });

    it("E5: a large prompt does not starve the timeline", () => {
      const store = createMemoryEventStore(neverPinned, undefined, undefined, undefined, CEIL);
      const entries = Array.from({ length: 10 }, (_, i) => toolEntry(i, 1500));
      store.insertEvent("s1", subagentEvent({ entries, prompt: "P".repeat(16_000) }));
      const stored = store.getEvent("s1", 1) as any;
      expect(stored.data.__truncated).toBeUndefined();
      expect(stored.data.args.prompt.length).toBeLessThanOrEqual(2_000 + 40);
      const kept = stored.data.partialResult.details.entries as any[];
      expect(kept[0].input.file_path).toBe("/src/file-0.ts");
      expect(kept[kept.length - 1].input.file_path).toBe("/src/file-9.ts");
      expect(bytesOf(stored.data)).toBeLessThanOrEqual(CEIL);
    });

    it("E6: large content text does not starve the timeline", () => {
      const store = createMemoryEventStore(neverPinned, undefined, undefined, undefined, CEIL);
      const entries = Array.from({ length: 10 }, (_, i) => toolEntry(i, 1500));
      store.insertEvent("s1", subagentEvent({ entries, contentText: "C".repeat(16_000) }));
      const stored = store.getEvent("s1", 1) as any;
      expect(stored.data.__truncated).toBeUndefined();
      expect(stored.data.partialResult.content[0].text.length).toBeLessThanOrEqual(1_500 + 40);
      const kept = stored.data.partialResult.details.entries as any[];
      expect(kept[kept.length - 1].input.file_path).toBe("/src/file-9.ts");
      expect(bytesOf(stored.data)).toBeLessThanOrEqual(CEIL);
    });

    it("E7: byte-accurate bound holds under escape/CJK-heavy entries", () => {
      const store = createMemoryEventStore(neverPinned, undefined, undefined, undefined, CEIL);
      // "\" and CJK expand under JSON/UTF-8: code-unit count < ceiling, bytes >>.
      const nasty = '"\\\u4e2d\u6587'.repeat(3_000); // ~12k code units, far more bytes
      const entries = Array.from({ length: 12 }, (_, i) => ({
        kind: "tool",
        toolName: "Read",
        input: { q: nasty },
        output: nasty,
        ts: 1000 + i,
      }));
      store.insertEvent("s1", subagentEvent({ entries }));
      const stored = store.getEvent("s1", 1) as any;
      expect(Buffer.byteLength(JSON.stringify(stored.data))).toBeLessThanOrEqual(CEIL);
    });

    it("E8: shape-only match (no toolName/agentId) is NOT reduced", () => {
      // Production config disables the per-field string pass (maxStringFieldSize
      // = 0), so the ceiling is the bound. A shape-only array must NOT get the
      // subagent head+tail reducer — it gets the blunt {__truncated} placeholder.
      const store = createMemoryEventStore(neverPinned, 100, 20000, 0, 20000);
      const event: DashboardEvent = {
        eventType: "some_other_event",
        timestamp: Date.now(),
        data: {
          details: { entries: Array.from({ length: 30 }, (_, i) => toolEntry(i, 1500)) },
        },
      };
      store.insertEvent("s1", event);
      const stored = store.getEvent("s1", 1) as any;
      expect(stored.data.__truncated).toBe(true);
      expect(Array.isArray(stored.data.details)).toBe(false);
    });

    it("E9: a >20-entry timeline is not clobbered to a string (maxStringFieldSize>0)", () => {
      // maxStringFieldSize = 4000 (default) so the generic array clobber WOULD
      // fire for a >20 array on the generic path.
      const store = createMemoryEventStore(neverPinned, undefined, undefined, undefined, CEIL);
      const entries = Array.from({ length: 25 }, (_, i) => toolEntry(i, 1500));
      store.insertEvent("s1", subagentEvent({ entries }));
      const stored = store.getEvent("s1", 1) as any;
      expect(Array.isArray(stored.data.partialResult.details.entries)).toBe(true);
      expect(stored.data.partialResult.details.entries).not.toBe("[array truncated]");
    });

    it("E10: shrinkEntryToBudget bounds a many-leaf object entry (not leafCount×cap)", () => {
      // leafCount×cap would be 10×2000 = 20000; the entry-level bound holds it
      // far under B while the per-leaf floor (256) + markers set the achievable
      // minimum for 11 leaves at ~2.9 KB, so B=4000 is a real entry-level bound.
      const B = 4_000;
      const input: Record<string, string> = {};
      for (let i = 0; i < 10; i++) input[`leaf${i}`] = "L".repeat(2_000);
      const entry = {
        kind: "tool",
        toolName: "Big",
        input,
        output: "O".repeat(5_000),
        ts: 1,
      };
      shrinkEntryToBudget(entry, B);
      expect(Buffer.byteLength(JSON.stringify(entry))).toBeLessThanOrEqual(B);
    });

    it("E11: image-bearing NON-subagent event keeps the message, strips the image bytes", () => {
      // A user message_start carrying a pasted screenshot bigger than the
      // ceiling must NOT collapse to {__truncated} (that erases data.message
      // and the row vanishes from chat). The image bytes are stripped in place;
      // the message envelope + block position survive.
      // See change: fix-pasted-image-message-vanishes.
      const store = createMemoryEventStore(neverPinned, undefined, undefined, undefined, CEIL);
      const event: DashboardEvent = {
        eventType: "message_start",
        timestamp: Date.now(),
        data: {
          message: {
            role: "user",
            content: [{ type: "image", data: "A".repeat(2_000_000), mimeType: "image/png" }],
          },
        },
      };
      store.insertEvent("s1", event);
      const stored = store.getEvent("s1", 1) as any;
      expect(stored.data.__truncated).toBeUndefined();
      expect(stored.data.message.role).toBe("user");
      const img = stored.data.message.content[0];
      expect(img.type).toBe("image");
      expect(img.mimeType).toBe("image/png");
      expect(img.data).toBe("");
      expect(bytesOf(stored.data)).toBeLessThanOrEqual(CEIL);
    });

    it("E12: an under-ceiling subagent event is stored unchanged", () => {
      const store = createMemoryEventStore(neverPinned, undefined, undefined, undefined, CEIL);
      const entries = Array.from({ length: 3 }, (_, i) => toolEntry(i, 500)); // ~small
      const event = subagentEvent({ entries });
      expect(exceedsSerializedSize(event.data, CEIL)).toBe(false);
      store.insertEvent("s1", event);
      const stored = store.getEvent("s1", 1) as any;
      const kept = stored.data.partialResult.details.entries as any[];
      expect(kept.length).toBe(3);
      expect(kept.some((e) => e.kind === "text" && /hidden/.test(e.text))).toBe(false);
      expect(stored.data.args.prompt).toBe("do the task");
    });

    it("E13: non-subagent over-ceiling event → {__truncated}", () => {
      // Production config: string pass off (maxStringFieldSize = 0), so the
      // 60 KB blob is bounded by the ceiling → placeholder (existing behavior).
      const store = createMemoryEventStore(neverPinned, 100, 20000, 0, 20000);
      const event: DashboardEvent = {
        eventType: "subagent_end",
        timestamp: Date.now(),
        data: { blob: "Z".repeat(60_000) },
      };
      store.insertEvent("s1", event);
      const stored = store.getEvent("s1", 1) as any;
      expect(stored.data.__truncated).toBe(true);
      expect(stored.data.reason).toBeTruthy();
      expect(stored.data.eventType).toBe("subagent_end");
    });

    it("E14: pathological single huge final entry stays bounded", () => {
      const store = createMemoryEventStore(neverPinned, undefined, undefined, undefined, CEIL);
      // Many entries so the middle elides; final entry alone is 40 KB.
      const entries = Array.from({ length: 25 }, (_, i) => toolEntry(i, 1000));
      entries[entries.length - 1] = toolEntry(24, 40_000);
      store.insertEvent("s1", subagentEvent({ entries }));
      const stored = store.getEvent("s1", 1) as any;
      expect(bytesOf(stored.data)).toBeLessThanOrEqual(CEIL);
    });

    it("E15: reducer returns a NEW event and does not mutate the input", () => {
      const entries = Array.from({ length: 30 }, (_, i) => toolEntry(i, 1500));
      const event = subagentEvent({ entries, prompt: "P".repeat(16_000) });
      const origPrompt = (event.data as any).args.prompt;
      const origEntriesRef = (event.data as any).partialResult.details.entries;
      const origLen = origEntriesRef.length;
      const reduced = reduceSubagentEvent(event, CEIL);
      expect(reduced).not.toBe(event);
      expect((event.data as any).args.prompt).toBe(origPrompt); // unchanged
      expect((event.data as any).partialResult.details.entries).toBe(origEntriesRef);
      expect(origEntriesRef.length).toBe(origLen);
      expect((origEntriesRef[0] as any).output.length).toBe(1500); // leaf untouched
    });

    // --- performance (P1, P2) ---
    it("P1: size measurement is bounded and never full-stringifies oversized data", () => {
      const spy = vi.spyOn(JSON, "stringify");
      const store = createMemoryEventStore(neverPinned, undefined, undefined, undefined, CEIL);
      const event: DashboardEvent = {
        eventType: "message_start",
        timestamp: Date.now(),
        data: { huge: "S".repeat(5_000_000) },
      };
      const start = performance.now();
      store.insertEvent("s1", event);
      const elapsed = performance.now() - start;
      const stored = store.getEvent("s1", 1) as any;
      expect(bytesOf(stored.data)).toBeLessThanOrEqual(CEIL);
      // No stringify call was made on the 5MB string by the store.
      for (const call of spy.mock.calls) {
        const arg = call[0];
        const asStr = typeof arg === "string" ? arg : "";
        expect(asStr.length).toBeLessThan(1_000_000);
      }
      expect(elapsed).toBeLessThan(50);
      spy.mockRestore();
    });

    it("P2: the shrink loop terminates on a pathological entry", () => {
      const input: Record<string, unknown> = { big: "S".repeat(5_000_000) };
      for (let i = 0; i < 500; i++) input[`n${i}`] = i;
      const entries = [
        toolEntry(0, 500),
        { kind: "tool", toolName: "Big", input, output: "", ts: 2 },
      ];
      const event = subagentEvent({ entries });
      const reduced = reduceSubagentEvent(event, CEIL);
      expect(Buffer.byteLength(JSON.stringify(reduced.data))).toBeLessThanOrEqual(CEIL);
    });

    // --- error-handling (X1, X2) ---
    it("X1: a 5MB base64 image in a subagent event does not OOM", () => {
      const spy = vi.spyOn(JSON, "stringify");
      const store = createMemoryEventStore(neverPinned, undefined, undefined, undefined, CEIL);
      const entries = Array.from({ length: 6 }, (_, i) => toolEntry(i, 800));
      store.insertEvent(
        "s1",
        subagentEvent({ entries, contentImage: "A".repeat(5_000_000) }),
      );
      const stored = store.getEvent("s1", 1) as any;
      expect(bytesOf(stored.data)).toBeLessThanOrEqual(CEIL);
      for (const call of spy.mock.calls) {
        const arg = call[0];
        const asStr = typeof arg === "string" ? arg : "";
        expect(asStr.length).toBeLessThan(1_000_000);
      }
      spy.mockRestore();
    });

    it("X2: an unreducible empty-entries subagent event falls back to {__truncated}", () => {
      const store = createMemoryEventStore(neverPinned, undefined, undefined, undefined, CEIL);
      // Empty entries + an oversized envelope the caps cannot shrink below ceiling:
      // a huge prompt beyond PROMPT_CAP still caps, so instead give a huge
      // non-capped envelope field (extra) that stays over ceiling.
      const event: DashboardEvent = {
        eventType: "tool_execution_update",
        timestamp: Date.now(),
        data: {
          toolName: "Agent",
          extra: "Z".repeat(60_000), // not a capped field → envelope stays huge
          partialResult: { details: { agentId: "ag1", entries: [] } },
        },
      };
      store.insertEvent("s1", event);
      const stored = store.getEvent("s1", 1) as any;
      expect(stored.data.__truncated).toBe(true);
      expect(bytesOf(stored.data)).toBeLessThanOrEqual(CEIL);
    });

    it("measureBytes never undercounts and stays bounded", () => {
      // The walk is a SAFE overcount (one trailing-comma byte per element), never
      // an undercount — the bound can never let an over-ceiling event through.
      const actual = Buffer.byteLength(JSON.stringify({ a: "hi" }));
      const m = measureBytes({ a: "hi" }, 1_000);
      expect(m).toBeGreaterThanOrEqual(actual);
      expect(m).toBeLessThanOrEqual(actual + 4);
      // A 5 MB field short-circuits to the cap+1 over-ceiling sentinel.
      expect(measureBytes({ big: "A".repeat(5_000_000) }, 1_000)).toBe(1_001);
      // Lone surrogates escape to \uXXXX (6 bytes) — must never be undercounted.
      for (const s of ["\ud800".repeat(50), "\udc00".repeat(50), `${"\ud800".repeat(50)}x`]) {
        const m = measureBytes({ s }, 100_000);
        expect(m).toBeGreaterThanOrEqual(Buffer.byteLength(JSON.stringify({ s })));
      }
      // A valid surrogate pair is still one 4-byte sequence, not two escapes.
      const pair = { s: "\ud800\udc00".repeat(50) };
      expect(measureBytes(pair, 100_000)).toBeGreaterThanOrEqual(
        Buffer.byteLength(JSON.stringify(pair)),
      );
    });
  });

  // See change: reduce-subagent-details-payload (D5a).
  //
  // A resync reply is delivered as `subagent_started` with `{id, details}` and
  // matches NEITHER `toolName === "Agent"` NOR `tool_execution_update/end`, so
  // it falls through to the generic pass where any array > 20 items becomes the
  // string "[array truncated]" — which the reducer then ignores, rendering no
  // timeline at all. The pull path this change leans on is broken today past 20
  // entries; these tests pin the type gate that fixes it.
  describe("D5a: subagent_* carrier engages the timeline type gate", () => {
    const CEIL = 20_000;

    /** The resync-reply shape: `subagent_started` with `data.details.entries`. */
    function startedEvent(entries: unknown[], eventType = "subagent_started"): DashboardEvent {
      return {
        eventType,
        timestamp: Date.now(),
        data: {
          id: "ag1",
          details: { agentId: "ag1", description: "explore", entries },
        },
      };
    }

    function toolEntry(i: number, outputSize: number): unknown {
      return {
        kind: "tool",
        toolName: "Read",
        input: { file_path: `/src/file-${i}.ts` },
        output: "X".repeat(outputSize),
        ts: 1000 + i,
      };
    }

    it("E1: entries length exactly 20 stays an Array (boundary — clobber must not fire)", () => {
      const store = createMemoryEventStore(neverPinned, undefined, undefined, undefined, CEIL);
      store.insertEvent("s1", startedEvent(Array.from({ length: 20 }, (_, i) => toolEntry(i, 20))));
      const kept = (store.getEvent("s1", 1) as any).data.details.entries;
      expect(Array.isArray(kept)).toBe(true);
      expect(kept).toHaveLength(20);
    });

    it("E2: entries length 21 stays an Array, NOT the string '[array truncated]'", () => {
      const store = createMemoryEventStore(neverPinned, undefined, undefined, undefined, CEIL);
      store.insertEvent("s1", startedEvent(Array.from({ length: 21 }, (_, i) => toolEntry(i, 20))));
      const kept = (store.getEvent("s1", 1) as any).data.details.entries;
      expect(kept).not.toBe("[array truncated]");
      expect(Array.isArray(kept)).toBe(true);
      expect(kept).toHaveLength(21);
    });

    it("E3: over-ceiling entries reduce to head + sentinel + tail, still an Array", () => {
      const store = createMemoryEventStore(neverPinned, undefined, undefined, undefined, CEIL);
      const entries = Array.from({ length: 30 }, (_, i) => toolEntry(i, 1500));
      store.insertEvent("s1", startedEvent(entries));
      const stored = (store.getEvent("s1", 1) as any).data;
      expect(stored.__truncated).toBeUndefined();
      const kept = stored.details.entries as any[];
      expect(Array.isArray(kept)).toBe(true);
      expect(kept[0].input.file_path).toBe("/src/file-0.ts"); // head kept
      expect(kept[kept.length - 1].input.file_path).toBe("/src/file-29.ts"); // tail kept
      expect(kept.some((e) => e.kind === "text" && /steps hidden/.test(e.text))).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(stored))).toBeLessThanOrEqual(CEIL);
    });

    it("D6: counts subagent ticks, splitting fat from thin", () => {
      const store = createMemoryEventStore(neverPinned, undefined, undefined, undefined, CEIL);
      // A thin tick: the strip landed, no timeline on the wire.
      store.insertEvent("s1", {
        eventType: "subagent_started",
        timestamp: Date.now(),
        data: { id: "ag1", details: { agentId: "ag1", status: "running", toolUses: 2 } },
      });
      // A fat tick: a terminal frame or a resync reply.
      store.insertEvent("s1", startedEvent(Array.from({ length: 5 }, (_, i) => toolEntry(i, 100))));
      // Not a subagent carrier — must not be counted at all.
      store.insertEvent("s1", { eventType: "message_start", timestamp: Date.now(), data: { a: 1 } });

      const stats = store.getTrimStats();
      expect(stats.subagentTicks).toBe(2);
      expect(stats.subagentFatTicks).toBe(1);
      expect(stats.subagentTickFatBytes).toBeGreaterThan(0);
      expect(stats.subagentTickBytes).toBeGreaterThan(stats.subagentTickFatBytes);
      // Never reset on read.
      expect(store.getTrimStats().subagentTicks).toBe(2);
    });

    it("E4: a non-subagent/non-tool event carrying details.entries still does NOT match", () => {
      // Shape alone must never match the timeline reducer.
      const store = createMemoryEventStore(neverPinned, undefined, undefined, undefined, CEIL);
      store.insertEvent("s1", startedEvent(Array.from({ length: 25 }, (_, i) => toolEntry(i, 20)), "some_other_event"));
      const kept = (store.getEvent("s1", 1) as any).data.details.entries;
      expect(kept).toBe("[array truncated]");
    });
  });
});

// ---------------------------------------------------------------------------
// Superseded `tool_execution_update` collapse.
// See change: collapse-superseded-tool-execution-updates.
// ---------------------------------------------------------------------------

/**
 * Default subagent `details` — deliberately a SUBSUMING shape: every key
 * present, `entries` non-empty, and a sibling `content` that sets the rendered
 * result. Individual scenarios perturb exactly one axis so a failure names the
 * gate condition it broke.
 */
function baseDetails(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    agentId: "a1",
    agentSessionId: "as1",
    subagentType: "Explore",
    description: "d1",
    activity: "thinking",
    entries: [{ kind: "text", text: "step", ts: 1 }],
    ...over,
  };
}

/** A `tool_execution_update` with a structured `partialResult`. */
function mkUpdate(
  toolCallId: string | undefined,
  details: Record<string, unknown> | undefined = baseDetails(),
  opts: { content?: unknown; extra?: Record<string, unknown> } = {},
): DashboardEvent {
  const partialResult: Record<string, unknown> = {
    content: "content" in opts ? opts.content : [{ text: "running…" }],
  };
  if (details) partialResult.details = details;
  return {
    eventType: "tool_execution_update",
    timestamp: Date.now(),
    data: {
      ...(toolCallId !== undefined ? { toolCallId } : {}),
      toolName: "Agent",
      partialResult,
      ...opts.extra,
    },
  };
}

/** A `tool_execution_update` whose `partialResult` is a plain string. */
function mkPlainUpdate(toolCallId: string, text: string): DashboardEvent {
  return {
    eventType: "tool_execution_update",
    timestamp: Date.now(),
    data: { toolCallId, toolName: "Agent", partialResult: text },
  };
}

function mkTyped(type: string, toolCallId?: string): DashboardEvent {
  return {
    eventType: type,
    timestamp: Date.now(),
    data: toolCallId ? { toolCallId } : {},
  };
}

const neverPinnedFn = () => false;

/** Every stored `tool_execution_update` for `toolCallId`, oldest first. */
function updatesFor(store: ReturnType<typeof createMemoryEventStore>, sessionId: string, toolCallId: string) {
  return store
    .getEvents(sessionId, 1)
    .filter(
      (e) =>
        e.event.eventType === "tool_execution_update" &&
        (e.event.data as Record<string, unknown>)?.toolCallId === toolCallId,
    );
}

describe("collapse of superseded tool_execution_update events", () => {
  it("E1: retains the newest update per toolCallId plus the pinned creating tick", () => {
    const store = createMemoryEventStore(neverPinnedFn);
    const s1 = store.insertEvent("s", mkTyped("tool_execution_start", "t1")); // seq1
    store.insertEvent("s", mkUpdate("t1")); // seq2 — creating tick (pinned)
    store.insertEvent("s", mkUpdate("t1")); // seq3
    store.insertEvent("s", mkUpdate("t1")); // seq4
    const s5 = store.insertEvent("s", mkUpdate("t1")); // seq5

    const kept = updatesFor(store, "s", "t1");
    // Creating tick (seq2) is pinned; exactly ONE non-pinned update survives.
    const nonPinned = kept.filter((e) => e.seq !== 2);
    expect(nonPinned).toHaveLength(1);
    expect(nonPinned[0].seq).toBe(s5);
    // The tool_execution_start is untouched by the collapse policy.
    expect(store.getEvent("s", s1)?.eventType).toBe("tool_execution_start");
    expect(store.getTrimStats().collapsedUpdates).toBe(2); // seq3, seq4
  });

  it("E2: does not subsume when a details key is missing from the successor", () => {
    const store = createMemoryEventStore(neverPinnedFn);
    store.insertEvent("s", mkUpdate("t1")); // creating (pinned)
    store.insertEvent("s", mkUpdate("t1")); // retained newest
    const details = baseDetails();
    delete details.agentSessionId;
    store.insertEvent("s", mkUpdate("t1", details));

    expect(updatesFor(store, "s", "t1")).toHaveLength(3);
    expect(store.getTrimStats().collapsedUpdates).toBe(0);
  });

  it("E3: does not subsume when non-empty entries are replaced by an empty array", () => {
    const store = createMemoryEventStore(neverPinnedFn);
    store.insertEvent("s", mkUpdate("t1")); // creating (pinned)
    store.insertEvent(
      "s",
      mkUpdate("t1", baseDetails({ entries: [{ ts: 1 }, { ts: 2 }, { ts: 3 }] })),
    );
    store.insertEvent("s", mkUpdate("t1", baseDetails({ entries: [] })));

    expect(updatesFor(store, "s", "t1")).toHaveLength(3);
    expect(store.getTrimStats().collapsedUpdates).toBe(0);
  });

  it("E4: does not subsume on a type downgrade of a present key", () => {
    const store = createMemoryEventStore(neverPinnedFn);
    store.insertEvent("s", mkUpdate("t1")); // creating (pinned)
    store.insertEvent("s", mkUpdate("t1", baseDetails({ activity: "thinking" })));
    store.insertEvent("s", mkUpdate("t1", baseDetails({ activity: 123 })));

    expect(updatesFor(store, "s", "t1")).toHaveLength(3);
    expect(store.getTrimStats().collapsedUpdates).toBe(0);
  });

  it("E5: does not subsume when the successor sets no rendered result", () => {
    const store = createMemoryEventStore(neverPinnedFn);
    // Plain-string predecessor SETS the rendered result…
    store.insertEvent("s", mkPlainUpdate("t1", "running…"));
    // …the structured successor carries details but NO content, so it does not.
    store.insertEvent("s", mkUpdate("t1", baseDetails(), { content: undefined }));

    expect(updatesFor(store, "s", "t1")).toHaveLength(2);
    expect(store.getTrimStats().collapsedUpdates).toBe(0);
  });

  it("E6: collapses per toolCallId in isolation", () => {
    const store = createMemoryEventStore(neverPinnedFn);
    store.insertEvent("s", mkUpdate("t1")); // t1 creating
    store.insertEvent("s", mkUpdate("t2")); // t2 creating
    store.insertEvent("s", mkUpdate("t1"));
    store.insertEvent("s", mkUpdate("t2"));
    const lastT1 = store.insertEvent("s", mkUpdate("t1"));
    const lastT2 = store.insertEvent("s", mkUpdate("t2"));

    const t1 = updatesFor(store, "s", "t1");
    const t2 = updatesFor(store, "s", "t2");
    // creating + newest each; neither call collapsed the other's events.
    expect(t1.map((e) => e.seq)).toEqual([1, lastT1]);
    expect(t2.map((e) => e.seq)).toEqual([2, lastT2]);
  });

  it("E7: fails open on an update with no toolCallId", () => {
    const store = createMemoryEventStore(neverPinnedFn);
    store.insertEvent("s", mkUpdate("t1"));
    store.insertEvent("s", mkUpdate("t1"));
    const before = store.getEvents("s", 1).length;

    const seq = store.insertEvent("s", mkUpdate(undefined));
    const after = store.getEvents("s", 1);
    // The keyless update is retained and removed nothing.
    expect(after).toHaveLength(before + 1);
    expect(store.getEvent("s", seq)).toBeDefined();
  });

  it("E8: a {__truncated} placeholder escapes collapse entirely", () => {
    // Ceiling low enough that the (entries-free) payload is unreducible.
    const store = createMemoryEventStore(neverPinnedFn, 100, 20_000, 4_000, 500);
    for (let i = 0; i < 5; i++) {
      store.insertEvent("s", {
        eventType: "tool_execution_update",
        timestamp: Date.now(),
        data: { toolCallId: "t1", partialResult: { text: "x".repeat(50_000) } },
      });
    }
    const stored = store.getEvents("s", 1);
    expect(stored).toHaveLength(5);
    for (const e of stored) {
      expect((e.event.data as Record<string, unknown>).__truncated).toBe(true);
      expect((e.event.data as Record<string, unknown>).toolCallId).toBeUndefined();
    }
    expect(store.getTrimStats().collapsedUpdates).toBe(0);
  });

  it("E9: the pinned creating tick is never collapsed by a subsuming successor", () => {
    const store = createMemoryEventStore(neverPinnedFn);
    const creating = store.insertEvent("s", mkUpdate("t1")); // only retained update
    const successor = store.insertEvent("s", mkUpdate("t1")); // fully subsuming

    // BOTH retained — the two-pointer index keeps the pin from being the
    // collapse target even when it IS the current newest.
    expect(updatesFor(store, "s", "t1").map((e) => e.seq)).toEqual([creating, successor]);
    expect(store.getTrimStats().collapsedUpdates).toBe(0);
  });

  it("E11: leaves non-update event types untouched", () => {
    const store = createMemoryEventStore(neverPinnedFn);
    store.insertEvent("s", mkTyped("message_start"));
    store.insertEvent("s", mkTyped("message_end"));
    store.insertEvent("s", mkTyped("tool_execution_start", "t1"));
    store.insertEvent("s", mkTyped("tool_execution_end", "t1"));
    for (let i = 0; i < 10; i++) store.insertEvent("s", mkUpdate("t1"));

    const types = store.getEvents("s", 1).map((e) => e.event.eventType);
    expect(types).toContain("message_start");
    expect(types).toContain("message_end");
    expect(types).toContain("tool_execution_start");
    expect(types).toContain("tool_execution_end");
  });

  it("E12: resolves details from partialResult.details only, never data.details", () => {
    const store = createMemoryEventStore(neverPinnedFn);
    store.insertEvent("s", mkUpdate("t1")); // creating (pinned)
    const predecessor = store.insertEvent("s", mkUpdate("t1")); // retained newest
    // Successor carries a SUPERSET at the top level but no partialResult at all.
    store.insertEvent("s", {
      eventType: "tool_execution_update",
      timestamp: Date.now(),
      data: { toolCallId: "t1", toolName: "Agent", details: baseDetails() },
    });

    // The predecessor is NOT dropped on the strength of `data.details`.
    expect(store.getEvent("s", predecessor)).toBeDefined();
    expect(store.getTrimStats().collapsedUpdates).toBe(0);
  });

  it("E13: never drops the buffer's highest-seq event", () => {
    const store = createMemoryEventStore(neverPinnedFn);
    store.insertEvent("s", mkUpdate("t1"));
    store.insertEvent("s", mkUpdate("t1"));
    const last = store.insertEvent("s", mkUpdate("t1"));
    expect(store.getMaxSeq("s")).toBe(last);
  });

  it("E14: the seq insertEvent returned is re-readable after collapse", () => {
    const store = createMemoryEventStore(neverPinnedFn);
    store.insertEvent("s", mkUpdate("t1"));
    store.insertEvent("s", mkUpdate("t1"));
    const seq = store.insertEvent("s", mkUpdate("t1"));
    // Mirrors the broadcast path: insert, then re-read by the returned seq.
    expect(store.getEvent("s", seq)?.eventType).toBe("tool_execution_update");
  });

  it("E15: preserves the essential head under a subagent flood", () => {
    const cap = 50;
    const store = createMemoryEventStore(neverPinnedFn, 100, cap);
    store.insertEvent("s", mkTyped("message_start"));
    store.insertEvent("s", mkTyped("message_end"));
    for (let i = 0; i < 500; i++) store.insertEvent("s", mkUpdate(`t${i % 7}`));

    const events = store.getEvents("s", 1);
    expect(events.map((e) => e.event.eventType)).toEqual(
      expect.arrayContaining(["message_start", "message_end"]),
    );
    // trimSlack is 0 at this cap.
    expect(events.length).toBeLessThanOrEqual(cap);
  });

  it("P1: predecessor lookup cost is bounded, not O(buffer length)", () => {
    const probeAt = (tailSize: number): number => {
      const store = createMemoryEventStore(neverPinnedFn, 100, 0); // trim disabled
      for (let i = 0; i < tailSize; i++) store.insertEvent("s", mkTyped("message_end"));
      // 50 distinct toolCallIds, interleaved, on top of the non-update tail.
      for (let round = 0; round < 20; round++) {
        for (let c = 0; c < 50; c++) store.insertEvent("s", mkUpdate(`t${c}`));
      }
      return store.getCollapseProbe().maxEntriesExamined;
    };
    const small = probeAt(100);
    const large = probeAt(20_000);
    // Bounded by concurrent call count, NOT by buffer length: growing the
    // buffer 200x must not grow the examined-entry high-water mark.
    expect(small).toBeLessThanOrEqual(200);
    expect(large).toBeLessThanOrEqual(200);
    expect(large).toBeLessThanOrEqual(small * 2);
  });

  it("P3: the buffer stays bounded under a 10 000-update soak", () => {
    const cap = 200;
    const store = createMemoryEventStore(neverPinnedFn, 100, cap);
    const slack = Math.min(256, Math.floor(cap * 0.05));
    for (let i = 0; i < 10_000; i++) {
      store.insertEvent("s", mkUpdate(`t${i % 40}`));
      if (i % 250 === 0) {
        expect(store.getEvents("s", 1).length).toBeLessThanOrEqual(cap + slack);
      }
    }
    expect(store.getEvents("s", 1).length).toBeLessThanOrEqual(cap + slack);
  });

  it("X1: a trim-removed retained update makes the next collapse a no-op", () => {
    // cap 20 → trimSlack 1: the two updates are the only non-essential events,
    // so the trim at length 22 sheds exactly them and leaves the buffer at 20 —
    // one below the reclaim threshold, so the final insert triggers no trim and
    // the assertion isolates the COLLAPSE path.
    const cap = 20;
    const store = createMemoryEventStore(neverPinnedFn, 100, cap);
    store.insertEvent("s", mkUpdate("t1")); // creating (pinned)
    store.insertEvent("s", mkUpdate("t1")); // retained newest
    for (let i = 0; i < 20; i++) store.insertEvent("s", mkTyped("message_end"));
    const before = store.getEvents("s", 1);
    const maxBefore = store.getMaxSeq("s");
    expect(before.some((e) => e.event.eventType === "tool_execution_update")).toBe(false);

    const seq = store.insertEvent("s", mkUpdate("t1"));
    const after = store.getEvents("s", 1);
    // The stale index entry resolved to nothing: no OTHER event was removed…
    expect(after.filter((e) => e.seq !== seq).map((e) => e.seq)).toEqual(
      before.map((e) => e.seq),
    );
    // …and the max-seq event advanced only by the insert itself.
    expect(store.getMaxSeq("s")).toBe(seq);
    expect(seq).toBeGreaterThan(maxBefore);
  });

  it("X2: an unresolved index lookup never deletes the buffer's last element", () => {
    const cap = 20;
    const store = createMemoryEventStore(neverPinnedFn, 100, cap);
    store.insertEvent("s", mkUpdate("t1")); // creating
    store.insertEvent("s", mkUpdate("t1")); // newest → indexed seq
    // Trim evaporates both updates, leaving the index naming absent seqs.
    for (let i = 0; i < 20; i++) store.insertEvent("s", mkTyped("message_start"));
    const tailBefore = store.getEvents("s", 1).at(-1);

    store.insertEvent("s", mkUpdate("t1"));
    const events = store.getEvents("s", 1);
    // `splice(-1, 1)` on an indexOf miss would have deleted this element.
    expect(events.some((e) => e.seq === tailBefore?.seq)).toBe(true);
  });

  it("X3: the collapse index is released with its buffer on evict and delete", () => {
    const maxSessions = 3;
    const store = createMemoryEventStore(neverPinnedFn, maxSessions);
    for (let s = 0; s < 30; s++) {
      for (let c = 0; c < 5; c++) store.insertEvent(`sess${s}`, mkUpdate(`t${c}`));
    }
    // Only `maxSessions` buffers survive LRU eviction → at most 5 keys each.
    expect(store.sessionCount()).toBeLessThanOrEqual(maxSessions);
    expect(store.getCollapseProbe().indexedToolCalls).toBeLessThanOrEqual(maxSessions * 5);

    for (let s = 0; s < 30; s++) store.deleteEventsForSession(`sess${s}`);
    expect(store.getCollapseProbe().indexedToolCalls).toBe(0);
  });

  it("X9: a plain-string predecessor that SETS the result survives a successor that does not", () => {
    // The `!dp && !ds` early return skipped the rendered-result rule entirely.
    // Neither event resolves `partialResult.details` here, but for DIFFERENT
    // reasons: the predecessor's `partialResult` is a plain string (the
    // reducer's unconditional overwrite branch — it SETS `result`), while the
    // successor is structured with neither `details` nor `content` (it sets
    // nothing). Collapsing the former into the latter LOSES the rendered result.
    const mkPlainString = (toolCallId: string, text: string): DashboardEvent => ({
      eventType: "tool_execution_update",
      timestamp: Date.now(),
      data: { toolCallId, toolName: "Agent", partialResult: text },
    });
    const mkStructuredNoContent = (toolCallId: string): DashboardEvent => ({
      eventType: "tool_execution_update",
      timestamp: Date.now(),
      data: { toolCallId, toolName: "Agent", partialResult: {} },
    });

    const store = createMemoryEventStore(neverPinnedFn, 100);
    store.insertEvent("s", mkPlainString("t1", "older output"));
    // Bind the assertion to THIS event specifically. Asserting "some update
    // still sets a result" would pass on a surviving earlier tick even when the
    // one under test was wrongly collapsed, so the test must name its subject.
    const tailSeq = store.insertEvent("s", mkPlainString("t1", "rendered output"));
    store.insertEvent("s", mkStructuredNoContent("t1")); // sets nothing

    const events = store.getEvents("s", 1);
    const tail = events.find((e) => e.seq === tailSeq);
    expect(tail).toBeDefined();
    expect((tail?.event.data as Record<string, unknown>).partialResult).toBe("rendered output");
  });

  it("X8: the collapse index does not grow unboundedly within ONE long-lived session", () => {
    // The buffer's EVENTS are capped by `trimBufferToLimit`, but the collapse
    // index is keyed by `toolCallId`. Without pruning it gains one permanent
    // entry per distinct tool call for the life of the session — an uncapped
    // map introduced by a change whose whole purpose is to bound memory (the
    // D6.4 leak argument, applied within a session rather than across them).
    const cap = 20;
    const store = createMemoryEventStore(neverPinnedFn, 100, cap);
    const distinctCalls = 500;
    for (let c = 0; c < distinctCalls; c++) {
      store.insertEvent("long-lived", mkUpdate(`call${c}`));
      store.insertEvent("long-lived", mkUpdate(`call${c}`));
    }
    // Every tool call but the most recent few has been trimmed out of the
    // buffer entirely, so its index entry names seqs that no longer exist.
    // trimSlack = min(256, floor(cap * 0.05)) = 1 at this cap.
    const bound = cap + 1;
    expect(store.getEvents("long-lived", 1).length).toBeLessThanOrEqual(bound);
    // The index must track the RESIDENT calls, not every call ever seen.
    expect(store.getCollapseProbe().indexedToolCalls).toBeLessThanOrEqual(bound);
  });

  it("X4: a re-ingested session takes no action on the previous residency's index", () => {
    const store = createMemoryEventStore(neverPinnedFn, 1);
    store.insertEvent("victim", mkUpdate("t1"));
    store.insertEvent("victim", mkUpdate("t1"));
    // Evict `victim` by exceeding the 1-session cap.
    store.insertEvent("other", mkTyped("message_start"));
    expect(store.hasEvents("victim")).toBe(false);

    const seq = store.insertEvent("victim", mkUpdate("t1"));
    const events = store.getEvents("victim", 1);
    // Fresh buffer, fresh index: the update is simply the first of a new run.
    expect(events).toHaveLength(1);
    expect(events[0].seq).toBe(seq);
  });

  it("X7: a late update after tool_execution_end applies the policy unchanged", () => {
    const store = createMemoryEventStore(neverPinnedFn);
    store.insertEvent("s", mkUpdate("t1")); // creating (pinned)
    store.insertEvent("s", mkUpdate("t1")); // retained newest
    const endSeq = store.insertEvent("s", mkTyped("tool_execution_end", "t1"));
    const lateSeq = store.insertEvent("s", mkUpdate("t1"));

    // The superseded predecessor collapsed; the terminal end is untouched.
    expect(store.getEvent("s", endSeq)?.eventType).toBe("tool_execution_end");
    expect(updatesFor(store, "s", "t1").map((e) => e.seq)).toEqual([1, lateSeq]);
    expect(store.getMaxSeq("s")).toBe(lateSeq);
  });
});
