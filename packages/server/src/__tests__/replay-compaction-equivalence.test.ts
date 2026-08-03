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
