/**
 * `POST /api/pair/device-key` (test-plan E10) and the operator routes for held devices (E14):
 * `GET /api/paired-devices/revoked`, `POST /api/paired-devices/:id/restore`,
 * `DELETE /api/paired-devices/revoked/:id`, `DELETE /api/paired-devices/:id/companions/:companionId`.
 * Exemplar: device-cookie.test.ts. See change: device-key-mutual-check (D3, D6, D8).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEVICE_COOKIE, registerBearerAuth } from "../auth/bearer-auth.js";
import { DeviceNonceStore } from "../auth/device-proof.js";
import { ensureServerIdentity, type ServerIdentity } from "../auth/identity.js";
import { createNetworkGuard } from "../auth/localhost-guard.js";
import { PairedDeviceRegistry, keyIdOf } from "../pairing/paired-devices.js";
import { PairingManager } from "../pairing/pairing.js";
import { registerPairingRoutes } from "../routes/pairing-routes.js";
import { stampLegacyHook } from "../test-support/local-credential-stamp.js";
import { bindProof, newDeviceKey, statusProof, type TestDeviceKey } from "./helpers/device-key.js";

const REMOTE = "203.0.113.9";
const SESSION = { "x-test-session": "1" };

let tmp: string;
let identity: ServerIdentity;
let reg: PairedDeviceRegistry;
let mgr: PairingManager;
let app: FastifyInstance;
let nonces: DeviceNonceStore;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-devkey-routes-"));
  identity = ensureServerIdentity(path.join(tmp, "identity.json"));
  reg = new PairedDeviceRegistry(path.join(tmp, "paired.json"));
  mgr = new PairingManager({ registry: reg, getFingerprint: () => identity.fingerprint, getReachableUrls: () => [] });
  nonces = new DeviceNonceStore();
  app = Fastify();
  await app.register(fastifyCookie);
  stampLegacyHook(app, "tok");
  app.addHook("onRequest", async (req) => {
    if (req.headers["x-test-session"] === "1") (req as unknown as { authVia: string }).authVia = "session";
  });
  app.decorateRequest("isAuthenticated", false);
  registerBearerAuth(app, { registry: reg });
  registerPairingRoutes(app, {
    networkGuard: createNetworkGuard([]),
    identity,
    pairing: mgr,
    registry: reg,
    localToken: "tok",
    hostAdmission: () => ({ allowedHosts: [], publicBaseUrls: [], configuredOrigins: [], bindHost: "localhost" }),
    deviceNonces: nonces,
  });
  await app.ready();
});

afterEach(async () => {
  mgr.dispose();
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const cookie = (t: string) => ({ cookie: `${DEVICE_COOKIE}=${t}` });
const nonce = () => nonces.issue();

const bind = (headers: Record<string, string>, payload: unknown, remoteAddress = REMOTE) =>
  app.inject({ method: "POST", url: "/api/pair/device-key", remoteAddress, headers, payload: payload as never });

describe("E10 an already-paired device binds its key with its credential", () => {
  for (const tier of ["observe", "control", "operate"] as const) {
    for (const via of ["bearer", "cookie"] as const) {
      it(`${tier} device by ${via}: 200 and a later proof answers paired`, async () => {
        const k = newDeviceKey();
        const { token } = reg.add("d", "pairing", tier);
        const res = await bind(via === "bearer" ? bearer(token) : cookie(token), bindProof(k, identity.fingerprint, nonce()));
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true });
        expect(reg.deviceKeyStatus(k.pub)).toMatchObject({ status: "paired", tier });
      });
    }
  }

  it("anonymous → 401 and nothing bound", async () => {
    const k = newDeviceKey();
    const res = await bind({}, bindProof(k, identity.fingerprint, nonce()), "127.0.0.1");
    expect(res.statusCode).toBe(401);
    expect(reg.isKeyHeld(k.pub)).toBe(false);
  });

  it("a revoked device's bearer is refused like any revoked credential", async () => {
    const k = newDeviceKey();
    const { token, device } = reg.add("d", "pairing", "operate");
    reg.revoke(device.id, "local");
    const res = await bind(bearer(token), bindProof(k, identity.fingerprint, nonce()), "127.0.0.1");
    expect(res.statusCode).toBe(401);
    expect(reg.isKeyHeld(k.pub)).toBe(false);
  });

  it("a key held by another record (active primary / companion, revoked primary) → 409 and both rows unchanged", async () => {
    const primary = newDeviceKey();
    const companion = newDeviceKey();
    const revoked = newDeviceKey();
    const owner = reg.add("owner", "pairing", "operate", undefined, { key: primary.pub });
    reg.addCompanion(owner.device.id, { pub: companion.pub, origin: "http://192.168.16.31:8000" });
    const gone = reg.add("gone", "pairing", "operate", undefined, { key: revoked.pub });
    reg.revoke(gone.device.id, "local");
    const caller = reg.add("caller", "pairing", "operate");
    for (const k of [primary, companion, revoked]) {
      const res = await bind(bearer(caller.token), bindProof(k, identity.fingerprint, nonce()));
      expect(res.statusCode).toBe(409);
    }
    expect(reg.list().find((d) => d.id === caller.device.id)?.keyId).toBeUndefined();
    expect(reg.list().find((d) => d.id === owner.device.id)?.keyId).toBe(keyIdOf(primary.pub));
  });

  it("replacement: the new key replaces the old one, which now answers unknown", async () => {
    const k1 = newDeviceKey();
    const k2 = newDeviceKey();
    const { token } = reg.add("d", "pairing", "operate", undefined, { key: k1.pub });
    expect((await bind(bearer(token), bindProof(k2, identity.fingerprint, nonce()))).statusCode).toBe(200);
    expect(reg.deviceKeyStatus(k1.pub)).toEqual({ status: "unknown" });
    expect(reg.deviceKeyStatus(k2.pub)).toMatchObject({ status: "paired" });
  });

  it("a credential for device A never binds a key to device B", async () => {
    const k = newDeviceKey();
    const a = reg.add("a", "pairing", "operate");
    const b = reg.add("b", "pairing", "operate");
    await bind(bearer(a.token), bindProof(k, identity.fingerprint, nonce()));
    expect(reg.list().find((d) => d.id === a.device.id)?.keyId).toBe(keyIdOf(k.pub));
    expect(reg.list().find((d) => d.id === b.device.id)?.keyId).toBeUndefined();
  });

  const invalid: Array<[string, (k: TestDeviceKey) => unknown]> = [
    ["bad signature", (k) => ({ ...bindProof(k, identity.fingerprint, nonce()), sig: newDeviceKey().sign("x") })],
    ["malformed pub", (k) => ({ ...bindProof(k, identity.fingerprint, nonce()), pub: "short" })],
    ["malformed sig", (k) => ({ ...bindProof(k, identity.fingerprint, nonce()), sig: "short" })],
    ["malformed nonce", (k) => ({ ...bindProof(k, identity.fingerprint, nonce()), deviceNonce: "short" })],
    ["unknown nonce", (k) => bindProof(k, identity.fingerprint, "C".repeat(43))],
    ["another server's proof", (k) => bindProof(k, "sha256:other", nonce())],
    ["a status-check proof (wrong purpose)", (k) => statusProof(k, identity.fingerprint, nonce())],
    ["no body", () => undefined],
  ];
  it.each(invalid)("%s → 400 and nothing bound", async (_n, make) => {
    const k = newDeviceKey();
    const { token } = reg.add("d", "pairing", "operate");
    const res = await bind(bearer(token), make(k));
    expect(res.statusCode).toBe(400);
    expect(reg.isKeyHeld(k.pub)).toBe(false);
  });

  it("a replayed (consumed) nonce → 400 and nothing new is bound", async () => {
    const k = newDeviceKey();
    const k2 = newDeviceKey();
    const { token } = reg.add("d", "pairing", "operate");
    const n = nonce();
    expect((await bind(bearer(token), bindProof(k, identity.fingerprint, n))).statusCode).toBe(200);
    const replay = await bind(bearer(token), bindProof(k2, identity.fingerprint, n));
    expect(replay.statusCode).toBe(400);
    expect(reg.isKeyHeld(k2.pub)).toBe(false);
  });

  it("a nonce this route's store never issued (or already expired) → 400", async () => {
    const old = new DeviceNonceStore().issue();
    const k = newDeviceKey();
    const { token } = reg.add("d", "pairing", "operate");
    expect((await bind(bearer(token), bindProof(k, identity.fingerprint, old))).statusCode).toBe(400);
  });

  it("bearer rotation keeps the key (the row is mutated in place)", async () => {
    const k = newDeviceKey();
    const { token, device } = reg.add("d", "pairing", "operate", "browser", { key: k.pub });
    const rotated = reg.rotate(token, true);
    expect(rotated.ok).toBe(true);
    expect(reg.list().find((d) => d.id === device.id)?.keyId).toBe(keyIdOf(k.pub));
    expect(reg.deviceKeyStatus(k.pub)).toMatchObject({ status: "paired" });
  });
});

describe("E14 operator routes for held devices", () => {
  const op = (method: "GET" | "POST" | "DELETE", url: string, headers: Record<string, string> = SESSION) =>
    app.inject({ method, url, remoteAddress: "127.0.0.1", headers: { host: "localhost:8000", ...headers } });

  it("lists revoked devices (with the key id, no key), never lists them in the active list", async () => {
    const k = newDeviceKey();
    const a = reg.add("d1", "pairing", "operate", undefined, { key: k.pub });
    reg.add("d2", "pairing", "operate");
    reg.revoke(a.device.id, "local");
    const res = await op("GET", "/api/paired-devices/revoked");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.warning).toBeUndefined();
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ id: a.device.id, keyId: keyIdOf(k.pub), revokedBy: "local" });
    expect(JSON.stringify(body)).not.toContain(k.pub);
    expect(JSON.stringify(body)).not.toContain(a.token);
    const active = (await op("GET", "/api/paired-devices")).json().data as Array<{ id: string }>;
    expect(active.map((d) => d.id)).not.toContain(a.device.id);
  });

  it("carries the unreadable-list warning", async () => {
    await app.close();
    mgr.dispose();
    fs.writeFileSync(path.join(tmp, "revoked-devices.json"), "{not json");
    reg = new PairedDeviceRegistry(path.join(tmp, "paired.json"));
    mgr = new PairingManager({ registry: reg, getFingerprint: () => identity.fingerprint, getReachableUrls: () => [] });
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
      hostAdmission: () => ({ allowedHosts: [], publicBaseUrls: [], configuredOrigins: [], bindHost: "localhost" }),
    });
    await app.ready();
    const res = await op("GET", "/api/paired-devices/revoked");
    expect(res.json()).toMatchObject({ success: true, data: [], warning: "unreadable" });
  });

  it("restore: revoked → 200 (back in the active list); again → 409; unknown → 404", async () => {
    const d = reg.add("d", "pairing", "operate");
    reg.revoke(d.device.id, "local");
    expect((await op("POST", `/api/paired-devices/${d.device.id}/restore`)).statusCode).toBe(200);
    expect(reg.list().some((x) => x.id === d.device.id)).toBe(true);
    expect((await op("POST", `/api/paired-devices/${d.device.id}/restore`)).statusCode).toBe(409);
    expect((await op("POST", "/api/paired-devices/nope/restore")).statusCode).toBe(404);
    expect(reg.verify(d.token, "plain")).not.toBeNull(); // the same bearer works again
  });

  it("delete-now: revoked → 200; after restore → 409; after delete → restore 404; active → 409; unknown → 404", async () => {
    const d = reg.add("d", "pairing", "operate");
    const act = reg.add("active", "pairing", "operate");
    reg.revoke(d.device.id, "local");
    expect((await op("POST", `/api/paired-devices/${d.device.id}/restore`)).statusCode).toBe(200);
    expect((await op("DELETE", `/api/paired-devices/revoked/${d.device.id}`)).statusCode).toBe(409);
    reg.revoke(d.device.id, "local");
    expect((await op("DELETE", `/api/paired-devices/revoked/${d.device.id}`)).statusCode).toBe(200);
    expect((await op("POST", `/api/paired-devices/${d.device.id}/restore`)).statusCode).toBe(404);
    expect((await op("DELETE", `/api/paired-devices/revoked/${act.device.id}`)).statusCode).toBe(409);
    expect((await op("DELETE", "/api/paired-devices/revoked/nope")).statusCode).toBe(404);
    expect(reg.list().some((x) => x.id === act.device.id)).toBe(true);
  });

  it("revoke of an already-revoked or unknown id → 404 and nothing changes", async () => {
    const d = reg.add("d", "pairing", "operate");
    expect((await op("DELETE", `/api/paired-devices/${d.device.id}`)).statusCode).toBe(200);
    expect((await op("DELETE", `/api/paired-devices/${d.device.id}`)).statusCode).toBe(404);
    expect((await op("DELETE", "/api/paired-devices/nope")).statusCode).toBe(404);
    expect(reg.listRevoked().devices).toHaveLength(1);
  });

  it("companion removal: 200, then it answers unknown; unknown companion → 404", async () => {
    const c = newDeviceKey();
    const d = reg.add("d", "pairing", "operate");
    reg.addCompanion(d.device.id, { pub: c.pub, origin: "http://192.168.16.31:8000" });
    const listed = (await op("GET", "/api/paired-devices")).json().data as Array<{ id: string; companions?: Array<{ id: string; origin: string }> }>;
    const row = listed.find((x) => x.id === d.device.id)!;
    expect(row.companions).toEqual([expect.objectContaining({ id: keyIdOf(c.pub), origin: "http://192.168.16.31:8000" })]);
    expect(JSON.stringify(listed)).not.toContain(c.pub);
    const id = encodeURIComponent(keyIdOf(c.pub));
    expect((await op("DELETE", `/api/paired-devices/${d.device.id}/companions/${id}`)).statusCode).toBe(200);
    expect(reg.deviceKeyStatus(c.pub)).toEqual({ status: "unknown" });
    expect((await op("DELETE", `/api/paired-devices/${d.device.id}/companions/${id}`)).statusCode).toBe(404);
  });

  it("a device bearer is refused 401 on every operator route and nothing changes", async () => {
    const caller = reg.add("caller", "pairing", "operate");
    const held = reg.add("held", "pairing", "operate");
    const comp = newDeviceKey();
    const other = reg.add("other", "pairing", "operate");
    reg.addCompanion(other.device.id, { pub: comp.pub, origin: "http://192.168.16.31:8000" });
    reg.revoke(held.device.id, "local");
    const h = bearer(caller.token);
    const calls: Array<["GET" | "POST" | "DELETE", string]> = [
      ["GET", "/api/paired-devices/revoked"],
      ["POST", `/api/paired-devices/${held.device.id}/restore`],
      ["DELETE", `/api/paired-devices/revoked/${held.device.id}`],
      ["DELETE", `/api/paired-devices/${other.device.id}/companions/${encodeURIComponent(keyIdOf(comp.pub))}`],
    ];
    for (const [method, url] of calls) {
      const res = await app.inject({ method, url, remoteAddress: "127.0.0.1", headers: { host: "localhost:8000", ...h } });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
    expect(reg.listRevoked().devices.map((x) => x.id)).toEqual([held.device.id]);
    expect(reg.deviceKeyStatus(comp.pub)).toMatchObject({ status: "paired", scope: "status-only" });
  });
});
