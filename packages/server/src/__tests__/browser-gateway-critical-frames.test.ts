/**
 * Bounded critical-frame delivery for pending prompts — test-plan scenarios
 * E1–E6, X6, P1 for change: fix-pending-prompt-lost-on-replay.
 *
 * The pending-prompt replay runs in the replay-completion callback of
 * `sendEventBatches`, i.e. exactly when a full replay has most likely pushed
 * the socket past MAX_WS_BUFFER. These tests drive the REAL gateway over a
 * `DrainingFakeWs` whose `bufferedAmount` is pinned to the scenario value, so
 * the frame-class decision (transcript shed vs blocking exemption) is observed
 * on the wire and in the split drop counters.
 *
 * Saturation model: a delta subscribe with no new events replays exactly one
 * terminator `event_replay` frame (transcript) before the pending-prompt leg,
 * so every scenario runs a CONTROL subscribe first and asserts on the DELTA —
 * the prompt legs themselves must add zero transcript drops.
 *
 * See change: fix-pending-prompt-lost-on-replay (design D1/D2/D3).
 */
import { describe, expect, it } from "vitest";
import type { BrowserGateway } from "../pairing/browser-gateway.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import type { DrainingWs } from "./helpers/draining-ws.js";
import { createDrainingWs } from "./helpers/draining-ws.js";
import {
  buildLoadGatewayEx,
  flushAsync,
  makeUntruncatedEventStore,
  seedReplayEvents,
  seedSessions,
} from "./helpers/load-fixtures.js";

const MAX_WS_BUFFER = 4 * 1024 * 1024; // gateway default
const MB = 1024 * 1024;

interface Rig {
  gateway: BrowserGateway;
  ws: DrainingWs;
  sessionId: string;
}

/**
 * A real gateway + one subscribed draining socket. The store holds a single
 * event (seq 1), so `subscribe { lastSeq: 1 }` is an empty delta: one
 * terminator frame, then the pending-prompt + notify replays.
 */
function setupRig(): Rig {
  const seed = seedSessions({ focusedCwd: "/repo/a", idleCwds: [] });
  const store = createMemoryEventStore(() => false);
  seedReplayEvents(store, seed.focusedSessionId, 1, 16);
  const { gateway } = buildLoadGatewayEx(seed.manager, { eventStore: store });
  const ws = createDrainingWs({ drainRateBytesPerMs: 1 });
  gateway.wss.emit("connection", ws, {});
  ws.drainFully(); // clear the on-connect bootstrap frames
  return { gateway, ws, sessionId: seed.focusedSessionId };
}

/** One saturated (or not) delta subscribe; the pending-prompt replay runs in its completion callback. */
async function subscribeAt(rig: Rig, bufferedAmount: number): Promise<number> {
  const sentBefore = rig.ws.sent.length;
  rig.ws.bufferedAmount = bufferedAmount;
  rig.ws.emit("message", Buffer.from(JSON.stringify({ type: "subscribe", sessionId: rig.sessionId, lastSeq: 1 })));
  await flushAsync(20);
  return sentBefore;
}

function promptFrame(msg: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "prompt_request",
    promptId: msg.promptId,
    prompt: { type: "select", question: `q-${msg.promptId}`, options: ["a", "b"] },
    ...msg,
  };
}

function trackPrompts(gateway: BrowserGateway, sessionId: string, ids: string[]): void {
  for (const id of ids) gateway.trackPromptRequest(sessionId, promptFrame({ promptId: id, sessionId }));
}

const promptsIn = (ws: DrainingWs, from: number) =>
  ws.sent.slice(from).filter((r) => r.type === "prompt_request");

describe("critical-frame delivery — the per-delivery cap (E1, E2)", () => {
  it("E1: at cap — 4 pending prompts on a socket at 4 MB + 1 B all reach ws.send, blocking drops 0", async () => {
    const rig = setupRig();
    // Control: the saturated delta subscribe itself drops only the terminator (transcript).
    await subscribeAt(rig, MAX_WS_BUFFER + 1);
    const control = rig.gateway.getDroppedFrameStats();

    trackPrompts(rig.gateway, rig.sessionId, ["p1", "p2", "p3", "p4"]);
    const from = await subscribeAt(rig, MAX_WS_BUFFER + 1);

    const sent = promptsIn(rig.ws, from);
    expect(sent).toHaveLength(4);
    const stats = rig.gateway.getDroppedFrameStats();
    expect(stats.blocking.total).toBe(0);
    // Prompt delivery added ZERO transcript drops beyond the per-subscribe
    // constant: the empty-delta terminator `event_replay` (a transcript frame
    // that must keep shedding).
    expect(stats.total - control.total).toBe(1);
  });

  it("E2: cap + 1 — 5 pending prompts: exactly 4 sent, the 5th dropped into the blocking counter", async () => {
    const rig = setupRig();
    await subscribeAt(rig, MAX_WS_BUFFER + 1);
    const control = rig.gateway.getDroppedFrameStats();

    trackPrompts(rig.gateway, rig.sessionId, ["p1", "p2", "p3", "p4", "p5"]);
    const from = await subscribeAt(rig, MAX_WS_BUFFER + 1);

    const sent = promptsIn(rig.ws, from);
    expect(sent).toHaveLength(4);
    const stats = rig.gateway.getDroppedFrameStats();
    expect(stats.blocking.total).toBe(1);
    expect(stats.blocking.bySession[rig.sessionId]).toBe(1);
    // The dropped 5th prompt landed in the BLOCKING counter — transcript only
    // gained the per-subscribe terminator, nothing from the prompt legs.
    expect(stats.total - control.total).toBe(1);
  });
});

describe("critical-frame delivery — the absolute ceiling (E3)", () => {
  it("E3a: at exactly 5 MB the exemption still applies — frame sent, no counter moves", async () => {
    const rig = setupRig();
    await subscribeAt(rig, MAX_WS_BUFFER + MB);
    const control = rig.gateway.getDroppedFrameStats();

    trackPrompts(rig.gateway, rig.sessionId, ["p1"]);
    const from = await subscribeAt(rig, MAX_WS_BUFFER + MB);

    expect(promptsIn(rig.ws, from)).toHaveLength(1);
    const stats = rig.gateway.getDroppedFrameStats();
    expect(stats.blocking.total).toBe(0);
    expect(stats.total - control.total).toBe(1);
  });

  it("E3b: at 5 MB + 1 B even a blocking frame is dropped and counted", async () => {
    const rig = setupRig();
    await subscribeAt(rig, MAX_WS_BUFFER + MB + 1);
    const control = rig.gateway.getDroppedFrameStats();

    trackPrompts(rig.gateway, rig.sessionId, ["p1"]);
    const from = await subscribeAt(rig, MAX_WS_BUFFER + MB + 1);

    expect(promptsIn(rig.ws, from)).toHaveLength(0);
    const stats = rig.gateway.getDroppedFrameStats();
    expect(stats.blocking.total).toBe(1);
    expect(stats.blocking.bySession[rig.sessionId]).toBe(1);
    expect(stats.total - control.total).toBe(1);
  });
});

describe("critical-frame delivery — nominal and guard rails (E4, X6)", () => {
  it("E4: at 1 MB the prompt takes the ordinary path — sent, neither counter moves", async () => {
    const rig = setupRig();
    trackPrompts(rig.gateway, rig.sessionId, ["p1"]);
    const from = await subscribeAt(rig, 1 * MB);

    expect(promptsIn(rig.ws, from)).toHaveLength(1);
    const stats = rig.gateway.getDroppedFrameStats();
    expect(stats.total).toBe(0);
    expect(stats.blocking.total).toBe(0);
  });

  it("X6: a closed target socket — no send attempted, counters intact, no throw", async () => {
    const rig = setupRig();
    trackPrompts(rig.gateway, rig.sessionId, ["p1"]);
    const sentBefore = rig.ws.sent.length;
    rig.ws.readyState = 3; // CLOSED
    await subscribeAt(rig, MAX_WS_BUFFER + 1);

    expect(rig.ws.sent.length).toBe(sentBefore);
    const stats = rig.gateway.getDroppedFrameStats();
    expect(stats.total).toBe(0);
    expect(stats.blocking.total).toBe(0);
  });
});

describe("transcript frames keep the original shedding policy (E5, E6)", () => {
  it("E5: a transcript `event` frame at 4 MB + 1 B is dropped as transcript, blocking unchanged", async () => {
    const rig = setupRig();
    await subscribeAt(rig, 1 * MB); // healthy subscribe — no drops
    rig.ws.bufferedAmount = MAX_WS_BUFFER + 1;

    rig.gateway.broadcastEvent(rig.sessionId, 2, { type: "tool_execution_end", data: { toolCallId: "t1" } });

    const landed = rig.ws.sent.filter((r) => r.type === "event" && r.bytes < 1000);
    expect(landed).toHaveLength(0);
    const stats = rig.gateway.getDroppedFrameStats();
    expect(stats.total).toBe(1);
    expect(stats.bySession[rig.sessionId]).toBe(1);
    expect(stats.blocking.total).toBe(0);
  });

  it("E5b: the fan-out path (`broadcast`) also stays transcript-class", async () => {
    const rig = setupRig();
    await subscribeAt(rig, 1 * MB);
    rig.ws.bufferedAmount = MAX_WS_BUFFER + 1;

    rig.gateway.broadcast({ type: "session_updated", sessionId: rig.sessionId, updates: { status: "idle" } });

    const stats = rig.gateway.getDroppedFrameStats();
    expect(stats.total).toBe(1);
    expect(stats.blocking.total).toBe(0);
  });

  it("E6: the notify-log replay is NOT exempt — 3 retained rows all dropped as transcript", async () => {
    const rig = setupRig();
    for (let i = 0; i < 3; i++) {
      rig.gateway.appendNotify(rig.sessionId, { notifyId: `n${i}`, message: `m${i}` });
    }
    // Control: saturated subscribe with the notify log already populated but no
    // prompts — everything the subscribe itself replays is transcript-class.
    await subscribeAt(rig, MAX_WS_BUFFER + 1);
    const control = rig.gateway.getDroppedFrameStats();

    const from = await subscribeAt(rig, MAX_WS_BUFFER + 1);

    // None of the 3 notify rows reached the wire…
    expect(rig.ws.sent.slice(from).filter((r) => r.type === "notify")).toHaveLength(0);
    // …and their drops were counted as transcript (control + terminator + 3
    // notify rows), never as blocking.
    const stats = rig.gateway.getDroppedFrameStats();
    expect(stats.total - control.total).toBe(4);
    expect(stats.blocking.total).toBe(0);
  });
});

describe("P1: a saturating full replay still delivers the pending prompt", () => {
  it("2000-event replay on a slow socket: blocking drops 0, prompt lands after the last batch", async () => {
    const seed = seedSessions({ focusedCwd: "/repo/b", idleCwds: [] });
    // Untruncated store: the default 4 KB per-string cap would silently shrink
    // the padding and the replay would never reach saturation volume.
    const store = makeUntruncatedEventStore();
    // Exactly maxReplayEvents (2000) → no window. ~22 KB per event makes each
    // 200-event batch frame ~4.4 MB, so a single batch pushes the socket past
    // MAX_WS_BUFFER — the saturation volume the scenario requires.
    seedReplayEvents(store, seed.focusedSessionId, 2000, 22 * 1024);
    const { gateway } = buildLoadGatewayEx(seed.manager, { eventStore: store });
    const ws = createDrainingWs({ drainRateBytesPerMs: 100_000 }); // ~100 MB/s
    gateway.wss.emit("connection", ws, {});
    ws.drainFully();

    gateway.trackPromptRequest(
      seed.focusedSessionId,
      promptFrame({ promptId: "p1", sessionId: seed.focusedSessionId }),
    );
    ws.bufferedAmount = 0;
    ws.emit("message", Buffer.from(JSON.stringify({ type: "subscribe", sessionId: seed.focusedSessionId })));
    // Drive the fake's virtual drain clock off REAL time, so sendEventBatches'
    // real-timer back-pressure poll observes a slowly draining socket exactly
    // like a live one.
    const ticker = setInterval(() => ws.advance(20), 20);
    try {
      await flushAsync(400);
      await new Promise((r) => setTimeout(r, 1200));
      await flushAsync(20);
    } finally {
      clearInterval(ticker);
    }

    // The replay saturated the socket (a single batch crossed 4 MB)…
    expect(ws.peakBufferedAmount()).toBeGreaterThan(MAX_WS_BUFFER);
    // …and completed: the last event_replay batch carries isLast.
    const lastReplayIdx = (() => {
      let idx = -1;
      for (let i = 0; i < ws.sent.length; i++) if (ws.sent[i].type === "event_replay") idx = i;
      return idx;
    })();
    expect(lastReplayIdx).toBeGreaterThan(-1);
    // …but the pending prompt was never dropped as a blocking frame…
    expect(gateway.getDroppedFrameStats().blocking.total).toBe(0);
    // …and it was observed AFTER the last event_replay batch that landed.
    const promptIdx = ws.sent.findIndex((r) => r.type === "prompt_request");
    expect(promptIdx).toBeGreaterThan(-1);
    expect(promptIdx).toBeGreaterThan(lastReplayIdx);
  }, 20000);
});
