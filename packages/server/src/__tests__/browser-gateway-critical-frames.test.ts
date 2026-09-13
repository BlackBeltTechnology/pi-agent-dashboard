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
import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ServerToBrowserMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import type { BrowserGateway } from "../pairing/browser-gateway.js";
import { createBrowserGateway } from "../pairing/browser-gateway.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import type { DrainingWs } from "./helpers/draining-ws.js";
import { createDrainingWs } from "./helpers/draining-ws.js";
import {
  buildLoadGatewayEx,
  flushAsync,
  makeStubPiGateway,
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

// ─────────────────────────────────────────────────────────────────────────
// Per-socket pending-state map (D2) — E3–E9, E11, P2, P3.
// See change: fix-connect-snapshot-frame-loss.
//
// A state frame is NEVER shed: over threshold it defers into a per-socket
// pending map (latest-wins per delivery key, byte-accounted, FIFO by first
// insertion) flushed by send-completion, by a 250 ms interval, and ahead of
// any transcript send.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Fake ws for state-delivery scenarios: `send(data, cb)` records the frame and
 * the callback (invoked on demand), `bufferedAmount` is caller-owned,
 * `terminate()` models the ws library (readyState → CLOSED) and is counted.
 */
function makeStateWs(opts: { bufferedAmount?: number; readyState?: number } = {}) {
  const ws = new EventEmitter() as EventEmitter & {
    readyState: number;
    OPEN: number;
    bufferedAmount: number;
    frames: string[];
    callbacks: Array<(err?: Error | null) => void>;
    terminateCount: number;
    send: (data: string, cb?: (err?: Error | null) => void) => void;
    terminate: () => void;
  };
  ws.readyState = opts.readyState ?? 1;
  ws.OPEN = 1;
  ws.bufferedAmount = opts.bufferedAmount ?? 0;
  ws.frames = [];
  ws.callbacks = [];
  ws.terminateCount = 0;
  ws.send = (data, cb) => {
    ws.frames.push(data);
    if (cb) ws.callbacks.push(cb);
  };
  ws.terminate = () => {
    ws.terminateCount++;
    ws.readyState = 3; // ws library: terminate() closes synchronously
  };
  return ws;
}

type StateWs = ReturnType<typeof makeStateWs>;

/** The fake satisfies the gateway's `WebSocket` surface at runtime; bridge the type. */
const asWs = (w: StateWs) => w as unknown as import("ws").WebSocket;

/** Gateway with an explicit MAX_WS_BUFFER + one connected state ws. */
function stateRig(maxWsBufferBytes: number, wsOpts: { bufferedAmount?: number; readyState?: number } = {}) {
  const gateway = createBrowserGateway(
    createMemorySessionManager(),
    createMemoryEventStore(() => false),
    makeStubPiGateway(),
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    maxWsBufferBytes,
  );
  const ws = makeStateWs(wsOpts);
  gateway.wss.emit("connection", ws, {});
  const base = ws.frames.length; // skip the connect bootstrap frame(s)
  return { gateway, ws, base };
}

/** `openspec_update` for `cwd` whose serialized frame is exactly `bytes` UTF-8 bytes. */
function openspecSized(cwd: string, bytes: number, tag = "v"): ServerToBrowserMessage {
  for (let pad = 0; pad < bytes; pad++) {
    const msg = { type: "openspec_update", cwd, data: { initialized: true, changes: [{ name: `${tag}${"x".repeat(pad)}` }] } };
    if (Buffer.byteLength(JSON.stringify(msg)) === bytes) return msg as ServerToBrowserMessage;
  }
  throw new Error(`cannot hit ${bytes} bytes`);
}

/**
 * `openspec_update` whose serialized frame is exactly `units` UTF-16 code
 * units AND `bytes` UTF-8 bytes (non-ASCII padding: "é" = 1 unit / 2 bytes).
 */
function openspecSizedUnitsBytes(cwd: string, units: number, bytes: number): ServerToBrowserMessage {
  const build = (multibyte: number, ascii: number) =>
    ({ type: "openspec_update", cwd, data: { initialized: true, changes: [{ name: "é".repeat(multibyte) + "x".repeat(ascii) }] } });
  let total = -1;
  for (let t = 0; t <= 4 * bytes; t++) {
    if (JSON.stringify(build(0, t)).length === units) {
      total = t;
      break;
    }
  }
  if (total < 0) throw new Error(`cannot hit ${units} units`);
  const asciiBytes = Buffer.byteLength(JSON.stringify(build(0, total)));
  const multibyte = bytes - asciiBytes;
  const msg = build(multibyte, total - multibyte);
  if (JSON.stringify(msg).length !== units || Buffer.byteLength(JSON.stringify(msg)) !== bytes) {
    throw new Error(`fit failed: units=${units} bytes=${bytes}`);
  }
  return msg as ServerToBrowserMessage;
}

const gitHead = (cwd: string): ServerToBrowserMessage =>
  ({ type: "git_head_update", cwd, branch: "develop" }) as ServerToBrowserMessage;

/** `git_head_update` for `cwd` whose serialized frame is exactly `bytes` UTF-8 bytes. */
function gitHeadSized(cwd: string, bytes: number): ServerToBrowserMessage {
  for (let pad = 0; pad < bytes; pad++) {
    const msg = { type: "git_head_update", cwd, branch: "b".repeat(pad) };
    if (Buffer.byteLength(JSON.stringify(msg)) === bytes) return msg as ServerToBrowserMessage;
  }
  throw new Error(`cannot hit ${bytes} bytes`);
}

describe("pending-state map — coalescing and order (E3, E4)", () => {
  it("E3: superseded payload replaced in place; exactly [v2, git] flushed on drain+callback; coalescedState===1", () => {
    const { gateway, ws, base } = stateRig(1000);
    // One healthy immediate send first so a send-callback exists to fire.
    gateway.sendToClient(asWs(ws), openspecSized("/h", 200));
    expect(ws.frames.length).toBe(base + 1);

    ws.bufferedAmount = 1001; // saturate
    gateway.sendToClient(asWs(ws), openspecSized("/a", 300, "v1")); // defer K1
    gateway.sendToClient(asWs(ws), openspecSized("/a", 340, "v2")); // supersede K1
    gateway.sendToClient(asWs(ws), gitHead("/a"));                   // defer K2
    expect(gateway.getPendingStateInfo(asWs(ws))?.entries).toBe(2);

    ws.bufferedAmount = 0; // drained; fire the recorded healthy-send callback
    ws.callbacks[0](null);

    const flushed = ws.frames.slice(base + 1).map((f) => JSON.parse(f));
    expect(flushed.map((m) => m.type)).toEqual(["openspec_update", "git_head_update"]);
    expect(flushed[0].data.changes[0].name.startsWith("v2")).toBe(true); // newest payload won
    expect(gateway.getDroppedFrameStats().coalescedState).toBe(1);
    expect(gateway.getPendingStateInfo(asWs(ws))).toBeUndefined();
  });

  it("E4: a superseded key keeps its insertion slot — flush order [K1(newest), K2]", () => {
    vi.useFakeTimers();
    try {
      const { gateway, ws, base } = stateRig(1000);
      ws.bufferedAmount = 1001;
      gateway.sendToClient(asWs(ws), openspecSized("/a", 300, "k1-old")); // K1 first
      gateway.sendToClient(asWs(ws), gitHead("/a"));                      // K2 second
      gateway.sendToClient(asWs(ws), openspecSized("/a", 330, "k1-new")); // K1 again

      ws.bufferedAmount = 0;
      vi.advanceTimersByTime(250); // periodic flush

      const flushed = ws.frames.slice(base).map((f) => JSON.parse(f));
      expect(flushed.map((m) => m.type)).toEqual(["openspec_update", "git_head_update"]);
      expect(flushed[0].data.changes[0].name.startsWith("k1-new")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("pending-state map — byte ceiling (E5, E6, E7)", () => {
  it("E5: bytes+len ≤ ceiling defers; bytes+len > ceiling terminates the stalled socket", () => {
    // BVA scaled to real message shapes (a serialized frame's minimum is
    // ~44 B, so 990+10 is unbuildable): pending 950, ceiling 1000 — a +50 B
    // frame lands exactly AT the ceiling (deferred), +51 goes over (terminate).
    const ok = stateRig(1000);
    ok.ws.bufferedAmount = 1001;
    ok.gateway.sendToClient(asWs(ok.ws), openspecSized("/a", 950));
    ok.gateway.sendToClient(asWs(ok.ws), gitHeadSized("/b", 50));
    expect(ok.ws.terminateCount).toBe(0);
    expect(ok.gateway.getPendingStateInfo(asWs(ok.ws))).toEqual({ entries: 2, bytes: 1000 });

    const over = stateRig(1000);
    over.ws.bufferedAmount = 1001;
    over.gateway.sendToClient(asWs(over.ws), openspecSized("/a", 950));
    over.gateway.sendToClient(asWs(over.ws), gitHeadSized("/b", 51));
    expect(over.ws.terminateCount).toBe(1);
    expect(over.gateway.getPendingStateInfo(asWs(over.ws))).toBeUndefined();
    expect(over.gateway.getDroppedFrameStats().stalledSocketsTerminated).toBe(1);
  });

  it("E6: accounting uses Buffer.byteLength, not UTF-16 code units", () => {
    // Ceiling 1000, pending 890. Next frame: 109 code units but 119 UTF-8
    // bytes (10 'é' chars). Length-accounting would defer (890+109=999 ≤
    // 1000); byte-accounting terminates (890+119=1009 > 1000).
    const { gateway, ws } = stateRig(1000);
    ws.bufferedAmount = 1001;
    gateway.sendToClient(asWs(ws), openspecSized("/a", 890));
    const frame = openspecSizedUnitsBytes("/b", 109, 119);
    expect(JSON.stringify(frame).length).toBe(109);
    expect(Buffer.byteLength(JSON.stringify(frame))).toBe(119);

    gateway.sendToClient(asWs(ws), frame);
    expect(ws.terminateCount).toBe(1);
  });

  it("E7: 100 frames for one key → one map entry, coalescedState===99", () => {
    const { gateway, ws } = stateRig(1000);
    ws.bufferedAmount = 1001;
    for (let i = 0; i < 100; i++) {
      gateway.sendToClient(asWs(ws), gitHead("/a"));
    }
    expect(gateway.getPendingStateInfo(asWs(ws))).toEqual({ entries: 1, bytes: Buffer.byteLength(JSON.stringify(gitHead("/a"))) });
    expect(gateway.getDroppedFrameStats().coalescedState).toBe(99);
  });
});

describe("pending-state map — no-limit mode and dead sockets (E8, E9)", () => {
  it("E8: maxWsBufferBytes=0 sends immediately regardless of bufferedAmount, no deferral, no timer", () => {
    vi.useFakeTimers();
    try {
      const { gateway, ws, base } = stateRig(0);
      ws.bufferedAmount = 10_000_000;
      gateway.sendToClient(asWs(ws), openspecSized("/a", 200));
      expect(ws.frames.length).toBe(base + 1);
      expect(gateway.getPendingStateInfo(asWs(ws))).toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("E9: CLOSING socket — timer tick sends nothing and throws nothing; close clears the timer and map", () => {
    vi.useFakeTimers();
    try {
      const { gateway, ws, base } = stateRig(1000);
      ws.bufferedAmount = 1001;
      gateway.sendToClient(asWs(ws), openspecSized("/a", 300));
      gateway.sendToClient(asWs(ws), gitHead("/a"));
      expect(vi.getTimerCount()).toBe(1);

      ws.readyState = 2; // CLOSING
      vi.advanceTimersByTime(250);
      expect(ws.frames.length).toBe(base); // no send, no throw

      ws.emit("close");
      expect(gateway.getPendingStateInfo(asWs(ws))).toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("pending-state map — transcript ordering and steady-state cost (E11, P2, P3)", () => {
  it("E11: a transcript send flushes already-flushable pending state first", () => {
    const { gateway, ws, base } = stateRig(1000);
    ws.bufferedAmount = 1001;
    gateway.sendToClient(asWs(ws), openspecSized("/a", 300)); // deferred state
    gateway.sendToClient(asWs(ws), gitHead("/a"));             // deferred state

    ws.bufferedAmount = 0; // drained below threshold, but no callback fired yet
    gateway.sendToClient(asWs(ws), { type: "session_updated", sessionId: "s", updates: { status: "idle" } });

    const order = ws.frames.slice(base).map((f) => JSON.parse(f).type);
    expect(order).toEqual(["openspec_update", "git_head_update", "session_updated"]);
    expect(gateway.getPendingStateInfo(asWs(ws))).toBeUndefined();
  });

  it("P2: 50 deferred frames all flush ≤ 250 ms after the socket crosses below threshold", () => {
    vi.useFakeTimers();
    try {
      const { gateway, ws, base } = stateRig(10_000); // 50 small frames ≪ ceiling
      ws.bufferedAmount = 10_001;
      for (let i = 0; i < 50; i++) {
        gateway.sendToClient(asWs(ws), gitHead(`/c${i}`)); // 50 distinct keys
      }
      expect(gateway.getPendingStateInfo(asWs(ws))?.entries).toBe(50);

      ws.bufferedAmount = 0; // drained with no further send — only the timer can flush
      vi.advanceTimersByTime(249);
      expect(ws.frames.length).toBe(base); // not yet
      vi.advanceTimersByTime(1); // exactly 250 ms after the interval started
      expect(ws.frames.length).toBe(base + 50);
      expect(gateway.getPendingStateInfo(asWs(ws))).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("P3: 1,000 state sends on an unsaturated socket — zero timers, pending map never allocated", () => {
    vi.useFakeTimers();
    try {
      const { gateway, ws, base } = stateRig(1000);
      ws.bufferedAmount = 0;
      for (let i = 0; i < 1_000; i++) {
        gateway.sendToClient(asWs(ws), gitHead(`/c${i % 50}`));
      }
      expect(ws.frames.length).toBe(base + 1_000);
      expect(vi.getTimerCount()).toBe(0);
      expect(gateway.getPendingStateInfo(asWs(ws))).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
