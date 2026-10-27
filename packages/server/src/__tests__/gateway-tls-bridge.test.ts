/**
 * Bridge admission over the native TLS listener, against a REAL TLS listener (fixture CA), the real
 * gateway and the real vault hub. See change: prove-vault-bridge-tls
 * (test-plan #E15, #X2, #X3; design D2, D3).
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { TlsConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ClientOptions, WebSocket } from "ws";

/** `ws` passes these through to `https.request`; `servername` is the SNI name the fixture leaf is issued for. */
type TlsClientOptions = ClientOptions & import("node:https").RequestOptions;

import { mintBridgeTicket, WsTicketStore } from "../auth/ws-ticket.js";
import { createPiGateway, type PiGateway } from "../pi/pi-gateway.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { CA_PEM, FakeSource } from "../tls/__tests__/helpers.js";
import { registerCertSourceType, unregisterCertSourceType } from "../tls/source-registry.js";
import { onTlsBridgeSwitchChanged, routeBridgeUpgrade } from "../tls/tls-bridge-route.js";
import { TlsListener } from "../tls/tls-listener.js";
import { createBinding } from "../vault/vault-bindings.js";
import { createVaultDeliveryHub } from "../vault/vault-delivery-hub.js";
import { createGrant, dirSubject } from "../vault/vault-grants.js";
import { createVaultStore } from "../vault/vault-store.js";
import { testVaultCodec } from "./helpers/vault-test-codec.js";

/** Poll gateway.address() until the async listen resolves a port. */
async function waitForBind(g: { address(): number | string | null }): Promise<number> {
  for (let i = 0; i < 200; i++) {
    const port = g.address();
    if (typeof port === "number") return port;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("gateway did not bind a port");
}

const NAME = "host.example.ts.net";
const quiet = { info: () => undefined, warn: () => undefined };
const encrypted = { socket: { encrypted: true }, headers: {} } as never;
const plain = { socket: { encrypted: false }, headers: {} } as never;

let root: string;
let accept: boolean;
let tickets: WsTicketStore;
let gateway: PiGateway;
let listener: TlsListener;
let plainServer: http.Server;
let rejectLog: Array<{ status: number; reason?: string }>;
let sessions: ReturnType<typeof createMemorySessionManager>;
let routingChanges: Array<{ id: string; declared?: unknown }>;
let tlsPort: number;
let plainPort: number;
let started: boolean;
let listenerStopped: boolean;
const clients: WebSocket[] = [];
const warn = vi.spyOn(console, "warn");

const routeDeps = (gw: PiGateway | undefined) => ({
  acceptBridges: () => accept,
  gateway: gw,
  rejectLog: (e: { status: number; reason?: string }) => rejectLog.push(e),
});

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-tls-bridge-"));
  accept = true;
  started = true;
  listenerStopped = false;
  rejectLog = [];
  routingChanges = [];
  tickets = new WsTicketStore();
  sessions = createMemorySessionManager();
  warn.mockImplementation(() => undefined);
  gateway = createPiGateway(sessions, {
    bridgeAuth: { consumeTicket: (t) => tickets.consumeDetailed(t, "bridge"), requireTicketOnLoopback: false },
    onRoutingChanged: (id, declared) => routingChanges.push({ id, declared }),
  });
  gateway.start(0, "127.0.0.1");
  await waitForBind(gateway);
  const src = new FakeSource({ names: [NAME] });
  registerCertSourceType({ type: "fake", defaultId: "fake", validate: () => null, create: () => src });
  const cfg: TlsConfig = { enabled: true, port: 0, host: "127.0.0.1", sources: [{ type: "fake" }], acceptBridges: true };
  listener = new TlsListener({
    dataRoot: root,
    getTlsConfig: () => cfg,
    log: quiet,
    dispatch: {
      request: (_req, res) => res.writeHead(404).end(),
      upgrade: (req, socket, head) => routeBridgeUpgrade(routeDeps(started ? gateway : undefined), req, socket, head),
      clientError: (_e, socket) => socket.destroy(),
    },
  });
  await listener.markReady();
  for (let i = 0; i < 500; i++) {
    const certs = listener.manager.status().certs;
    if (listener.boundTlsPort() && certs.length === 1 && certs.every((c) => c.held)) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  tlsPort = listener.boundTlsPort() as number;
  plainServer = http.createServer();
  plainServer.on("upgrade", (req, socket, head) => routeBridgeUpgrade(routeDeps(gateway), req, socket, head));
  await new Promise<void>((r) => plainServer.listen(0, "127.0.0.1", r));
  plainPort = (plainServer.address() as { port: number }).port;
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.terminate();
  gateway.stop();
  if (!listenerStopped) await listener.stop();
  plainServer.closeAllConnections?.();
  await new Promise<void>((r) => plainServer.close(() => r()));
  unregisterCertSourceType("fake");
  fs.rmSync(root, { recursive: true, force: true });
  warn.mockReset();
});

interface Outcome {
  opened: boolean;
  status?: number;
  ws?: WebSocket;
  frames: any[];
  closed: Promise<void>;
}

/** Dial `/ws/bridge` over TLS (or plain) and report whether the upgrade was admitted or what status refused it. */
function dial(ticket: string | null, via: "tls" | "plain" = "tls"): Promise<Outcome> {
  const url = via === "tls" ? `wss://127.0.0.1:${tlsPort}/ws/bridge` : `ws://127.0.0.1:${plainPort}/ws/bridge`;
  const tlsOptions: TlsClientOptions = { ca: CA_PEM, servername: NAME };
  const ws = new WebSocket(ticket ? `${url}?ticket=${ticket}` : url, via === "tls" ? tlsOptions : {});
  clients.push(ws);
  const frames: any[] = [];
  ws.on("message", (raw) => frames.push(JSON.parse(String(raw))));
  return new Promise((resolve) => {
    const closed = new Promise<void>((r) => ws.once("close", () => r()));
    ws.once("open", () => resolve({ opened: true, ws, frames, closed }));
    ws.once("unexpected-response", (_req, res) => resolve({ opened: false, status: res.statusCode, frames, closed }));
    ws.once("error", () => resolve({ opened: false, frames, closed }));
  });
}

const register = (ws: WebSocket, sessionId: string, extra: Record<string, unknown> = {}) =>
  ws.send(JSON.stringify({ type: "session_register", sessionId, cwd: "/work/x", source: "cli", ...extra }));
const until = async (pred: () => boolean, ms = 4000) => {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error("until: timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("E15 bridge admission over the TLS listener", () => {
  it("(a) a device ticket is admitted and the session is attributed to the device, as remote", async () => {
    const out = await dial(mintBridgeTicket(tickets, "dev-a", encrypted));
    expect(out.opened).toBe(true);
    register(out.ws as WebSocket, "s-a");
    await until(() => sessions.get("s-a") !== undefined && gateway.channelOf("s-a") !== undefined);
    expect(sessions.get("s-a")?.originDeviceId).toBe("dev-a");
    expect(gateway.channelOf("s-a")).toEqual({ admission: "device-ticket", provenTls: true, ticketTls: true, ticketDeviceId: "dev-a" });
  });

  it("(b) the same ticket presented again is refused", async () => {
    const t = mintBridgeTicket(tickets, "dev-a", encrypted);
    expect((await dial(t)).opened).toBe(true);
    expect((await dial(t)).opened).toBe(false);
  });

  it("(c) Accept bridges off → 400 `tls-bridges-off`, the ticket stays consumable", async () => {
    accept = false;
    const t = mintBridgeTicket(tickets, "dev-a", encrypted);
    const out = await dial(t);
    expect(out.opened).toBe(false);
    expect(rejectLog).toContainEqual({ status: 400, reason: "tls-bridges-off" });
    accept = true;
    expect((await dial(t)).opened).toBe(true);
  });

  it("(d) the plaintext main listener keeps the 400 and does not consume the ticket", async () => {
    const t = mintBridgeTicket(tickets, "dev-a", encrypted);
    expect((await dial(t, "plain")).opened).toBe(false);
    expect(rejectLog.at(-1)).toEqual({ status: 400 }); // no tls-bridges-off cause on a plaintext socket
    expect((await dial(t)).opened).toBe(true);
  });

  it("(e) a deviceless local ticket is refused (cause logged) and consumed", async () => {
    const t = mintBridgeTicket(tickets, undefined, encrypted);
    expect((await dial(t)).opened).toBe(false);
    expect(warn.mock.calls.flat().join("\n")).toContain("tls-deviceless-ticket");
    expect(tickets.consumeDetailed(t, "bridge")).toMatchObject({ ok: false, reason: "unknown" });
  });

  it("(f) no ticket from a loopback peer is refused (no grace on this path)", async () => {
    expect((await dial(null)).opened).toBe(false);
  });

  it("(g) a gateway that has not started answers 503 `tls-gateway-not-ready`", async () => {
    started = false;
    expect((await dial(mintBridgeTicket(tickets, "dev-a", encrypted))).opened).toBe(false);
    // routeBridgeUpgrade has no gateway → the 400 stands; the gateway-side 503 is exercised directly below
    const idle = createPiGateway(sessions, { bridgeAuth: { consumeTicket: (t) => tickets.consumeDetailed(t, "bridge") } });
    const writes: string[] = [];
    const sock = { write: (s: string) => writes.push(s), destroy: () => undefined, encrypted: true } as never;
    idle.handleTlsUpgrade({ socket: { remoteAddress: "127.0.0.1", encrypted: true }, headers: {}, url: "/ws/bridge" } as never, sock, Buffer.alloc(0));
    expect(writes.join("")).toContain("503");
    expect(warn.mock.calls.flat().join("\n")).toContain("tls-gateway-not-ready");
  });

  it("an upgrade on the TLS socket that carries a forwarding header is admitted but its channel is not proven TLS", async () => {
    // Exercised end to end through the gateway's own hand-off: provenTls comes from `isProvenTls(req)`.
    const t = mintBridgeTicket(tickets, "dev-a", encrypted);
    const out = await new Promise<Outcome>((resolve) => {
      const forwardedOptions: TlsClientOptions = {
        ca: CA_PEM,
        servername: NAME,
        headers: { "x-forwarded-for": "198.51.100.7" },
      };
      const ws = new WebSocket(`wss://127.0.0.1:${tlsPort}/ws/bridge?ticket=${t}`, forwardedOptions);
      clients.push(ws);
      const frames: any[] = [];
      ws.once("open", () => resolve({ opened: true, ws, frames, closed: new Promise<void>((r) => ws.once("close", () => r())) }));
      ws.once("error", () => resolve({ opened: false, frames, closed: Promise.resolve() }));
    });
    expect(out.opened).toBe(true);
    register(out.ws as WebSocket, "s-fwd");
    await until(() => gateway.channelOf("s-fwd") !== undefined);
    expect(gateway.channelOf("s-fwd")).toMatchObject({ admission: "device-ticket", provenTls: false, ticketTls: true });
  });
});

describe("X2 / X3 switching off withdraws and closes", () => {
  async function connectTrusted(sessionId: string) {
    const store = createVaultStore({ codec: testVaultCodec(), path: path.join(root, "vault.json") });
    const acc = await store.addAccount({ provider: "soniox", label: "s", value: "soniox-key-0001" });
    await createBinding(store, { name: "SONIOX_API_KEY", defaultAccountId: acc.id });
    await createGrant(store, { subject: dirSubject("dev-a", "/work/x"), bindingName: "SONIOX_API_KEY" });
    const hub = createVaultDeliveryHub({
      store,
      getOrigin: (id) => {
        const s = sessions.get(id);
        return s?.originDeviceId ? { local: false, deviceId: s.originDeviceId } : s ? { local: true } : undefined;
      },
      getChannel: (id) => gateway.channelOf(id),
      getDeviceTrust: () => "eligible",
      isTlsBridgesLive: () => accept,
      send: (id, msg) => gateway.sendToSession(id, msg),
      isSessionConnected: (id) => gateway.isSessionConnected(id),
      isDeliveryEnabled: () => true,
      getGraceHours: () => 24,
      pushDelayMs: 10,
    });
    const out = await dial(mintBridgeTicket(tickets, "dev-a", encrypted));
    expect(out.opened).toBe(true);
    register(out.ws as WebSocket, sessionId, { certValidation: "enforced" });
    await until(() => gateway.channelOf(sessionId) !== undefined);
    await hub.handleSyncRequest(sessionId, { type: "vault_sync_request", sessionId, cwd: "/work/x", tracked: [], reason: "connect", certValidation: "enforced" });
    await until(() => out.frames.some((f) => f.type === "vault_snapshot" && f.status === "ok"));
    return { out, hub };
  }

  it("X2 turning Accept bridges off pushes `denied`, closes the socket within 5 s, and a reconnect gets 400 tls-bridges-off", async () => {
    const { out, hub } = await connectTrusted("s-x2");
    accept = false;
    const t0 = Date.now();
    onTlsBridgeSwitchChanged({ acceptBridges: () => accept, push: () => void hub.pushNow(), gateway });
    await out.closed;
    expect(Date.now() - t0).toBeLessThan(5_000);
    const denied = out.frames.filter((f) => f.type === "vault_snapshot").at(-1);
    expect(denied).toMatchObject({ status: "denied", outcome: "transport-insecure", trustDetail: "plain-transport", entries: [] });
    const again = await dial(mintBridgeTicket(tickets, "dev-a", encrypted));
    expect(again.opened).toBe(false);
    expect(rejectLog).toContainEqual({ status: 400, reason: "tls-bridges-off" });
    hub.dispose();
  });

  it("X3 the TLS listener stopping closes the TLS-admitted gateway socket; nothing is delivered to it afterwards", async () => {
    const { out, hub } = await connectTrusted("s-x3");
    accept = false; // `tls.enabled: false` reconcile → live switch reads off
    // The config route runs the hook BEFORE the reconcile: closing the listener waits for upgraded sockets.
    onTlsBridgeSwitchChanged({ acceptBridges: () => accept, push: () => void hub.pushNow(), gateway });
    await listener.stop();
    listenerStopped = true;
    await until(() => !gateway.isSessionConnected("s-x3"), 5_000);
    const seen = out.frames.length;
    await hub.pushNow();
    expect(out.frames.length).toBe(seen); // no later evaluation reaches the closed socket
    expect(out.frames.filter((f) => f.type === "vault_snapshot").at(-1)).toMatchObject({ status: "denied", trustDetail: "plain-transport" });
    hub.dispose();
  });
});

describe("routing hooks", () => {
  it("register and move-commit report the routing change with the declared certValidation", async () => {
    const out = await dial(mintBridgeTicket(tickets, "dev-a", encrypted));
    register(out.ws as WebSocket, "s-r", { certValidation: "enforced" });
    await until(() => routingChanges.length > 0);
    expect(routingChanges[0]).toEqual({ id: "s-r", declared: { certValidation: "enforced" } });
    const out2 = await dial(mintBridgeTicket(tickets, "dev-a", encrypted));
    register(out2.ws as WebSocket, "s-r2");
    await until(() => routingChanges.length > 1);
    expect(routingChanges[1]).toEqual({ id: "s-r2", declared: { certValidation: undefined } });
  });
});
