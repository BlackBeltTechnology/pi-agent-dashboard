/**
 * Requester-scoped delivery of prompt-resync replies — test-plan scenarios
 * E7, E8, E9, X3, E16, P2 for change: fix-pending-prompt-lost-on-replay.
 *
 * Drives the REAL gateway: a browser records itself as the requester by
 * sending `prompt_resync_request` (the bridge-reachable stub decides whether a
 * requester is recorded at all, E16), then `deliverPromptResyncReply` routes a
 * token-carrying `prompt_request` to that one socket (D4/D5: non-consuming
 * peek, every prompt of one reply routes, unicast only).
 *
 * See change: fix-pending-prompt-lost-on-replay (design D4/D5).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserGateway } from "../pairing/browser-gateway.js";
import type { PiGateway } from "../pi/pi-gateway.js";
import type { DrainingWs } from "./helpers/draining-ws.js";
import { createDrainingWs } from "./helpers/draining-ws.js";
import {
  buildLoadGatewayEx,
  flushAsync,
  makeStubPiGateway,
  seedSessions,
} from "./helpers/load-fixtures.js";

const MAX_WS_BUFFER = 4 * 1024 * 1024;
const MB = 1024 * 1024;

interface Rig {
  gateway: BrowserGateway;
  piGateway: PiGateway;
  sessionId: string;
  sockets: DrainingWs[];
  /** Connect + subscribe one more browser socket and return it. */
  attach(): DrainingWs;
}

/** Gateway with a bridge-reachable pi stub; each `attach` adds a subscribed browser socket. */
function setupRig(): Rig {
  const seed = seedSessions({ focusedCwd: "/repo/a", idleCwds: [] });
  const piGateway = makeStubPiGateway();
  (piGateway.sendToSession as ReturnType<typeof vi.fn>).mockReturnValue(true);
  const { gateway } = buildLoadGatewayEx(seed.manager, { piGateway });
  const sockets: DrainingWs[] = [];
  return {
    gateway,
    piGateway,
    sessionId: seed.focusedSessionId,
    sockets,
    attach() {
      const ws = createDrainingWs({ drainRateBytesPerMs: 1 });
      gateway.wss.emit("connection", ws, {});
      ws.drainFully();
      ws.emit("message", Buffer.from(JSON.stringify({ type: "subscribe", sessionId: seed.focusedSessionId })));
      sockets.push(ws);
      return ws;
    },
  };
}

async function requestResync(rig: Rig, ws: DrainingWs, requestId: string): Promise<void> {
  ws.emit("message", Buffer.from(JSON.stringify({ type: "prompt_resync_request", sessionId: rig.sessionId, requestId })));
  await flushAsync(10);
}

function promptReply(rig: Rig, promptId: string, token: string): Record<string, unknown> {
  return {
    type: "prompt_request",
    sessionId: rig.sessionId,
    promptId,
    prompt: { type: "select", question: `q-${promptId}`, options: ["a"] },
    __resyncRequestId: token,
  };
}

const framesOf = (ws: DrainingWs, type: string) => ws.sent.filter((r) => r.type === type);

describe("requester recording via prompt_resync_request (task 2.3)", () => {
  it("forwards a well-formed extension message to the bridge", async () => {
    const rig = setupRig();
    const ws = rig.attach();
    await requestResync(rig, ws, "tok-1");

    expect(rig.piGateway.sendToSession).toHaveBeenCalledWith(rig.sessionId, {
      type: "prompt_resync_request",
      sessionId: rig.sessionId,
      requestId: "tok-1",
    });
  });

  it("E16: no bridge connected — the request is dropped and NO requester is recorded", async () => {
    const seed = seedSessions({ focusedCwd: "/repo/a", idleCwds: [] });
    const piGateway = makeStubPiGateway(); // sendToSession → undefined (no bridge)
    const { gateway } = buildLoadGatewayEx(seed.manager, { piGateway });
    gateway.trackPromptRequest(
      seed.focusedSessionId,
      { type: "prompt_request", sessionId: seed.focusedSessionId, promptId: "p0", prompt: { type: "select", question: "q", options: ["a"] } },
    );
    const ws = createDrainingWs({ drainRateBytesPerMs: 1 });
    gateway.wss.emit("connection", ws, {});
    ws.drainFully();

    const pendingBefore = gateway.hasPendingPromptRequests(seed.focusedSessionId);
    ws.emit("message", Buffer.from(JSON.stringify({ type: "prompt_resync_request", sessionId: seed.focusedSessionId, requestId: "tok-nb" })));
    await flushAsync(10);

    // Dropped without error; the existing pending registry is untouched…
    expect(gateway.hasPendingPromptRequests(seed.focusedSessionId)).toBe(pendingBefore);
    // …and no requester was recorded: a reply carrying that token must NOT route.
    const reply = {
      type: "prompt_request",
      sessionId: seed.focusedSessionId,
      promptId: "p0",
      prompt: { type: "select", question: "q", options: ["a"] },
      __resyncRequestId: "tok-nb",
    };
    expect(gateway.deliverPromptResyncReply(reply as any, seed.focusedSessionId)).toBe(false);
  });
});

describe("deliverPromptResyncReply — requester-scoped unicast (D4/D5)", () => {
  it("E7: one token serves EVERY prompt of the reply, to the recorded socket only", async () => {
    const rig = setupRig();
    const a = rig.attach();
    const b = rig.attach();
    await requestResync(rig, a, "tok-1");

    expect(rig.gateway.deliverPromptResyncReply(promptReply(rig, "p1", "tok-1") as any, rig.sessionId)).toBe(true);
    expect(rig.gateway.deliverPromptResyncReply(promptReply(rig, "p2", "tok-1") as any, rig.sessionId)).toBe(true);

    // Both prompts reached the requester (two frames for two replies)…
    expect(framesOf(a, "prompt_request")).toHaveLength(2);
    // …and only the requester: the co-subscribed browser was not disturbed.
    expect(framesOf(b, "prompt_request")).toHaveLength(0);
    // The token is still resolvable after both replies (peek is non-consuming).
    expect(rig.gateway.deliverPromptResyncReply(promptReply(rig, "p3", "tok-1") as any, rig.sessionId)).toBe(true);
    expect(framesOf(a, "prompt_request")).toHaveLength(3);
  });

  it("a reply with no token routes nowhere (caller keeps the fan-out)", async () => {
    const rig = setupRig();
    const a = rig.attach();
    await requestResync(rig, a, "tok-1");

    const untokened = { type: "prompt_request", sessionId: rig.sessionId, promptId: "p1", prompt: { type: "select", question: "q", options: ["a"] } };
    expect(rig.gateway.deliverPromptResyncReply(untokened as any, rig.sessionId)).toBe(false);
    expect(framesOf(a, "prompt_request")).toHaveLength(0);
  });

  it("X3: an unknown token falls back (false), no throw", async () => {
    const rig = setupRig();
    rig.attach();
    expect(rig.gateway.deliverPromptResyncReply(promptReply(rig, "p1", "never-recorded") as any, rig.sessionId)).toBe(false);
  });

  it("E9: requester socket closed — the registry forgets it, delivery falls back, no throw", async () => {
    const rig = setupRig();
    const a = rig.attach();
    await requestResync(rig, a, "tok-1");
    a.close();

    expect(rig.gateway.deliverPromptResyncReply(promptReply(rig, "p1", "tok-1") as any, rig.sessionId)).toBe(false);
  });

  it("E8: TTL boundary — unicast at t0+29.9 s, expired (fallback) at t0+30.1 s", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const rig = setupRig();
    const a = rig.attach();
    const t0 = Date.now();
    await requestResync(rig, a, "tok-1");

    vi.setSystemTime(t0 + 29_900);
    expect(rig.gateway.deliverPromptResyncReply(promptReply(rig, "p1", "tok-1") as any, rig.sessionId)).toBe(true);

    vi.setSystemTime(t0 + 30_100);
    expect(rig.gateway.deliverPromptResyncReply(promptReply(rig, "p2", "tok-1") as any, rig.sessionId)).toBe(false);
  });
});

describe("P2: bound soak — repeated resyncs on a never-draining socket stay bounded", () => {
  it("100 deliveries: bufferedAmount never exceeds 5 MB + one frame; exempted bytes ≤ 1 MB", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const rig = setupRig();
    // drainRate 1 with a virtual clock that never advances: the wire never drains.
    const ws = createDrainingWs({ drainRateBytesPerMs: 1 });
    rig.gateway.wss.emit("connection", ws, {});
    ws.drainFully();
    ws.emit("message", Buffer.from(JSON.stringify({ type: "subscribe", sessionId: rig.sessionId })));
    await flushAsync(10);
    await requestResync(rig, ws, "tok-soak");
    ws.bufferedAmount = 0;

    const pad = 60 * 1024;
    const msg = {
      type: "prompt_request",
      sessionId: rig.sessionId,
      promptId: "p-soak",
      prompt: { type: "input", question: "x".repeat(pad), defaultValue: "" },
      __resyncRequestId: "tok-soak",
    };
    let routed = 0;
    for (let i = 0; i < 100; i++) {
      if (rig.gateway.deliverPromptResyncReply(msg as any, rig.sessionId)) routed++;
    }
    // Every delivery routed to the requester (the requester never left) —
    // what the ceiling sheds is the FRAME, inside sendTo, not the routing.
    expect(routed).toBe(100);

    // The exemption is what let frames through past MAX_WS_BUFFER…
    const onWire = framesOf(ws, "prompt_request").length;
    expect(onWire).toBeGreaterThan(0);
    // …but the buffer is capped at the ceiling + the one frame that crossed it…
    const maxFrame = Math.max(...ws.sent.map((r) => r.bytes));
    expect(ws.peakBufferedAmount()).toBeLessThanOrEqual(MAX_WS_BUFFER + MB + maxFrame);
    // …and the bytes the exemption added past the threshold total ≤ 1 MB (+ one frame).
    const exempted = ws.sent
      .filter((r) => r.bytesAtEnqueue - r.bytes > MAX_WS_BUFFER)
      .reduce((sum, r) => sum + r.bytes, 0);
    expect(exempted).toBeLessThanOrEqual(MB + maxFrame);
    // Every delivery either landed or was counted as a blocking drop — never
    // silently lost.
    const blocking = rig.gateway.getDroppedFrameStats().blocking.total;
    expect(onWire + blocking).toBe(100);
  });
});

afterEach(() => {
  vi.useRealTimers();
});
