/**
 * Terminal owner model (task 18.13) — the verified isolation gap: `/ws/terminal`,
 * `terminal_added` bootstrap/broadcast and the terminal commands had no principal
 * check. Same rule as sessions: exact `(iss, sub)` equality; an ownerless terminal
 * reaches no human; the break-glass operator sees all; inert ⇒ unchanged.
 *
 * See change: add-multi-user-identity-plane (D11/D24).
 */
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleCreateTerminal, handleKillTerminal, handleOpenInlineTerminal, handleRenameTerminal } from "../browser-handlers/terminal-handler.js";
import type { BrowserHandlerContext } from "../browser-handlers/handler-context.js";
import { LOCAL_OPERATOR } from "../identity/session-access.js";
import { createBrowserGateway } from "../pairing/browser-gateway.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import type { PiGateway } from "../pi/pi-gateway.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";

const anna = { iss: "https://idp", sub: "anna" };
const bela = { iss: "https://idp", sub: "bela" };

// ── handlers ────────────────────────────────────────────────────────────────
function handlerCtx(over: { principal?: object | null; active: boolean; terminals?: Record<string, { principalOwner?: typeof anna }> }) {
  const spawn = vi.fn((cwd: string, o?: { owner?: unknown; ephemeral?: boolean }) => ({ id: "t1", cwd, shell: "sh", status: "active" as const, createdAt: 0, ...(o?.owner ? { principalOwner: o.owner } : {}) }));
  const kill = vi.fn();
  const updateTitle = vi.fn();
  const broadcast = vi.fn();
  const ctx = {
    ws: over.principal === null ? {} : { principal: over.principal },
    isResolverActive: () => over.active,
    terminalManager: { spawn, kill, updateTitle, get: (id: string) => over.terminals?.[id] && { id, ...over.terminals[id] } },
    sessionOrderManager: { insert: vi.fn(), getOrder: () => [] },
    broadcast,
    eventStore: { insertEvent: () => 1, getEvent: () => ({}), getEvents: () => [] },
  } as unknown as BrowserHandlerContext;
  return { ctx, spawn, kill, updateTitle, broadcast };
}

describe("terminal handlers (18.13)", () => {
  it("create/open-inline stamp the creating principal while enforced; never in the inert era", () => {
    const e = handlerCtx({ principal: anna, active: true });
    handleCreateTerminal({ type: "create_terminal", cwd: "/w" } as never, e.ctx);
    expect(e.spawn).toHaveBeenLastCalledWith("/w", { owner: anna });
    handleOpenInlineTerminal({ type: "open_inline_terminal", cwd: "/w", sessionId: "s" } as never, e.ctx);
    expect(e.spawn).toHaveBeenLastCalledWith("/w", { ephemeral: true, owner: anna });
    const inert = handlerCtx({ principal: anna, active: false });
    handleCreateTerminal({ type: "create_terminal", cwd: "/w" } as never, inert.ctx);
    expect(inert.spawn).toHaveBeenLastCalledWith("/w", { owner: undefined });
  });

  it("kill/rename by a non-owner, a principal-less socket, or on an ownerless terminal are dropped; the owner and the operator pass", () => {
    const terminals = { t1: { principalOwner: anna }, t0: {} };
    for (const [who, expectOk] of [[anna, true], [bela, false], [null, false], [LOCAL_OPERATOR, true]] as const) {
      const c = handlerCtx({ principal: who, active: true, terminals });
      handleKillTerminal({ type: "kill_terminal", terminalId: "t1" } as never, c.ctx);
      handleRenameTerminal({ type: "rename_terminal", terminalId: "t1", title: "x" } as never, c.ctx);
      expect(c.kill.mock.calls.length > 0).toBe(expectOk);
      expect(c.updateTitle.mock.calls.length > 0).toBe(expectOk);
      expect(c.broadcast.mock.calls.length > 0).toBe(expectOk);
    }
    const ownerless = handlerCtx({ principal: anna, active: true, terminals });
    handleKillTerminal({ type: "kill_terminal", terminalId: "t0" } as never, ownerless.ctx);
    expect(ownerless.kill).not.toHaveBeenCalled();
  });

  it("inert plane ⇒ any socket may kill/rename (unchanged)", () => {
    const c = handlerCtx({ principal: bela, active: false, terminals: { t1: { principalOwner: anna } } });
    handleKillTerminal({ type: "kill_terminal", terminalId: "t1" } as never, c.ctx);
    expect(c.kill).toHaveBeenCalled();
  });
});

// ── gateway visibility ──────────────────────────────────────────────────────
function fakeWs(principal?: object) {
  const ws = new EventEmitter() as EventEmitter & Record<string, any>;
  Object.assign(ws, { send: vi.fn(), close: vi.fn(), ping: vi.fn(), terminate: vi.fn(), readyState: 1, bufferedAmount: 0, OPEN: 1 });
  if (principal) ws.principal = principal;
  return ws;
}
const types = (ws: { send: ReturnType<typeof vi.fn> }) => ws.send.mock.calls.map((c) => JSON.parse(c[0] as string) as { type: string; terminal?: { id: string }; terminalId?: string; sessionIds?: string[] });

function gatewayWith(terminals: Array<{ id: string; cwd: string; principalOwner?: typeof anna }>, active = true) {
  const live = [...terminals];
  const terminalManager = { list: () => live, get: (id: string) => live.find((t) => t.id === id), on: vi.fn() };
  const piGateway = { start: vi.fn(), stop: vi.fn(), sendToSession: vi.fn(), getConnectedSessionIds: vi.fn(() => []), hasSession: vi.fn(() => false), onEvent: vi.fn() } as unknown as PiGateway;
  const gateway = createBrowserGateway(
    createMemorySessionManager(),
    createMemoryEventStore(() => false),
    piGateway,
    undefined, undefined, undefined,
    { getPinnedDirectories: () => [], getCollapsedFolders: () => [] } as never,
    undefined,
    terminalManager as never,
    ...(new Array(15).fill(undefined) as []),
    () => active,
  );
  return { gateway, live };
}

describe("terminal frames reach only the owner (18.13)", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  it("bootstrap lists only the principal's own terminals; operator sees all; principal-less sees none", () => {
    const { gateway } = gatewayWith([
      { id: "ta", cwd: "/a", principalOwner: anna },
      { id: "tb", cwd: "/b", principalOwner: bela },
      { id: "t0", cwd: "/z" },
    ]);
    const seen = (who?: object) => {
      const ws = fakeWs(who);
      gateway.wss.emit("connection", ws, {});
      return types(ws).filter((m) => m.type === "terminal_added").map((m) => m.terminal?.id);
    };
    expect(seen(anna)).toEqual(["ta"]);
    expect(seen(bela)).toEqual(["tb"]);
    expect(seen(LOCAL_OPERATOR).sort()).toEqual(["t0", "ta", "tb"]);
    expect(seen()).toEqual([]);
  });

  it("inert plane ⇒ every terminal to everyone (unchanged)", () => {
    const { gateway } = gatewayWith([{ id: "ta", cwd: "/a", principalOwner: anna }, { id: "t0", cwd: "/z" }], false);
    const ws = fakeWs(bela);
    gateway.wss.emit("connection", ws, {});
    expect(types(ws).filter((m) => m.type === "terminal_added").map((m) => m.terminal?.id).sort()).toEqual(["t0", "ta"]);
  });

  it("live added/updated/removed frames go to the owner (and operator) only — removal too, after the PTY is gone", () => {
    const { gateway, live } = gatewayWith([{ id: "ta", cwd: "/a", principalOwner: anna }]);
    const a = fakeWs(anna);
    const b = fakeWs(bela);
    const op = fakeWs(LOCAL_OPERATOR);
    for (const w of [a, b, op]) gateway.wss.emit("connection", w, {});
    for (const w of [a, b, op]) w.send.mockClear();
    gateway.broadcast({ type: "terminal_updated", terminalId: "ta", updates: { title: "x" } } as never);
    live.length = 0; // PTY exited: the manager no longer knows it
    gateway.broadcast({ type: "terminal_removed", terminalId: "ta" } as never);
    const got = (w: typeof a) => types(w).map((m) => m.type);
    expect(got(a)).toEqual(["terminal_updated", "terminal_removed"]);
    expect(got(op)).toEqual(["terminal_updated", "terminal_removed"]);
    expect(got(b)).toEqual([]);
  });

  it("a terminal_added broadcast of an OWNERLESS terminal reaches no human, only the operator", () => {
    const { gateway } = gatewayWith([]);
    const a = fakeWs(anna);
    const op = fakeWs(LOCAL_OPERATOR);
    for (const w of [a, op]) gateway.wss.emit("connection", w, {});
    for (const w of [a, op]) w.send.mockClear();
    gateway.broadcast({ type: "terminal_added", terminal: { id: "t9", cwd: "/z", shell: "sh", status: "active", createdAt: 0 } } as never);
    expect(types(a)).toEqual([]);
    expect(types(op).map((m) => m.type)).toEqual(["terminal_added"]);
  });

  it("filterSnapshotForPrincipal keeps the principal's own terminal ids in the order lists (and nobody else's)", async () => {
    const { filterSnapshotForPrincipal } = await import("../identity/session-access.js");
    const snap = { sessions: [], orders: { "/a": ["ta", "tb"] }, endedTotals: { "/a": 0 } };
    expect(filterSnapshotForPrincipal(snap as never, true, anna, ["ta"]).orders).toEqual({ "/a": ["ta"] });
    expect(filterSnapshotForPrincipal(snap as never, true, bela, []).orders).toEqual({});
  });

  // ── review round 1, B3: the terminal policy grant covers EVERY terminal-bearing frame ──
  function policyGateway(grants: { terminal: boolean }) {
    const sessionManager = createMemorySessionManager();
    // Window projection that (unlike the memory manager's) keeps the terminal id, so the
    // order frames below really carry it.
    (sessionManager as any).snapshotVisibleIds = () => new Set(["ta", "sa"]);
    (sessionManager as any).buildSnapshot = () => ({ sessions: [], orders: { "/a": ["ta"] }, endedTotals: { "/a": 0 } });
    const terminals = [{ id: "ta", cwd: "/a", principalOwner: anna }];
    const terminalManager = { list: () => terminals, get: (id: string) => terminals.find((t) => t.id === id), on: vi.fn() };
    const piGateway = { start: vi.fn(), stop: vi.fn(), sendToSession: vi.fn(), getConnectedSessionIds: vi.fn(() => []), hasSession: vi.fn(() => false), onEvent: vi.fn() } as unknown as PiGateway;
    const gateway = createBrowserGateway(
      sessionManager,
      createMemoryEventStore(() => false),
      piGateway,
      undefined, undefined, undefined,
      { getPinnedDirectories: () => [], getCollapsedFolders: () => [] } as never,
      undefined,
      terminalManager as never,
      ...(new Array(15).fill(undefined) as []),
      () => true,
    );
    gateway.setHostPolicy({ hasPolicy: () => true, authorize: vi.fn(async () => true) as never });
    const ws = fakeWs(anna) as ReturnType<typeof fakeWs> & { bootstrapGrants?: unknown };
    ws.bootstrapGrants = { workspace: true, openspec: true, branch: true, terminal: grants.terminal, terminals: grants.terminal ? "all" : new Set<string>() };
    gateway.wss.emit("connection", ws, {});
    ws.send.mockClear();
    return { gateway, ws };
  }
  const ordersOf = (ws: ReturnType<typeof fakeWs>) => types(ws).find((m) => m.type === "sessions_reordered")?.sessionIds;

  it("B3: terminal_updated is withheld from an owner whose terminal grant is denied (and sent when granted)", async () => {
    for (const [granted, expected] of [[false, []], [true, ["terminal_updated"]]] as const) {
      const { gateway, ws } = policyGateway({ terminal: granted });
      gateway.broadcast({ type: "terminal_updated", terminalId: "ta", updates: { title: "secret" } } as never);
      await new Promise((r) => setTimeout(r, 20)); // policy-gated terminal frames are decided on an ordered queue
      expect(types(ws).map((m) => m.type)).toEqual(expected);
    }
  });

  it("B3: a denied terminal grant also hides the terminal id from session-order frames; granted keeps it", () => {
    const denied = policyGateway({ terminal: false });
    denied.gateway.broadcast({ type: "sessions_reordered", cwd: "/a", sessionIds: ["ta", "sa"] } as never);
    expect(ordersOf(denied.ws) ?? []).not.toContain("ta");
    const granted = policyGateway({ terminal: true });
    granted.gateway.broadcast({ type: "sessions_reordered", cwd: "/a", sessionIds: ["ta"] } as never);
    expect(ordersOf(granted.ws)).toEqual(["ta"]);
  });

  it("B3: the connect snapshot's order lists omit the terminal id when its grant is denied", () => {
    const orders = (grants: { terminal: boolean }) => {
      const sessionManager = createMemorySessionManager();
      (sessionManager as any).buildSnapshot = () => ({ sessions: [], orders: { "/a": ["ta"] }, endedTotals: { "/a": 0 } });
      const terminals = [{ id: "ta", cwd: "/a", principalOwner: anna }];
      const terminalManager = { list: () => terminals, get: (id: string) => terminals.find((t) => t.id === id), on: vi.fn() };
      const piGateway = { start: vi.fn(), stop: vi.fn(), sendToSession: vi.fn(), getConnectedSessionIds: vi.fn(() => []), hasSession: vi.fn(() => false), onEvent: vi.fn() } as unknown as PiGateway;
      const gateway = createBrowserGateway(sessionManager, createMemoryEventStore(() => false), piGateway, undefined, undefined, undefined, { getPinnedDirectories: () => [], getCollapsedFolders: () => [] } as never, undefined, terminalManager as never, ...(new Array(15).fill(undefined) as []), () => true);
      gateway.setHostPolicy({ hasPolicy: () => true, authorize: vi.fn(async () => true) as never });
      const ws = fakeWs(anna) as ReturnType<typeof fakeWs> & { bootstrapGrants?: unknown };
      ws.bootstrapGrants = { workspace: true, openspec: true, branch: true, ...grants, terminals: grants.terminal ? "all" : new Set<string>() };
      gateway.wss.emit("connection", ws, {});
      return (types(ws).find((m) => m.type === "sessions_snapshot") as unknown as { orders: Record<string, string[]> }).orders;
    };
    expect(orders({ terminal: false })).toEqual({});
    expect(orders({ terminal: true })).toEqual({ "/a": ["ta"] });
  });

  // ── review r2 B2: decisions are per terminal TARGET, not just per family ──
  function perTargetGateway(policy: (resourceId: string | undefined) => Promise<boolean> | boolean, grants: object | null) {
    const sessionManager = createMemorySessionManager();
    (sessionManager as any).snapshotVisibleIds = () => new Set(["ta", "tb"]);
    const live = [
      { id: "ta", cwd: "/a", principalOwner: anna },
      { id: "tb", cwd: "/a", principalOwner: anna },
    ];
    const terminalManager = { list: () => live, get: (id: string) => live.find((t) => t.id === id), on: vi.fn() };
    const piGateway = { start: vi.fn(), stop: vi.fn(), sendToSession: vi.fn(), getConnectedSessionIds: vi.fn(() => []), hasSession: vi.fn(() => false), onEvent: vi.fn() } as unknown as PiGateway;
    const gateway = createBrowserGateway(sessionManager, createMemoryEventStore(() => false), piGateway, undefined, undefined, undefined, { getPinnedDirectories: () => [], getCollapsedFolders: () => [] } as never, undefined, terminalManager as never, ...(new Array(15).fill(undefined) as []), () => true);
    const authorize = vi.fn(async ({ resource }: { resource: { id?: string } }) => policy(resource.id));
    gateway.setHostPolicy({ hasPolicy: () => true, authorize: authorize as never });
    const ws = fakeWs(anna) as ReturnType<typeof fakeWs> & { bootstrapGrants?: unknown };
    if (grants) ws.bootstrapGrants = grants;
    gateway.wss.emit("connection", ws, {});
    ws.send.mockClear();
    return { gateway, ws, live, authorize };
  }
  const familyAllowed = { workspace: true, openspec: true, branch: true, terminal: true };
  const tick = () => new Promise((r) => setTimeout(r, 20));

  it("r2-B2: bootstrap only lists terminals in the per-target allow set", () => {
    const g = perTargetGateway(() => true, null);
    const fresh = fakeWs(anna) as ReturnType<typeof fakeWs> & { bootstrapGrants?: unknown };
    fresh.bootstrapGrants = { ...familyAllowed, terminals: new Set(["ta"]) };
    g.gateway.wss.emit("connection", fresh, {});
    expect(types(fresh).filter((m) => m.type === "terminal_added").map((m) => m.terminal?.id)).toEqual(["ta"]);
  });

  it("r2-B2: updated/removed/order frames follow the per-target set (denied id never leaks, allowed id still flows)", async () => {
    const { gateway, ws } = perTargetGateway(() => true, { ...familyAllowed, terminals: new Set(["ta"]) });
    gateway.broadcast({ type: "terminal_updated", terminalId: "tb", updates: { title: "secret" } } as never);
    gateway.broadcast({ type: "terminal_updated", terminalId: "ta", updates: { title: "ok" } } as never);
    gateway.broadcast({ type: "sessions_reordered", cwd: "/a", sessionIds: ["ta", "tb"] } as never);
    await tick();
    const frames = types(ws);
    expect(frames.filter((m) => m.type === "terminal_updated").map((m) => m.terminalId)).toEqual(["ta"]);
    expect(frames.find((m) => m.type === "sessions_reordered")?.sessionIds).toEqual(["ta"]);
  });

  it("r2-B2: a terminal created AFTER connect is shown only if the policy permits THAT terminal, in order with its updates", async () => {
    const { gateway, ws, live, authorize } = perTargetGateway((id) => id !== "td", { ...familyAllowed, terminals: new Set<string>() });
    for (const id of ["tc2", "td"]) live.push({ id, cwd: "/a", principalOwner: anna });
    gateway.broadcast({ type: "terminal_added", terminal: { id: "tc2", cwd: "/a", shell: "sh", status: "active", createdAt: 0, principalOwner: anna } } as never);
    gateway.broadcast({ type: "terminal_updated", terminalId: "tc2", updates: { title: "t" } } as never);
    gateway.broadcast({ type: "terminal_added", terminal: { id: "td", cwd: "/a", shell: "sh", status: "active", createdAt: 0, principalOwner: anna } } as never);
    gateway.broadcast({ type: "terminal_updated", terminalId: "td", updates: { title: "secret" } } as never);
    await tick();
    expect(types(ws).map((m) => `${m.type}:${m.terminal?.id ?? m.terminalId}`)).toEqual(["terminal_added:tc2", "terminal_updated:tc2"]);
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ action: "terminal.read", resource: expect.objectContaining({ kind: "terminal", id: "td" }) }));
  });

  it("r2-B2: no policy ⇒ the synchronous, unchanged terminal path (no extra decisions)", () => {
    const sessionManager = createMemorySessionManager();
    const live = [{ id: "ta", cwd: "/a", principalOwner: anna }];
    const terminalManager = { list: () => live, get: (id: string) => live.find((t) => t.id === id), on: vi.fn() };
    const piGateway = { start: vi.fn(), stop: vi.fn(), sendToSession: vi.fn(), getConnectedSessionIds: vi.fn(() => []), hasSession: vi.fn(() => false), onEvent: vi.fn() } as unknown as PiGateway;
    const gateway = createBrowserGateway(sessionManager, createMemoryEventStore(() => false), piGateway, undefined, undefined, undefined, { getPinnedDirectories: () => [], getCollapsedFolders: () => [] } as never, undefined, terminalManager as never, ...(new Array(15).fill(undefined) as []), () => true);
    const ws = fakeWs(anna);
    gateway.wss.emit("connection", ws, {});
    ws.send.mockClear();
    gateway.broadcast({ type: "terminal_updated", terminalId: "ta", updates: { title: "x" } } as never);
    expect(types(ws).map((m) => m.type)).toEqual(["terminal_updated"]); // delivered synchronously
  });

  // ── review r3 B1: policy-gated terminal frames keep the gateway's backpressure ──
  it("r3-B1: a saturated socket never accumulates per-update sends — repeated terminal_updated coalesce to the latest", async () => {
    const { gateway, ws } = perTargetGateway(() => true, { ...familyAllowed, terminals: new Set(["ta"]) });
    (ws as any).bufferedAmount = 64 * 1024 * 1024; // far above the 4 MiB default MAX_WS_BUFFER
    for (let i = 0; i < 200; i++) {
      gateway.broadcast({ type: "terminal_updated", terminalId: "ta", updates: { title: `t${i}` } } as never);
    }
    await tick();
    // Deferred, not sent: a direct ws.send per frame is the unbounded-buffer bug.
    expect(types(ws).filter((m) => m.type === "terminal_updated")).toHaveLength(0);

    // The socket drains; the next delivery flushes the coalesced state — ONE latest update, not 200.
    (ws as any).bufferedAmount = 0;
    gateway.broadcast({ type: "terminal_updated", terminalId: "ta", updates: { title: "final" } } as never);
    await new Promise((r) => setTimeout(r, 450)); // the state flusher runs every 250 ms
    const titles = ws.send.mock.calls
      .map((c) => JSON.parse(c[0] as string) as { type: string; updates?: { title?: string } })
      .filter((m) => m.type === "terminal_updated")
      .map((m) => m.updates?.title);
    expect(titles.length).toBeLessThanOrEqual(2);
    expect(titles[titles.length - 1]).toBe("final");
  });

  it("r3-B1: a stalled socket whose pending state exceeds the bound is terminated, not grown without limit", async () => {
    const { gateway, ws } = perTargetGateway(() => true, { ...familyAllowed, terminals: new Set(["ta", "tb"]) });
    (ws as any).bufferedAmount = 64 * 1024 * 1024;
    const big = "x".repeat(2 * 1024 * 1024);
    for (let i = 0; i < 6; i++) {
      gateway.broadcast({ type: "terminal_updated", terminalId: "ta", updates: { title: big } } as never);
      gateway.broadcast({ type: "terminal_updated", terminalId: "tb", updates: { title: big } } as never);
    }
    await new Promise((r) => setTimeout(r, 100));
    expect(ws.terminate).toHaveBeenCalled();
  });
});
