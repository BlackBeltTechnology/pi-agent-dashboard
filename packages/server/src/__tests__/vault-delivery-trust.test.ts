/**
 * Hub-side delivery: trust gate (paired device + TLS, or hub-local), snapshot per
 * project key, config-held disable switch, corrupt vault, push on change.
 * See change: add-credential-vault (test-plan X1, X2, X9, X10-hub).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { VaultSnapshotMessage, VaultSyncRequestMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UNATTRIBUTED_REMOTE } from "../session/session-origin.js";
import { createBinding } from "../vault/vault-bindings.js";
import { createVaultDeliveryHub, decideVaultTrust, type VaultDeliveryHubDeps } from "../vault/vault-delivery-hub.js";
import { confirmCheckout, createGrant, dirSubject, repoSubject } from "../vault/vault-grants.js";
import { createVaultStore, type VaultStore } from "../vault/vault-store.js";

let dir: string;
let store: VaultStore;
let sent: Array<{ sessionId: string; msg: VaultSnapshotMessage }>;
let enabled: boolean;
let origins: Record<string, { local: boolean; deviceId?: string }>;
let tls: boolean;
let connected: boolean;

const mkHub = (extra: Partial<VaultDeliveryHubDeps> = {}) =>
  createVaultDeliveryHub({
    store,
    getOrigin: (id) => origins[id],
    send: (sessionId, msg) => { sent.push({ sessionId, msg: msg as VaultSnapshotMessage }); return true; },
    isDeliveryEnabled: () => enabled,
    getGraceHours: () => 24,
    // `tls` stands for "r1's bridge is on a proven TLS channel with a proven ticket" (prove-vault-bridge-tls).
    getChannel: (id) =>
      id === "s1"
        ? { admission: "unix", provenTls: false, ticketTls: false }
        : id === "r1"
          ? { admission: "device-ticket", provenTls: tls, ticketTls: tls, ticketDeviceId: "dev-1" }
          : id === "rx"
            ? { admission: "local-ticket", provenTls: tls, ticketTls: tls }
            : undefined,
    getDeviceTrust: () => "eligible",
    isTlsBridgesLive: () => true,
    isSessionConnected: () => connected,
    pushDelayMs: 10,
    ...extra,
  });

const req = (over: Partial<VaultSyncRequestMessage> = {}): VaultSyncRequestMessage => ({
  type: "vault_sync_request", sessionId: "s1", cwd: "/work/p", tracked: [], reason: "connect", ...over,
});

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-hub-"));
  store = createVaultStore(path.join(dir, "vault.json"));
  sent = []; enabled = true; tls = false; connected = true;
  origins = { s1: { local: true }, r1: { local: false, deviceId: "dev-1" }, rx: { local: false, deviceId: UNATTRIBUTED_REMOTE } };
  const a = await store.addAccount({ provider: "gemini", label: "g", value: "gemini-key-001" });
  await createBinding(store, { name: "GEMINI_API_KEY", defaultAccountId: a.id });
  await createGrant(store, { subject: dirSubject("hub", "/work/p"), bindingName: "GEMINI_API_KEY" });
  await createGrant(store, { subject: dirSubject("dev-1", "/work/p"), bindingName: "GEMINI_API_KEY" });
});
afterEach(() => { vi.useRealTimers(); fs.rmSync(dir, { recursive: true, force: true }); });

describe("trust gate", () => {
  it("hub-local sessions are trusted as device `hub`", () => {
    expect(
      decideVaultTrust({
        origin: { local: true },
        channel: { admission: "unix", provenTls: false, ticketTls: false },
        deviceTrust: () => "eligible",
        bridgeCertCheck: undefined,
        tlsBridgesLive: true,
        exposurePending: false,
      }),
    ).toEqual({ allow: true, deviceId: "hub" });
  });
  it("X1: a remote paired device over plain ws gets nothing: transport-insecure", async () => {
    const hub = mkHub();
    expect(await hub.handleSyncRequest("r1", req({ sessionId: "r1" }))).toBe("transport-insecure");
    expect(sent.at(-1)?.msg).toMatchObject({ status: "denied", outcome: "transport-insecure", entries: [] });
  });
  it("a remote paired device over TLS is delivered under its own device id", async () => {
    tls = true;
    const hub = mkHub();
    expect(await hub.handleSyncRequest("r1", req({ sessionId: "r1", certValidation: "enforced" }))).toBe("delivered");
    expect(sent.at(-1)?.msg.entries).toEqual([{ name: "GEMINI_API_KEY", value: "gemini-key-001" }]);
  });
  it("X2: a remote connection without a paired-device ticket gets nothing", async () => {
    tls = true;
    const hub = mkHub();
    expect(await hub.handleSyncRequest("rx", req({ sessionId: "rx" }))).toBe("untrusted");
    expect(sent.at(-1)?.msg).toMatchObject({ status: "denied", outcome: "untrusted", entries: [] });
  });
  it("an unknown session gets nothing", async () => {
    expect(await mkHub().handleSyncRequest("ghost", req({ sessionId: "ghost" }))).toBe("untrusted");
  });
});

describe("snapshot", () => {
  it("delivers the values granted to the session's directory key", async () => {
    expect(await mkHub().handleSyncRequest("s1", req())).toBe("delivered");
    expect(sent.at(-1)?.msg).toMatchObject({ status: "ok", graceHours: 24, entries: [{ name: "GEMINI_API_KEY", value: "gemini-key-001" }] });
  });
  it("nothing for a project without a grant, and nothing without a cwd", async () => {
    const hub = mkHub();
    await hub.handleSyncRequest("s1", req({ cwd: "/work/other" }));
    expect(sent.at(-1)?.msg.entries).toEqual([]);
    expect(await hub.handleSyncRequest("s1", req({ cwd: undefined }))).toBe("no-project");
    expect(sent.at(-1)?.msg).toMatchObject({ status: "denied", outcome: "no-project" });
  });
  it("a repository grant needs the checkout confirmed", async () => {
    await createGrant(store, { subject: repoSubject("github.com/acme/app"), bindingName: "GEMINI_API_KEY" });
    const hub = mkHub();
    const r = req({ cwd: "/src/app", origin: "git@github.com:acme/app.git" });
    await hub.handleSyncRequest("s1", r);
    expect(sent.at(-1)?.msg.entries).toEqual([]);
    expect(hub.getSessionState("s1")?.bindings).toEqual([{ name: "GEMINI_API_KEY", state: "pending-confirmation" }]);
    await confirmCheckout(store, { deviceId: "hub", dir: "/src/app", repoKey: "github.com/acme/app" });
    await vi.waitFor(() => expect(sent.at(-1)?.msg.entries).toHaveLength(1));
  });
  it("clamps the grace it advertises", async () => {
    await mkHub({ getGraceHours: () => 9999 }).handleSyncRequest("s1", req());
    expect(sent.at(-1)?.msg.graceHours).toBe(168);
  });
});

describe("X9: switch and corruption", () => {
  it("a corrupt vault answers `unavailable`, not an empty snapshot", async () => {
    fs.writeFileSync(store.filePath, '{"a":"sk-live-ABCDEFGH');
    const hub = mkHub();
    expect(await hub.handleSyncRequest("s1", req())).toBe("vault-unavailable");
    expect(sent.at(-1)?.msg).toMatchObject({ status: "unavailable", entries: [] });
    expect(JSON.stringify(sent)).not.toContain("sk-live");
  });
  it("the config switch wins even while the vault is corrupt, and pushes to connected sessions", async () => {
    const hub = mkHub();
    await hub.handleSyncRequest("s1", req());
    fs.writeFileSync(store.filePath, "not json");
    enabled = false;
    sent.length = 0;
    await hub.pushNow();
    expect(sent.at(-1)?.msg).toMatchObject({ status: "denied", outcome: "disabled", entries: [] });
  });
});

describe("push on change (hub half of X10)", () => {
  it("a rotation reaches the connected session well inside 5 s", async () => {
    vi.useFakeTimers();
    const hub = mkHub();
    await hub.handleSyncRequest("s1", req());
    sent.length = 0;
    const acc = (await store.listAccounts())[0];
    await store.rotateAccount(acc.id, "rotated-key-0001");
    await vi.advanceTimersByTimeAsync(100);
    expect(sent.at(-1)?.msg.entries).toEqual([{ name: "GEMINI_API_KEY", value: "rotated-key-0001" }]);
    hub.dispose();
  });
  it("forget stops pushes to a closed session", async () => {
    vi.useFakeTimers();
    const hub = mkHub();
    await hub.handleSyncRequest("s1", req());
    hub.forget("s1");
    sent.length = 0;
    await store.rotateAccount((await store.listAccounts())[0].id, "rotated-key-0002");
    await vi.advanceTimersByTimeAsync(100);
    expect(sent).toEqual([]);
    hub.dispose();
  });
});

describe("session state", () => {
  it("merges the bridge report and marks withdrawn names revoked", async () => {
    const hub = mkHub();
    await hub.handleSyncRequest("s1", req());
    hub.handleReport("s1", { type: "vault_report", sessionId: "s1", applied: [{ name: "GEMINI_API_KEY", outcome: "local-override" }] });
    expect(hub.getSessionState("s1")?.bindings).toEqual([{ name: "GEMINI_API_KEY", state: "local-override" }]);
    await store.update((d) => { d.grants = []; });
    await hub.pushNow();
    const st = hub.getSessionState("s1");
    expect(st?.bindings).toEqual([{ name: "GEMINI_API_KEY", state: "revoked" }]);
    expect(typeof st?.lastContactAt).toBe("number");
    expect(JSON.stringify(st)).not.toContain("gemini-key-001");
  });
  it("B2: rows that held a value show hub-unreachable while the bridge is disconnected, with the last contact time", async () => {
    const hub = mkHub();
    await hub.handleSyncRequest("s1", req());
    hub.handleReport("s1", { type: "vault_report", sessionId: "s1", applied: [{ name: "GEMINI_API_KEY", outcome: "delivered" }] });
    connected = false;
    const st = hub.getSessionState("s1");
    expect(st?.bindings).toEqual([{ name: "GEMINI_API_KEY", state: "hub-unreachable" }]);
    expect(typeof st?.lastContactAt).toBe("number");
    connected = true;
    expect(hub.getSessionState("s1")?.bindings).toEqual([{ name: "GEMINI_API_KEY", state: "delivered" }]);
  });
  it("a disconnected session keeps non-holding states (pending-confirmation) as they are", async () => {
    await createGrant(store, { subject: repoSubject("github.com/acme/app"), bindingName: "GEMINI_API_KEY" });
    const hub = mkHub();
    await hub.handleSyncRequest("s1", req({ cwd: "/src/app", origin: "git@github.com:acme/app.git" }));
    connected = false;
    expect(hub.getSessionState("s1")?.bindings).toEqual([{ name: "GEMINI_API_KEY", state: "pending-confirmation" }]);
  });
  it("is undefined for an unknown session", () => {
    expect(mkHub().getSessionState("zz")).toBeUndefined();
  });
});

// ── prove-vault-bridge-tls: the proof table (D5) ─────────────────────────────────────────────────

describe("hub-local admission (test-plan #E1)", () => {
  const admissions = [
    ["unix", true],
    ["local-proof", true],
    ["in-process", true],
    ["legacy-token", false],
    ["grace", false],
    ["local-ticket", false],
  ] as const;
  it.each(admissions)("%s → %s", async (admission, ok) => {
    const hub = mkHub({ getChannel: () => ({ admission, provenTls: false, ticketTls: false }) });
    await hub.handleSyncRequest("s1", req());
    hub.handleRegister("s1");
    const msg = sent.at(-1)?.msg;
    if (ok) {
      expect(msg).toMatchObject({ status: "ok", outcome: "delivered" });
      expect(msg?.entries).toEqual([{ name: "GEMINI_API_KEY", value: "gemini-key-001" }]);
    } else {
      expect(msg).toMatchObject({ status: "denied", outcome: "untrusted", trustDetail: "local-unproven", entries: [] });
      expect(hub.getSessionState("s1")).toMatchObject({ outcome: "untrusted", trustDetail: "local-unproven" });
    }
  });
});

describe("remote proof decision table (test-plan #E2)", () => {
  type Row = {
    name: string;
    channel?: Partial<{ admission: "device-ticket" | "local-ticket"; provenTls: boolean; ticketTls: boolean; ticketDeviceId: string }> | null;
    trust?: "eligible" | "inactive" | "exposed" | "history-unknown";
    cert?: "enforced";
    live?: boolean;
    origin?: { local: boolean; deviceId?: string };
    expect: { status: string; outcome: string; detail?: string };
  };
  const okChannel = { admission: "device-ticket" as const, provenTls: true, ticketTls: true, ticketDeviceId: "dev-a" };
  const rows: Row[] = [
    { name: "a: everything proven", cert: "enforced", expect: { status: "ok", outcome: "delivered" } },
    { name: "b: Accept bridges off", cert: "enforced", live: false, expect: { status: "denied", outcome: "transport-insecure", detail: "plain-transport" } },
    { name: "c: device ticket on loopback (ssh -L), not provenTls", cert: "enforced", channel: { provenTls: false, ticketTls: false }, origin: { local: true }, expect: { status: "denied", outcome: "transport-insecure", detail: "plain-transport" } },
    { name: "d: ticket not minted on proven TLS", cert: "enforced", channel: { ticketTls: false }, expect: { status: "denied", outcome: "transport-insecure", detail: "ticket-plain" } },
    { name: "e: bearer exposed", cert: "enforced", trust: "exposed", expect: { status: "denied", outcome: "transport-insecure", detail: "bearer-exposed" } },
    { name: "f: history unknown", cert: "enforced", trust: "history-unknown", expect: { status: "denied", outcome: "transport-insecure", detail: "history-unknown" } },
    { name: "g: device inactive", cert: "enforced", trust: "inactive", expect: { status: "denied", outcome: "untrusted", detail: "device-inactive" } },
    { name: "h: no certValidation declared", expect: { status: "denied", outcome: "transport-insecure", detail: "bridge-outdated" } },
    { name: "i: ticket device ≠ origin device", cert: "enforced", origin: { local: false, deviceId: "dev-b" }, expect: { status: "denied", outcome: "untrusted", detail: "unattributed" } },
    { name: "j: no channel", cert: "enforced", channel: null, expect: { status: "denied", outcome: "untrusted", detail: "unattributed" } },
  ];
  it.each(rows)("$name", async (row) => {
    origins.r1 = row.origin ?? { local: false, deviceId: "dev-a" };
    await createGrant(store, { subject: dirSubject("dev-a", "/work/p"), bindingName: "GEMINI_API_KEY" });
    const hub = mkHub({
      getChannel: () => (row.channel === null ? undefined : { ...okChannel, ...row.channel }),
      getDeviceTrust: () => row.trust ?? "eligible",
      isTlsBridgesLive: () => row.live ?? true,
    });
    await hub.handleSyncRequest("r1", req({ sessionId: "r1", ...(row.cert ? { certValidation: row.cert } : {}) }));
    const msg = sent.at(-1)?.msg;
    expect(msg).toMatchObject({ status: row.expect.status, outcome: row.expect.outcome });
    if (row.expect.detail) expect(msg?.trustDetail).toBe(row.expect.detail);
    if (row.expect.status === "ok") expect(msg?.entries).toEqual([{ name: "GEMINI_API_KEY", value: "gemini-key-001" }]);
    else expect(msg?.entries).toEqual([]);
  });

  it("a pending exposure write refuses every remote session (history-unknown), not a hub session", async () => {
    await createGrant(store, { subject: dirSubject("dev-a", "/work/p"), bindingName: "GEMINI_API_KEY" });
    origins.r1 = { local: false, deviceId: "dev-a" };
    const hub = mkHub({ getChannel: (id) => (id === "s1" ? { admission: "unix", provenTls: false, ticketTls: false } : okChannel), exposurePending: () => true });
    await hub.handleSyncRequest("r1", req({ sessionId: "r1", certValidation: "enforced" }));
    expect(sent.at(-1)?.msg).toMatchObject({ status: "denied", trustDetail: "history-unknown" });
    await hub.handleSyncRequest("s1", req());
    expect(sent.at(-1)?.msg).toMatchObject({ status: "ok", outcome: "delivered" });
  });
});

describe("[vault] trust log (test-plan #F10)", () => {
  it("logs one line per outcome/detail change, naming session and device prefix, never a bearer or value", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(" ")));
    origins.r1 = { local: false, deviceId: "dev-1-aaaaaaaaaaaa" };
    let exposed = false;
    const hub = mkHub({
      getChannel: () => ({ admission: "device-ticket", provenTls: true, ticketTls: true, ticketDeviceId: "dev-1-aaaaaaaaaaaa" }),
      getDeviceTrust: () => (exposed ? "exposed" : "eligible"),
      // Switch off until the bearer is exposed: detail 1 is plain-transport, detail 2 bearer-exposed.
      isTlsBridgesLive: () => exposed,
    });
    try {
      for (let i = 0; i < 3; i++) await hub.handleSyncRequest("r1", req({ sessionId: "r1", certValidation: "enforced" }));
      exposed = true;
      for (let i = 0; i < 2; i++) await hub.handleSyncRequest("r1", req({ sessionId: "r1", certValidation: "enforced" }));
    } finally {
      spy.mockRestore();
    }
    const trustLines = lines.filter((l) => l.startsWith("[vault] trust"));
    expect(trustLines).toHaveLength(2);
    expect(trustLines[0]).toContain("session=r1");
    expect(trustLines[0]).toContain("device=dev-1-aa");
    expect(trustLines[0]).toContain("outcome=transport-insecure detail=plain-transport");
    expect(trustLines[1]).toContain("detail=bearer-exposed");
    for (const l of trustLines) expect(l).not.toContain("gemini-key-001");
  });
});
