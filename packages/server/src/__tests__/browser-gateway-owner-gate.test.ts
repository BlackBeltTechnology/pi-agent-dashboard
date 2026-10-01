/**
 * Integration contract for the §8.3 owner-equality choke point in the real
 * `createBrowserGateway` message loop. A session-owned command from a non-owner
 * (or principal-less) socket MUST be dropped BEFORE dispatch when the resolver
 * is active — no bridge forward, no frames served — while the exact owner is
 * forwarded normally, and the inert era is unchanged.
 *
 * See change: add-multi-user-identity-plane (§8.3 / D11).
 */
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserGateway } from "../pairing/browser-gateway.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import type { PiGateway } from "../pi/pi-gateway.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";

const owner = { iss: "https://kc/realms/app", sub: "user-1" };
const other = { iss: "https://kc/realms/app", sub: "user-2" };

function makeFakeWs(principal?: { iss: string; sub: string }) {
  const ws = new EventEmitter() as EventEmitter & {
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    ping: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
    readyState: number;
    OPEN: number;
    principal?: { iss: string; sub: string };
  };
  ws.send = vi.fn();
  ws.close = vi.fn();
  ws.ping = vi.fn();
  ws.terminate = vi.fn();
  ws.readyState = 1;
  ws.OPEN = 1;
  if (principal) ws.principal = principal;
  return ws;
}

function makeGateway(active: boolean) {
  const sendToSession = vi.fn(() => true) as unknown as PiGateway["sendToSession"];
  const piGateway = {
    start: vi.fn(),
    stop: vi.fn(),
    sendToSession,
    getConnectedSessionIds: vi.fn(() => []),
    hasSession: vi.fn(() => false),
    onEvent: vi.fn(),
  } as unknown as PiGateway;
  const sessionManager = createMemorySessionManager();
  // A session owned by `owner`.
  sessionManager.register({ id: "s1", cwd: "/p", source: "dashboard" } as never);
  sessionManager.update("s1", { principalOwner: owner });
  // Params 4..24 (20 optional deps + pendingPrincipalOwnerRegistry) are unused
  // here; isResolverActive is the 25th positional arg.
  const skip = new Array(21).fill(undefined);
  const gateway = createBrowserGateway(
    sessionManager,
    createMemoryEventStore(() => false),
    piGateway,
    ...(skip as []),
    () => active, // isResolverActive (position 25)
  );
  return { gateway, sendToSession };
}

async function deliver(ws: EventEmitter, msg: unknown) {
  ws.emit("message", Buffer.from(JSON.stringify(msg)));
  await new Promise((r) => setImmediate(r));
}

describe("gateway §8.3 owner-equality gate", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  it("forwards a session command from the exact owner", async () => {
    const { gateway, sendToSession } = makeGateway(true);
    const ws = makeFakeWs(owner);
    gateway.wss.emit("connection", ws, {});
    await deliver(ws, { type: "retry_session", sessionId: "s1" });
    expect(sendToSession).toHaveBeenCalledWith("s1", { type: "retry_session", sessionId: "s1" });
  });

  it("drops a session command from a non-owner (no forward, no frames)", async () => {
    const { gateway, sendToSession } = makeGateway(true);
    const ws = makeFakeWs(other);
    gateway.wss.emit("connection", ws, {});
    ws.send.mockClear();
    await deliver(ws, { type: "retry_session", sessionId: "s1" });
    expect(sendToSession).not.toHaveBeenCalled();
    const sent = ws.send.mock.calls.map((c) => JSON.parse(c[0] as string));
    expect(sent.find((m) => m.type === "retry_session_error")).toBeUndefined();
  });

  it("drops a session command from a principal-less socket when active", async () => {
    const { gateway, sendToSession } = makeGateway(true);
    const ws = makeFakeWs(); // no principal
    gateway.wss.emit("connection", ws, {});
    await deliver(ws, { type: "abort", sessionId: "s1" });
    expect(sendToSession).not.toHaveBeenCalled();
  });

  it("does not gate when the resolver is inert (unchanged behavior)", async () => {
    const { gateway, sendToSession } = makeGateway(false);
    const ws = makeFakeWs(other); // non-owner, but inert
    gateway.wss.emit("connection", ws, {});
    await deliver(ws, { type: "retry_session", sessionId: "s1" });
    expect(sendToSession).toHaveBeenCalledWith("s1", { type: "retry_session", sessionId: "s1" });
  });
});

// Non-session commands ride the OPTIONAL host policy (D9/D14/D24, task 18.28).
describe("gateway non-session host-policy gate", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  function withPolicy(active: boolean, decide?: (i: { action: string }) => Promise<boolean>) {
    const g = makeGateway(active);
    const authorize = vi.fn(decide ?? (async () => true));
    g.gateway.setHostPolicy({ hasPolicy: () => decide !== undefined, authorize: authorize as never });
    const handler = vi.fn();
    g.gateway.registerHandler("grant_response", handler);
    return { ...g, authorize, handler };
  }

  it("policy allow ⇒ dispatched, asked with the classified action", async () => {
    const { gateway, authorize, handler } = withPolicy(true, async () => true);
    const ws = makeFakeWs(owner);
    gateway.wss.emit("connection", ws, {});
    await deliver(ws, { type: "grant_response", promptId: "x" });
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ principal: owner, action: "access.write", resource: expect.objectContaining({ ws: "grant_response" }) }),
    );
    expect(handler).toHaveBeenCalled();
  });

  it("policy deny ⇒ dropped before dispatch", async () => {
    const { gateway, handler } = withPolicy(true, async () => false);
    const ws = makeFakeWs(owner);
    gateway.wss.emit("connection", ws, {});
    await deliver(ws, { type: "grant_response", promptId: "x" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("principal-less socket under a policy ⇒ dropped, policy not consulted", async () => {
    const { gateway, authorize, handler } = withPolicy(true, async () => true);
    const ws = makeFakeWs();
    gateway.wss.emit("connection", ws, {});
    await deliver(ws, { type: "grant_response", promptId: "x" });
    expect(handler).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });

  it("no policy ⇒ dispatched (D24 default)", async () => {
    const { gateway, handler } = withPolicy(true);
    const ws = makeFakeWs(owner);
    gateway.wss.emit("connection", ws, {});
    await deliver(ws, { type: "grant_response", promptId: "x" });
    expect(handler).toHaveBeenCalled();
  });

  it("inert plane ⇒ a loaded policy gates nothing (18.14)", async () => {
    const { gateway, authorize, handler } = withPolicy(false, async () => false);
    const ws = makeFakeWs(other);
    gateway.wss.emit("connection", ws, {});
    await deliver(ws, { type: "grant_response", promptId: "x" });
    expect(handler).toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });

  it("a plugin-registered custom frame is asked as plugin:<owner>:write", async () => {
    const { gateway, authorize } = withPolicy(true, async () => true);
    const custom = vi.fn();
    gateway.registerHandler("acme_sync", custom, "acme");
    const ws = makeFakeWs(owner);
    gateway.wss.emit("connection", ws, {});
    await deliver(ws, { type: "acme_sync" });
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ action: "plugin:acme:write" }));
    expect(custom).toHaveBeenCalled();
  });

  it("session-owned commands never consult the policy", async () => {
    const { gateway, authorize, sendToSession } = withPolicy(true, async () => false);
    const ws = makeFakeWs(owner);
    gateway.wss.emit("connection", ws, {});
    await deliver(ws, { type: "retry_session", sessionId: "s1" });
    expect(sendToSession).toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });
});
