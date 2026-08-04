/**
 * Task 1.2 — the fixtures are only trustworthy as an equivalence baseline if the
 * CURRENT (uncompacted) client reducer already turns each of them into a sane
 * `SessionState`. Asserted here once, so a failure in
 * `replay-compaction-equivalence.test.ts` can only mean the compaction is wrong.
 *
 * See change: compact-warm-replay-stream.
 */
import { describe, expect, it } from "vitest";
import { createInitialState, reduceEvent, type SessionState } from "../../../client/src/lib/chat/event-reducer.js";
import type { StoredEvent } from "../persistence/memory-event-store.js";
import {
  plainMessageWindow,
  streamingTailWindow,
  subagentInterleavedWindow,
  textToolTextWindow,
  thinkingMessageWindow,
} from "./fixtures/replay-streams.js";

export function reduceAll(stored: StoredEvent[]): SessionState {
  return stored.reduce((s, e) => reduceEvent(s, e.event), createInitialState());
}

const roles = (s: SessionState) => s.messages.map((m) => m.role);
const contentOf = (s: SessionState, role: string) =>
  s.messages.filter((m) => m.role === role).map((m) => m.content);

describe("replay-stream fixtures reduce sanely with the current reducer", () => {
  it("plain assistant message → [user, assistant] with the full final text", () => {
    const s = reduceAll(plainMessageWindow());
    expect(roles(s)).toEqual(["user", "assistant"]);
    expect(contentOf(s, "assistant")[0]).toBe(
      "The answer is forty-two, and here is a slightly longer explanation.",
    );
    expect(s.streamingText).toBe("");
  });

  it("[text, toolCall, text] → text1 flushed once, tool card present, no resurrected text1", () => {
    const s = reduceAll(textToolTextWindow());
    expect(roles(s)).toContain("toolResult");
    const assistants = contentOf(s, "assistant");
    // Exactly one assistant row; the flushed row is stamped in place, never duplicated.
    expect(assistants).toHaveLength(1);
    expect(s.streamingText).toBe("");
    expect(s.messages.some((m) => m.toolCallId === "call-1")).toBe(true);
  });

  it("thinking-bearing message → exactly one thinking row, no double-reconstruction", () => {
    const s = reduceAll(thinkingMessageWindow());
    const thinking = s.messages.filter((m) => m.role === "thinking");
    expect(thinking).toHaveLength(1);
    expect(thinking[0].content).toBe("First check the store, then the handler.");
    expect(contentOf(s, "assistant")[0]).toBe("Compaction happens in the subscription handler.");
  });

  it("streaming tail → M1 committed, M2 still in streamingText", () => {
    const s = reduceAll(streamingTailWindow());
    expect(contentOf(s, "assistant")).toEqual(["First message, complete."]);
    expect(s.streamingText).toBe("Second message, still arriving right now.");
  });

  it("subagent-interleaved → subagent state tracked, parent message finalized", () => {
    const s = reduceAll(subagentInterleavedWindow());
    expect(contentOf(s, "assistant")[0]).toBe("Delegating to a subagent, then summarizing.");
    expect(s.messages.some((m) => m.toolCallId === "call-sa")).toBe(true);
  });
});
