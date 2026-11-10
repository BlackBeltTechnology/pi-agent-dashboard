/**
 * Device check, step 1 + 2 over the REAL pairing routes (test-plan E3, E12, E13, E17).
 * `POST /api/pair/challenge` issues `deviceNonce`; `POST /api/pair/device-status` answers the
 * status of the caller's own key, or exactly `{"status":"unverified"}`.
 * See change: device-key-mutual-check (D1, D2, D8).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import fastifyCookie from "@fastify/cookie";
import { isDeviceNonce } from "@blackbelt-technology/pi-dashboard-shared/device-key-proof.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceNonceStore, DeviceStatusLimiter, RevokedAnswerLog } from "../auth/device-proof.js";
import { DEVICE_COOKIE, registerBearerAuth, registerDeviceSessionRoutes } from "../auth/bearer-auth.js";
import { ensureServerIdentity, verifyNonceSignature, type ServerIdentity } from "../auth/identity.js";
import { createNetworkGuard, createNetworkGuardHook } from "../auth/localhost-guard.js";
import { createRouteTierGate } from "../auth/route-tier-gate.js";
import { PairedDeviceRegistry } from "../pairing/paired-devices.js";
import { PairingManager } from "../pairing/pairing.js";
import { PUBLIC_PAIRING_PREFIXES, registerPairingRoutes } from "../routes/pairing-routes.js";
import { bindProof, newDeviceKey, statusProof, type TestDeviceKey } from "./helpers/device-key.js";

const REMOTE = "192.168.16.20";
const UNVERIFIED = { status: "unverified" };

let tmp: string;
let identity: ServerIdentity;
let reg: PairedDeviceRegistry;
let mgr: PairingManager;
let app: FastifyInstance;
let nonces: DeviceNonceStore;
let limiter: DeviceStatusLimiter;
let tripped: string[];
let revokedLines: string[];
let now: number;

async function mkApp(limit = 60) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-devstatus-"));
  identity = ensureServerIdentity(path.join(tmp, "identity.json"));
  reg = new PairedDeviceRegistry(path.join(tmp, "paired.json"));
  mgr = new PairingManager({ registry: reg, getFingerprint: () => identity.fingerprint, getReachableUrls: () => [] });
  tripped = [];
  revokedLines = [];
  nonces = new DeviceNonceStore();
  limiter = new DeviceStatusLimiter({ limit, onTrip: (p) => tripped.push(p) });
  app = Fastify();
  await app.register(fastifyCookie);
  app.decorateRequest("isAuthenticated", false);
  registerBearerAuth(app, { registry: reg });
  registerDeviceSessionRoutes(app, { registry: reg, isSecure: () => false });
  app.addHook("onRequest", createRouteTierGate({ getTrustedNetworks: () => [] }));
  app.addHook(
    "onRequest",
    createNetworkGuardHook({ trustedNetworks: [], getPairingPrefixes: () => PUBLIC_PAIRING_PREFIXES, logDenial: () => {} }),
  );
  registerPairingRoutes(app, {
    networkGuard: createNetworkGuard([]),
    identity,
    pairing: mgr,
    registry: reg,
    hostAdmission: () => ({ allowedHosts: [], publicBaseUrls: [], configuredOrigins: [], bindHost: "192.168.16.204" }),
    deviceNonces: nonces,
    deviceStatusLimiter: limiter,
    revokedAnswerLog: new RevokedAnswerLog({ now: () => now, emit: (k) => revokedLines.push(k) }),
  });
  app.post("/api/restart", async () => ({ ok: true }));
  app.get("/api/sessions", async () => ({ success: true }));
  app.post("/api/ws-ticket", async () => ({ success: true }));
  await app.ready();
}

/** Tear the app down and rebuild it with a different limiter budget. */
async function remkApp(limit: number) {
  await app.close();
  mgr.dispose();
  fs.rmSync(tmp, { recursive: true, force: true });
  await mkApp(limit);
}

beforeEach(async () => {
  now = 0;
  await mkApp();
});

afterEach(async () => {
  vi.useRealTimers();
  mgr.dispose();
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const challenge = async (peer = REMOTE) => {
  const res = await app.inject({
    method: "POST",
    url: "/api/pair/challenge",
    remoteAddress: peer,
    payload: { nonce: "n".repeat(16) },
  });
  return res.json().data as { fingerprint: string; publicKey: string; signature: string; v: number; deviceNonce: string };
};

const postStatus = (body: unknown, peer = REMOTE, headers: Record<string, string> = {}) =>
  app.inject({
    method: "POST",
    url: "/api/pair/device-status",
    remoteAddress: peer,
    headers: { "content-type": "application/json", ...headers },
    payload: body as never,
  });

/** Pair a device that holds `key`, returning its bearer. */
function pairWithKey(key: TestDeviceKey, tier: "observe" | "control" | "operate" = "operate", holder?: "browser") {
  return reg.add("laptop", "pairing", tier, holder, { key: key.pub });
}

const checkOnce = async (key: TestDeviceKey, peer = REMOTE) => {
  const ch = await challenge(peer);
  return postStatus(statusProof(key, ch.fingerprint, ch.deviceNonce), peer);
};

describe("challenge reply gains deviceNonce", () => {
  it("keeps the identity answer and adds a 43-char single-use nonce", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/pair/challenge",
      remoteAddress: REMOTE,
      payload: { nonce: "client-nonce-1234" },
    });
    expect(res.statusCode).toBe(200);
    const { data } = res.json();
    expect(data.fingerprint).toBe(identity.fingerprint);
    expect(data.publicKey).toBe(identity.publicKeyB64);
    expect(verifyNonceSignature(data.publicKey, "client-nonce-1234", data.signature)).toBe(true);
    expect(isDeviceNonce(data.deviceNonce)).toBe(true);
    const second = (await challenge()).deviceNonce;
    expect(second).not.toBe(data.deviceNonce);
  });

  it("a bad client nonce is still refused 400", async () => {
    const res = await app.inject({ method: "POST", url: "/api/pair/challenge", remoteAddress: REMOTE, payload: { nonce: "x" } });
    expect(res.statusCode).toBe(400);
  });
});

describe("E3 device-status answers", () => {
  it("paired full key → paired + tier + scope full", async () => {
    const k = newDeviceKey();
    pairWithKey(k, "control");
    const res = await checkOnce(k);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "paired", tier: "control", scope: "full" });
  });

  it("unknown key → unknown", async () => {
    expect((await checkOnce(newDeviceKey())).json()).toEqual({ status: "unknown" });
  });

  it("revoked → revoked with no tier or scope", async () => {
    const k = newDeviceKey();
    const { device } = pairWithKey(k);
    reg.revoke(device.id, "local");
    expect((await checkOnce(k)).json()).toEqual({ status: "revoked" });
  });

  it("expired browser bearer → expired with no tier or scope; revoked wins over expired", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const k = newDeviceKey();
    const { device } = pairWithKey(k, "operate", "browser");
    vi.setSystemTime(new Date("2026-01-09T00:00:00Z")); // past the 7-day expiry
    expect((await checkOnce(k)).json()).toEqual({ status: "expired" });
    reg.revoke(device.id, "local");
    expect((await checkOnce(k)).json()).toEqual({ status: "revoked" });
  });

  it("paired companion → paired + status-only and no tier", async () => {
    const owner = newDeviceKey();
    const companion = newDeviceKey();
    const { device } = pairWithKey(owner);
    expect(reg.addCompanion(device.id, { pub: companion.pub, origin: "http://192.168.16.31:8000" })).toBe("added");
    expect((await checkOnce(companion)).json()).toEqual({ status: "paired", scope: "status-only" });
  });

  it("a nonce is single use: replaying the proof is unverified", async () => {
    const k = newDeviceKey();
    pairWithKey(k);
    const ch = await challenge();
    const proof = statusProof(k, ch.fingerprint, ch.deviceNonce);
    expect((await postStatus(proof)).json().status).toBe("paired");
    expect((await postStatus(proof)).json()).toEqual(UNVERIFIED);
  });
});

describe("E3 unverified replies are indistinguishable", () => {
  it("six failure causes give a byte-identical 200 reply", async () => {
    const k = newDeviceKey();
    pairWithKey(k);
    const other = newDeviceKey();
    const replies: Array<{ status: number; body: string; headers: Record<string, unknown> }> = [];
    const keep = (r: Awaited<ReturnType<typeof postStatus>>) =>
      replies.push({ status: r.statusCode, body: r.body, headers: { "content-length": r.headers["content-length"], "content-type": r.headers["content-type"], "cache-control": r.headers["cache-control"] } });

    // (a) replay
    const a = await challenge();
    const pa = statusProof(k, a.fingerprint, a.deviceNonce);
    await postStatus(pa);
    keep(await postStatus(pa));
    // (b) bad sig first, then the valid one over the same (now consumed) nonce
    const b = await challenge();
    await postStatus({ ...statusProof(k, b.fingerprint, b.deviceNonce), sig: statusProof(other, b.fingerprint, b.deviceNonce).sig });
    keep(await postStatus(statusProof(k, b.fingerprint, b.deviceNonce)));
    // (c) a proof signed for another server's fingerprint
    const c = await challenge();
    keep(await postStatus(statusProof(k, "sha256:another-server", c.deviceNonce)));
    // (d) a nonce this server never issued
    keep(await postStatus(statusProof(k, identity.fingerprint, "A".repeat(43))));
    // (e) malformed pub
    const e = await challenge();
    keep(await postStatus({ ...statusProof(k, e.fingerprint, e.deviceNonce), pub: "short" }));
    // (f) over the limit
    await remkApp(1);
    const k2 = newDeviceKey();
    pairWithKey(k2);
    const f1 = await challenge();
    await postStatus(statusProof(k2, f1.fingerprint, f1.deviceNonce));
    const f2 = await challenge();
    keep(await postStatus(statusProof(k2, f2.fingerprint, f2.deviceNonce)));

    expect(replies).toHaveLength(6);
    for (const r of replies) {
      expect(r.status).toBe(200);
      expect(r.body).toBe(JSON.stringify(UNVERIFIED));
      expect(r.headers).toEqual(replies[0].headers);
    }
  });

  it("an unparseable body, a text/plain body and no body all give the same reply", async () => {
    const bad = await postStatus("{not json", REMOTE);
    const text = await postStatus("hello", REMOTE, { "content-type": "text/plain" });
    const none = await app.inject({ method: "POST", url: "/api/pair/device-status", remoteAddress: REMOTE });
    for (const r of [bad, text, none]) {
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual(UNVERIFIED);
    }
  });

  it("the limit trips per peer, never limits the challenge, and logs once", async () => {
    await remkApp(2);
    const k = newDeviceKey();
    pairWithKey(k);
    const answers: string[] = [];
    for (let i = 0; i < 5; i += 1) answers.push((await checkOnce(k)).json().status);
    expect(answers).toEqual(["paired", "paired", "unverified", "unverified", "unverified"]);
    expect(tripped).toEqual([REMOTE]);
    // the identity challenge is unaffected
    const ch = await challenge();
    expect(ch.fingerprint).toBe(identity.fingerprint);
    // another peer has its own budget
    expect((await checkOnce(k, "192.168.16.77")).json().status).toBe("paired");
  });
});

describe("E17 revoked-answer line", () => {
  it("100 revoked checks write at most one line, and it names only the short key id", async () => {
    await remkApp(1000);
    const k = newDeviceKey();
    const { device } = pairWithKey(k);
    reg.revoke(device.id, "local");
    for (let i = 0; i < 100; i += 1) await checkOnce(k);
    expect(revokedLines).toHaveLength(1);
    expect(revokedLines[0]).toMatch(/^dk:[A-Za-z0-9_-]{12}$/);
    expect(revokedLines[0]).not.toContain(k.pub);
  });
});

describe("E12 observe-tier routes are never refused on tier grounds", () => {
  const tiers = ["observe", "control", "operate"] as const;

  async function bindBody() {
    const k = newDeviceKey();
    const ch = await challenge();
    return bindProof(k, ch.fingerprint, ch.deviceNonce);
  }

  for (const tier of tiers) {
    for (const via of ["bearer", "cookie"] as const) {
      it(`${tier} device by ${via}: challenge, device-status, device-key are not 403; /api/restart follows its tier`, async () => {
        const { token } = reg.add("d", "pairing", tier);
        const headers = via === "bearer" ? { authorization: `Bearer ${token}` } : { cookie: `${DEVICE_COOKIE}=${token}` };
        const insufficient = (r: { statusCode: number; json: () => any }) =>
          r.statusCode === 403 && r.json().error === "insufficient_scope";

        const ch = await app.inject({ method: "POST", url: "/api/pair/challenge", remoteAddress: REMOTE, headers, payload: { nonce: "n".repeat(16) } });
        expect(ch.statusCode).toBe(200);

        const k = newDeviceKey();
        const nonce = ch.json().data.deviceNonce as string;
        const status = await app.inject({
          method: "POST",
          url: "/api/pair/device-status",
          remoteAddress: REMOTE,
          headers,
          payload: statusProof(k, identity.fingerprint, nonce),
        });
        expect(insufficient(status)).toBe(false);
        expect(status.statusCode).toBe(200);

        const bind = await app.inject({
          method: "POST",
          url: "/api/pair/device-key",
          remoteAddress: REMOTE,
          headers,
          payload: await bindBody(),
        });
        expect(insufficient(bind)).toBe(false);
        expect(bind.statusCode).toBe(200);

        const restart = await app.inject({ method: "POST", url: "/api/restart", remoteAddress: REMOTE, headers });
        if (tier === "operate") expect(restart.statusCode).toBe(200);
        else expect(restart.json()).toMatchObject({ error: "insufficient_scope", scope: "operate" });
      });
    }
  }

  it("request / redeem / poll keep tier operate for an observe device", async () => {
    const { token } = reg.add("d", "pairing", "observe");
    for (const url of ["/api/pair/request", "/api/pair/redeem", "/api/pair/poll"]) {
      const res = await app.inject({
        method: "POST",
        url,
        remoteAddress: REMOTE,
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });
      expect(res.statusCode, url).toBe(403);
      expect(res.json(), url).toMatchObject({ error: "insufficient_scope", scope: "operate" });
    }
  });
});

describe("E13 only a device credential authenticates", () => {
  it("anonymous device-key → 401 and nothing bound", async () => {
    const k = newDeviceKey();
    const ch = await challenge();
    const res = await app.inject({
      method: "POST",
      url: "/api/pair/device-key",
      remoteAddress: "127.0.0.1",
      payload: bindProof(k, ch.fingerprint, ch.deviceNonce),
    });
    expect(res.statusCode).toBe(401);
    expect(reg.isKeyHeld(k.pub)).toBe(false);
  });

  it("a companion key presented as bearer, cookie or proof body authenticates nothing", async () => {
    const owner = newDeviceKey();
    const companion = newDeviceKey();
    const { device } = pairWithKey(owner);
    reg.addCompanion(device.id, { pub: companion.pub, origin: "http://192.168.16.31:8000" });
    expect(reg.verify(companion.pub)).toBeNull();
    expect(reg.verifyDetailed(companion.pub).status).toBe("invalid");

    for (const headers of [{ authorization: `Bearer ${companion.pub}` }, { cookie: `${DEVICE_COOKIE}=${companion.pub}` }]) {
      for (const [method, url] of [
        ["POST", "/api/device-session"],
        ["POST", "/api/ws-ticket"],
        ["GET", "/api/sessions"],
      ] as const) {
        const res = await app.inject({ method, url, remoteAddress: REMOTE, headers });
        expect([401, 403], `${method} ${url}`).toContain(res.statusCode);
      }
    }
    // As a proof body on the credentialed route it is simply anonymous.
    const ch = await challenge();
    const res = await app.inject({
      method: "POST",
      url: "/api/pair/device-key",
      remoteAddress: "127.0.0.1",
      payload: bindProof(companion, ch.fingerprint, ch.deviceNonce),
    });
    expect(res.statusCode).toBe(401);
  });

  it("device-status is public and no public prefix is a string prefix of device-key", () => {
    expect(PUBLIC_PAIRING_PREFIXES).toContain("/api/pair/device-status");
    for (const p of PUBLIC_PAIRING_PREFIXES) expect("/api/pair/device-key".startsWith(p)).toBe(false);
  });
});
