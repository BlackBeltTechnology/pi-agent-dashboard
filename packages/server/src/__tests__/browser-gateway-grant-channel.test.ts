/**
 * Prompt-capability issuance on the browser gateway (change:
 * add-access-grant-dialog, task 3.2; test-plan #E1, #E7).
 *
 * - Each qualifying socket is sent its OWN `grant_channel` value.
 * - Closing the socket releases it: the value no longer resolves.
 * - With no policy installed (every existing embedder), NO socket is issued one.
 * - A connection the policy refuses, or one with no headers at all, gets none.
 * - A policy that throws fails closed.
 */
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetPromptChannels, resolvePromptChannel } from "../access/prompt-channel.js";
import { createBrowserGateway } from "../pairing/browser-gateway.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import type { PiGateway } from "../pi/pi-gateway.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";

function makeFakeWs() {
  const ws = new EventEmitter() as EventEmitter & {
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    readyState: number;
    OPEN: number;
    bufferedAmount: number;
  };
  ws.send = vi.fn();
  ws.close = vi.fn();
  ws.readyState = 1;
  ws.OPEN = 1;
  ws.bufferedAmount = 0;
  return ws;
}

function makeStubPiGateway(): PiGateway {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    sendToSession: vi.fn(),
    getConnectedSessionIds: vi.fn(() => []),
    hasSession: vi.fn(() => false),
    onEvent: vi.fn(),
  } as unknown as PiGateway;
}

/** Every `grant_channel` capability this fake socket has been sent. */
function capabilitiesSentTo(ws: ReturnType<typeof makeFakeWs>): string[] {
  const out: string[] = [];
  for (const [raw] of ws.send.mock.calls) {
    try {
      const msg = JSON.parse(String(raw));
      if (msg?.type === "grant_channel") out.push(msg.capability);
    } catch {
      /* non-JSON frames are not ours */
    }
  }
  return out;
}

const browserReq = { headers: { origin: "http://127.0.0.1:8000", host: "127.0.0.1:8000" } };

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  errorSpy.mockRestore();
  __resetPromptChannels();
  // State frames are flushed on a microtask/timer; let them drain.
  await new Promise((r) => setTimeout(r, 0));
});

const makeGateway = () =>
  createBrowserGateway(createMemorySessionManager(), createMemoryEventStore(() => false), makeStubPiGateway());

/** State-class frames are deferred; wait for the flush before asserting. */
const flush = () => new Promise((r) => setTimeout(r, 20));

describe("BrowserGateway grant_channel issuance", () => {
  it("sends each qualifying socket a DISTINCT capability that resolves", async () => {
    const gateway = makeGateway();
    gateway.setPromptCapabilityPolicy(() => true);
    const a = makeFakeWs();
    const b = makeFakeWs();
    gateway.wss.emit("connection", a, browserReq);
    gateway.wss.emit("connection", b, browserReq);
    await flush();

    const [capA] = capabilitiesSentTo(a);
    const [capB] = capabilitiesSentTo(b);
    expect(capA).toBeTruthy();
    expect(capB).toBeTruthy();
    expect(capA).not.toBe(capB);
    expect(resolvePromptChannel(capA)).not.toBeNull();
    expect(resolvePromptChannel(capB)).not.toBeNull();
    expect(resolvePromptChannel(capA)).not.toBe(resolvePromptChannel(capB));
  });

  it("closing the socket releases its capability (#E7)", async () => {
    const gateway = makeGateway();
    gateway.setPromptCapabilityPolicy(() => true);
    const ws = makeFakeWs();
    gateway.wss.emit("connection", ws, browserReq);
    await flush();
    const [cap] = capabilitiesSentTo(ws);
    expect(resolvePromptChannel(cap)).not.toBeNull();

    ws.emit("close");
    expect(resolvePromptChannel(cap)).toBeNull();
  });

  it("with NO policy installed, no socket is ever issued one (fail-closed default)", async () => {
    const gateway = makeGateway();
    const ws = makeFakeWs();
    gateway.wss.emit("connection", ws, browserReq);
    await flush();
    expect(capabilitiesSentTo(ws)).toEqual([]);
  });

  it("a connection the policy refuses gets none (#E1)", async () => {
    const gateway = makeGateway();
    gateway.setPromptCapabilityPolicy(() => false);
    const ws = makeFakeWs();
    gateway.wss.emit("connection", ws, browserReq);
    await flush();
    expect(capabilitiesSentTo(ws)).toEqual([]);
  });

  it("the policy sees the upgrade headers, and a header-less request is handled", async () => {
    const gateway = makeGateway();
    const seen: unknown[] = [];
    gateway.setPromptCapabilityPolicy((h) => {
      seen.push(h);
      return false;
    });
    gateway.wss.emit("connection", makeFakeWs(), browserReq);
    gateway.wss.emit("connection", makeFakeWs(), {});
    await flush();
    expect(seen[0]).toEqual(browserReq.headers);
    expect(seen[1]).toEqual({});
  });

  it("a policy that throws fails closed and does not break the connection", async () => {
    const gateway = makeGateway();
    gateway.setPromptCapabilityPolicy(() => {
      throw new Error("boom");
    });
    const ws = makeFakeWs();
    expect(() => gateway.wss.emit("connection", ws, browserReq)).not.toThrow();
    await flush();
    expect(capabilitiesSentTo(ws)).toEqual([]);
  });
});
