/**
 * THE ACCEPTANCE GATE for compact-warm-replay-stream (test-plan F1, F2, F4, X3).
 *
 * The compaction lives in `packages/server`, but its correctness is defined
 * entirely by the CLIENT reducer: dropping an event is legal only when the
 * reduced `SessionState` is deep-equal. This test therefore deliberately
 * crosses the server/client boundary (design D3) and imports
 * `packages/client/src/lib/chat/event-reducer.ts` directly.
 *
 * If this file ever fails, the compaction rule is wrong — not the test.
 */
import { describe, expect, it } from "vitest";
import { createInitialState, reduceEvent, type SessionState } from "../../../client/src/lib/chat/event-reducer.js";
import type { StoredEvent } from "../persistence/memory-event-store.js";
import { compactEventsForReplay } from "../session/replay-compaction.js";
import {
  plainMessageWindow,
  streamingTailWindow,
  subagentInterleavedWindow,
  textToolTextWindow,
  thinkingMessageWindow,
} from "./fixtures/replay-streams.js";

function reduceAll(stored: StoredEvent[]): SessionState {
  return stored.reduce((s, e) => reduceEvent(s, e.event), createInitialState());
}

/**
 * `SessionState` carries a `Map` (`toolCalls`); vitest's `toEqual` compares Maps
 * structurally, so no normalization is needed — but Sets/Maps inside must be
 * compared by value, which `toEqual` does.
 */
function expectEquivalent(raw: StoredEvent[]): void {
  const compacted = compactEventsForReplay(raw);
  expect(compacted.length).toBeLessThanOrEqual(raw.length);
  expect(reduceAll(compacted)).toEqual(reduceAll(raw));
}

describe("reducer equivalence — compacted replay reduces to the same SessionState", () => {
  it("F1: plain assistant message", () => {
    expectEquivalent(plainMessageWindow());
  });

  it("F2: [text, toolCall, text] — streamingTextFlushed reorder path", () => {
    const raw = textToolTextWindow();
    expectEquivalent(raw);
    // Guard the specific hazard: the flushed assistant row must not be
    // resurrected as a second row, and text1 must not reappear standalone.
    const s = reduceAll(compactEventsForReplay(raw));
    expect(s.messages.filter((m) => m.role === "assistant")).toHaveLength(1);
    expect(s.streamingText).toBe("");
  });

  it("streaming tail: the un-finalized message still converges", () => {
    expectEquivalent(streamingTailWindow());
  });

  it("X3: subagent-interleaved window — subagent_* events survive in order", () => {
    const raw = subagentInterleavedWindow();
    expectEquivalent(raw);
    const compacted = compactEventsForReplay(raw);
    expect(compacted.map((e) => e.event.eventType).filter((t) => t.startsWith("subagent_"))).toEqual([
      "subagent_created",
      "subagent_started",
      "subagent_completed",
    ]);
  });
});

describe("F4: thinking policy (decides D2)", () => {
  const raw = thinkingMessageWindow();

  const isThinkingUpdate = (e: StoredEvent) =>
    e.event.eventType === "message_update" &&
    typeof (e.event.data.assistantMessageEvent as { type?: unknown } | undefined)?.type === "string" &&
    ((e.event.data.assistantMessageEvent as { type: string }).type.startsWith("thinking"));

  it("the SHIPPED policy is deep-equal", () => {
    expect(reduceAll(compactEventsForReplay(raw))).toEqual(reduceAll(raw));
  });

  it("the alternative policy (drop thinking updates too) is NOT deep-equal — so exempting them is required", () => {
    // Derive the alternative from the shipped output so the two policies differ
    // in exactly one dimension.
    const alternative = compactEventsForReplay(raw).filter((e) => !isThinkingUpdate(e));
    expect(alternative.length).toBeLessThan(compactEventsForReplay(raw).length);
    expect(reduceAll(alternative)).not.toEqual(reduceAll(raw));
  });
});

describe("unfinished text replay", () => {
  const update = (seq: number, content: string | unknown[]): StoredEvent => ({ seq, bytes: 0, event: { eventType: "message_update", timestamp: 1700000000000 + seq, data: { message: { role: "assistant", content } } } });
  it("P1: 100 growing snapshots retain only the last and reduce to the same state", () => {
    const raw = Array.from({length: 100}, (_, i) => update(i + 1, "x".repeat((i + 1) * 1024)));
    const compacted = compactEventsForReplay(raw);
    expect(compacted).toHaveLength(1); expect(compacted[0]).toBe(raw[99]);
    expect(Buffer.byteLength(JSON.stringify(compacted))).toBeLessThan(Buffer.byteLength(JSON.stringify(raw)));
    expect(reduceAll(compacted)).toEqual(reduceAll(raw));
  });
  it("F1: shrinking to empty replaces prior text and survives live continuation", () => {
    for (const empty of ["", []]) {
      const raw = [update(1,"abcdef"), update(2,"ab"), update(3,empty)];
      const compacted = compactEventsForReplay(raw);
      expect(compacted[0]).toBe(raw[2]);
      let reference = reduceAll(raw); let actual = reduceAll(compacted);
      expect(reference.streamingText).toBe(""); expect(actual).toEqual(reference);
      const live = update(4,"later");
      reference = reduceEvent(reference, live.event); actual = reduceEvent(actual, live.event);
      expect(actual).toEqual(reference);
      const end: StoredEvent = { seq: 5, bytes: 0, event: { eventType: "message_end", timestamp: 1700000000005, data: { message: { role: "assistant", content: [{type:"text", text:"later"}] } } } };
      expect(reduceEvent(actual, end.event)).toEqual(reduceEvent(reference, end.event));
    }
  });
  it("F2: tail boundaries match an independently declared old-policy replay", () => {
    const entry = (seq: number, eventType: string, data: Record<string, unknown>): StoredEvent => ({ seq, bytes: 0, event: { eventType, timestamp: 1700000000000 + seq, data } });
    const raw = [entry(1,"message_start", {message: {role: "assistant", content: []}}), update(2,"old"), entry(3,"message_end", {message: {role:"assistant", content:[{type:"text", text:"old"}]}}), entry(4,"message_start", {message: {role:"assistant", content:[]}}), update(5,"a"), update(6,"ab"), entry(7,"message_update", {assistantMessageEvent:{type:"thinking_start"}}), entry(8,"message_update", {assistantMessageEvent:{type:"thinking_delta", delta:"hmm"}}), entry(9,"message_update", {assistantMessageEvent:{type:"thinking_end"}}), update(10,"c"), update(11,"cd"), entry(12,"tool_execution_start", {toolCallId:"c1", toolName:"read", args:{}}), entry(13,"subagent_created", {id:"s1", type:"Explore", description:"inspect"}), entry(14,"tool_execution_end", {toolCallId:"c1", toolName:"read", result:"ok"}), update(15,"e"), update(16,"ef")];
    const oldPolicy = raw.filter(e => e.seq !== 2);
    const candidate = compactEventsForReplay(raw);
    expect(candidate.map(e => e.seq)).toEqual([1,3,4,6,7,8,9,11,12,13,14,16]);
    expect(reduceAll(oldPolicy.filter(e => e.seq <= 13)).subagents.get("s1")).toMatchObject({ id: "s1", type: "Explore", description: "inspect", status: "created" });
    expect(reduceAll(candidate.filter(e => e.seq <= 13)).subagents.get("s1")).toMatchObject({ id: "s1", type: "Explore", description: "inspect", status: "created" });
    for (const boundary of [6,7,8,9,11,12,13,14,16]) {
      expect(reduceAll(candidate.filter(e => e.seq <= boundary))).toEqual(reduceAll(oldPolicy.filter(e => e.seq <= boundary)));
    }
  });
  function generatedConsumerCase(seed: number) {
      const final = seed % 2 ? "" : `regrown-${seed}`;
      const raw = [update(3, "a"), update(4, "abcdef"), update(5, "ab"), update(6, ""), update(7, final)];
      if (seed % 2 === 0) raw[4] = update(7, [{ type: "text", text: final }]);
      const separators = [
        { eventType: "message_update", timestamp: 1700000000007, data: { assistantMessageEvent: { type: "thinking_start" } } },
        { eventType: "message_update", timestamp: 1700000000008, data: { assistantMessageEvent: { type: "thinking_delta", delta: "thought" } } },
        { eventType: "message_update", timestamp: 1700000000009, data: { assistantMessageEvent: { type: "thinking_end" } } },
        { eventType: "tool_execution_start", timestamp: 1700000000010, data: { toolCallId: `later-${seed}`, toolName: "Agent", args: {} } },
        { eventType: "subagent_created", timestamp: 1700000000011, data: { id: `agent-${seed}`, type: "Explore", description: "inspect" } },
        { eventType: "tool_execution_end", timestamp: 1700000000012, data: { toolCallId: `later-${seed}`, toolName: "Agent", result: "ok" } },
      ];
      const second = seed % 2 ? [update(14, "only")] : [update(14, "grow"), update(15, "growth")];
      const live = update(16, "live");
      const end = { eventType: "message_end", timestamp: 1700000000017, data: { message: { role: "assistant", content: [{type: "text", text: "live"}] } } };
      const prelude = seed % 3 === 0 ? [] : [update(1, "prelude").event];
      if (seed % 3 === 2) prelude.push({ eventType: "tool_execution_start", timestamp: 1700000000002, data: { toolCallId: `c${seed}`, toolName: "read", args: {} } });
    return { final, raw, separators, second, live, end, prelude };
  }

  function assertConsumerCase(seed: number, fixture: ReturnType<typeof generatedConsumerCase>, partitions: Set<string>) {
    const { final, raw, prelude } = fixture;
      let reference = createInitialState();
      for (const event of prelude) reference = reduceEvent(reference, event);
      if (seed % 3 === 2) expect(reference.streamingTextFlushed).toBe(true);
      partitions.add(`initial-${seed % 3}`);
      let actual = reference;
      const initial = reference;
      partitions.add(seed % 2 === 0 ? "text-array" : "string");
      const compacted = compactEventsForReplay(raw);
      expect(compacted).toEqual([raw[4]]);
      for (const entry of raw) reference = reduceEvent(reference, entry.event);
      for (const entry of compacted) actual = reduceEvent(actual, entry.event);
      expect(actual, `seed ${seed}`).toEqual(reference);
      expect(reference.streamingText).toBe(seed % 3 === 2 ? "" : final);
    assertConsumerContinuation(seed, fixture, partitions, initial, reference, actual);
  }

  function assertConsumerContinuation(seed: number, fixture: ReturnType<typeof generatedConsumerCase>, partitions: Set<string>, initial: SessionState, reference: SessionState, actual: SessionState) {
    const { final, raw, separators, second, live, end } = fixture;
      for (const separator of separators) {
        reference = reduceEvent(reference, separator); actual = reduceEvent(actual, separator);
        expect(actual).toEqual(reference);
      }
      expect(reference.toolCalls.get(`later-${seed}`)?.status).toBe("complete");
      const wasFlushed = reference.streamingTextFlushed;
      partitions.add(second.length === 1 ? "singleton" : "multiple");
      const secondCompacted = compactEventsForReplay(second);
      expect(secondCompacted).toEqual([second[second.length - 1]]);
      for (const event of second) reference = reduceEvent(reference, event.event);
      for (const event of secondCompacted) actual = reduceEvent(actual, event.event);
      expect(actual).toEqual(reference);
      const combined = [...raw, ...separators.map((event, i) => ({ seq: 8 + i, bytes: 0, event })), ...second];
      const combinedResult = compactEventsForReplay(combined);
      expect(combinedResult).toEqual([raw[4], ...combined.slice(raw.length, raw.length + separators.length), second[second.length - 1]]);
      expect(combinedResult.reduce((state, entry) => reduceEvent(state, entry.event), initial)).toEqual(reference);
      expect(reference.streamingText).toBe(wasFlushed ? "" : seed % 2 ? "only" : "growth");
      reference = reduceEvent(reference, live.event); actual = reduceEvent(actual, live.event);
      expect(actual).toEqual(reference);
      expect(reduceEvent(actual, end)).toEqual(reduceEvent(reference, end));
      partitions.add(final ? "regrowth" : "empty");
  }

  it("E10: generated unfinished runs agree at retained boundaries and live continuation", () => {
    const partitions = new Set<string>();
    const generatedInputs: Array<{ seed: number; input: string }> = [];
    for (let seed = 0; seed < 240; seed++) {
      const fixture = generatedConsumerCase(seed);
      const input = JSON.stringify(fixture);
      generatedInputs.push({ seed, input });
      try {
        assertConsumerCase(seed, fixture, partitions);
      } catch (error) {
        throw new Error(`E10 seed ${seed}, input ${input}`, { cause: error });
      }
    }
    expect([...partitions].sort(), `E10 generated inputs ${JSON.stringify(generatedInputs)}`).toEqual(["empty", "initial-0", "initial-1", "initial-2", "multiple", "regrowth", "singleton", "string", "text-array"]);
  });

});
