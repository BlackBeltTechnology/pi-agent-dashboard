import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { httpProofHeaders } from "@blackbelt-technology/pi-dashboard-shared/local-credential-proof.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COOKIE_NAME, signToken } from "../auth/auth.js";
import { validateWsUpgrade } from "../auth/auth-plugin.js";
import { parseBearerHeader, registerBearerAuth } from "../auth/bearer-auth.js";
import { createLocalCredentialVerifier } from "../auth/local-credential.js";
import { createNetworkGuardHook } from "../auth/localhost-guard.js";
import { createRouteTierGate } from "../auth/route-tier-gate.js";
import { WsTicketStore } from "../auth/ws-ticket.js";
import { PairedDeviceRegistry } from "../pairing/paired-devices.js";
import { PairingManager } from "../pairing/pairing.js";
import { simulateTlsSocket, TEST_TLS_HEADER } from "./helpers/channel-fixture.js";
import {
  bearer,
  DAY_MS,
  get,
  LOOPBACK,
  mkRotationApp,
  REMOTE,
  type RotationApp,
  rotate,
  settledBytes,
  T0,
  writeRegistryRows,
} from "./helpers/bearer-rotation-app.js";

const SECRET = "test-secret-for-bearer";
let tmpDir: string;
let reg: PairedDeviceRegistry;
let token: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-bearer-"));
  reg = new PairedDeviceRegistry(path.join(tmpDir, "paired.json"));
  token = reg.add("dev").token;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("bearer header parsing", () => {
  it("extracts a Bearer token (case-insensitive), else null", () => {
    expect(parseBearerHeader("Bearer abc123")).toBe("abc123");
    expect(parseBearerHeader("bearer  xyz ")).toBe("xyz");
    expect(parseBearerHeader("Basic abc")).toBe(null);
    expect(parseBearerHeader(undefined)).toBe(null);
  });
});

describe("validateWsUpgrade — ticket branch is additive (Task 3.3/3.5)", () => {
  it("loopback still bypasses without any credential (unchanged)", () => {
    expect(validateWsUpgrade(undefined, "127.0.0.1", SECRET)).toBe(true);
    expect(validateWsUpgrade(undefined, "::1", SECRET)).toBe(true);
  });

  it("valid cookie still authorizes external requests (unchanged)", () => {
    const cookie = `${COOKIE_NAME}=${signToken({ sub: "u@e.com", name: "U", username: "u", provider: "github" }, SECRET)}`;
    expect(validateWsUpgrade(cookie, "1.2.3.4", SECRET)).toBe(true);
  });

  it("external request with NO credential is still rejected (unchanged)", () => {
    const store = new WsTicketStore();
    const consumeTicket = (t: string, s: any) => store.consume(t, s);
    expect(validateWsUpgrade(undefined, "1.2.3.4", SECRET, [], { scope: "browser", consumeTicket })).toBe(false);
  });

  it("valid single-use ticket authorizes an external request; durable bearer never rides WS", () => {
    const store = new WsTicketStore();
    const consumeTicket = (t: string, s: any) => store.consume(t, s);
    const ticket = store.mint("browser");
    expect(validateWsUpgrade(undefined, "1.2.3.4", SECRET, [], { ticket, scope: "browser", consumeTicket })).toBe(true);
    // Single-use: replaying the same ticket fails.
    expect(validateWsUpgrade(undefined, "1.2.3.4", SECRET, [], { ticket, scope: "browser", consumeTicket })).toBe(false);
  });

  it("a durable bearer token presented as a ticket is rejected", () => {
    const store = new WsTicketStore();
    const consumeTicket = (t: string, s: any) => store.consume(t, s);
    // token is a durable bearer, never minted as a ticket.
    expect(validateWsUpgrade(undefined, "1.2.3.4", SECRET, [], { ticket: token, scope: "browser", consumeTicket })).toBe(false);
  });
});

// test-plan #E7 — a paired device reaching the dashboard THROUGH a tunnel
// (relayed loopback) is admitted by its bearer, not by a loopback trusted
// entry; the device-tier gate is therefore still evaluated.
// See change: fix-trusted-network-tunnel-bypass.
describe("E7 paired device over a tunnel", () => {
  it("admits the relayed-loopback request on the bearer alone, with the tier gate live", async () => {
    const operate = reg.add("phone", "manual", "operate").token;
    const observe = reg.add("ro", "manual", "observe").token;
    const app = Fastify();
    app.decorateRequest("isAuthenticated", false);
    registerBearerAuth(app, { registry: reg });
    app.addHook("onRequest", createRouteTierGate({ getTrustedNetworks: () => ["127.0.0.1"], logRefusal: () => {} }));
    app.addHook(
      "onRequest",
      createNetworkGuardHook({ trustedNetworks: ["127.0.0.1"], logDenial: () => {} }),
    );
    app.get("/api/sessions", async (req) => ({ authVia: (req as any).authVia }));
    app.post("/api/restart", async () => ({ ok: true }));
    await app.ready();
    const relayed = { remoteAddress: "127.0.0.1", headers: { "x-forwarded-for": "203.0.113.9" } };
    try {
      const noCred = await app.inject({ method: "GET", url: "/api/sessions", ...relayed });
      expect(noCred.statusCode).toBe(403);

      const ok = await app.inject({
        method: "GET",
        url: "/api/sessions",
        remoteAddress: relayed.remoteAddress,
        headers: { ...relayed.headers, authorization: `Bearer ${operate}` },
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json()).toEqual({ authVia: "device" });

      // Tier gate evaluated: the loopback entry no longer exempts the relay.
      const aboveTier = await app.inject({
        method: "POST",
        url: "/api/restart",
        remoteAddress: relayed.remoteAddress,
        headers: { ...relayed.headers, authorization: `Bearer ${observe}` },
      });
      expect(aboveTier.statusCode).toBe(403);
      expect(aboveTier.json()).toMatchObject({ error: "insufficient_scope" });
    } finally {
      await app.close();
    }
  });
});

// ── Browser-held bearer expiry + rotation (change: harden-auth-credentials, D5) ──
// AE35..AE44, AE47..AE49, AE67..AE71, AE73, AX1..AX4, AX13. Fake clock: Date only
// (`app.inject` keeps real timers). 7 d = 604 800 s; 30 d = 2 592 000 s; grace = 60 s.
describe("browser bearer expiry + rotation", () => {
  let a: RotationApp;
  const at = (ms: number) => vi.setSystemTime(ms);
  const body = (r: { json: () => unknown }) => r.json() as Record<string, unknown>;
  const mkBrowser = (tier: "observe" | "control" | "operate" = "operate") => a.reg.add("L", "pairing", tier, "browser");
  /** Seed a browser row (own registry) with an explicit pairedAt / expiresAt. */
  async function seeded(rows: Array<{ token: string } & Record<string, unknown>>, opts: { open?: "loopback" | "all" } = {}) {
    await a?.close();
    a = await mkRotationApp({ ...opts, seed: (f) => writeRegistryRows(f, rows) });
  }
  const fileRows = () => JSON.parse(a.bytes()) as Array<Record<string, unknown>>;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    at(T0);
    a = await mkRotationApp();
  });
  afterEach(async () => {
    await a.close();
    vi.useRealTimers();
  });

  it("AE35 a never-rotated browser bearer: 200 at T+604 799 s, 401 bearer_expired at T+604 801 s", async () => {
    const d = mkBrowser();
    at(T0 + 604_799_000);
    expect((await get(a, d.token)).statusCode).toBe(200);
    at(T0 + 604_801_000);
    const res = await get(a, d.token);
    expect(res.statusCode).toBe(401);
    expect(body(res).code).toBe("bearer_expired");
  });

  it("AE36 a bearer rotated at T0+29 d is capped at T0+30 d (200 / 401 bearer_expired either side)", async () => {
    await seeded([{ token: "b1", pairedAt: T0, expiresAt: T0 + 30 * DAY_MS }]);
    at(T0 + 29 * DAY_MS);
    const r = await rotate(a, "b1");
    expect(r.statusCode).toBe(200);
    const b2 = body(r).token as string;
    expect(body(r).expiresAt).toBe(T0 + 2_592_000_000);
    at(T0 + 2_591_999_000);
    expect((await get(a, b2)).statusCode).toBe(200);
    at(T0 + 2_592_001_000);
    const res = await get(a, b2);
    expect(res.statusCode).toBe(401);
    expect(body(res).code).toBe("bearer_expired");
  });

  it("AE37 rotation expiresAt = min(R+7 d, pairedAt+30 d) at the cap threshold", async () => {
    const cases: Array<[number, number]> = [
      [22 * DAY_MS, 29 * DAY_MS],
      [23 * DAY_MS, 30 * DAY_MS],
      [23 * DAY_MS + 1000, 30 * DAY_MS],
      [25 * DAY_MS, 30 * DAY_MS],
      [30 * DAY_MS - 1000, 30 * DAY_MS],
    ];
    for (const [rotAt, want] of cases) {
      await seeded([{ token: "cur", pairedAt: T0, expiresAt: T0 + rotAt + DAY_MS }]);
      at(T0 + rotAt);
      const res = await rotate(a, "cur");
      expect(res.statusCode).toBe(200);
      expect(body(res).expiresAt).toBe(T0 + want);
      expect(body(res).expiresAt as number).toBeLessThanOrEqual(T0 + 30 * DAY_MS);
      expect(body(res).expiresAt as number).toBeLessThanOrEqual(T0 + rotAt + 7 * DAY_MS);
    }
  });

  it("AE38 rotate past the 30 d ceiling → 401 bearer_expired, nothing issued, registry unchanged", async () => {
    await seeded([{ token: "cur", pairedAt: T0, expiresAt: T0 + 30 * DAY_MS }]);
    const before = a.bytes();
    at(T0 + 30 * DAY_MS + 1000);
    const res = await rotate(a, "cur");
    expect(res.statusCode).toBe(401);
    expect(body(res).code).toBe("bearer_expired");
    expect(body(res).token).toBeUndefined();
    expect(a.bytes()).toBe(before);
  });

  it.each(["observe", "control", "operate"] as const)("AE39 %s rotation: 200 {token, expiresAt}, no-store, id/label/tier/unknown field kept", async (tier) => {
    await seeded([{ token: "cur", label: `L-${tier}`, tier, x_future: 1, pairedAt: T0, expiresAt: T0 + 7 * DAY_MS }]);
    const d = { token: "cur" };
    const id = fileRows()[0].id;
    at(T0 + 3_600_000);
    const res = await rotate(a, d.token);
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(body(res).expiresAt).toBe(T0 + 3_600_000 + 604_800_000);
    expect(body(res).token).not.toBe(d.token);
    const row = fileRows()[0];
    expect(row).toMatchObject({ id, label: `L-${tier}`, tier, x_future: 1 });
  });

  it("AE40 the old bearer survives only a 60 s grace", async () => {
    const d = mkBrowser();
    const r = await rotate(a, d.token);
    const b = body(r).token as string;
    at(T0 + 59_000);
    expect((await get(a, d.token)).statusCode).toBe(200);
    at(T0 + 61_000);
    expect((await get(a, d.token)).statusCode).toBe(401);
    expect((await get(a, b)).statusCode).toBe(200);
  });

  it("AE41 a legacy row converts on holder:browser; 30 d counts from conversion", async () => {
    await seeded([{ token: "legacy", createdAt: new Date(T0 - 90 * DAY_MS).toISOString() }]);
    at(T0);
    const res = await rotate(a, "legacy", { holder: "browser" });
    expect(res.statusCode).toBe(200);
    expect(body(res).expiresAt).toBe(T0 + 7 * DAY_MS);
    expect(fileRows()[0].pairedAt).toBe(T0);
    at(T0 + 30 * DAY_MS + 1000);
    const late = await get(a, body(res).token as string);
    expect(late.statusCode).toBe(401);
    expect(body(late).code).toBe("bearer_expired");
  });

  it("AE42 a converted row's ceiling is conversion+30 d: rotate at N+25 d → N+30 d, not N+32 d", async () => {
    await seeded([{ token: "legacy" }]);
    let cur = body(await rotate(a, "legacy", { holder: "browser" })).token as string;
    for (const d of [6, 12, 18, 24]) {
      at(T0 + d * DAY_MS);
      const r = await rotate(a, cur);
      expect(r.statusCode).toBe(200);
      cur = body(r).token as string;
    }
    at(T0 + 25 * DAY_MS);
    const res = await rotate(a, cur);
    expect(res.statusCode).toBe(200);
    expect(body(res).expiresAt).toBe(T0 + 30 * DAY_MS);
  });

  it("AE43 a non-expiring row without the declaration → 409 holder_declaration_required, unchanged, never expires", async () => {
    for (const payload of [undefined, {}, { holder: "desktop" }]) {
      await seeded([
        { token: "pairing-tok", source: "pairing" },
        { token: "manual-tok", source: "manual", tier: "observe" },
      ]);
      for (const tok of ["pairing-tok", "manual-tok"]) {
        const before = await settledBytes(a, tok);
        const res = await rotate(a, tok, payload);
        expect(res.statusCode).toBe(409);
        expect(body(res).code).toBe("holder_declaration_required");
        expect(body(res).token).toBeUndefined();
        expect(a.bytes()).toBe(before);
        at(T0 + 400 * DAY_MS);
        expect((await get(a, tok)).statusCode).toBe(200);
        at(T0);
      }
    }
  });

  it("AE44 an expiring browser row needs no declaration", async () => {
    for (const payload of [{}, undefined, { holder: "browser" }]) {
      const d = mkBrowser();
      const res = await rotate(a, d.token, payload);
      expect(res.statusCode).toBe(200);
      expect(typeof body(res).token).toBe("string");
      expect(typeof body(res).expiresAt).toBe("number");
    }
    expect(fileRows().every((r) => typeof r.expiresAt === "number")).toBe(true);
  });

  it("AE47 revoked / unknown bearers are plain 401s; an expired one is bearer_expired", async () => {
    const revoked = mkBrowser();
    a.reg.revoke(revoked.device.id);
    const expired = mkBrowser();
    const rv = await get(a, revoked.token);
    const un = await get(a, "not-a-real-token");
    expect([rv.statusCode, un.statusCode]).toEqual([401, 401]);
    expect(body(rv).code).toBeUndefined();
    expect(body(un).code).toBeUndefined();
    at(T0 + 604_801_000);
    const ex = await get(a, expired.token);
    expect(ex.statusCode).toBe(401);
    expect(body(ex).code).toBe("bearer_expired");
  });

  it("AE48 revoke kills the grace-window bearer too", async () => {
    const d = mkBrowser();
    const b = body(await rotate(a, d.token)).token as string;
    at(T0 + 10_000);
    a.reg.revoke(d.device.id);
    at(T0 + 11_000);
    for (const t of [d.token, b]) {
      const res = await get(a, t);
      expect(res.statusCode).toBe(401);
      expect(body(res).code).toBeUndefined();
    }
    expect((await rotate(a, b)).statusCode).toBe(401);
  });

  it("AE49 a device id in the body is ignored: a bearer rotates only itself", async () => {
    const x = mkBrowser();
    const y = mkBrowser();
    const rowsBefore = fileRows();
    const idY = y.device.id;
    const yBefore = JSON.stringify(rowsBefore.find((r) => r.id === idY));
    const res = await rotate(a, x.token, { id: idY, deviceId: idY, device: idY });
    expect(res.statusCode).toBe(200);
    const rows = fileRows();
    expect(JSON.stringify(rows.find((r) => r.id === idY))).toBe(yBefore);
    expect(rows.find((r) => r.id === x.device.id)?.tokenHash).not.toBe(rowsBefore.find((r) => r.id === x.device.id)?.tokenHash);
    expect((await get(a, y.token)).statusCode).toBe(200);
  });

  it("AE67 expiry is exclusive: invalid at now >= limit, valid 1 ms earlier", async () => {
    // (a) browser row issued at T
    const d = mkBrowser();
    at(T0 + 604_800_000 - 1);
    expect((await get(a, d.token)).statusCode).toBe(200);
    at(T0 + 604_800_000);
    const ea = await get(a, d.token);
    expect(ea.statusCode).toBe(401);
    expect(body(ea).code).toBe("bearer_expired");
    // (b) ceiling-capped row
    await seeded([{ token: "cap", pairedAt: T0, expiresAt: T0 + 2_592_000_000 }]);
    at(T0 + 2_592_000_000 - 1);
    expect((await get(a, "cap")).statusCode).toBe(200);
    at(T0 + 2_592_000_000);
    const eb = await get(a, "cap");
    expect(eb.statusCode).toBe(401);
    expect(body(eb).code).toBe("bearer_expired");
    // (c) the old bearer's grace ends at rotation + 60 s
    await seeded([{ token: "A", pairedAt: T0, expiresAt: T0 + 7 * DAY_MS }]);
    at(T0);
    await rotate(a, "A");
    at(T0 + 60_000 - 1);
    expect((await get(a, "A")).statusCode).toBe(200);
    at(T0 + 60_000);
    const ec = await get(a, "A");
    expect(ec.statusCode).toBe(401);
    expect(body(ec).code).toBeUndefined();
  });

  it("AE68 only the immediately previous bearer has a grace (A→B→C)", async () => {
    const d = mkBrowser();
    const A = d.token;
    const B = body(await rotate(a, A)).token as string;
    at(T0 + 10_000);
    const C = body(await rotate(a, B)).token as string;
    at(T0 + 11_000);
    const ra = await get(a, A);
    expect(ra.statusCode).toBe(401);
    expect(body(ra).code).toBeUndefined();
    expect((await rotate(a, A)).statusCode).toBe(401);
    expect((await get(a, B)).statusCode).toBe(200);
    expect((await get(a, C)).statusCode).toBe(200);
    at(T0 + 69_000);
    expect((await get(a, B)).statusCode).toBe(200);
    expect((await get(a, C)).statusCode).toBe(200);
    at(T0 + 71_000);
    expect((await get(a, B)).statusCode).toBe(401);
    expect((await get(a, C)).statusCode).toBe(200);
    const row = fileRows()[0];
    expect(Object.keys(row).filter((k) => k === "previousHash")).toHaveLength(1);
    expect(row.previousHash).toBe(crypto.createHash("sha256").update(B).digest("hex"));
  });

  it("AE69 a superseded bearer after the grace is a plain 401 everywhere, byte-equal to a never-issued one", async () => {
    const d = mkBrowser();
    await rotate(a, d.token);
    at(T0 + 61_000);
    const before = a.bytes();
    const calls: Array<[string, string]> = [
      ["GET", "/api/sessions"],
      ["POST", "/api/ws-ticket"],
      ["POST", "/api/device-session"],
      ["POST", "/api/paired-devices/rotate"],
    ];
    for (const [method, url] of calls) {
      const send = (t: string) =>
        a.app.inject({ method: method as "GET" | "POST", url, remoteAddress: REMOTE, headers: bearer(t) });
      const old = await send(d.token);
      const never = await send("never-issued-bearer");
      expect(old.statusCode).toBe(401);
      expect(body(old).code).toBeUndefined();
      expect(old.body).toBe(never.body);
    }
    expect(a.bytes()).toBe(before);
  });

  it("AE70 only exact holder:browser declares — rotate of a legacy row and pairing redeem", async () => {
    const values: unknown[] = ["browser", "desktop", true, "BROWSER", ["browser"], " browser", null, undefined];
    for (const holder of values) {
      const exact = holder === "browser";
      // rotate against a legacy non-expiring row
      await seeded([{ token: "legacy" }]);
      const res = await rotate(a, "legacy", holder === undefined ? {} : { holder });
      expect([200, 409]).toContain(res.statusCode);
      expect(res.statusCode).toBe(exact ? 200 : 409);
      if (exact) expect(typeof body(res).expiresAt).toBe("number");
      else expect(body(res).code).toBe("holder_declaration_required");
      // pairing redeem → approve
      const mgr = new PairingManager({
        registry: a.reg,
        getFingerprint: () => "fp",
        getReachableUrls: () => ["https://a.example"],
      });
      const p = mgr.createPayload()!;
      const r = mgr.redeem(p.code, { holder });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(mgr.approve(p.code, r.confirmCode).ok).toBe(true);
      const polled = mgr.poll(r.pendingId);
      expect(polled.status).toBe("approved");
      const row = fileRows().find((x) => x.label === "device");
      if (exact) expect(typeof row?.expiresAt).toBe("number");
      else expect(row && "expiresAt" in row).toBe(false);
    }
  });

  it("AE71 an expired bearer is judged even from loopback / trusted-network / remote peers", async () => {
    for (const open of ["loopback", "all"] as const) {
      await a.close();
      a = await mkRotationApp({ open });
      at(T0);
      const d = mkBrowser();
      at(T0 + 604_801_000);
      const peers = open === "loopback" ? [LOOPBACK, REMOTE] : [REMOTE, "10.1.2.3"];
      for (const peer of peers) {
        const res = await get(a, d.token, peer);
        expect(res.statusCode).toBe(401);
        expect(body(res).code).toBe("bearer_expired");
      }
      // control: no bearer from an admitted peer still passes as before
      expect((await get(a, null, open === "loopback" ? LOOPBACK : "10.1.2.3")).statusCode).toBe(200);
      at(T0);
    }
  });

  it("AE73 the grace never outlives the old bearer's own expiry", async () => {
    const R = T0;
    await seeded([{ token: "A", pairedAt: R - DAY_MS, expiresAt: R + 30_000 }]);
    at(R);
    const B = body(await rotate(a, "A")).token as string;
    at(R + 29_000);
    expect((await get(a, "A")).statusCode).toBe(200);
    at(R + 30_000);
    expect((await get(a, "A")).statusCode).toBe(401);
    at(R + 59_000);
    expect((await get(a, "A")).statusCode).toBe(401);
    expect((await get(a, B)).statusCode).toBe(200);
  });

  it("AX1 a grace-window bearer cannot rotate again: 409 bearer_superseded, nothing changes", async () => {
    const d = mkBrowser();
    const B = body(await rotate(a, d.token)).token as string;
    at(T0 + 10_000);
    const before = await settledBytes(a, B);
    const res = await rotate(a, d.token);
    expect(res.statusCode).toBe(409);
    expect(body(res).code).toBe("bearer_superseded");
    expect(body(res).token).toBeUndefined();
    expect(a.bytes()).toBe(before);
    expect((await get(a, B)).statusCode).toBe(200);
    expect((await get(a, d.token)).statusCode).toBe(200);
    at(T0 + 61_000);
    expect((await get(a, d.token)).statusCode).toBe(401);
  });

  it("AX2 an expired bearer cannot rotate", async () => {
    const d = mkBrowser();
    // The only permitted change is the first-exposure mark: the request is plain HTTP (prove-vault-bridge-tls D4).
    const rowsNoExposure = (bytes: string) => JSON.parse(bytes).map(({ exposure: _e, ...r }: Record<string, unknown>) => r);
    const before = rowsNoExposure(a.bytes());
    at(T0 + 604_801_000);
    const res = await rotate(a, d.token);
    expect(res.statusCode).toBe(401);
    expect(body(res).code).toBe("bearer_expired");
    expect(body(res).token).toBeUndefined();
    expect(rowsNoExposure(a.bytes())).toEqual(before);
  });

  it("AX3 a revoked bearer cannot rotate and no row is recreated", async () => {
    const d = mkBrowser();
    a.reg.revoke(d.device.id);
    const before = a.bytes();
    const res = await rotate(a, d.token);
    expect(res.statusCode).toBe(401);
    expect(body(res).code).not.toBe("bearer_expired");
    expect(body(res).token).toBeUndefined();
    expect(a.bytes()).toBe(before);
    expect(fileRows()).toHaveLength(0);
  });

  it("AX4 two same-tick rotations with one bearer: exactly one 200 and one 409", async () => {
    const d = mkBrowser();
    const [r1, r2] = await Promise.all([rotate(a, d.token), rotate(a, d.token)]);
    const codes = [r1.statusCode, r2.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    const ok = r1.statusCode === 200 ? r1 : r2;
    const lost = r1.statusCode === 200 ? r2 : r1;
    expect(body(lost).code).toBe("bearer_superseded");
    const row = fileRows()[0];
    const h = (t: string) => crypto.createHash("sha256").update(t).digest("hex");
    expect(row.tokenHash).toBe(h(body(ok).token as string));
    expect(row.previousHash).toBe(h(d.token));
  });

  it.each(["EACCES", "ENOSPC"] as const)("AX13 a %s persist fault → 500 rotation_failed, state unchanged; recovers after the fault clears", async (code) => {
    const d = mkBrowser();
    const before = await settledBytes(a, d.token);
    const spy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
      throw Object.assign(new Error(code), { code });
    });
    try {
      const res = await rotate(a, d.token);
      expect(res.statusCode).toBe(500);
      expect(body(res).code).toBe("rotation_failed");
      expect(body(res).token).toBeUndefined();
      expect((await get(a, d.token)).statusCode).toBe(200);
    } finally {
      spy.mockRestore();
    }
    expect(a.bytes()).toBe(before);
    const ok = await rotate(a, d.token);
    expect(ok.statusCode).toBe(200);
    expect(body(ok).token).not.toBe(d.token);
  });
});

// ── prove-vault-bridge-tls: exposure record per channel (test-plan #E4) + TLS-only refusal (#E8) ──

describe("bearer exposure by channel", () => {
  const LOCAL_TOKEN = "exposure-token-0123456789abcdefghijklmnopqrstuvwxyz";
  let expApp: FastifyInstance;
  let expPort: number;
  let expReg: PairedDeviceRegistry;
  let lines: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    expReg = new PairedDeviceRegistry(path.join(tmpDir, "exposure.json"));
    expApp = Fastify();
    simulateTlsSocket(expApp);
    const verifier = createLocalCredentialVerifier({ token: LOCAL_TOKEN, acceptLegacyToken: true, log: () => {} });
    expApp.addHook("onRequest", async (request) => {
      verifier.stamp(request.raw, { kind: "http", boundAt: Date.now() - 1000 });
    });
    expApp.decorateRequest("isAuthenticated", false);
    registerBearerAuth(expApp, { registry: expReg });
    expApp.post("/api/ws-ticket", async () => ({ ok: true }));
    await expApp.listen({ port: 0, host: "127.0.0.1" });
    expPort = (expApp.server.address() as { port: number }).port;
    lines = [];
    logSpy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      lines.push(a.join(" "));
    });
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await expApp.close();
  });

  const post = (bearerToken: string, extra: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${expPort}/api/ws-ticket`, {
      method: "POST",
      headers: { authorization: `Bearer ${bearerToken}`, ...extra },
    });

  const fresh = () => expReg.add("dev", "manual", "operate", undefined, { channel: "tls" });

  it("E4 marks exposure for forwarded-TLS, plain, bare-loopback and legacy-token rows; not for proven TLS or a local proof", async () => {
    // A proof is good for exactly one request: minted fresh per row.
    const proofHeaders = () => httpProofHeaders(LOCAL_TOKEN, `http://127.0.0.1:${expPort}/api/ws-ticket`, "POST");
    const rows: Array<{ name: string; headers: (t: string) => Record<string, string>; exposed: boolean }> = [
      { name: "a: TLS listener, no header", headers: () => ({ [TEST_TLS_HEADER]: "1" }), exposed: false },
      { name: "b: TLS listener + X-Forwarded-For", headers: () => ({ [TEST_TLS_HEADER]: "1", "x-forwarded-for": "198.51.100.7" }), exposed: true },
      { name: "c: plain, remote-looking", headers: () => ({}), exposed: true },
      { name: "d: plain loopback, no proof", headers: () => ({}), exposed: true },
      { name: "e: legacy raw local token", headers: () => ({ "x-pi-local-token": LOCAL_TOKEN }), exposed: true },
      { name: "f: valid local proof", headers: proofHeaders, exposed: false },
    ];
    for (const row of rows) {
      const { device, token: t } = fresh();
      const res = await post(t, row.headers(t));
      expect(res.status, row.name).toBe(200);
      expect(expReg.deviceTrust(device.id), row.name).toBe(row.exposed ? "exposed" : "eligible");
      const mine = lines.filter((l) => l.includes("bearer-exposed") && l.includes(`id=${device.id.slice(0, 8)}`));
      expect(mine, row.name).toHaveLength(row.exposed ? 1 : 0);
      for (const l of lines) {
        expect(l).not.toContain(t);
        expect(l).not.toContain(crypto.createHash("sha256").update(t).digest("hex"));
      }
      if (row.exposed) expect(mine[0]).toContain("channel=plain");
    }
  });

  it("E8 a pi_tls_ bearer off a proven channel is refused 401 with the named cause and the device is marked", async () => {
    const { device, token: t } = expReg.add("bridge", "manual", "operate", undefined, { channel: "tls", purpose: "bridge" });
    const lan = await post(t);
    expect(lan.status).toBe(401);
    expect(await lan.json()).toMatchObject({ error: "tls_only_token_untrusted_channel" });
    expect(expReg.deviceTrust(device.id)).toBe("exposed");

    const { device: d2, token: t2 } = expReg.add("bridge2", "manual", "operate", undefined, { channel: "tls", purpose: "bridge" });
    const forwarded = await post(t2, { "x-forwarded-for": "198.51.100.7" });
    expect(forwarded.status).toBe(401);
    expect(await forwarded.json()).toMatchObject({ error: "tls_only_token_untrusted_channel" });
    expect(expReg.deviceTrust(d2.id)).toBe("exposed");

    const { token: t3 } = expReg.add("bridge3", "manual", "operate", undefined, { channel: "tls", purpose: "bridge" });
    const ok = await post(t3, { [TEST_TLS_HEADER]: "1" });
    expect(ok.status).toBe(200);
  });
});
