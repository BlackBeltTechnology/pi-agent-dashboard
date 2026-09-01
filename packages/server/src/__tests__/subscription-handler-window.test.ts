/**
 * Server-side replay windowing — test-plan scenarios E8-E13, E17-E21, E26,
 * P1/P2 and X7.
 *
 * The change is deliberately held to a DETERMINISTIC server-side observable —
 * delivered event count and serialized wire bytes — never a wall-clock
 * threshold. Wall-clock on this path is dominated by the un-windowed disk parse
 * and by client hardware, so asserting it would be measuring someone else's
 * cost.
 *
 * See change: lazy-load-session-history.
 */
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { DEFAULT_MEMORY_LIMITS } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { DashboardEvent } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { describe, expect, it } from "vitest";
import {
  computeReplayWindow,
  HEAD_CAP,
  HEAD_MIN,
  SNAP_LOOKUP,
  sendEventBatches,
} from "../browser-handlers/subscription-handler.js";
import { createMemoryEventStore, type StoredEvent } from "../persistence/memory-event-store.js";

function makeEvent(eventType = "turn_start", data: Record<string, unknown> = {}): DashboardEvent {
  return { eventType, timestamp: 1, data };
}

/** Non-compactable filler, so window maths is never confounded by compaction. */
function filler(n: number, startSeq = 1): StoredEvent[] {
  return Array.from({ length: n }, (_, i) => ({ seq: startSeq + i, event: makeEvent("tool_execution_end") }));
}

const openWs = () => ({ readyState: 1, OPEN: 1, bufferedAmount: 0 }) as any;

async function deliver(stored: StoredEvent[], windowLimit?: number, mode?: "head-tail" | "tail-only") {
  const sent: ServerToBrowserMessage[] = [];
  const seq = await sendEventBatches(openWs(), "s1", stored, (_w, m) => sent.push(m), windowLimit, mode);
  const replays = sent.filter((m): m is Extract<ServerToBrowserMessage, { type: "event_replay" }> => m.type === "event_replay");
  const windows = sent.filter((m): m is Extract<ServerToBrowserMessage, { type: "history_window" }> => m.type === "history_window");
  const events = replays.flatMap((b) => b.events);
  return { sent, replays, windows, events, seq };
}

describe("replay windowing — the fits-entirely short-circuit (E8, E9, E10)", () => {
  it("E8: an array exactly AT the limit is delivered whole, each seq once, gapCount 0", async () => {
    const { events, windows } = await deliver(filler(500), 500);
    expect(events).toHaveLength(500);
    expect(new Set(events.map((e) => e.seq)).size).toBe(500);
    // No window applied → no disclosure to make.
    expect(windows).toHaveLength(0);
  });

  it("E9: the window fires at limit+1, and reports exactly one elided event", async () => {
    const { events, windows } = await deliver(filler(501), 500);
    expect(events.length).toBeLessThanOrEqual(500);
    expect(windows).toHaveLength(1);
    expect(windows[0].gapCount).toBe(1);
  });

  it("E10: a small session under a large limit never overlaps or reports a negative gap", async () => {
    // Without the short-circuit, head(100) + tail(900) would exceed the array,
    // the two slices would OVERLAP, and gapCount would go negative. The guard
    // makes that case unrepresentable rather than handled.
    const { events, windows } = await deliver(filler(40), 1000);
    expect(events).toHaveLength(40);
    expect(new Set(events.map((e) => e.seq)).size).toBe(40);
    expect(windows).toHaveLength(0);
  });
});

describe("replay windowing — head/tail geometry (E11, E12, E13)", () => {
  const geometry = (n: number, limit: number) => {
    const win = computeReplayWindow(filler(n), limit);
    if (!win) throw new Error("expected a window");
    return { head: win.headEnd, tail: n - win.tailStart };
  };

  it("E11: at MIN_REPLAY_WINDOW the HEAD_MIN floor beats the ratio", () => {
    // floor(100 * 0.1) = 10, which the floor lifts to 20. Without the floor a
    // small limit degrades to tail-only — the shape D3 exists to reject.
    expect(geometry(5000, 100)).toEqual({ head: HEAD_MIN, tail: 80 });
  });

  it("E12: a nominal limit splits by HEAD_RATIO", () => {
    expect(geometry(5000, 500)).toEqual({ head: 50, tail: 450 });
  });

  it("E13: a large limit is bounded by HEAD_CAP, and the tail absorbs the rest", () => {
    expect(geometry(50000, 5000)).toEqual({ head: HEAD_CAP, tail: 5000 - HEAD_CAP });
  });
});

describe("replay windowing — edge snapping (E18, E19, E20, E21)", () => {
  it("E18: the tail's leading edge snaps FORWARD to the next message_start", () => {
    const stored = filler(5000);
    // Nominal tail cut for limit 500 over 5000 events is index 4550.
    const boundary = 4562; // 12 events later
    stored[boundary] = { seq: boundary + 1, event: makeEvent("message_start") };
    const win = computeReplayWindow(stored, 500);
    if (!win) throw new Error("expected a window");
    expect(win.tailStart).toBe(boundary);
    expect(stored[win.tailStart].event.eventType).toBe("message_start");
    // Forward, not backward: the budget stays a HARD cap. Backward snapping
    // would ADD events and make `maxReplayEvents` a soft floor.
    expect(win.headEnd + (stored.length - win.tailStart)).toBeLessThanOrEqual(500);
  });

  it("E19: maximal snapping on BOTH edges still never exceeds the budget", () => {
    // Budget 5000 over 50000 puts the nominal cuts at head 200 / tail 45200,
    // leaving room for BOTH snaps to travel their full SNAP_LOOKUP distance.
    const stored = filler(50000);
    const headTarget = HEAD_CAP - SNAP_LOOKUP; // index 0, the furthest reachable
    const tailTarget = 45000 + SNAP_LOOKUP;
    stored[headTarget] = { seq: headTarget + 1, event: makeEvent("message_end") };
    stored[tailTarget] = { seq: tailTarget + 1, event: makeEvent("message_start") };
    const win = computeReplayWindow(stored, 5000);
    if (!win) throw new Error("expected a window");
    // Both snaps actually MOVED — otherwise the budget assertion below would be
    // vacuously satisfied by a window that never snapped at all.
    expect(win.headEnd).toBe(headTarget + 1);
    expect(win.tailStart).toBe(tailTarget);
    // ...and both SHRANK: the budget stays a hard cap under maximal snapping.
    const delivered = win.headEnd + (stored.length - win.tailStart);
    expect(delivered).toBeLessThanOrEqual(5000);
    expect(delivered).toBeLessThan(5000);
  });

  it("E20: with no boundary inside SNAP_LOOKUP the exact cut index is used", () => {
    // Filler carries no `message_start` / `message_end` at all, so neither snap
    // can find a target and both must fall back rather than scan unbounded.
    const win = computeReplayWindow(filler(5000), 500);
    expect(win).toEqual({ headEnd: 50, tailStart: 4550 });
  });

  it("E21: a head cut landing after an unterminated message_start snaps back to a message_end", () => {
    const stored = filler(5000);
    stored[40] = { seq: 41, event: makeEvent("message_end") };
    stored[45] = { seq: 46, event: makeEvent("message_start") }; // never terminated
    const win = computeReplayWindow(stored, 500);
    if (!win) throw new Error("expected a window");
    // Ends ON the completed message_end, not on the dangling start — a head
    // ending mid-message can strand a permanently "streaming" row in the UI.
    expect(stored[win.headEnd - 1].event.eventType).toBe("message_end");
    expect(win.headEnd).toBe(41);
  });
});

describe("replay windowing — the D4 high-water contract (E17, X7, E26)", () => {
  it("E17/X7: the returned seq is the INPUT max even when the window elides the top", async () => {
    // The highest-seq event is a superseded `message_update`: compaction drops
    // it AND the window elides more. Deriving the return value from the
    // delivered array would return a lower seq and make `clearReplaying`
    // re-send events the client already has.
    const stored = filler(5000);
    stored[4000] = { seq: 4001, event: makeEvent("message_end") };
    stored[4999] = {
      seq: 5000,
      event: makeEvent("message_update", { message: { role: "assistant", content: [{ type: "text", text: "x" }] } }),
    };
    const { seq, events } = await deliver(stored, 500);
    expect(seq).toBe(5000);
    expect(events.length).toBeLessThanOrEqual(500);
    expect(events.at(-1)!.seq).toBeLessThanOrEqual(5000);

    // X7: the catch-up query the gateway runs with that seq must come back empty.
    const store = createMemoryEventStore(() => false);
    for (const e of stored) store.insertEvent("s1", e.event);
    expect(store.getEvents("s1", seq + 1)).toEqual([]);
  });

  it("E26: the window is applied AFTER compaction, so every delivered event is a survivor", async () => {
    // 20000 stored where all but the tail are superseded `message_update`s.
    const stored: StoredEvent[] = [];
    for (let i = 0; i < 19000; i++) {
      stored.push({
        seq: i + 1,
        event: makeEvent("message_update", { message: { role: "assistant", content: [{ type: "text", text: `t${i}` }] } }),
      });
    }
    stored.push({ seq: 19001, event: makeEvent("message_end") });
    for (let i = 0; i < 999; i++) stored.push({ seq: 19002 + i, event: makeEvent("tool_execution_end") });

    const { events } = await deliver(stored, 500);
    expect(events.length).toBeLessThanOrEqual(500);
    // Every non-exempt update before the message_end was dropped by compaction,
    // so nothing delivered may be one of them.
    const supersededSeqs = new Set(stored.slice(0, 19000).map((e) => e.seq));
    const leaked = events.filter((e) => supersededSeqs.has(e.seq));
    expect(leaked).toEqual([]);
  });
});

describe("replay windowing — bounded delivery (P1, P2)", () => {
  const seeded = () => filler(50000);

  it("P1: a 50000-event session under a 500 budget delivers at most 500 events", async () => {
    const { events } = await deliver(seeded(), 500);
    expect(events.length).toBeLessThanOrEqual(500);
  });

  it("P2: windowed wire bytes are at least 90% below the unwindowed replay", async () => {
    const bytes = async (limit: number) => {
      const { replays } = await deliver(seeded(), limit);
      return replays.reduce((n, b) => n + JSON.stringify(b).length, 0);
    };
    const unwindowed = await bytes(0);
    const windowed = await bytes(500);
    expect(windowed).toBeLessThanOrEqual(unwindowed * 0.1);
  });
});

describe("replay windowing — gapCount is what the store HOLDS (E22)", () => {
  it("E22: a middle-trimmed store reports fewer gap events than the seq distance", async () => {
    // Stored seqs 1–5000 and 18000–20000: the middle was already trimmed, so
    // `tailMinSeq - headMaxSeq - 1` OVERSTATES what exists. A divider promising
    // rows trimmed months ago is the failure this guards.
    const stored = [...filler(5000, 1), ...filler(2000, 18000)];
    const { windows } = await deliver(stored, 500);
    expect(windows).toHaveLength(1);
    const w = windows[0];
    const heldInGap = stored.filter((e) => e.seq > w.headMaxSeq && e.seq < w.tailMinSeq).length;
    expect(w.gapCount).toBe(heldInGap);
    expect(w.gapCount).toBeLessThan(w.tailMinSeq - w.headMaxSeq - 1);
    expect(w.oldestGapSeq).toBe(w.headMaxSeq + 1);
  });
});

/**
 * The geometry at the SHIPPED default — test-plan scenarios E7, E8, E9.
 *
 * These pin `DEFAULT_MEMORY_LIMITS.maxReplayEvents` itself, not the parametric
 * maths already covered above: the default is the value every user who never
 * touched the field now gets, so its window shape is a shipped contract.
 * See change: fix-lazy-history-backfill-ux (D7).
 */
describe("replay windowing at the default budget (E7, E8, E9)", () => {
  const DEFAULT = DEFAULT_MEMORY_LIMITS.maxReplayEvents;

  it("the default under test is the shipped one", () => {
    expect(DEFAULT).toBe(2000);
  });

  it("E7: a compacted stream exactly AT the default is not windowed at all", async () => {
    // The fits-entirely short-circuit is what makes the flip safe: any session
    // compacting below the default takes the pre-change code path exactly.
    const { events, windows } = await deliver(filler(DEFAULT), DEFAULT);
    expect(computeReplayWindow(filler(DEFAULT), DEFAULT)).toBeNull();
    expect(events).toHaveLength(DEFAULT);
    expect(windows).toHaveLength(0);
  });

  it("E8: one event past the default windows into head 200 / tail 1800", async () => {
    const win = computeReplayWindow(filler(DEFAULT + 1), DEFAULT);
    if (!win) throw new Error("expected a window");
    // Head is AT `HEAD_CAP`, so the protected chat head is maximal.
    expect(win.headEnd).toBe(HEAD_CAP);
    expect(DEFAULT + 1 - win.tailStart).toBe(DEFAULT - HEAD_CAP);
  });

  it("E9: at the minimum window the head floor still beats the ratio", () => {
    const win = computeReplayWindow(filler(500), 100);
    if (!win) throw new Error("expected a window");
    expect(win.headEnd).toBe(HEAD_MIN);
    expect(500 - win.tailStart).toBe(80);
  });
});

/**
 * `tail-only` — the head-free window shape.
 *
 * The whole budget goes to the tail; `headEnd === 0` and the elided region is
 * unbounded above. The sharpest item here is E6: the announcement block derives
 * `full[replayWindow.headEnd - 1].seq`, which at `headEnd === 0` indexes
 * `full[-1]` and throws on EVERY tail-only windowed replay.
 * See change: add-tail-only-replay-window (D2, D2a).
 */
describe("replay windowing — the tail-only shape (E5, E6, E7, E8, E9)", () => {
  // #E5 — the fits-entirely short-circuit is UNCONDITIONAL: it makes the
  // overlap case unrepresentable, which is mode-independent.
  it("E5: 499 and 500 fit entirely and announce nothing; 501 windows to exactly 500", async () => {
    for (const n of [499, 500]) {
      const { events, windows } = await deliver(filler(n), 500, "tail-only");
      expect(windows).toHaveLength(0);
      expect(events).toHaveLength(n);
    }
    const { events, windows } = await deliver(filler(501), 500, "tail-only");
    expect(windows).toHaveLength(1);
    expect(events).toHaveLength(500);
  });

  // #E6 — pins the `full[-1]` crash. The announcement must emit `headMaxSeq: 0`
  // rather than throwing, and `0` means "nothing above the gap".
  it("E6: a head-free window returns headEnd 0 and announces headMaxSeq 0 without throwing", async () => {
    const win = computeReplayWindow(filler(5000), 500, "tail-only");
    expect(win).not.toBeNull();
    expect(win?.headEnd).toBe(0);

    const { windows } = await deliver(filler(5000), 500, "tail-only");
    expect(windows).toHaveLength(1);
    expect(windows[0].headMaxSeq).toBe(0);
    expect(windows[0].tailMinSeq).toBeGreaterThan(1);
    // The gap scan (`e.seq > headMaxSeq && e.seq < tailMinSeq`) is correct as
    // written once `headMaxSeq` is 0: everything below the tail is elided.
    expect(windows[0].gapCount).toBe(windows[0].tailMinSeq - 1);
    expect(windows[0].oldestGapSeq).toBe(1);
  });

  // #E7 — the decision table. Limit 0 is "unlimited" in BOTH modes; the mode
  // only chooses the SHAPE of a window that applies.
  it("E7: limit 0 is unlimited in both modes; limit 500 delivers 500 shaped per mode", async () => {
    for (const mode of ["head-tail", "tail-only"] as const) {
      const unlimited = await deliver(filler(5000), 0, mode);
      expect(unlimited.events).toHaveLength(5000);
      expect(unlimited.windows).toHaveLength(0);

      const windowed = await deliver(filler(5000), 500, mode);
      expect(windowed.events).toHaveLength(500);
      expect(windowed.windows).toHaveLength(1);
    }
    // Shape per mode: head-tail keeps a head beginning at the lowest seq;
    // tail-only does not.
    const ht = await deliver(filler(5000), 500, "head-tail");
    expect(ht.events[0].seq).toBe(1);
    expect(ht.windows[0].headMaxSeq).toBeGreaterThanOrEqual(1);
    const to = await deliver(filler(5000), 500, "tail-only");
    expect(to.events[0].seq).toBeGreaterThan(1);
    expect(to.windows[0].headMaxSeq).toBe(0);
  });

  /**
   * #E8 — the tail's leading edge still snaps FORWARD (shrinking, so the budget
   * stays a hard cap). There is no head edge to snap, so no head-edge scan is
   * performed — asserted structurally via `headEnd === 0`.
   */
  it("E8: the tail edge still snaps forward and no head-edge scan is performed", () => {
    const n = 5000;
    const limit = 500;
    const events = filler(n);
    // Naive tail cut, then a `message_start` 30 events forward of it.
    const naiveStart = n - limit;
    events[naiveStart + 30] = { seq: naiveStart + 31, event: makeEvent("message_start") };

    const win = computeReplayWindow(events, limit, "tail-only");
    if (!win) throw new Error("expected a window");
    expect(win.headEnd).toBe(0);
    expect(win.tailStart).toBe(naiveStart + 30);
    expect(events[win.tailStart].event.eventType).toBe("message_start");
    // Forward snap SHRINKS: delivered count stays under the hard cap.
    expect(n - win.tailStart).toBeLessThanOrEqual(limit);
  });

  // #E9 — the shape is ANNOUNCED, never inferred from a `headMaxSeq === 0`
  // sentinel. The field is optional in the type; both modes set it explicitly.
  it("E9: the announcement carries windowShape for each mode", async () => {
    const to = await deliver(filler(5000), 500, "tail-only");
    expect(to.windows[0].windowShape).toBe("tail-only");
    const ht = await deliver(filler(5000), 500);
    expect(ht.windows[0].windowShape).toBe("head-tail");
  });
});

/**
 * The reset relocation — D3. `session_state_reset` moves OUT of the call-site
 * guards and INTO `sendEventBatches`, the only function that knows a window was
 * actually applied. That fixes the latent bug (the cold-hydration fan-out had
 * no guard at all and relied on the reducer's `firstSeq === 1` rule, which
 * holds only because a head-tail window always starts at seq 1) and changes two
 * sequences for existing `head-tail` users, both pinned below.
 * See change: add-tail-only-replay-window (D3), test-plan X1-X4.
 */
describe("windowed replay resets client state explicitly (X1, X2, X3, X4)", () => {
  /**
   * #X1 — a tail-only replay opens at seq 4501, so the reducer's
   * `firstSeq === 1` rule CANNOT fire. The explicit reset is the only thing
   * stopping the tail being appended beneath stale rows. Asserted on the reset
   * message and on the delivered first seq, never on `firstSeq === 1`.
   */
  it("X1: a tail-only window whose first seq is far above 1 still resets first", async () => {
    const { sent, events } = await deliver(filler(5000), 500, "tail-only");
    expect(events[0].seq).toBeGreaterThan(1);
    expect(events[0].seq).not.toBe(1);

    const resets = sent.filter((m) => m.type === "session_state_reset");
    expect(resets).toHaveLength(1);
    // The wipe precedes the transcript it applies to.
    expect(sent.indexOf(resets[0])).toBeLessThan(sent.findIndex((m) => m.type === "event_replay"));
  });

  // #X2 — ordering holds wherever a window applies, and the reset is emitted by
  // the callee, so every call site that windows inherits it by construction.
  it("X2: session_state_reset precedes history_window whenever a window applies", async () => {
    for (const mode of ["head-tail", "tail-only"] as const) {
      const { sent } = await deliver(filler(5000), 500, mode);
      const resetAt = sent.findIndex((m) => m.type === "session_state_reset");
      const windowAt = sent.findIndex((m) => m.type === "history_window");
      const replayAt = sent.findIndex((m) => m.type === "event_replay");
      expect(resetAt).toBeGreaterThanOrEqual(0);
      expect(windowAt).toBeGreaterThan(resetAt);
      expect(replayAt).toBeGreaterThan(windowAt);
    }
  });

  /**
   * #X2 (contrast) — the never-windowed delta call site passes no window limit,
   * so it sends NO reset. This is what makes the delta site correct by
   * construction rather than by a guard that could drift.
   */
  it("X2: an unwindowed stream sends no reset and no announcement", async () => {
    const { sent } = await deliver(filler(400), 500, "tail-only");
    expect(sent.filter((m) => m.type === "session_state_reset")).toHaveLength(0);
    expect(sent.filter((m) => m.type === "history_window")).toHaveLength(0);
    // A delta (no limit at all) likewise.
    const delta = await deliver(filler(400, 9000));
    expect(delta.sent.filter((m) => m.type === "session_state_reset")).toHaveLength(0);
  });

  /**
   * #X3 — D3 sequence change (a). The old guard keyed on the UNCOMPACTED count
   * while the window is computed on the COMPACTED array, so a stream over the
   * limit uncompacted but under it compacted used to reset and now does not.
   * Equivalent because that replay starts at seq 1 and the reducer's
   * `firstSeq === 1` rule resets anyway — the store-invariant dependency is
   * removed where it matters (windowed replays) and kept where it is sound.
   */
  it("X3: a stream over the limit uncompacted but under it compacted sends no reset", async () => {
    // 600 superseded `message_update` snapshots inside one message compact away
    // to a handful, leaving the compacted array under the limit.
    const stored: StoredEvent[] = [
      { seq: 1, event: makeEvent("message_start", { messageId: "m1" }) },
      ...Array.from({ length: 600 }, (_, i) => ({
        seq: 2 + i,
        event: makeEvent("message_update", { messageId: "m1", content: `c${i}` }),
      })),
      { seq: 602, event: makeEvent("message_end", { messageId: "m1" }) },
    ];
    expect(stored.length).toBeGreaterThan(500);

    const { sent, events } = await deliver(stored, 500, "head-tail");
    // Compacted below the limit → the fits-entirely short-circuit → no window.
    expect(sent.filter((m) => m.type === "history_window")).toHaveLength(0);
    expect(sent.filter((m) => m.type === "session_state_reset")).toHaveLength(0);
    // The transcript is still correct: the replay starts at seq 1.
    expect(events[0].seq).toBe(1);
  });

  /**
   * #X4 — D3 sequence change (b). The reset now lands AFTER `replaySessionAssets`
   * rather than before it. Safe because `session_state_reset` reduces to
   * `createInitialState()` — transcript state only — and `asset_register` is a
   * documented no-op in that reducer, so the asset registry is not cleared and
   * `pi-asset:` tokens in the delivered window still resolve.
   */
  it("X4: pi-asset tokens in the delivered window survive a reset that follows the asset replay", async () => {
    const n = 5000;
    const stored = filler(n);
    // A token-bearing event inside the tail segment.
    stored[n - 10] = {
      seq: n - 9,
      event: makeEvent("message_end", { messageId: "m1", content: "![x](pi-asset:abc123)" }),
    };

    const { sent, events } = await deliver(stored, 500, "tail-only");
    const delivered = events.find((e) => e.seq === n - 9);
    expect(delivered).toBeDefined();
    expect(JSON.stringify(delivered)).toContain("pi-asset:abc123");
    // The reset is a transcript-state wipe; it carries no asset payload and so
    // cannot clear a registry replayed before it.
    const reset = sent.find((m) => m.type === "session_state_reset");
    expect(reset).toEqual({ type: "session_state_reset", sessionId: "s1" });
  });
});
