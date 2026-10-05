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
    bufferedAmount: number;
    OPEN: number;
    principal?: { iss: string; sub: string };
  };
  ws.send = vi.fn();
  ws.close = vi.fn();
  ws.ping = vi.fn();
  ws.terminate = vi.fn();
  ws.readyState = 1;
  ws.bufferedAmount = 0;
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

// ── 18.37(a) bootstrap disclosure + (b) domain-event road ──────────────────
describe("non-session bootstrap + domain events under a host policy (18.37)", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  const types = (ws: { send: ReturnType<typeof vi.fn> }) =>
    ws.send.mock.calls.map((c) => (JSON.parse(c[0] as string) as { type: string }).type);

  function prefsGateway(active: boolean, policy: boolean) {
    const sessionManager = createMemorySessionManager();
    const piGateway = { start: vi.fn(), stop: vi.fn(), sendToSession: vi.fn(), getConnectedSessionIds: vi.fn(() => []), hasSession: vi.fn(() => false), onEvent: vi.fn() } as unknown as PiGateway;
    const preferencesStore = {
      getPinnedDirectories: () => ["/p"],
      getWorkspaces: () => [{ id: "w" }],
      getCollapsedFolders: () => [],
      getFavoriteModels: () => [],
    };
    // Owned by `owner`: enforced terminals are visible to their owner only (18.13).
    const terminals = [{ id: "t1", principalOwner: owner }];
    const terminalManager = { list: () => terminals, get: (id: string) => terminals.find((t) => t.id === id), on: vi.fn() };
    // Positional deps: preferencesStore is #7, terminalManager #9, isResolverActive #25.
    const gateway = createBrowserGateway(
      sessionManager,
      createMemoryEventStore(() => false),
      piGateway,
      undefined, undefined, undefined,
      preferencesStore as never,
      undefined,
      terminalManager as never,
      ...(new Array(15).fill(undefined) as []),
      () => active,
    );
    gateway.setHostPolicy({ hasPolicy: () => policy, authorize: vi.fn(async () => true) as never });
    return gateway;
  }

  it("under a policy, a socket WITHOUT grants gets no workspace/terminal bootstrap (fail-closed)", () => {
    const g = prefsGateway(true, true);
    const ws = makeFakeWs(owner);
    g.wss.emit("connection", ws, {});
    const t = types(ws);
    expect(t).not.toContain("workspaces_updated");
    expect(t).not.toContain("pinned_dirs_updated");
    expect(t).not.toContain("terminal_added");
    expect(t).toContain("sessions_snapshot"); // owner-filtered session state is unaffected
  });

  it("granted families are sent, denied ones are not", () => {
    const g = prefsGateway(true, true);
    const ws = makeFakeWs(owner) as ReturnType<typeof makeFakeWs> & { bootstrapGrants?: unknown };
    ws.bootstrapGrants = { workspace: true, openspec: false, branch: false, terminal: false };
    g.wss.emit("connection", ws, {});
    const t = types(ws);
    expect(t).toContain("workspaces_updated");
    expect(t).toContain("pinned_dirs_updated");
    expect(t).not.toContain("terminal_added");
  });

  it("no policy ⇒ unchanged bootstrap; inert plane ⇒ unchanged even with a policy", () => {
    for (const [active, policy] of [[true, false], [false, true]] as const) {
      const g = prefsGateway(active, policy);
      const ws = makeFakeWs(owner);
      g.wss.emit("connection", ws, {});
      expect(types(ws)).toEqual(expect.arrayContaining(["workspaces_updated", "pinned_dirs_updated", "terminal_added"]));
    }
  });

  it("live frames of a denied family are withheld too (terminal_added broadcast)", () => {
    const g = prefsGateway(true, true);
    const yes = makeFakeWs(owner) as ReturnType<typeof makeFakeWs> & { bootstrapGrants?: unknown };
    yes.bootstrapGrants = { workspace: true, openspec: true, branch: true, terminal: true };
    // Same principal (so ownership passes) — only the policy grant differs.
    const no = makeFakeWs(owner) as ReturnType<typeof makeFakeWs> & { bootstrapGrants?: unknown };
    no.bootstrapGrants = { workspace: true, openspec: true, branch: true, terminal: false };
    g.wss.emit("connection", yes, {});
    g.wss.emit("connection", no, {});
    yes.send.mockClear();
    no.send.mockClear();
    g.broadcast({ type: "terminal_added", terminal: { id: "t2", principalOwner: owner } } as never);
    expect(types(yes)).toContain("terminal_added");
    expect(types(no)).not.toContain("terminal_added");
  });

  it("a plugin domain event is delivered only to sockets the policy permits (principal-less gets none)", async () => {
    const g = prefsGateway(true, true);
    const authorize = vi.fn(async ({ principal }: { principal: { sub: string } }) => principal.sub === "user-1");
    g.setHostPolicy({ hasPolicy: () => true, authorize: authorize as never });
    const a = makeFakeWs(owner);
    const b = makeFakeWs(other);
    const anon = makeFakeWs();
    for (const w of [a, b, anon]) g.wss.emit("connection", w, {});
    for (const w of [a, b, anon]) w.send.mockClear();
    g.broadcastDomainEvent({ type: "goal_status", n: 1 } as never, "goal", "goal_status");
    await new Promise((r) => setTimeout(r, 20));
    expect(types(a)).toContain("goal_status");
    expect(types(b)).not.toContain("goal_status");
    expect(types(anon)).not.toContain("goal_status");
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ action: "domain.event", resource: { kind: "domain", pluginId: "goal", eventType: "goal_status" } }));
  });

  it("no policy ⇒ a domain event is the plain synchronous broadcast", () => {
    const g = prefsGateway(true, false);
    const a = makeFakeWs(owner);
    const anon = makeFakeWs();
    g.wss.emit("connection", a, {});
    g.wss.emit("connection", anon, {});
    a.send.mockClear();
    anon.send.mockClear();
    g.broadcastDomainEvent({ type: "goal_status" } as never, "goal", "goal_status");
    expect(types(a)).toContain("goal_status");
    expect(types(anon)).toContain("goal_status");
  });

  it("domain events keep their order under a policy (async decisions never reorder)", async () => {
    const g = prefsGateway(true, true);
    let n = 0;
    g.setHostPolicy({ hasPolicy: () => true, authorize: (async () => { await new Promise((r) => setTimeout(r, n++ === 0 ? 30 : 0)); return true; }) as never });
    const a = makeFakeWs(owner);
    g.wss.emit("connection", a, {});
    a.send.mockClear();
    g.broadcastDomainEvent({ type: "ev", i: 1 } as never, "p", "ev");
    g.broadcastDomainEvent({ type: "ev", i: 2 } as never, "p", "ev");
    await new Promise((r) => setTimeout(r, 80));
    const order = a.send.mock.calls.map((c) => (JSON.parse(c[0] as string) as { i?: number }).i).filter(Boolean);
    expect(order).toEqual([1, 2]);
  });
});
