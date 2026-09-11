/**
 * Replay of persisted `compaction` session entries (change:
 * replay-compaction-boundary).
 *
 * pi persists a `compaction` entry (shape: `{type, id, parentId, timestamp,
 * summary, tokensBefore, firstKeptEntryId, fromHook, details}`) when a session
 * compacts. The live bridge forwards a `session_compact` event, which the
 * client reducer renders as the `── Session compacted ──` divider. Replay had
 * no arm for the entry type, so a rebuilt transcript lost the divider and the
 * summarized turns rendered adjacent to the surviving ones — reading as data
 * loss. These tests gate the synthesized event: type, position, timestamp,
 * absent-metadata semantics and resilience to schema drift.
 *
 * Level L1 (pure converter). Scenarios E1–E7 + X1 of the change's test-plan.
 */
import { describe, expect, it } from "vitest";
import { replayEntriesAsEvents } from "../state-replay.js";

const T = (s: string) => `2026-04-27T07:26:${s}.000Z`;

function userEntry(id: string, text: string, timestamp: string, parentId: string | null = null) {
  return {
    type: "message",
    id,
    parentId,
    timestamp,
    message: { role: "user", content: [{ type: "text", text }] },
  };
}

/** A realistic pi `compaction` entry — every field the audit observed. */
function compactionEntry(id: string, timestamp: string, parentId: string | null = null, extra: Record<string, unknown> = {}) {
  return {
    type: "compaction",
    id,
    parentId,
    timestamp,
    summary: "SUMMARY: earlier turns collapsed",
    tokensBefore: 41000,
    firstKeptEntryId: "a1",
    fromHook: true,
    details: { readFiles: ["a.ts"], modifiedFiles: [] },
    ...extra,
  };
}

const compactEvents = (events: ReturnType<typeof replayEntriesAsEvents>) =>
  events.filter((e) => e.event.eventType === "session_compact");

// ── E1: boundary synthesized between neighbours ──────────────────────────────
describe("E1 — a compaction entry produces a boundary between its neighbours", () => {
  it("emits exactly one session_compact, indexed between A's and B's events, at C's timestamp", () => {
    const events = replayEntriesAsEvents("sess-1", [
      userEntry("a1", "A", T("25")),
      compactionEntry("c1", T("26"), "a1"),
      userEntry("b1", "B", T("27"), "c1"),
    ]);

    expect(compactEvents(events)).toHaveLength(1);
    const aIdx = events.findIndex((e) => e.event.eventType === "message_start" && e.event.data.entryId === "a1");
    const cIdx = events.findIndex((e) => e.event.eventType === "session_compact");
    const bIdx = events.findIndex((e) => e.event.eventType === "message_start" && e.event.data.entryId === "b1");
    expect(aIdx).toBeGreaterThanOrEqual(0);
    expect(bIdx).toBeGreaterThanOrEqual(0);
    expect(aIdx).toBeLessThan(cIdx);
    expect(cIdx).toBeLessThan(bIdx);
    expect(events[cIdx].event.timestamp).toBe(new Date(T("26")).getTime());
  });
});

// ── E2: no-compaction output unchanged ───────────────────────────────────────
describe("E2 — compaction-free replay is unchanged", () => {
  it("emits exactly the pre-change event sequence (nothing added, removed or reordered)", () => {
    const events = replayEntriesAsEvents("sess-1", [
      userEntry("u1", "hello", T("20")),
      {
        type: "message",
        id: "a1",
        parentId: "u1",
        timestamp: T("21"),
        message: {
          role: "assistant",
          content: [
            { type: "toolCall", id: "t1", name: "read", arguments: { path: "a.ts" } },
            { type: "text", text: "done" },
          ],
          usage: { input: 10, output: 5, cost: { total: 0.01 }, totalTokens: 15 },
        },
      },
      {
        type: "message",
        id: "r1",
        parentId: "a1",
        timestamp: T("22"),
        message: { role: "toolResult", toolCallId: "t1", toolName: "read", content: [{ type: "text", text: "ok" }] },
      },
      { type: "model_change", id: "m1", parentId: "r1", timestamp: T("23"), provider: "anthropic", modelId: "claude" },
    ]);

    // Golden (eventType, timestamp) sequence — pins add/remove/reorder.
    expect(events.map((e) => [e.event.eventType, e.event.timestamp])).toEqual([
      ["message_start", new Date(T("20")).getTime()],
      ["tool_execution_start", new Date(T("21")).getTime()],
      ["message_update", new Date(T("21")).getTime()],
      ["message_end", new Date(T("21")).getTime()],
      ["stats_update", new Date(T("21")).getTime()],
      ["tool_execution_end", new Date(T("22")).getTime()],
      ["model_select", new Date(T("23")).getTime()],
    ]);
    expect(compactEvents(events)).toHaveLength(0);
  });
});

// ── E3: multiplicity ─────────────────────────────────────────────────────────
describe("E3 — one boundary per compaction entry, in entry order", () => {
  it.each([0, 1, 2, 3])("a branch with %i compaction entries emits %i boundaries", (count) => {
    const entries: unknown[] = [userEntry("u1", "start", T("10"))];
    for (let i = 0; i < count; i++) {
      entries.push(compactionEntry(`c${i}`, T(String(11 + i))));
      entries.push(userEntry(`u${i + 2}`, `after ${i}`, T(String(20 + i))));
    }

    const events = replayEntriesAsEvents("sess-1", entries);
    const boundaries = compactEvents(events);
    expect(boundaries).toHaveLength(count);
    expect(boundaries.map((e) => e.event.timestamp)).toEqual(
      Array.from({ length: count }, (_, i) => new Date(T(String(11 + i))).getTime()),
    );
  });
});

// ── E4: positional boundaries ────────────────────────────────────────────────
describe("E4 — first-entry and last-entry positions", () => {
  it("emits the boundary first when the compaction is the first entry, neighbours intact", () => {
    const events = replayEntriesAsEvents("sess-1", [
      compactionEntry("c1", T("30")),
      userEntry("a1", "A", T("31"), "c1"),
    ]);
    expect(events[0].event.eventType).toBe("session_compact");
    expect(events.find((e) => e.event.eventType === "message_start" && e.event.data.entryId === "a1")).toBeDefined();
  });

  it("emits the boundary last when the compaction is the last entry, neighbours intact", () => {
    const events = replayEntriesAsEvents("sess-1", [
      userEntry("a1", "A", T("30")),
      compactionEntry("c1", T("31"), "a1"),
    ]);
    expect(events.at(-1)?.event.eventType).toBe("session_compact");
    expect(events.find((e) => e.event.eventType === "message_start" && e.event.data.entryId === "a1")).toBeDefined();
  });
});

// ── E5: metadata is not fabricated ───────────────────────────────────────────
describe("E5 — absent compaction metadata is not invented", () => {
  it("emits no reason, willRetry or estimatedPostCompactionTokens key", () => {
    const events = replayEntriesAsEvents("sess-1", [
      compactionEntry("c1", T("40"), null, {
        summary: "big",
        tokensBefore: 99000,
        firstKeptEntryId: "x",
        fromHook: true,
        details: { foo: "bar" },
      }),
    ]);
    const data = compactEvents(events)[0].event.data as Record<string, unknown>;
    expect(data).not.toHaveProperty("reason");
    expect(data).not.toHaveProperty("willRetry");
    expect(data).not.toHaveProperty("estimatedPostCompactionTokens");
    // Only the protocol `type` tag rides the synthesized event.
    expect(Object.keys(data)).toEqual(["type"]);
  });
});

// ── E6: summary never leaks into the stream ──────────────────────────────────
describe("E6 — the entry's summary is not rendered", () => {
  it("carries no substring of a 64 KB summary", () => {
    const marker = "SUMMARIZING-SECRET-MARKER";
    const summary = `${marker}-HEAD ${"x".repeat(64 * 1024)} ${marker}-TAIL`;
    const events = replayEntriesAsEvents("sess-1", [compactionEntry("c1", T("50"), null, { summary })]);
    const wire = JSON.stringify(events);
    expect(wire).not.toContain(marker);
    expect(compactEvents(events)).toHaveLength(1);
  });
});

// ── E7: schema drift tolerated ───────────────────────────────────────────────
describe("E7 — schema drift is tolerated", () => {
  it("emits one boundary each when timestamp/tokensBefore are missing and an unknown field is present", () => {
    const before = Date.now();
    let events: ReturnType<typeof replayEntriesAsEvents> = [];
    expect(() => {
      events = replayEntriesAsEvents("sess-1", [
        { type: "compaction", id: "c1", summary: "s" },
        { type: "compaction", id: "c2", timestamp: T("60"), summary: "s2", tokensBefore: undefined, usage: { bogus: true } },
      ]);
    }).not.toThrow();

    const boundaries = compactEvents(events);
    expect(boundaries).toHaveLength(2);
    // Missing timestamp degrades to the converter's existing Date.now() fallback.
    expect(boundaries[0].event.timestamp).toBeGreaterThanOrEqual(before);
    expect(boundaries[1].event.timestamp).toBe(new Date(T("60")).getTime());
    // Unknown entry fields are ignored, not forwarded.
    expect(boundaries[1].event.data).not.toHaveProperty("usage");
  });
});

// ── X1: one bad entry does not abort the replay ──────────────────────────────
describe("X1 — a malformed compaction entry does not abort the replay", () => {
  it("still emits the valid message events around a truncated compaction entry", () => {
    let events: ReturnType<typeof replayEntriesAsEvents> = [];
    expect(() => {
      events = replayEntriesAsEvents("sess-1", [
        userEntry("a1", "A", T("70")),
        { type: "compaction" },
        userEntry("b1", "B", T("72"), "c1"),
      ]);
    }).not.toThrow();

    expect(events.find((e) => e.event.eventType === "message_start" && e.event.data.entryId === "a1")).toBeDefined();
    expect(events.find((e) => e.event.eventType === "message_start" && e.event.data.entryId === "b1")).toBeDefined();
    expect(compactEvents(events)).toHaveLength(1);
  });
});
