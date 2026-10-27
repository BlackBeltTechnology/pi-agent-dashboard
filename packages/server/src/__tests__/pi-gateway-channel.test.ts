/**
 * `channelOf(sessionId)` answers from the socket the gateway currently ROUTES the session to, so it changes
 * with the routing entry at move-commit, and the vault hub re-evaluates then — without a sync request.
 * See change: prove-vault-bridge-tls (test-plan #F2; design D3).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BRIDGE_PURPOSE,
  canonicalBinding,
  LOCAL_PROOF_HEADER,
  mintProof,
} from "@blackbelt-technology/pi-dashboard-shared/local-credential-proof.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createLocalCredentialVerifier } from "../auth/local-credential.js";
import { WsTicketStore } from "../auth/ws-ticket.js";
import { createPiGateway, type PiGateway } from "../pi/pi-gateway.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { originOf } from "../session/session-origin.js";
import { createBinding } from "../vault/vault-bindings.js";
import { createVaultDeliveryHub } from "../vault/vault-delivery-hub.js";
import { createGrant, dirSubject } from "../vault/vault-grants.js";
import { createVaultStore } from "../vault/vault-store.js";
import { testVaultCodec } from "./helpers/vault-test-codec.js";

const TOKEN = "channel-token-0123456789abcdefghijklmnopqrstuvwxyz";
let dir: string;
let gateway: PiGateway;
const sockets: WebSocket[] = [];

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-gw-channel-"));
});
afterEach(() => {
  for (const s of sockets.splice(0)) s.terminate();
  gateway.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

const until = async (pred: () => boolean, ms = 4000) => {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error("until: timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
};

function open(port: number, headers: Record<string, string> = {}): Promise<{ ws: WebSocket; frames: any[] }> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers });
  sockets.push(ws);
  const frames: any[] = [];
  ws.on("message", (raw) => frames.push(JSON.parse(String(raw))));
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve({ ws, frames }));
    ws.once("error", reject);
  });
}

describe("F2 move-commit hands the routing entry (and its channel) to another socket", () => {
  it("channelOf follows the entry and the hub denies without a sync request", async () => {
    const sessions = createMemorySessionManager();
    const store = createVaultStore({ codec: testVaultCodec(), path: path.join(dir, "vault.json") });
    const acc = await store.addAccount({ provider: "soniox", label: "s", value: "soniox-key-0001" });
    await createBinding(store, { name: "SONIOX_API_KEY", defaultAccountId: acc.id });
    await createGrant(store, { subject: dirSubject("hub", "/work/m"), bindingName: "SONIOX_API_KEY" });

    let hubRef: ReturnType<typeof createVaultDeliveryHub> | undefined;
    const tickets = new WsTicketStore();
    gateway = createPiGateway(sessions, {
      bridgeAuth: {
        consumeTicket: (t) => tickets.consumeDetailed(t, "bridge"),
        requireTicketOnLoopback: false,
        verifyCredential: createLocalCredentialVerifier({ token: TOKEN, acceptLegacyToken: false, log: () => undefined }),
      },
      onRoutingChanged: (id, declared) => hubRef?.handleRegister(id, declared),
    });
    gateway.start(0, "127.0.0.1");
    let port = 0;
    await until(() => typeof gateway.address() === "number");
    port = gateway.address() as number;
    hubRef = createVaultDeliveryHub({
      store,
      getOrigin: (id) => {
        const s = sessions.get(id);
        return s ? originOf(s) : undefined;
      },
      getChannel: (id) => gateway.channelOf(id),
      getDeviceTrust: () => "eligible",
      isTlsBridgesLive: () => false,
      send: (id, msg) => gateway.sendToSession(id, msg),
      isSessionConnected: (id) => gateway.isSessionConnected(id),
      isDeliveryEnabled: () => true,
      getGraceHours: () => 24,
      pushDelayMs: 10,
    });

    // 1. A bridge admitted on a verified local credential proof registers and is delivered to.
    const proof = mintProof({ token: TOKEN, binding: canonicalBinding("127.0.0.1", port), purpose: BRIDGE_PURPOSE });
    const first = await open(port, { [LOCAL_PROOF_HEADER]: proof.header });
    first.ws.send(JSON.stringify({ type: "session_register", sessionId: "sess-M", cwd: "/work/m", source: "cli" }));
    await until(() => gateway.channelOf("sess-M") !== undefined);
    expect(gateway.channelOf("sess-M")).toMatchObject({ admission: "local-proof", provenTls: false });
    await hubRef.handleSyncRequest("sess-M", { type: "vault_sync_request", sessionId: "sess-M", cwd: "/work/m", tracked: [], reason: "connect" });
    await until(() => first.frames.some((f) => f.type === "vault_snapshot"));
    expect(first.frames.filter((f) => f.type === "vault_snapshot").at(-1)).toMatchObject({ status: "ok", outcome: "delivered" });

    // 2. That socket lets go of the entry.
    first.ws.send(JSON.stringify({ type: "session_unregister", sessionId: "sess-M" }));
    await until(() => gateway.channelOf("sess-M") === undefined);

    // 3. A plain tokenless-grace socket opens a provisional registration and commits the move.
    const second = await open(port);
    second.ws.send(JSON.stringify({ type: "session_register", provisional: true, sessionId: "sess-M", cwd: "/work/m", source: "cli" }));
    await until(() => second.frames.some((f) => f.type === "provisional_accepted"));
    const token = second.frames.find((f) => f.type === "provisional_accepted").token;
    second.ws.send(JSON.stringify({ type: "session_move_commit", sessionId: "sess-M", token }));
    await until(() => second.frames.some((f) => f.type === "session_move_committed"));

    // The channel changed with the routing entry, and the hub denied BEFORE any sync request from the new socket.
    expect(gateway.channelOf("sess-M")).toMatchObject({ admission: "grace" });
    await until(() => second.frames.some((f) => f.type === "vault_snapshot"));
    expect(second.frames.find((f) => f.type === "vault_snapshot")).toMatchObject({
      status: "denied",
      outcome: "untrusted",
      trustDetail: "local-unproven",
      entries: [],
    });
    hubRef.dispose();
  });
});
