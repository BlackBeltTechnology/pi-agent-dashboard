/**
 * Bridge coalescing — wire ORDERING at the lifecycle boundaries.
 *
 * Two layers, because the bridge's ordering invariant is a proximity rule that
 * no in-process unit test can reach (no test instantiates `initBridge`: it opens
 * a WebSocket, mDNS, and interval timers at load):
 *
 *  1. **Model** (E17–E20): a reduced model of the bridge's event pipeline —
 *     entry flush → barrier → early-returning branches → deferred send — driving
 *     the REAL `MessageUpdateCoalescer` and the REAL
 *     `flushesParkedText` predicate. Same "reduced local model" shape the repo
 *     already uses for forward-site ordering (`bridge-queue-update-forward`,
 *     `bridge-followup-chat-order`); only the pipeline shape is restated.
 *  2. **Source contract**: the placement half — that the choke point really is
 *     at handler ENTRY (before every branch), that the out-of-loop sinks and
 *     `onReconnect` flush, and that the barrier sits ahead of `message_end`'s
 *     deferred send. A model cannot prove placement in the real file, and
 *     placement is the whole invariant: a branch-scoped flush is the bug.
 *
 * Do NOT confuse this file with `bridge-followup-chat-order.test.ts`, which
 * covers a DIFFERENT invariant (drained-queue user `message_start` vs the
 * preceding assistant `message_end`) and must stay untouched.
 *
 * See change: coalesce-bridge-message-update-snapshots (tasks 4.1–4.4).
 */
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COALESCE_WINDOW_MS,
  flushesParkedText,
  MessageUpdateCoalescer,
} from "../message-update-coalescer.js";

const BRIDGE_SOURCE = fs.readFileSync(new URL("../bridge.ts", import.meta.url), "utf8");

/** Slice `from` (inclusive) up to the next `to` (exclusive). */
function region(from: string, to: string): string {
  const start = BRIDGE_SOURCE.indexOf(from);
  expect(start, `missing anchor: ${from}`).toBeGreaterThanOrEqual(0);
  const end = BRIDGE_SOURCE.indexOf(to, start + from.length);
  expect(end, `missing terminator: ${to}`).toBeGreaterThan(start);
  return BRIDGE_SOURCE.slice(start, end);
}

/** Index of `needle` inside `haystack`, failing loudly when absent. */
function at(haystack: string, needle: string): number {
  const index = haystack.indexOf(needle);
  expect(index, `missing: ${needle}`).toBeGreaterThanOrEqual(0);
  return index;
}

interface WireRow {
  eventType: string;
  role?: string;
  text?: string;
}

/**
 * Reduced model of the bridge's forwarding pipeline. Every ordering rule below
 * mirrors a real statement, cited in the comment beside it.
 */
class BridgeModel {
  readonly wire: WireRow[] = [];
  active = true;
  ready = true;

  private readonly coalescer = new MessageUpdateCoalescer<Record<string, unknown>>({
    windowMs: COALESCE_WINDOW_MS,
    isActive: () => this.active && this.ready,
    send: (event) => {
      // The real send callback: liveness gate, then inliner, then map + send.
      if (!this.active || !this.ready) return;
      this.wire.push({ eventType: "message_update", text: textOf(event) });
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (timer) => clearTimeout(timer),
  });

  private gen = 0;
  private markIndex = 0;

  /** Ignore everything written during setup; assert only on what follows. */
  mark(): void {
    this.markIndex = this.wire.length;
  }

  /** Rows written since the last {@link mark}. */
  sinceMark(): WireRow[] {
    return this.wire.slice(this.markIndex);
  }

  private keyOf(message: any): string {
    return this.coalescer.keyOf(this.gen, message);
  }

  /** Mirrors the enriched-event handler body. */
  dispatchEnriched(eventType: string, event: any): void {
    if (!this.active) return;
    if (!this.ready) return;
    // ENTRY choke point — the real bridge's `if (flushesParkedText(...))`.
    if (flushesParkedText(eventType)) this.coalescer.flush();

    if (eventType === "message_start") {
      this.gen += 1;
      this.coalescer.messageStart(this.gen, this.keyOf(event.message));
      // Early-returning branch: a custom message is forwarded elsewhere.
      if (event.message?.role === "custom") return;
      if (event.message?.role === "user") {
        setTimeout(() => this.wire.push({ eventType, role: "user" }), 0);
      } else {
        this.wire.push({ eventType, role: event.message?.role });
      }
      return;
    }

    if (eventType === "message_end") {
      this.coalescer.messageEnd(this.gen, this.keyOf(event.message));
      // Deferred send (entryId capture).
      setTimeout(() => this.wire.push({ eventType, role: event.message?.role }), 0);
      return;
    }

    if (eventType === "message_update") {
      this.coalescer.offer(event, this.gen);
      return;
    }

    // The shared forward tail.
    this.wire.push({ eventType });
  }

  /** Mirrors the pass-through handler loop. */
  dispatchPassThrough(eventType: string): void {
    if (!this.active) return;
    if (!this.ready) return;
    this.coalescer.flush();
    this.wire.push({ eventType });
  }

  /** Mirrors `wrapCustomPersistenceForCtx`'s synthesized `custom_entry`. */
  appendCustomEntry(): void {
    this.coalescer.flush();
    this.wire.push({ eventType: "custom_entry" });
  }

  /** Mirrors `sendSyntheticRetryEvent`. */
  syntheticRetry(eventType: string): void {
    this.coalescer.flush();
    this.wire.push({ eventType });
  }

  /** Mirrors `onReconnect`: flush, then state sync, then replay. */
  reconnect(): void {
    this.coalescer.flush();
    this.wire.push({ eventType: "state_sync" });
    this.wire.push({ eventType: "replay" });
  }

  /** Drain deferred sends. */
  async drain(): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
  }
}

function textOf(event: Record<string, unknown>): string | undefined {
  const partial = (event as any)?.assistantMessageEvent?.partial;
  const content = partial?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  return content
    .filter((b: any) => b && b.type === "text")
    .map((b: any) => b.text ?? "")
    .join("");
}

/** A `message_update` carrying `text` as the accumulated snapshot. */
function textDelta(text: string, timestamp: number, role = "assistant"): Record<string, unknown> {
  const message: Record<string, unknown> = { role, timestamp, content: [{ type: "text", text }] };
  return {
    type: "message_update",
    message,
    assistantMessageEvent: { type: "text_delta", partial: message },
  };
}

/** Park one snapshot on the model's slot. */
function park(model: BridgeModel, text: string, timestamp: number): void {
  model.dispatchEnriched("message_start", { type: "message_start", message: { role: "assistant", timestamp } });
  model.dispatchEnriched("message_update", textDelta(text, timestamp));
  // Nothing on the wire yet — the window is still open.
  expect(model.wire.filter((row) => row.eventType === "message_update")).toHaveLength(0);
  // Everything from here on is the boundary under test.
  model.mark();
}

describe("bridge coalescing — choke-point predicate", () => {
  it("every event except message_update flushes parked text", () => {
    expect(flushesParkedText("message_update")).toBe(false);
    for (const type of [
      "message_start",
      "message_end",
      "turn_end",
      "agent_end",
      "agent_settled",
      "tool_execution_start",
      "tool_execution_update",
      "tool_execution_end",
      "model_select",
      "thinking_level_select",
      "session_compact",
      "user_bash",
      "input",
      "session_tree",
    ]) {
      expect(flushesParkedText(type), `${type} must flush`).toBe(true);
    }
  });
});

describe("bridge coalescing — ordering model (E17–E20)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("E17: an early-returning branch still flushes the parked snapshot", () => {
    const model = new BridgeModel();
    park(model, "before the custom message", 1000);

    // `role === "custom"` returns without forwarding anything.
    model.dispatchEnriched("message_start", {
      type: "message_start",
      message: { role: "custom", timestamp: 2000 },
    });

    // The snapshot is already on the wire before that branch returned.
    expect(model.sinceMark()).toEqual([
      { eventType: "message_update", text: "before the custom message" },
    ]);
  });

  it("E18: the deferred message_end lands AFTER the snapshot, and a gap delta is dropped", async () => {
    const model = new BridgeModel();
    park(model, "final answer", 1000);

    model.dispatchEnriched("message_end", {
      type: "message_end",
      message: { role: "assistant", timestamp: 1000 },
    });
    // Ordering is already fixed synchronously: the flush ran at entry, the
    // message_end send was only SCHEDULED.
    expect(model.sinceMark().map((row) => row.eventType)).toEqual(["message_update"]);

    // A straggler during the macrotask gap belongs to the now-closed identity.
    model.dispatchEnriched("message_update", textDelta("straggler", 1000));

    await model.drain();
    expect(model.sinceMark()).toEqual([
      { eventType: "message_update", text: "final answer" },
      { eventType: "message_end", role: "assistant" },
    ]);
  });

  it("E19: the out-of-loop custom_entry sink flushes first", () => {
    const model = new BridgeModel();
    park(model, "text before a custom entry", 1000);

    model.appendCustomEntry();

    expect(model.sinceMark()).toEqual([
      { eventType: "message_update", text: "text before a custom entry" },
      { eventType: "custom_entry" },
    ]);
  });

  it("E19b: the synthesized retry sink flushes first", () => {
    const model = new BridgeModel();
    park(model, "text before a retry event", 1000);

    model.syntheticRetry("auto_retry_start");

    expect(model.sinceMark()).toEqual([
      { eventType: "message_update", text: "text before a retry event" },
      { eventType: "auto_retry_start" },
    ]);
  });

  it("E20: pre-tool text is on the wire immediately before the tool event", () => {
    const model = new BridgeModel();
    park(model, "Running the test", 1000);

    model.dispatchEnriched("tool_execution_start", { type: "tool_execution_start", toolCallId: "tc-1" });

    expect(model.sinceMark()).toEqual([
      { eventType: "message_update", text: "Running the test" },
      { eventType: "tool_execution_start" },
    ]);
  });

  it("R5: reconnect flushes before state sync and replay", () => {
    const model = new BridgeModel();
    park(model, "live tail", 1000);

    model.reconnect();

    expect(model.sinceMark()).toEqual([
      { eventType: "message_update", text: "live tail" },
      { eventType: "state_sync" },
      { eventType: "replay" },
    ]);
  });

  it("R5: the pass-through loop flushes too", () => {
    const model = new BridgeModel();
    park(model, "text before a pass-through event", 1000);

    model.dispatchPassThrough("session_tree");

    expect(model.sinceMark()).toEqual([
      { eventType: "message_update", text: "text before a pass-through event" },
      { eventType: "session_tree" },
    ]);
  });

  it("R5: a deactivated bridge drops the timer's snapshot and writes nothing", () => {
    const model = new BridgeModel();
    park(model, "doomed", 1000);

    model.active = false;
    vi.advanceTimersByTime(COALESCE_WINDOW_MS);

    expect(model.sinceMark()).toHaveLength(0);
  });
});

describe("bridge coalescing — source contract (placement)", () => {
  const enrichedHandler = region(
    "for (const eventType of enrichedEventTypes) {",
    "// Pass-through events: forward with no enrichment",
  );
  const passThroughHandler = region(
    "// Pass-through events: forward with no enrichment",
    "// ── Subagent fan-out admission",
  );
  const reconnectHandler = region("onReconnect: safe(() => {", 'connection.send({ type: "replay_complete"');
  const customMessageSink = region("sm.appendCustomMessageEntry = (customType", "const origEntry = sm.appendCustomEntry");
  const customEntrySink = region("sm.appendCustomEntry = (customType", "customWrappedSm = sm;");
  const retrySink = region("const sendSyntheticRetryEvent", "// ── Per-message entry id tracking");
  const messageStartBranch = region('if (eventType === "message_start") {', "// For message_end: defer the SEND");
  const messageEndBranch = region('if (eventType === "message_end") {', "// Text snapshots are COALESCED");

  it("the enriched loop flushes at ENTRY, ahead of every branch", () => {
    const flush = at(enrichedHandler, "if (flushesParkedText(eventType)) coalescer.flush();");
    for (const branch of [
      'if (eventType === "agent_start")',
      'if (eventType === "agent_settled")',
      'if (eventType === "message_start")',
      'if (eventType === "message_end")',
      'if (eventType === "model_select")',
      'if (eventType === "turn_end")',
    ]) {
      expect(flush, `${branch} must run after the entry flush`).toBeLessThan(at(enrichedHandler, branch));
    }
  });

  it("the pass-through loop and the three out-of-loop sinks each flush", () => {
    at(passThroughHandler, "coalescer.flush();");
    at(customMessageSink, "coalescer.flush();");
    at(customEntrySink, "coalescer.flush();");
    at(retrySink, "coalescer.flush();");
  });

  it("onReconnect flushes before state sync and replay", () => {
    const flush = at(reconnectHandler, "coalescer.flush();");
    expect(flush).toBeLessThan(at(reconnectHandler, "sendStateSync();"));
    expect(flush).toBeLessThan(at(reconnectHandler, "replaySessionEntries();"));
  });

  it("the barrier opens at message_start ENTRY, ahead of the custom early return", () => {
    const bump = at(messageStartBranch, "assistantMessageGen += 1;");
    const open = at(messageStartBranch, "coalescer.messageStart(");
    const customReturn = at(messageStartBranch, 'if ((event as any).message?.role === "custom") return;');
    expect(bump).toBeLessThan(customReturn);
    expect(open).toBeLessThan(customReturn);
  });

  it("the barrier closes at message_end ENTRY, before the deferred send is scheduled", () => {
    const close = at(messageEndBranch, "coalescer.messageEnd(");
    expect(close).toBeLessThan(at(messageEndBranch, "setTimeout(() => {"));
  });

  it("both session boundaries clear the coalescer", () => {
    const clears = BRIDGE_SOURCE.match(/coalescer\.clear\(\);/g) ?? [];
    expect(clears).toHaveLength(2);
  });

  it("message_update is routed to the coalescer and returns (never the shared tail)", () => {
    // Scope to the routing block itself: the `message_end` branch legitimately
    // KEEPS its own inliner call (the authoritative final-content replacement).
    const routing = region("// Text snapshots are COALESCED", "// Pass-through events: forward with no enrichment");
    expect(routing).toContain("coalescer.offer(event, assistantMessageGen);");
    expect(routing).toContain("return;");
    expect(routing).not.toContain("maybeInlineAssistantImages");
    expect(enrichedHandler).toContain("coalescer.offer(event, assistantMessageGen);");
    // The inliner now runs once per flushed window, inside the send callback.
    expect(region("const coalescer = new MessageUpdateCoalescer", "let assistantMessageGen")).toContain(
      "maybeInlineAssistantImages(event);",
    );
  });
});
