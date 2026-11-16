/**
 * Device key and companion key at pairing: knock + QR redeem intake, hold on the pending device,
 * bind at approval, discard otherwise (test-plan E2, E6, E7, E9, E17, X16).
 * Driven through the REAL pairing routes, the real identity (so signatures verify) and the real registry.
 * See change: device-key-mutual-check (D3, D5, D10).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { COMPANION_ORIGIN_MAX_BYTES } from "@blackbelt-technology/pi-dashboard-shared/device-key-proof.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceNonceStore } from "../auth/device-proof.js";
import { ensureServerIdentity, type ServerIdentity } from "../auth/identity.js";
import { createNetworkGuard } from "../auth/localhost-guard.js";
import { PairedDeviceRegistry, keyIdOf } from "../pairing/paired-devices.js";
import { PairingManager } from "../pairing/pairing.js";
import { registerPairingRoutes } from "../routes/pairing-routes.js";
import { stampLegacyHook } from "../test-support/local-credential-stamp.js";
import { bindProof, companionClaim, newDeviceKey, type TestDeviceKey } from "./helpers/device-key.js";

const SERVER = "192.168.16.204:8000";
const IFACES = [{ address: "192.168.16.204", netmask: "255.255.255.0" }];
const ORIGIN = "http://192.168.16.31:8000";

let tmp: string;
let identity: ServerIdentity;
let reg: PairedDeviceRegistry;
let mgr: PairingManager;
let app: FastifyInstance;
let nonces: DeviceNonceStore;
let clock: number;
let logs: string[];
let peerSeq: number;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-devkeys-"));
  identity = ensureServerIdentity(path.join(tmp, "identity.json"));
  reg = new PairedDeviceRegistry(path.join(tmp, "paired.json"));
  clock = Math.floor(Date.now() / 1000) * 1000; // whole seconds: the companion window is compared in seconds
  mgr = new PairingManager({
    registry: reg,
    getFingerprint: () => identity.fingerprint,
    getReachableUrls: () => ["https://pi.example.com"],
    now: () => clock,
  });
  nonces = new DeviceNonceStore();
  peerSeq = 30;
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void logs.push(a.join(" ")));
  app = Fastify();
  stampLegacyHook(app, "tok");
  app.addHook("onRequest", async (req) => {
    if (req.headers["x-test-session"] === "1") (req as unknown as { authVia: string }).authVia = "session";
  });
  registerPairingRoutes(app, {
    networkGuard: createNetworkGuard([]),
    identity,
    pairing: mgr,
    registry: reg,
    localToken: "tok",
    hostAdmission: () => ({ allowedHosts: [], publicBaseUrls: [], configuredOrigins: [], bindHost: "192.168.16.204" }),
    getAcceptLanRequests: () => true,
    getLanInterfaces: () => IFACES,
    deviceNonces: nonces,
    now: () => clock,
  });
  await app.ready();
});

afterEach(async () => {
  mgr.dispose();
  await app.close();
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const freshNonce = () => nonces.issue();
const proofFor = (k: TestDeviceKey, nonce = freshNonce()) => bindProof(k, identity.fingerprint, nonce);
const nextPeer = () => `192.168.16.${++peerSeq}`;

const knock = (body: Record<string, unknown>, peer = nextPeer()) =>
  app.inject({
    method: "POST",
    url: "/api/pair/request",
    remoteAddress: peer,
    headers: { host: SERVER, "content-type": "application/json" },
    payload: body as never,
  });

const approve = (pendingId: string, confirmCode: string, extra: Record<string, unknown> = {}) =>
  app.inject({
    method: "POST",
    url: "/api/pair/approve-pending",
    remoteAddress: "127.0.0.1",
    headers: { host: "localhost:8000", "content-type": "application/json", "x-test-session": "1" },
    payload: { pendingId, confirmCode, ...extra },
  });

const pending = () => mgr.listPending();
const only = () => {
  const list = pending();
  expect(list).toHaveLength(1);
  return list[0];
};
/** Knock and return the reply data plus the status. */
async function doKnock(body: Record<string, unknown>) {
  const res = await knock(body);
  expect(res.statusCode).toBe(200);
  return res.json().data as { pendingId: string; confirmCode: string; expiresAt: number; fingerprint: string };
}

const keyLines = () => logs.filter((l) => /^\[pairing\] (key_|companion_)/.test(l));

describe("E2 device key bounds and validation at knock", () => {
  it("a valid key is held: the operator view shows only the short key id", async () => {
    const k = newDeviceKey();
    await doKnock({ name: "mbp", deviceKey: proofFor(k) });
    const view = only();
    expect(view.keyId).toBe(keyIdOf(k.pub));
    expect(view.keyId).toMatch(/^dk:[A-Za-z0-9_-]{12}$/);
    expect(JSON.stringify(view)).not.toContain(k.pub);
    expect(reg.isKeyHeld(k.pub)).toBe(false); // nothing is bound before approval
  });

  const bad: Array<[string, (k: TestDeviceKey, n: string) => unknown]> = [
    ["pub of 31 bytes", (k, n) => ({ ...proofFor(k, n), pub: Buffer.alloc(31, 7).toString("base64url") })],
    ["pub of 33 bytes", (k, n) => ({ ...proofFor(k, n), pub: Buffer.alloc(33, 7).toString("base64url") })],
    ["pub with padding", (k, n) => ({ ...proofFor(k, n), pub: `${k.pub}=` })],
    ["pub with + and /", (k, n) => ({ ...proofFor(k, n), pub: k.pub.replace(/[-_]/g, "+").slice(0, 42) + "/" })],
    ["sig of 63 bytes", (k, n) => ({ ...proofFor(k, n), sig: Buffer.alloc(63, 1).toString("base64url") })],
    ["sig of 65 bytes", (k, n) => ({ ...proofFor(k, n), sig: Buffer.alloc(65, 1).toString("base64url") })],
    ["nonce of 42 chars", (k) => ({ ...proofFor(k), deviceNonce: "A".repeat(42) })],
    ["nonce of 44 chars", (k) => ({ ...proofFor(k), deviceNonce: "A".repeat(44) })],
    ["a bad signature", (k, n) => ({ ...proofFor(k, n), sig: newDeviceKey().sign("other") })],
    ["a signature by another key", (k, n) => ({ ...proofFor(newDeviceKey(), n), pub: k.pub })],
    ["a nonce this server never issued", (k) => proofFor(k, "B".repeat(43))],
    ["a non-object", () => "not-an-object"],
    ["an array", () => []],
  ];

  it.each(bad)("%s is dropped: same reply fields as a keyless knock, approved device has no key", async (_name, make) => {
    const baseline = await doKnock({ name: "plain" });
    mgr.deny(baseline.pendingId);
    const k = newDeviceKey();
    const res = await knock({ name: "keyed", deviceKey: make(k, freshNonce()) });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(Object.keys(data).sort()).toEqual(Object.keys(baseline).sort());
    const view = pending().find((p) => p.pendingId === data.pendingId)!;
    expect(view.keyId).toBeUndefined();
    const ok = await approve(data.pendingId, data.confirmCode);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.keyId).toBeUndefined();
    expect(reg.list().find((d) => d.id === ok.json().data.id)?.keyId).toBeUndefined();
  });

  it("a replayed deviceKey proof is dropped: the second knock is admitted without a key", async () => {
    const k = newDeviceKey();
    const proof = proofFor(k);
    const first = await doKnock({ name: "a", deviceKey: proof });
    const second = await doKnock({ name: "b", deviceKey: proof });
    const views = pending();
    expect(views.find((v) => v.pendingId === first.pendingId)?.keyId).toBe(keyIdOf(k.pub));
    expect(views.find((v) => v.pendingId === second.pendingId)?.keyId).toBeUndefined();
  });

  it("a proof signed for another server never verifies here", async () => {
    const k = newDeviceKey();
    await doKnock({ deviceKey: bindProof(k, "sha256:another-server", freshNonce()) });
    expect(only().keyId).toBeUndefined();
  });

  it("the nonce is consumed on arrival even when the proof is invalid", async () => {
    const k = newDeviceKey();
    const nonce = freshNonce();
    await doKnock({ deviceKey: { ...proofFor(k, nonce), sig: newDeviceKey().sign("x") } });
    const second = await doKnock({ deviceKey: proofFor(k, nonce) });
    expect(pending().find((p) => p.pendingId === second.pendingId)?.keyId).toBeUndefined();
  });
});

describe("approval binds, everything else discards (E9 flow, X16)", () => {
  it("approve binds the submitted key and a later proof answers paired", async () => {
    const k = newDeviceKey();
    const kn = await doKnock({ deviceKey: proofFor(k) });
    const res = await approve(kn.pendingId, kn.confirmCode);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.keyId).toBe(keyIdOf(k.pub));
    expect(reg.deviceKeyStatus(k.pub)).toMatchObject({ status: "paired", scope: "full" });
  });

  it("deny leaves no row, and the key is accepted again by a later knock", async () => {
    const k = newDeviceKey();
    const kn = await doKnock({ deviceKey: proofFor(k) });
    expect(mgr.deny(kn.pendingId).ok).toBe(true);
    expect(reg.list()).toHaveLength(0);
    expect(reg.deviceKeyStatus(k.pub)).toEqual({ status: "unknown" });
    const again = await doKnock({ deviceKey: proofFor(k) });
    const ok = await approve(again.pendingId, again.confirmCode);
    expect(ok.json().data.keyId).toBe(keyIdOf(k.pub));
  });

  it("expiry at +300 s discards it", async () => {
    const k = newDeviceKey();
    const kn = await doKnock({ deviceKey: proofFor(k) });
    clock += 301_000;
    expect(pending()).toHaveLength(0);
    const res = await approve(kn.pendingId, kn.confirmCode);
    expect(res.statusCode).not.toBe(200);
    expect(reg.list()).toHaveLength(0);
    expect(reg.deviceKeyStatus(k.pub)).toEqual({ status: "unknown" });
  });

  it("five wrong approval codes lock the request out and discard the key", async () => {
    const k = newDeviceKey();
    const kn = await doKnock({ deviceKey: proofFor(k) });
    const wrong = kn.confirmCode === "00000000" ? "11111111" : "00000000";
    for (let i = 0; i < 5; i += 1) await approve(kn.pendingId, wrong);
    expect(reg.list()).toHaveLength(0);
    expect(reg.deviceKeyStatus(k.pub)).toEqual({ status: "unknown" });
    // approving with the right code now fails: the pending device is dead
    expect((await approve(kn.pendingId, kn.confirmCode)).statusCode).not.toBe(200);
    expect(reg.list()).toHaveLength(0);
  });

  it("QR redeem carries a key and binds it only after approval", async () => {
    const k2 = newDeviceKey();
    const payload = mgr.createPayload()!;
    const res = await app.inject({
      method: "POST",
      url: "/api/pair/redeem",
      remoteAddress: "203.0.113.9",
      headers: { "content-type": "application/json" },
      payload: { code: payload.code, deviceKey: proofFor(k2) },
    });
    expect(res.statusCode).toBe(200);
    const { pendingId, confirmCode } = res.json().data;
    expect(only().keyId).toBe(keyIdOf(k2.pub));
    expect(reg.deviceKeyStatus(k2.pub)).toEqual({ status: "unknown" });
    const ok = await approve(pendingId, confirmCode);
    expect(ok.json().data.keyId).toBe(keyIdOf(k2.pub));
    expect(reg.deviceKeyStatus(k2.pub)).toMatchObject({ status: "paired" });
  });

  it("QR redeem with an invalid key behaves like a keyless redeem", async () => {
    const k = newDeviceKey();
    const payload = mgr.createPayload()!;
    const res = await app.inject({
      method: "POST",
      url: "/api/pair/redeem",
      remoteAddress: "203.0.113.9",
      headers: { "content-type": "application/json" },
      payload: { code: payload.code, deviceKey: { ...proofFor(k), sig: newDeviceKey().sign("x") } },
    });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.json().data).sort()).toEqual(["confirmCode", "pendingId"]);
    expect(only().keyId).toBeUndefined();
  });
});

describe("E9 a public key belongs to one device record", () => {
  async function approveKeyed(k: TestDeviceKey) {
    const kn = await doKnock({ name: "dev", deviceKey: proofFor(k) });
    return { kn, res: await approve(kn.pendingId, kn.confirmCode) };
  }

  it("K held as an active primary: the second pairing is approved keyless, no error", async () => {
    const k = newDeviceKey();
    reg.add("first", "pairing", "operate", undefined, { key: k.pub });
    const kn = await doKnock({ deviceKey: proofFor(k) });
    expect(pending()).toHaveLength(1);
    expect(only().keyId).toBeUndefined(); // dropped at arrival: it is held
    const res = await approve(kn.pendingId, kn.confirmCode);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.keyId).toBeUndefined();
  });

  it("K held as an active companion or a revoked key is also refused", async () => {
    const owner = newDeviceKey();
    const comp = newDeviceKey();
    const revoked = newDeviceKey();
    const { device } = reg.add("owner", "pairing", "operate", undefined, { key: owner.pub });
    reg.addCompanion(device.id, { pub: comp.pub, origin: ORIGIN });
    const gone = reg.add("gone", "pairing", "operate", undefined, { key: revoked.pub });
    reg.revoke(gone.device.id, "local");
    for (const k of [comp, revoked]) {
      const kn = await doKnock({ deviceKey: proofFor(k) });
      expect(pending().find((p) => p.pendingId === kn.pendingId)?.keyId).toBeUndefined();
      mgr.deny(kn.pendingId);
    }
  });

  it("two pending knocks carrying the same K (different nonces): the first approved binds, the second is keyless", async () => {
    const k = newDeviceKey();
    const a = await doKnock({ deviceKey: proofFor(k) });
    const b = await doKnock({ deviceKey: proofFor(k) });
    expect(pending().every((p) => p.keyId === keyIdOf(k.pub))).toBe(true);
    const ra = await approve(a.pendingId, a.confirmCode);
    const rb = await approve(b.pendingId, b.confirmCode);
    expect(ra.statusCode).toBe(200);
    expect(rb.statusCode).toBe(200);
    expect(ra.json().data.keyId).toBe(keyIdOf(k.pub));
    expect(rb.json().data.keyId).toBeUndefined();
    expect(reg.list().filter((d) => d.keyId === keyIdOf(k.pub))).toHaveLength(1);
  });

  it("K as deviceKey AND companion in one knock: the device keeps the key only", async () => {
    const k = newDeviceKey();
    const kn = await doKnock({ deviceKey: proofFor(k), companion: companionClaim(k, identity.fingerprint, ORIGIN, Math.floor(clock / 1000)) });
    const view = only();
    expect(view.keyId).toBe(keyIdOf(k.pub));
    expect(view.companionId).toBeUndefined();
    const res = await approve(kn.pendingId, kn.confirmCode, { allowCompanion: true });
    expect(res.json().data.keyId).toBe(keyIdOf(k.pub));
    expect(res.json().data.companions ?? []).toHaveLength(0);
  });

  it("a successful approve of a lone approved pairing stays a plain 200 with no extra body fields", async () => {
    const { res } = await approveKeyed(newDeviceKey());
    expect(Object.keys(res.json()).sort()).toEqual(["data", "success"]);
  });
});

describe("E6 companion window and shape", () => {
  const ts = () => Math.floor(clock / 1000);
  const companion = (k: TestDeviceKey, t: number, origin = ORIGIN) => companionClaim(k, identity.fingerprint, origin, t);

  it("accepts ts at now ±300 s inclusive and ignores ±301 s; every case admits the knock the same", async () => {
    const cases: Array<[number, boolean]> = [
      [-301, false],
      [-300, true],
      [300, true],
      [301, false],
    ];
    for (const [delta, accepted] of cases) {
      const k = newDeviceKey();
      const kn = await doKnock({ companion: companion(k, ts() + delta) });
      const view = pending().find((p) => p.pendingId === kn.pendingId)!;
      expect(view.companionId !== undefined, `delta ${delta}`).toBe(accepted);
      mgr.deny(kn.pendingId);
    }
  });

  it("non-integer ts is ignored", async () => {
    const k = newDeviceKey();
    for (const bad of ["12.5", "abc", 12.5, null]) {
      const c = { ...companion(k, ts()), ts: bad };
      const kn = await doKnock({ companion: c });
      expect(pending().find((p) => p.pendingId === kn.pendingId)?.companionId).toBeUndefined();
      mgr.deny(kn.pendingId);
    }
  });

  it("a companion signed for another server, or with a tampered origin, is ignored", async () => {
    const k = newDeviceKey();
    const wrongServer = companionClaim(k, "sha256:other", ORIGIN, ts());
    const kn1 = await doKnock({ companion: wrongServer });
    expect(pending().find((p) => p.pendingId === kn1.pendingId)?.companionId).toBeUndefined();
    mgr.deny(kn1.pendingId);
    const tampered = { ...companion(k, ts()), origin: "http://192.168.16.99:8000" };
    const kn2 = await doKnock({ companion: tampered });
    expect(pending().find((p) => p.pendingId === kn2.pendingId)?.companionId).toBeUndefined();
  });
});

describe("E7 companion origin", () => {
  const ts = () => Math.floor(clock / 1000);
  const view = async (origin: string, k = newDeviceKey()) => {
    const kn = await doKnock({ companion: companionClaim(k, identity.fingerprint, origin, ts()) });
    const v = pending().find((p) => p.pendingId === kn.pendingId)!;
    mgr.deny(kn.pendingId);
    return v;
  };

  it.each([
    "http://192.168.16.31:8000",
    "https://h.example",
  ])("%s is accepted", async (o) => {
    expect((await view(o)).companionOrigin).toBe(o);
  });

  it.each([
    "http://user:pw@host",
    "http://host/path",
    "http://host?x=1",
    "http://host#f",
    "javascript:alert(1)",
    "ftp://h",
    "http://host:99999",
  ])("%s is ignored and the knock is still admitted", async (o) => {
    const v = await view(o);
    expect(v.companionOrigin).toBeUndefined();
    expect(v.companionId).toBeUndefined();
  });

  it("255 bytes accepted, 256 rejected, counting bytes not characters", async () => {
    const host255 = `http://${"a".repeat(COMPANION_ORIGIN_MAX_BYTES - "http://".length)}`;
    expect(Buffer.byteLength(host255)).toBe(255);
    expect((await view(host255)).companionId).toBeDefined();
    expect((await view(`${host255}a`)).companionId).toBeUndefined();
    // 2-byte characters: 128 characters = 256 bytes after the scheme prefix would overflow
    const wide = `http://${"é".repeat(125)}`; // 7 + 250 = 257 bytes < 256 chars? 132 chars
    expect(Buffer.byteLength(wide)).toBeGreaterThan(255);
    expect(wide.length).toBeLessThan(255);
    expect((await view(wide)).companionId).toBeUndefined();
  });

  it("control and format characters are signed as sent but stripped for display and storage", async () => {
    const k = newDeviceKey();
    const origin = "http://host\u200B.example\u202E";
    const v = await view(origin, k); // the signature covers the origin as sent, so it verifies
    expect(v.companionId).toBe(keyIdOf(k.pub));
    expect(v.companionOrigin).toBe("http://host.example");
    expect(/[\u200B\u202E]/.test(v.companionOrigin ?? "")).toBe(false);
  });
});

describe("companion is stored only when the operator ticks the box", () => {
  const ts = () => Math.floor(clock / 1000);

  it("default (absent / false): not stored; the view still names the claimed origin", async () => {
    const c = newDeviceKey();
    const kn = await doKnock({ companion: companionClaim(c, identity.fingerprint, ORIGIN, ts()) });
    expect(only()).toMatchObject({ companionOrigin: ORIGIN, companionId: keyIdOf(c.pub) });
    expect(JSON.stringify(only())).not.toContain(c.pub);
    const res = await approve(kn.pendingId, kn.confirmCode);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.companions ?? []).toHaveLength(0);
    expect(reg.deviceKeyStatus(c.pub)).toEqual({ status: "unknown" });
  });

  it("allowCompanion:true stores it as a status-only companion", async () => {
    const c = newDeviceKey();
    const kn = await doKnock({ companion: companionClaim(c, identity.fingerprint, ORIGIN, ts()) });
    const res = await approve(kn.pendingId, kn.confirmCode, { allowCompanion: true });
    expect(res.json().data.companions).toEqual([expect.objectContaining({ id: keyIdOf(c.pub), origin: ORIGIN })]);
    expect(JSON.stringify(res.json())).not.toContain(c.pub);
    expect(reg.deviceKeyStatus(c.pub)).toEqual({ status: "paired", scope: "status-only" });
  });

  it("allowCompanion:false stores nothing", async () => {
    const c = newDeviceKey();
    const kn = await doKnock({ companion: companionClaim(c, identity.fingerprint, ORIGIN, ts()) });
    await approve(kn.pendingId, kn.confirmCode, { allowCompanion: false });
    expect(reg.deviceKeyStatus(c.pub)).toEqual({ status: "unknown" });
  });

  it("a non-boolean allowCompanion is 400 and spends no approval attempt", async () => {
    const kn = await doKnock({});
    const res = await approve(kn.pendingId, kn.confirmCode, { allowCompanion: "yes" });
    expect(res.statusCode).toBe(400);
    expect(only().attemptsLeft).toBe(5);
    expect((await approve(kn.pendingId, kn.confirmCode)).statusCode).toBe(200);
  });

  it("a companion whose key is held elsewhere is dropped at arrival", async () => {
    const c = newDeviceKey();
    reg.add("owner", "pairing", "operate", undefined, { key: c.pub });
    await doKnock({ companion: companionClaim(c, identity.fingerprint, ORIGIN, ts()) });
    expect(only().companionId).toBeUndefined();
  });
});

describe("E17 key events are one audit line each, without key material", () => {
  const ts = () => Math.floor(clock / 1000);

  it("approval logs key_bound and companion_allowed with actor and ip; never a key, signature or nonce", async () => {
    const k = newDeviceKey();
    const c = newDeviceKey();
    const nonce = freshNonce();
    const keyProof = proofFor(k, nonce);
    const claim = companionClaim(c, identity.fingerprint, ORIGIN, ts());
    const kn = await doKnock({ deviceKey: keyProof, companion: claim });
    const res = await approve(kn.pendingId, kn.confirmCode, { allowCompanion: true });
    const deviceId = res.json().data.id as string;
    const lines = keyLines();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(`[pairing] key_bound id=${deviceId.slice(0, 8)} key=${keyIdOf(k.pub)} actor=session:unknown ip=127.0.0.1`);
    expect(lines[1]).toBe(`[pairing] companion_allowed id=${deviceId.slice(0, 8)} key=${keyIdOf(c.pub)} actor=session:unknown ip=127.0.0.1`);
    const all = logs.join("\n");
    for (const secret of [k.pub, c.pub, keyProof.sig, claim.sig, nonce, kn.confirmCode]) expect(all).not.toContain(secret);
  });

  it("a key held at arrival logs one key_ignored line (throttled per key id) and the reply is unchanged", async () => {
    const k = newDeviceKey();
    reg.add("owner", "pairing", "operate", undefined, { key: k.pub });
    await doKnock({ deviceKey: proofFor(k) });
    const second = await knock({ deviceKey: proofFor(k) });
    expect(second.statusCode).toBe(200);
    const ignored = keyLines().filter((l) => l.startsWith("[pairing] key_ignored"));
    expect(ignored).toEqual([`[pairing] key_ignored key=${keyIdOf(k.pub)}`]);
  });

  it("a key lost to a concurrent approval logs key_ignored at approval; a ticked companion that is refused too", async () => {
    const k = newDeviceKey();
    const a = await doKnock({ deviceKey: proofFor(k) });
    const b = await doKnock({ deviceKey: proofFor(k) });
    await approve(a.pendingId, a.confirmCode);
    logs.length = 0;
    const rb = await approve(b.pendingId, b.confirmCode);
    const id = rb.json().data.id as string;
    expect(keyLines()).toEqual([`[pairing] key_ignored id=${id.slice(0, 8)} key=${keyIdOf(k.pub)} actor=session:unknown ip=127.0.0.1`]);
  });

  it("removing a companion logs companion_removed", async () => {
    const c = newDeviceKey();
    const { device } = reg.add("owner", "pairing", "operate");
    reg.addCompanion(device.id, { pub: c.pub, origin: ORIGIN });
    logs.length = 0;
    const res = await app.inject({
      method: "DELETE",
      url: `/api/paired-devices/${device.id}/companions/${encodeURIComponent(keyIdOf(c.pub))}`,
      remoteAddress: "127.0.0.1",
      headers: { host: "localhost:8000", "x-test-session": "1" },
    });
    expect(res.statusCode).toBe(200);
    expect(keyLines()).toEqual([`[pairing] companion_removed id=${device.id.slice(0, 8)} key=${keyIdOf(c.pub)} actor=session:unknown ip=127.0.0.1`]);
    expect(reg.deviceKeyStatus(c.pub)).toEqual({ status: "unknown" });
  });
});
