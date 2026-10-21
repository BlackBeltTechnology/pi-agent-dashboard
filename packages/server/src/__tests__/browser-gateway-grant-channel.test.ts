/**
 * Prompt-capability issuance on the browser gateway (change:
 * add-access-grant-dialog, task 3.2; test-plan #E1, #E7).
 *
 * - Each qualifying socket is sent its OWN `grant_channel` value.
 * - Closing the socket releases it: the value no longer resolves.
 * - With no policy installed (every existing embedder), NO socket is issued one.
 * - A connection the policy refuses, or one with no headers at all, gets none.
 * - A policy that throws fails closed.
 * - Provisioning: operator-socket set, capability-gated settlement (tasks 2.4, 2.30-2.32).
 */
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAccessGrants, listGrants } from "../access/access-grants.js";
import { __resetPromptChannels, releasePromptChannel, resolvePromptChannel } from "../access/prompt-channel.js";
import { createDefaultProvisioningGrantStore, PROVISION_TTL_MS } from "../access/provisioning.js";
import { installProvisioning } from "../access/provisioning-wiring.js";
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

// ── access provisioning: the operator-socket set and capability-gated settlement ──
// (change: add-access-provisioning, tasks 2.4, 2.30-2.32; test-plan #X2, #X3, #X4.)
// Real gateway + real registry + the real wiring; only the socket is a fake.

describe("provisioning over the browser gateway", () => {
  let tmp: string;
  let w: string;
  let logs: string[];
  let provisioning: ReturnType<typeof installProvisioning>;
  let gateway: ReturnType<typeof makeGateway>;

  const dir = (...segs: string[]) => {
    const p = path.join(...segs);
    fs.mkdirSync(p, { recursive: true });
    return p;
  };
  const framesOfType = (ws: ReturnType<typeof makeFakeWs>, type: string) =>
    ws.send.mock.calls.map(([raw]) => JSON.parse(String(raw))).filter((m) => m?.type === type);
  const answer = (ws: ReturnType<typeof makeFakeWs>, requestId: string, lineId: string) =>
    ws.emit("message", Buffer.from(JSON.stringify({ type: "provision_response", requestId, lines: [{ lineId, verdict: "approve" }] })));
  /** A socket that connects with headers the policy accepts (capability) or not. */
  const connect = async (opts: { capability: boolean; tier?: "observe" | "operate" }) => {
    const ws = makeFakeWs() as ReturnType<typeof makeFakeWs> & { sessionTier?: () => string };
    if (opts.tier) ws.sessionTier = () => opts.tier as string;
    gateway.wss.emit("connection", ws, opts.capability ? browserReq : { headers: {} });
    await flush();
    return ws;
  };
  const create = () => {
    const out = provisioning.registry.create({ projectRoot: path.join(w, "app"), lines: [{ path: path.join(w, "lib") }] });
    if (!out.ok) throw new Error(`refused: ${out.error}`);
    provisioning.announce(out.request);
    return out.request;
  };

  beforeEach(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-prov-gw-")));
    w = dir(tmp, "w");
    dir(w, "app", ".git");
    dir(w, "lib");
    process.env.PI_ACCESS_GRANTS_STORE = path.join(tmp, "access-grants.json");
    __resetAccessGrants();
    logs = [];
    gateway = makeGateway();
    gateway.setPromptCapabilityPolicy((h) => typeof h.origin === "string");
    provisioning = installProvisioning({
      gateway,
      deps: {
        now: () => Date.now(),
        grants: createDefaultProvisioningGrantStore(),
        mirror: () => null,
        ladder: { killSwitch: () => false, promptEnabled: () => true, hostGateMode: () => "enforce" },
        env: { homedir: dir(tmp, "home"), platform: "darwin" },
        log: (l) => logs.push(l),
      },
    });
    gateway.registerHandler("provision_response", provisioning.onResponse);
  });
  afterEach(() => {
    provisioning.dispose();
    delete process.env.PI_ACCESS_GRANTS_STORE;
    __resetAccessGrants();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("the request goes only to a capability-holding operate-tier socket (no-operator counts the same set)", async () => {
    const A = await connect({ capability: true });
    const B = await connect({ capability: false });
    expect(gateway.holdsLiveCapability(A as never)).toBe(true);
    expect(gateway.holdsLiveCapability(B as never)).toBe(false);
    expect(gateway.operatorSocketCount()).toBe(1);

    const req = create();
    await flush();
    expect(framesOfType(A, "provision_request").map((m) => m.requestId)).toEqual([req.requestId]);
    expect(framesOfType(B, "provision_request")).toEqual([]);
  });

  it("2.30 / #X2 a response from a socket without a capability is dropped and counted; the request stays pending", async () => {
    await connect({ capability: true });
    const B = await connect({ capability: false });
    const req = create();

    answer(B, req.requestId, req.lines[0].lineId);
    await flush();

    expect(provisioning.registry.stats().droppedResponses).toBe(1);
    expect(logs).toContain("[access-provision] response-dropped reason=no-capability");
    expect(provisioning.registry.get(req.requestId)?.status).toBe("pending");
    expect(listGrants()).toEqual([]);
  });

  it("2.31 / #X3 a capability authorises only its own socket", async () => {
    const A = await connect({ capability: true });
    const B = await connect({ capability: false });
    const req = create();

    // B answers while A (a live capability holder) exists: still dropped.
    answer(B, req.requestId, req.lines[0].lineId);
    await flush();
    expect(provisioning.registry.get(req.requestId)?.status).toBe("pending");
    expect(provisioning.registry.stats().droppedResponses).toBe(1);

    // A released capability no longer authorises its own socket either.
    const [capA] = capabilitiesSentTo(A);
    const socketIdOfA = resolvePromptChannel(capA);
    expect(socketIdOfA).not.toBeNull();
    releasePromptChannel(socketIdOfA as string);
    expect(gateway.holdsLiveCapability(A as never)).toBe(false);
    answer(A, req.requestId, req.lines[0].lineId);
    await flush();
    expect(provisioning.registry.stats().droppedResponses).toBe(2);
    expect(provisioning.registry.get(req.requestId)?.status).toBe("pending");
    expect(listGrants()).toEqual([]);
  });

  it("the capability holder's own response settles the request and every operator gets provision_dismiss", async () => {
    const A = await connect({ capability: true });
    const C = await connect({ capability: true });
    const req = create();
    answer(A, req.requestId, req.lines[0].lineId);
    await flush();
    await flush();
    expect(provisioning.registry.get(req.requestId)?.status).toBe("settled");
    expect(listGrants().map((g) => g.subject)).toEqual([path.join(w, "lib")]);
    for (const ws of [A, C]) {
      expect(framesOfType(ws, "provision_dismiss")).toEqual([{ type: "provision_dismiss", requestId: req.requestId, reason: "settled" }]);
    }
  });

  it("2.32 / #X4 an observe-tier socket is neither a target nor a settler", async () => {
    const O = await connect({ capability: true, tier: "observe" });
    expect(gateway.holdsLiveCapability(O as never)).toBe(true);
    expect(gateway.operatorSocketCount()).toBe(0);

    // With only an observe-tier capability holder connected, a request is refused `no-operator`.
    const refused = provisioning.registry.create({ projectRoot: path.join(w, "app"), lines: [{ path: path.join(w, "lib") }] });
    expect(refused).toMatchObject({ ok: false, status: 409, error: "no-operator" });

    // An operate-tier operator joins: the request is created, but the observe socket is not sent it.
    const A = await connect({ capability: true });
    const req = create();
    await flush();
    expect(framesOfType(A, "provision_request")).toHaveLength(1);
    expect(framesOfType(O, "provision_request")).toEqual([]);

    // Its response is refused by tier before it reaches the registry (not even counted as dropped).
    answer(O, req.requestId, req.lines[0].lineId);
    await flush();
    expect(provisioning.registry.get(req.requestId)?.status).toBe("pending");
    expect(provisioning.registry.stats().droppedResponses).toBe(0);
    expect(listGrants()).toEqual([]);
  });

  it("a request that expires is dismissed by its own unref'd timer; the dialog closes without an answer", async () => {
    const A = await connect({ capability: true });
    vi.useFakeTimers();
    try {
      const req = create();
      await vi.advanceTimersByTimeAsync(PROVISION_TTL_MS - 1);
      expect(provisioning.registry.get(req.requestId)?.status).toBe("pending");
      await vi.advanceTimersByTimeAsync(1);
      expect(provisioning.registry.get(req.requestId)?.status).toBe("expired");
      expect(framesOfType(A, "provision_dismiss")).toEqual([{ type: "provision_dismiss", requestId: req.requestId, reason: "expired" }]);
      expect(listGrants()).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
