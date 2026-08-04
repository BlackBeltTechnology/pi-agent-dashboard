/**
 * Replay-stream fixtures for `compactEventsForReplay` (change:
 * compact-warm-replay-stream).
 *
 * Each builder returns a `StoredEvent[]` shaped like a real WARM (in-memory)
 * session window — i.e. the raw live stream the bridge forwards, where every
 * assistant `message_update` is a FULL SNAPSHOT of the accumulated content, not
 * a delta (see `packages/client/src/lib/chat/event-reducer.ts` `message_update`).
 *
 * These are the trusted baselines for the reducer-equivalence gate (test-plan
 * F1/F2/F4/X3): a fixture is only useful if the CURRENT reducer already turns it
 * into a sane `SessionState` (asserted in `replay-streams.test.ts`).
 */
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import type { StoredEvent } from "../../persistence/memory-event-store.js";

const T0 = 1_700_000_000_000;

/** Monotonic seq/timestamp emitter so every fixture shares one shape. */
export class StreamBuilder {
  private seq = 0;
  private events: StoredEvent[] = [];

  push(eventType: string, data: Record<string, unknown>): this {
    this.seq += 1;
    const event: DashboardEvent = { eventType, timestamp: T0 + this.seq, data };
    this.events.push({ seq: this.seq, event });
    return this;
  }

  build(): StoredEvent[] {
    return this.events;
  }
}

export interface TextBlock {
  type: "text";
  text: string;
}
export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
}
export interface ToolCallBlock {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}
export type ContentBlock = TextBlock | ThinkingBlock | ToolCallBlock;

function assistant(content: ContentBlock[], stopReason = "stop") {
  return { role: "assistant", content, stopReason };
}

/**
 * Chunk a string into EXACTLY `min(n, text.length)` cumulative prefixes
 * (snapshot semantics — each update carries the whole accumulated text so far,
 * the last one carries the full string).
 */
function cumulativePrefixes(text: string, n: number): string[] {
  const count = Math.max(1, Math.min(n, text.length));
  const out: string[] = [];
  for (let i = 1; i <= count; i++) {
    out.push(text.slice(0, Math.round((text.length * i) / count)));
  }
  return out;
}

/**
 * F1 — plain assistant message: user turn, then an assistant message streamed
 * over `updates` snapshot updates and finalized by `message_end`.
 */
export function plainMessageWindow(updates = 12): StoredEvent[] {
  const text = "The answer is forty-two, and here is a slightly longer explanation.";
  const b = new StreamBuilder();
  b.push("message_start", { message: { role: "user", content: [{ type: "text", text: "why?" }] }, entryId: "u1" });
  b.push("message_start", { message: { role: "assistant", content: [] } });
  for (const prefix of cumulativePrefixes(text, updates)) {
    b.push("message_update", { message: assistant([{ type: "text", text: prefix }]) });
  }
  b.push("message_end", { message: assistant([{ type: "text", text }]), entryId: "a1" });
  return b.build();
}

/**
 * F2 — `[text, toolCall, text]` message: exercises the client's
 * `streamingTextFlushed` reorder path (flush at `tool_execution_start`, second
 * text block lands only at `message_end`).
 */
export function textToolTextWindow(): StoredEvent[] {
  const text1 = "Let me check the file first.";
  const text2 = "It contains the config we expected.";
  const call: ToolCallBlock = { type: "toolCall", id: "call-1", name: "read", arguments: { path: "a.ts" } };
  const b = new StreamBuilder();
  b.push("message_start", { message: { role: "user", content: [{ type: "text", text: "read a.ts" }] }, entryId: "u1" });
  b.push("message_start", { message: { role: "assistant", content: [] } });
  for (const prefix of cumulativePrefixes(text1, 6)) {
    b.push("message_update", { message: assistant([{ type: "text", text: prefix }]) });
  }
  b.push("tool_execution_start", { toolCallId: "call-1", toolName: "read", args: { path: "a.ts" } });
  b.push("tool_execution_end", { toolCallId: "call-1", toolName: "read", result: "export const x = 1;" });
  for (const prefix of cumulativePrefixes(text2, 6)) {
    b.push("message_update", {
      message: assistant([{ type: "text", text: text1 }, call, { type: "text", text: prefix }]),
    });
  }
  b.push("message_end", {
    message: assistant([{ type: "text", text: text1 }, call, { type: "text", text: text2 }]),
    entryId: "a1",
  });
  return b.build();
}

/**
 * F4 — thinking-bearing message: `thinking_start | thinking_delta* |
 * thinking_end` ride on `message_update.data.assistantMessageEvent`, and the
 * SAME reasoning also lands inline as a `thinking` block on `message_end`
 * (which is what `reconstruct-reasoning-on-replay` rebuilds from).
 */
export function thinkingMessageWindow(): StoredEvent[] {
  const reasoning = "First check the store, then the handler.";
  const text = "Compaction happens in the subscription handler.";
  const b = new StreamBuilder();
  b.push("message_start", { message: { role: "user", content: [{ type: "text", text: "where?" }] }, entryId: "u1" });
  b.push("message_start", { message: { role: "assistant", content: [] } });
  b.push("message_update", { assistantMessageEvent: { type: "thinking_start" } });
  for (const chunk of reasoning.match(/.{1,10}/g) ?? []) {
    b.push("message_update", { assistantMessageEvent: { type: "thinking_delta", delta: chunk } });
  }
  b.push("message_update", { assistantMessageEvent: { type: "thinking_end" } });
  for (const prefix of cumulativePrefixes(text, 6)) {
    b.push("message_update", { message: assistant([{ type: "text", text: prefix }]) });
  }
  b.push("message_end", {
    message: assistant([{ type: "thinking", thinking: reasoning }, { type: "text", text }]),
    entryId: "a1",
  });
  return b.build();
}

/**
 * E9 / F3 — mid-turn streaming tail: message M1 is finalized, M2 is still
 * streaming (no `message_end`). Everything after the LAST `message_end` must
 * survive compaction untouched.
 */
export function streamingTailWindow(tailUpdates = 12): StoredEvent[] {
  const m1 = "First message, complete.";
  const m2 = "Second message, still arriving right now.";
  const b = new StreamBuilder();
  b.push("message_start", { message: { role: "user", content: [{ type: "text", text: "go" }] }, entryId: "u1" });
  b.push("message_start", { message: { role: "assistant", content: [] } });
  for (const prefix of cumulativePrefixes(m1, 8)) {
    b.push("message_update", { message: assistant([{ type: "text", text: prefix }]) });
  }
  b.push("message_end", { message: assistant([{ type: "text", text: m1 }]), entryId: "a1" });
  b.push("message_start", { message: { role: "assistant", content: [] } });
  for (const prefix of cumulativePrefixes(m2, tailUpdates)) {
    b.push("message_update", { message: assistant([{ type: "text", text: prefix }]) });
  }
  return b.build();
}

/**
 * X3 — subagent-interleaved window. Subagent inner timelines reach the parent
 * buffer as `subagent_*` events (`SUBAGENT_CHANNELS` in
 * `packages/extension/src/subagent-frame-buffer.ts`), NEVER as raw
 * `message_update`; this fixture pins that shape so the positional rule cannot
 * silently start eating a foreign producer's updates.
 */
export function subagentInterleavedWindow(): StoredEvent[] {
  const text = "Delegating to a subagent, then summarizing.";
  const call: ToolCallBlock = { type: "toolCall", id: "call-sa", name: "Agent", arguments: { task: "explore" } };
  const b = new StreamBuilder();
  b.push("message_start", { message: { role: "user", content: [{ type: "text", text: "explore" }] }, entryId: "u1" });
  b.push("message_start", { message: { role: "assistant", content: [] } });
  b.push("message_update", { message: assistant([{ type: "text", text: text.slice(0, 12) }]) });
  b.push("tool_execution_start", { toolCallId: "call-sa", toolName: "Agent", args: { task: "explore" } });
  b.push("subagent_created", { agentId: "sa-1", name: "Explore", toolCallId: "call-sa" });
  b.push("subagent_started", { agentId: "sa-1", name: "Explore", toolCallId: "call-sa" });
  b.push("message_update", { message: assistant([{ type: "text", text: text.slice(0, 24) }]) });
  b.push("subagent_completed", { agentId: "sa-1", name: "Explore", toolCallId: "call-sa", result: "found it" });
  b.push("tool_execution_end", { toolCallId: "call-sa", toolName: "Agent", result: "found it" });
  b.push("message_update", { message: assistant([{ type: "text", text }, call]) });
  b.push("message_end", { message: assistant([{ type: "text", text }, call]), entryId: "a1" });
  return b.build();
}

/** All five equivalence fixtures, keyed by test-plan scenario. */
export const REPLAY_FIXTURES: Record<string, () => StoredEvent[]> = {
  plain: plainMessageWindow,
  textToolText: textToolTextWindow,
  thinking: thinkingMessageWindow,
  streamingTail: streamingTailWindow,
  subagentInterleaved: subagentInterleavedWindow,
};

/**
 * P2 / P3 — synthetic #399-shaped window: `messages` finalized assistant
 * messages, each streamed over `updatesPerMessage` snapshot updates. Defaults
 * yield ~20k events with ~93% superseded updates.
 */
export function largeSyntheticWindow(messages = 140, updatesPerMessage = 150): StoredEvent[] {
  const b = new StreamBuilder();
  for (let m = 0; m < messages; m++) {
    // Body must be >= updatesPerMessage chars so the cumulative chunker can
    // actually emit that many distinct snapshots.
    const text = `Message ${m} body text that streams in over many snapshot updates. `.repeat(
      Math.ceil(updatesPerMessage / 60) + 1,
    );
    b.push("message_start", { message: { role: "user", content: [{ type: "text", text: `q${m}` }] }, entryId: `u${m}` });
    b.push("message_start", { message: { role: "assistant", content: [] } });
    for (const prefix of cumulativePrefixes(text, updatesPerMessage)) {
      b.push("message_update", { message: assistant([{ type: "text", text: prefix }]) });
    }
    b.push("message_end", { message: assistant([{ type: "text", text }]), entryId: `a${m}` });
  }
  return b.build();
}
