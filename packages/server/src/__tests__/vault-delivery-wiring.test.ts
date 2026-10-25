/**
 * Real server wiring of vault delivery: a hub-local bridge advertises the
 * `vault-delivery` feature, asks for its values with `vault_sync_request`, and
 * receives a rotation push without asking again.
 * See change: add-credential-vault (tasks 4.15, 4.16).
 */
import * as fs from "node:fs";
import nodeFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { VaultSnapshotMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { PairedDeviceRegistry } from "../pairing/paired-devices.js";
import type { BridgeChannel } from "../pi/bridge-channel.js";
import { createServer, type DashboardServer, type ServerConfig } from "../server.js";
import { startDeviceExpirySweep } from "../vault/device-expiry-sweep.js";
import { createVaultDeliveryHub } from "../vault/vault-delivery-hub.js";
import { writeRegistryRows } from "./helpers/bearer-rotation-app.js";
import { createBinding } from "../vault/vault-bindings.js";
import { createGrant, dirSubject } from "../vault/vault-grants.js";
import { createVaultStore } from "../vault/vault-store.js";
import { BRIDGE_PURPOSE, canonicalBinding, LOCAL_PROOF_HEADER, mintProof } from "@blackbelt-technology/pi-dashboard-shared/local-credential-proof.js";
import { readLocalTokenIfPresent } from "../auth/local-token.js";
import { proofFetch } from "../test-support/local-credential-stamp.js";

const baseConfig: ServerConfig = {
  port: 0, piPort: 0, host: "127.0.0.1", gatewayTcp: true, dev: true, autoShutdown: false, shutdownIdleSeconds: 999, tunnel: false,
};

describe("vault delivery wiring", () => {
  let server: DashboardServer;
  let tmp: string;
  let ws: WebSocket;

  beforeEach(() => { tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ew-vault-"))); });
  afterEach(async () => {
    ws?.close();
    await server?.stop();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("answers a sync request with the granted values, advertises the feature, and pushes a rotation", async () => {
    const store = createVaultStore(); // default path: under the per-file tmp $HOME
    const acc = await store.addAccount({ provider: "gemini", label: "g", value: "gemini-key-001" });
    await createBinding(store, { name: "GEMINI_API_KEY", defaultAccountId: acc.id });
    await createGrant(store, { subject: dirSubject("hub", tmp), bindingName: "GEMINI_API_KEY" });

    server = await createServer({ ...baseConfig });
    await server.start();
    // Hub vault delivery needs LOCAL admission (a verified local credential proof here), not just a loopback address.
    const bridgeProof = mintProof({
      token: readLocalTokenIfPresent() as string,
      binding: canonicalBinding("127.0.0.1", server.piPort() as number),
      purpose: BRIDGE_PURPOSE,
    });
    ws = new WebSocket(`ws://127.0.0.1:${server.piPort()}`, { headers: { [LOCAL_PROOF_HEADER]: bridgeProof.header } });
    const frames: any[] = [];
    ws.on("message", (raw) => { try { frames.push(JSON.parse(String(raw))); } catch { /* ignore */ } });
    await new Promise<void>((resolve) => ws.on("open", () => resolve()));

    ws.send(JSON.stringify({ type: "session_register", sessionId: "s1", cwd: tmp, source: "cli" }));
    // Registration is asynchronous; poll rather than guess a delay.
    await vi.waitFor(() => expect(frames.find((f) => f.type === "dashboard_identity")).toBeDefined(), { timeout: 5_000 });
    expect(frames.find((f) => f.type === "dashboard_identity")?.features).toContain("vault-delivery");

    ws.send(JSON.stringify({ type: "vault_sync_request", sessionId: "s1", cwd: tmp, tracked: [], reason: "connect" }));
    await vi.waitFor(() => expect(frames.some((f) => f.type === "vault_snapshot")).toBe(true), { timeout: 5_000 });
    const first = frames.filter((f) => f.type === "vault_snapshot").at(-1);
    expect(first).toMatchObject({ status: "ok", outcome: "delivered", entries: [{ name: "GEMINI_API_KEY", value: "gemini-key-001" }] });

    // Rotate through the management route (loopback = locally trusted): the
    // server's own store fires the push.
    const res = await proofFetch(`http://127.0.0.1:${server.httpPort()}/api/vault/accounts/${acc.id}/value`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "rotated-key-0001" }),
    });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(frames.filter((f) => f.type === "vault_snapshot").at(-1)?.entries?.[0]?.value).toBe("rotated-key-0001"), { timeout: 5_000 });
    const pushed = frames.filter((f) => f.type === "vault_snapshot").at(-1);
    expect(pushed.entries).toEqual([{ name: "GEMINI_API_KEY", value: "rotated-key-0001" }]);
  });
});

// ── prove-vault-bridge-tls: deactivation withdraws; downgrade, disconnect and persist-failure (D3, D4, D6) ──

describe("hub ↔ registry ↔ gateway: remote trust over time", () => {
  let dir: string;
  let store: ReturnType<typeof createVaultStore>;
  let reg: PairedDeviceRegistry;
  let hub: ReturnType<typeof createVaultDeliveryHub>;
  let stopSweep: (() => void) | undefined;
  const T0 = Date.UTC(2030, 0, 1);

  interface FakeSocket { channel: BridgeChannel; connected: boolean; deviceId: string }
  let sockets: Map<string, FakeSocket>;
  let inbox: Map<string, Array<{ at: number; msg: VaultSnapshotMessage }>>;

  const tlsChannel = (deviceId: string): BridgeChannel => ({ admission: "device-ticket", provenTls: true, ticketTls: true, ticketDeviceId: deviceId });
  const plainChannel = (deviceId: string): BridgeChannel => ({ admission: "device-ticket", provenTls: false, ticketTls: false, ticketDeviceId: deviceId });

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-wiring-"));
    store = createVaultStore(path.join(dir, "vault.json"));
    reg = new PairedDeviceRegistry(path.join(dir, "paired.json"));
    sockets = new Map();
    inbox = new Map();
    const acc = await store.addAccount({ provider: "soniox", label: "s", value: "soniox-key-0001" });
    await createBinding(store, { name: "SONIOX_API_KEY", defaultAccountId: acc.id });
    hub = createVaultDeliveryHub({
      store,
      getOrigin: (id) => (sockets.has(id) ? { local: false, deviceId: sockets.get(id)?.deviceId } : undefined),
      getChannel: (id) => sockets.get(id)?.channel,
      getDeviceTrust: (id) => reg.deviceTrust(id),
      isTlsBridgesLive: () => true,
      exposurePending: () => reg.exposurePending(),
      send: (id, msg) => {
        const s = sockets.get(id);
        if (!s?.connected) return false;
        const box = inbox.get(id) ?? [];
        box.push({ at: Date.now(), msg: msg as VaultSnapshotMessage });
        inbox.set(id, box);
        return true;
      },
      isSessionConnected: (id) => sockets.get(id)?.connected === true,
      isDeliveryEnabled: () => true,
      getGraceHours: () => 24,
      pushDelayMs: 150,
    });
    reg.onChange(() => hub.schedulePush());
  });
  afterEach(() => {
    stopSweep?.();
    hub.dispose();
    vi.useRealTimers();
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const connect = async (sessionId: string, deviceId: string, channel = tlsChannel(deviceId)) => {
    await createGrant(store, { subject: dirSubject(deviceId, `/work/${sessionId}`), bindingName: "SONIOX_API_KEY" });
    sockets.set(sessionId, { channel, connected: true, deviceId });
    await hub.handleSyncRequest(sessionId, { type: "vault_sync_request", sessionId, cwd: `/work/${sessionId}`, tracked: [], reason: "connect", certValidation: "enforced" });
  };
  const last = (id: string) => inbox.get(id)?.at(-1)?.msg;
  const mkDevice = () => reg.add("dev", "manual", "operate", undefined, { channel: "tls", purpose: "bridge" });

  it("P1 revoke and first plaintext exposure each withdraw from every session of the device within 5 s (expect ~150 ms)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const a = mkDevice();
    const b = mkDevice();
    await connect("a1", a.device.id);
    await connect("a2", a.device.id);
    await connect("b1", b.device.id);
    expect(last("a1")).toMatchObject({ status: "ok", outcome: "delivered" });

    // (a) revoke
    inbox.clear();
    const t1 = Date.now();
    reg.revoke(a.device.id);
    await vi.advanceTimersByTimeAsync(10_000);
    for (const id of ["a1", "a2"]) {
      const first = inbox.get(id)?.find((m) => m.msg.status === "denied");
      expect(first?.msg).toMatchObject({ outcome: "untrusted", trustDetail: "device-inactive" });
      expect((first?.at ?? Infinity) - t1).toBeLessThanOrEqual(5_000);
    }
    expect(inbox.get("b1")?.some((m) => m.msg.status === "denied") ?? false).toBe(false);

    // (b) a first plain-HTTP presentation of b's bearer
    inbox.clear();
    const t2 = Date.now();
    reg.verify(b.token, "plain");
    await vi.advanceTimersByTimeAsync(10_000);
    const denied = inbox.get("b1")?.find((m) => m.msg.status === "denied");
    expect(denied?.msg).toMatchObject({ outcome: "transport-insecure", trustDetail: "bearer-exposed" });
    expect((denied?.at ?? Infinity) - t2).toBeLessThanOrEqual(5_000);
  });

  it("P2 expiry withdraws within 60 s and idle sweeps push nothing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    const row = { id: "exp-dev", token: "expiring-token", expiresAt: T0 + 10_000, pairedAt: T0, exposure: { trackedSince: new Date(T0).toISOString() }, tier: "operate" };
    writeRegistryRows(path.join(dir, "paired.json"), [row]);
    reg = new PairedDeviceRegistry(path.join(dir, "paired.json"));
    reg.onChange(() => hub.schedulePush());
    expect(reg.deviceTrust("exp-dev")).toBe("eligible");
    await connect("e1", "exp-dev");
    expect(last("e1")).toMatchObject({ status: "ok" });
    const push = vi.spyOn(hub, "schedulePush");
    stopSweep = startDeviceExpirySweep({ activeIds: () => reg.activeIds(), onLeft: () => hub.schedulePush() });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(last("e1")).toMatchObject({ status: "denied", trustDetail: "device-inactive" });
    // The device is gone from the active set now: ten more sweeps change nothing and push nothing.
    push.mockClear();
    inbox.clear();
    await vi.advanceTimersByTimeAsync(10 * 30_000);
    expect(push).not.toHaveBeenCalled();
    expect(inbox.size).toBe(0);
  });

  it("F1 a plaintext reconnect gets `denied` before any `ok`; TLS again is delivered", async () => {
    const a = mkDevice();
    await connect("s1", a.device.id);
    expect(last("s1")).toMatchObject({ status: "ok" });
    // socket closes; the same session id re-registers over plain ws
    sockets.get("s1")!.connected = false;
    inbox.clear();
    sockets.set("s1", { channel: plainChannel(a.device.id), connected: true, deviceId: a.device.id });
    hub.handleRegister("s1", { certValidation: "enforced" });
    expect(inbox.get("s1")?.[0]?.msg).toMatchObject({ status: "denied", outcome: "transport-insecure", trustDetail: "plain-transport" });
    expect(inbox.get("s1")?.some((m) => m.msg.status === "ok")).toBe(false);
    // and over TLS again
    sockets.set("s1", { channel: tlsChannel(a.device.id), connected: true, deviceId: a.device.id });
    hub.handleRegister("s1", { certValidation: "enforced" });
    expect(last("s1")).toMatchObject({ status: "ok", outcome: "delivered", entries: [{ name: "SONIOX_API_KEY", value: "soniox-key-0001" }] });
  });

  it("F3 a disconnected session is not re-evaluated: no send, outcome stays delivered, rows hub-unreachable", async () => {
    const a = mkDevice();
    await connect("s1", a.device.id);
    sockets.get("s1")!.connected = false;
    inbox.clear();
    reg.revoke(a.device.id); // would deny, but nothing can be sent to a closed socket
    await hub.pushNow();
    expect(inbox.size).toBe(0);
    const state = hub.getSessionState("s1");
    expect(state?.outcome).toBe("delivered");
    expect(state?.bindings).toEqual([{ name: "SONIOX_API_KEY", state: "hub-unreachable" }]);
  });

  it("X1 a failed first-exposure write fails closed for every remote session until it persists", async () => {
    const a = mkDevice();
    const b = mkDevice();
    await connect("a1", a.device.id);
    await connect("b1", b.device.id);
    await hub.pushNow(); // settle the vault-write debounce created by the grants (real timers) before faking time
    const real = nodeFs.writeFileSync;
    let failing = true;
    vi.spyOn(nodeFs, "writeFileSync").mockImplementation(((...args: Parameters<typeof fs.writeFileSync>) => {
      if (failing) throw new Error("EIO");
      return real(...args);
    }) as typeof fs.writeFileSync);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();
    inbox.clear();
    reg.verify(a.token, "plain");
    expect(reg.exposurePending()).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(last("a1")).toMatchObject({ status: "denied", trustDetail: "bearer-exposed" });
    expect(last("b1")).toMatchObject({ status: "denied", trustDetail: "history-unknown" });
    // the fault clears and any persist runs
    failing = false;
    reg.add("later", "manual", "observe", undefined, { channel: "tls" });
    expect(reg.exposurePending()).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(last("b1")).toMatchObject({ status: "ok", outcome: "delivered" });
    expect(last("a1")).toMatchObject({ status: "denied", trustDetail: "bearer-exposed" });
    expect(JSON.parse(fs.readFileSync(path.join(dir, "paired.json"), "utf-8")).find((r: { id: string }) => r.id === a.device.id).exposure.plaintextSeenAt).toBeTruthy();
  });
});
