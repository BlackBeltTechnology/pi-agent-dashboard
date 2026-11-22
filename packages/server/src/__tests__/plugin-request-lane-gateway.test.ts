/**
 * End-to-end through the REAL hops (no stubbed hop): `createPiGateway` -> `wireEvents` ->
 * `dispatchPluginRequest` -> `createPluginRequestLane`. Guards against any hop silently dropping
 * the sending socket's `conn` (origin + channel), and pins the ownership gate that attributes a
 * `plugin_request` only to the socket that owns the session it names.
 * Also covers the `sessions_list` seed/rewrite binding (task 1.10) which uses the same `conn`.
 * See change: harden-bridge-session-claim (tasks 1.10, 3.1, 3.8; WS-05).
 */
import {
  BRIDGE_PURPOSE,
  canonicalBinding,
  LOCAL_PROOF_HEADER,
  mintProof,
} from "@blackbelt-technology/pi-dashboard-shared/local-credential-proof.js";
import type { PluginRequestMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { createLocalCredentialVerifier } from "../auth/local-credential.js";
import { WsTicketStore } from "../auth/ws-ticket.js";
import { wireEvents } from "../event-wiring.js";
import { createBrowserGateway } from "../pairing/browser-gateway.js";
import { createPendingForkRegistry } from "../pending/pending-fork-registry.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import { createPiGateway, type PiGateway } from "../pi/pi-gateway.js";
import { createPluginRequestLane } from "../plugin-request-lane.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { makeFakeDirectoryService } from "./helpers/load-fixtures.js";

const TOKEN = "lane-e2e-token-0123456789abcdefghijklmnopqrstuvwxyz";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms = 4000) {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error("until: timeout");
    await delay(10);
  }
}

interface Peer {
  ws: WebSocket;
  frames: any[];
}

describe("plugin_request through the real gateway -> wiring -> lane hops", () => {
  let gateway: PiGateway;
  const peers: Peer[] = [];
  const options: Record<string, unknown> = {};
  afterEach(() => {
    for (const p of peers.splice(0)) p.ws.terminate();
    gateway?.stop();
    vi.restoreAllMocks();
    delete options.peerAddressForTest;
  });

  async function setup() {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sessionManager = createMemorySessionManager();
    const tickets = new WsTicketStore();
    Object.assign(options, {
      pingInterval: 0,
      bridgeAuth: {
        consumeTicket: (t: string | null | undefined) => tickets.consumeDetailed(t, "bridge"),
        requireTicketOnLoopback: false,
        verifyCredential: createLocalCredentialVerifier({ token: TOKEN, acceptLegacyToken: false, log: () => undefined }),
      },
    });
    gateway = createPiGateway(sessionManager, options as never);
    const eventStore = createMemoryEventStore(() => false);
    const browserGateway = createBrowserGateway(sessionManager, eventStore, gateway);
    const lane = createPluginRequestLane((sid, msg) => gateway.sendToSession(sid, msg as never));
    const seen: Array<{ payload: unknown; meta: any }> = [];
    lane.register("gmail", "lease", (payload, meta) => { seen.push({ payload, meta }); return { token: "SECRET" }; }, { hubLocalOnly: true });
    lane.register("demo", "echo", (payload, meta) => { seen.push({ payload, meta }); return payload; });
    wireEvents({
      sessionManager,
      eventStore,
      piGateway: gateway,
      browserGateway,
      sessionOrderManager: {
        insert: vi.fn(), remove: vi.fn(), getOrder: vi.fn(() => []), reorder: vi.fn(),
        getAllOrders: vi.fn(() => ({})), moveToFront: vi.fn(), rekey: vi.fn(),
      } as any,
      preferencesStore: {
        getPinnedDirectories: () => [], setPinnedDirectories: () => {},
        getSessionOrder: () => ({}), setSessionOrder: () => {},
        getAutoNameSessions: () => false,
      } as any,
      pendingForkRegistry: createPendingForkRegistry(),
      directoryService: makeFakeDirectoryService().service,
      knownSessionIds: new Set<string>(),
      pendingDashboardSpawns: new Map<string, number>(),
      dispatchPluginRequest: (sid: string, msg: PluginRequestMessage, conn: unknown) => {
        lane.handle(sid, msg, conn as never).catch(() => undefined);
      },
    } as any);
    gateway.start(0, "127.0.0.1");
    await until(() => typeof gateway.address() === "number");
    return { sessionManager, port: gateway.address() as number, tickets, seen };
  }

  function open(port: number, headers: Record<string, string> = {}, query = ""): Promise<Peer> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${query}`, { headers });
    const peer: Peer = { ws, frames: [] };
    peers.push(peer);
    ws.on("message", (raw) => peer.frames.push(JSON.parse(String(raw))));
    ws.on("error", () => undefined);
    return new Promise((resolve, reject) => {
      ws.once("open", () => resolve(peer));
      ws.once("error", reject);
    });
  }
  const send = (p: Peer, m: unknown) => p.ws.send(JSON.stringify(m));
  const reg = (p: Peer, id: string, extra: Record<string, unknown> = {}) =>
    send(p, { type: "session_register", sessionId: id, cwd: "/w", source: "tui", ...extra });
  const lease = (p: Peer, requestId = "r1", type = "lease", plugin = "gmail") =>
    send(p, { type: "plugin_request", requestId, pluginId: plugin, messageType: type, payload: { a: 1 } });
  const replies = (p: Peer) => p.frames.filter((f) => f.type === "plugin_reply");

  it("a hub-local, locally admitted bridge reaches a hub-local-only handler with its own origin + channel", async () => {
    const { port, seen } = await setup();
    const proof = mintProof({ token: TOKEN, binding: canonicalBinding("127.0.0.1", port), purpose: BRIDGE_PURPOSE });
    const a = await open(port, { [LOCAL_PROOF_HEADER]: proof.header });
    reg(a, "S");
    await until(() => gateway.isSessionConnected("S"));
    lease(a);
    await until(() => replies(a).length === 1);
    expect(replies(a)[0]).toMatchObject({ ok: true, result: { token: "SECRET" } });
    expect(seen).toHaveLength(1);
    expect(seen[0].meta.sessionId).toBe("S");
    expect(seen[0].meta.channel.admission).toBe("local-proof");
    expect(seen[0].meta.origin).toEqual({ local: true });
  });

  it("the same request from a device-ticket socket (remote origin) is refused origin_denied", async () => {
    const { port, seen, tickets } = await setup();
    options.peerAddressForTest = "203.0.113.7";
    const b = await open(port, {}, `?ticket=${tickets.mint("bridge", "dev-aaaaaaaa-1")}`);
    reg(b, "R");
    await until(() => gateway.isSessionConnected("R"));
    lease(b);
    await until(() => replies(b).length === 1);
    expect(replies(b)[0]).toMatchObject({ ok: false });
    expect(replies(b)[0].error).toMatch(/^origin_denied: /);
    expect(seen).toHaveLength(0);
    // An unrestricted handler still answers the same remote socket, with the origin it observed.
    lease(b, "r2", "echo", "demo");
    await until(() => replies(b).length === 2);
    expect(replies(b)[1]).toMatchObject({ ok: true });
    expect(seen[0].meta.origin).toEqual({ local: false, deviceId: "dev-aaaaaaaa-1" });
    expect(seen[0].meta.channel).toMatchObject({ admission: "device-ticket" });
  });

  it("a deprecated (tokenless grace) admission on loopback is not locally admitted", async () => {
    const { port, seen } = await setup();
    const g = await open(port);
    reg(g, "G");
    await until(() => gateway.isSessionConnected("G"));
    lease(g);
    await until(() => replies(g).length === 1);
    expect(replies(g)[0].error).toMatch(/^origin_denied: /);
    expect(seen).toHaveLength(0);
  });

  it("3.1: a socket whose first frame names a live-held id cannot ride the owner's session on the lane", async () => {
    const { port, seen } = await setup();
    const proof = mintProof({ token: TOKEN, binding: canonicalBinding("127.0.0.1", port), purpose: BRIDGE_PURPOSE });
    const owner = await open(port, { [LOCAL_PROOF_HEADER]: proof.header });
    reg(owner, "VICTIM");
    await until(() => gateway.isSessionConnected("VICTIM"));

    options.peerAddressForTest = "203.0.113.7";
    const evil = await open(port);
    send(evil, { type: "event_forward", sessionId: "VICTIM", event: { type: "noop" } });
    await delay(100);
    lease(evil, "x1");
    lease(evil, "x2", "echo", "demo");
    await delay(200);

    expect(seen).toHaveLength(0);
    expect(replies(evil)).toHaveLength(0);
    expect(replies(owner)).toHaveLength(0);
  });

  it("3.1: a request-first socket (no session named, no registration) is dropped", async () => {
    const { port, seen } = await setup();
    const c = await open(port);
    lease(c, "y1", "echo", "demo");
    await delay(200);
    expect(seen).toHaveLength(0);
    expect(replies(c)).toHaveLength(0);
  });

  describe("sessions_list records are bound to the reporter's origin (task 1.10)", () => {
    const list = (p: Peer, sessions: Array<Record<string, unknown>>) =>
      send(p, { type: "sessions_list", cwd: "/w", sessions });
    const row = (id: string, path: string) => ({ id, path, cwd: "/w", name: id, firstMessage: "hi" });

    it("seeds an unseen id with the reporting socket's origin, and a hub-local register on it is then refused", async () => {
      const { port, sessionManager, tickets } = await setup();
      options.peerAddressForTest = "203.0.113.7";
      const remote = await open(port, {}, `?ticket=${tickets.mint("bridge", "dev-aaaaaaaa-1")}`);
      reg(remote, "OWN");
      await until(() => gateway.isSessionConnected("OWN"));
      list(remote, [row("HIST", "/remote/HIST.jsonl")]);
      await until(() => sessionManager.get("HIST") !== undefined);
      expect(sessionManager.get("HIST")).toMatchObject({ originDeviceId: "dev-aaaaaaaa-1", sessionFile: "/remote/HIST.jsonl" });

      delete options.peerAddressForTest;
      const hub = await open(port);
      reg(hub, "HIST");
      await until(() => hub.ws.readyState === WebSocket.CLOSED);
      expect(hub.frames.map((f) => f.type)).toContain("register_rejected");
      expect(sessionManager.get("HIST")!.originDeviceId).toBe("dev-aaaaaaaa-1");
    });

    it("a hub-local reporter seeds hub-local (origin stays undefined)", async () => {
      const { port, sessionManager } = await setup();
      const hub = await open(port);
      reg(hub, "OWN");
      await until(() => gateway.isSessionConnected("OWN"));
      list(hub, [row("HIST", "/h/HIST.jsonl")]);
      await until(() => sessionManager.get("HIST") !== undefined);
      expect(sessionManager.get("HIST")!.originDeviceId).toBeUndefined();
    });

    it("another origin's sessions_list does not rewrite an existing record's sessionFile; the same origin does", async () => {
      const { port, sessionManager, tickets } = await setup();
      sessionManager.register({ id: "H", cwd: "/w", source: "tui", sessionFile: "/h/H.jsonl", sessionDir: "/w" } as never);
      options.peerAddressForTest = "203.0.113.7";
      const remote = await open(port, {}, `?ticket=${tickets.mint("bridge", "dev-aaaaaaaa-1")}`);
      reg(remote, "OWN");
      await until(() => gateway.isSessionConnected("OWN"));
      list(remote, [row("H", "/evil/H.jsonl")]);
      await delay(150);
      expect(sessionManager.get("H")!.sessionFile).toBe("/h/H.jsonl");

      delete options.peerAddressForTest;
      const hub = await open(port);
      reg(hub, "OWN2");
      await until(() => gateway.isSessionConnected("OWN2"));
      list(hub, [row("H", "/h/MOVED.jsonl")]);
      await until(() => sessionManager.get("H")!.sessionFile === "/h/MOVED.jsonl");
    });
  });
});
