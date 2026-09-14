import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolvePublicBaseUrls } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerBearerAuth } from "../auth/bearer-auth.js";
import { createNetworkGuard } from "../auth/localhost-guard.js";
import { PairedDeviceRegistry } from "../pairing/paired-devices.js";
import { PAIRING_PROTOCOL_VERSION, PairingManager } from "../pairing/pairing.js";
import { MAX_DEVICE_LABEL_BYTES, registerPairingRoutes } from "../routes/pairing-routes.js";

let tmpDir: string;
let clock: number;
let urls: string[];

function mkManager(): { mgr: PairingManager; reg: PairedDeviceRegistry } {
  const reg = new PairedDeviceRegistry(path.join(tmpDir, "paired.json"));
  const mgr = new PairingManager({
    registry: reg,
    getFingerprint: () => "sha256:test-fp",
    getReachableUrls: () => urls,
    now: () => clock,
  });
  return { mgr, reg };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-pairing-"));
  clock = 1_000_000;
  urls = ["https://abc.share.zrok.io", "https://pi.example.com/"];
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("payload + reachable URLs (D14)", () => {
  it("emits only secure origins, deduped, trailing slash stripped", () => {
    urls = ["https://a.io/", "http://insecure.lan:8000", "https://a.io", "wss://b.io"];
    const { mgr } = mkManager();
    const payload = mgr.createPayload();
    expect(payload).not.toBeNull();
    expect(payload!.urls).toEqual(["https://a.io", "wss://b.io"]);
    expect(payload!.id).toBe("sha256:test-fp");
    expect(payload!.v).toBe(PAIRING_PROTOCOL_VERSION);
  });

  it("NEVER admits a loopback http origin without PI_E2E_SEED (D14 intact)", () => {
    const prev = process.env.PI_E2E_SEED;
    delete process.env.PI_E2E_SEED;
    try {
      urls = ["http://localhost:18000", "http://127.0.0.1:8000", "http://evil.lan"];
      const { mgr } = mkManager();
      expect(mgr.reachableUrls()).toEqual([]);
      expect(mgr.createPayload()).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.PI_E2E_SEED;
      else process.env.PI_E2E_SEED = prev;
    }
  });

  it("admits ONLY loopback http (not other http) under PI_E2E_SEED (e2e harness)", () => {
    const prev = process.env.PI_E2E_SEED;
    process.env.PI_E2E_SEED = "1";
    try {
      urls = ["http://localhost:18000/", "http://127.0.0.1:8000", "http://evil.lan:8000", "https://a.io"];
      const { mgr } = mkManager();
      expect(mgr.reachableUrls()).toEqual([
        "http://localhost:18000",
        "http://127.0.0.1:8000",
        "https://a.io",
      ]);
    } finally {
      if (prev === undefined) delete process.env.PI_E2E_SEED;
      else process.env.PI_E2E_SEED = prev;
    }
  });

  it("returns null when no secure endpoint exists (empty-state)", () => {
    urls = ["http://192.168.1.5:8000"];
    const { mgr } = mkManager();
    expect(mgr.createPayload()).toBeNull();
  });
});

describe("one-time code TTL", () => {
  it("rejects an expired code on redeem", () => {
    const { mgr } = mkManager();
    const p = mgr.createPayload()!;
    clock += 61_000;
    expect(mgr.redeem(p.code)).toEqual({ ok: false, error: "expired" });
  });

  it("rejects an unknown code", () => {
    const { mgr } = mkManager();
    expect(mgr.redeem("nope")).toEqual({ ok: false, error: "invalid_code" });
  });

  it("restarts the approval window on redeem so a late scan still has time to approve", () => {
    const { mgr } = mkManager();
    const p = mgr.createPayload()!; // expiresAt = mint + 60s
    // Phone scans 55s later — 5s before the original code TTL would lapse.
    clock += 55_000;
    const r = mgr.redeem(p.code);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 30s after redeem — PAST the original mint window, but the redeem restarted it.
    clock += 30_000;
    // The pending device must still be visible (not swept to "unknown")...
    expect(mgr.poll(r.pendingId).status).toBe("pending");
    // ...and the operator can still type+approve.
    expect(mgr.approve(p.code, r.confirmCode).ok).toBe(true);
  });
});

describe("D12 compare-code approval", () => {
  it("premature redemption does NOT lock out the legitimate device", () => {
    const { mgr } = mkManager();
    const p = mgr.createPayload()!;
    // Attacker redeems first.
    const attacker = mgr.redeem(p.code);
    expect(attacker.ok).toBe(true);
    // Legitimate device redeems → overwrites the single pending slot, still ok.
    const legit = mgr.redeem(p.code);
    expect(legit.ok).toBe(true);
    if (legit.ok && attacker.ok) {
      expect(legit.pendingId).not.toBe(attacker.pendingId);
    }
  });

  it("approves only on matching typed confirm code, then mints a token", () => {
    const { mgr, reg } = mkManager();
    const p = mgr.createPayload()!;
    const r = mgr.redeem(p.code);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // Wrong code → mismatch, no token.
    expect(mgr.approve(p.code, "00000000")).toEqual({ ok: false, error: "mismatch" });
    // Right code → device recorded + token issued.
    const ok = mgr.approve(p.code, r.confirmCode, "My iPhone");
    expect(ok.ok).toBe(true);
    expect(reg.list().some((d) => d.label === "My iPhone")).toBe(true);

    // Device polls and collects its token exactly once.
    const poll = mgr.poll(r.pendingId);
    expect(poll.status).toBe("approved");
    if (poll.status === "approved") {
      expect(reg.verify(poll.token)).not.toBe(null);
    }
    // Second poll → code consumed, unknown.
    expect(mgr.poll(r.pendingId).status).toBe("unknown");
  });

  it("rejects approval of an expired code even without an intervening sweep", () => {
    const { mgr } = mkManager();
    const p = mgr.createPayload()!;
    const r = mgr.redeem(p.code); // restarts expiresAt to now + 60s
    if (!r.ok) throw new Error("redeem failed");
    // Let the restarted window lapse with NO poll()/createPayload() sweep between.
    clock += 61_000;
    expect(mgr.approve(p.code, r.confirmCode)).toEqual({ ok: false, error: "expired" });
  });

  it("locks out after repeated wrong confirm codes", () => {
    const { mgr } = mkManager();
    const p = mgr.createPayload()!;
    const r = mgr.redeem(p.code);
    if (!r.ok) throw new Error("redeem failed");
    for (let i = 0; i < 5; i++) mgr.approve(p.code, "11111111");
    expect(mgr.approve(p.code, r.confirmCode)).toEqual({ ok: false, error: "locked_out" });
  });

  it("code is consumed only on approval (redemption alone leaves it usable)", () => {
    const { mgr } = mkManager();
    const p = mgr.createPayload()!;
    mgr.redeem(p.code);
    // Still redeemable after a bare redemption.
    expect(mgr.redeem(p.code).ok).toBe(true);
    const r = mgr.redeem(p.code);
    if (!r.ok) throw new Error("redeem failed");
    mgr.approve(p.code, r.confirmCode);
    // After approval the pairing code no longer starts a new pending flow.
    const after = mgr.redeem(p.code);
    expect(after.ok).toBe(false);
  });

  it("rate-limits redemption floods (bounded pending)", () => {
    const { mgr } = mkManager();
    const p = mgr.createPayload()!;
    let lastOk = true;
    for (let i = 0; i < 12; i++) lastOk = mgr.redeem(p.code).ok;
    expect(lastOk).toBe(false); // hit MAX_REDEEM_ATTEMPTS
  });
});

// G7 / D8 — the `publicBaseUrls` promotion moves the KEY, not the TLS gate.
// The list is shared with the endpoint surfaces, so a plain-http entry is a
// legitimate member of it; `reachableUrls()` is what must keep it out of the
// payload. The fixture is deliberately NON-loopback: a `http://localhost`
// entry would pass through the PI_E2E_SEED exception even with the gate broken.
// See change: config-override-oauth-redirect-base.
describe("G7: promoted publicBaseUrls stay behind the read-time TLS gate", () => {
  it("a non-loopback http entry in the promoted list never reaches the payload", () => {
    const config = { publicBaseUrls: ["http://192.168.1.9:8000", "https://pi.example.com"] };
    urls = resolvePublicBaseUrls(config);
    const { mgr } = mkManager();
    expect(mgr.reachableUrls()).toEqual(["https://pi.example.com"]);
    expect(mgr.createPayload()!.urls).not.toContain("http://192.168.1.9:8000");
  });

  it("the same gate applies to a legacy-sourced list", () => {
    const config = { pairing: { publicBaseUrls: ["http://192.168.1.9:8000"] } };
    urls = resolvePublicBaseUrls(config);
    const { mgr } = mkManager();
    expect(mgr.reachableUrls()).toEqual([]);
  });
});

// ── Direct device-token issuance (test-plan E13/E16/X4–X9) ────────────────
// POST /api/paired-devices — the operator-gated mint route
// (change: mcp-legacy-clients-and-token-issuance, D4/D5). The pairing
// identity/manager are not exercised by these routes, so they are stubs.

async function mkRouteApp(
  opts: { trusted?: string[]; localToken?: string; deviceBearer?: boolean } = {},
): Promise<{ app: FastifyInstance; reg: PairedDeviceRegistry }> {
  const reg = new PairedDeviceRegistry(path.join(tmpDir, "paired.json"));
  const app = Fastify();
  openApps.push(app);
  const deps = {
    networkGuard: createNetworkGuard(opts.trusted ?? [], { localToken: opts.localToken }),
    identity: {} as never,
    pairing: {} as never,
    registry: reg,
    localToken: opts.localToken,
    hostAdmission: () => ({
      allowedHosts: [],
      publicBaseUrls: [],
      configuredOrigins: [],
      getLiveTunnelOrigins: () => [],
      bindHost: "localhost",
    }),
  };
  if (opts.deviceBearer) {
    registerBearerAuth(app, { registry: reg });
  }
  registerPairingRoutes(app, deps);
  await app.ready();
  return { app, reg };
}

const openApps: FastifyInstance[] = [];

const loopbackMint = (app: FastifyInstance, body: unknown, extra: Record<string, unknown> = {}) =>
  app.inject({
    method: "POST",
    url: "/api/paired-devices",
    remoteAddress: "127.0.0.1",
    headers: { "content-type": "application/json", ...extra },
    payload: body as { label?: unknown },
  });

function registryRowCount(regPath: string): number {
  try {
    return (JSON.parse(fs.readFileSync(regPath, "utf-8")) as unknown[]).length;
  } catch {
    return 0;
  }
}

describe("E13 — mint label BVA", () => {
  it.each([
    ["empty string", "", 400],
    ["whitespace only", " ", 400],
    ["one char", "a", 200],
    ["64 ascii chars", "x".repeat(64), 200],
    ["65 ascii chars", "x".repeat(65), 400],
    ["32 two-byte chars (64 bytes)", "é".repeat(32), 200],
    ["33 two-byte chars (66 bytes)", "é".repeat(33), 400],
    ["a number", 123, 400],
    ["absent", undefined, 400],
  ])("%s", async (_label, value, want) => {
    const regPath = path.join(tmpDir, "paired.json");
    const { app, reg } = await mkRouteApp();
    const before = registryRowCount(regPath);
    const res = await loopbackMint(app, { label: value });
    expect(res.statusCode).toBe(want);
    // No registry row may be created by a refused label.
    expect(registryRowCount(regPath)).toBe(want === 200 ? before + 1 : before);
    expect(reg.list()).toHaveLength(want === 200 ? before + 1 : before);
  });

  it("a valid mint trims the label and returns a ≥32-char token with source manual", async () => {
    const regPath = path.join(tmpDir, "paired.json");
    const { app, reg } = await mkRouteApp();
    const res = await loopbackMint(app, { label: "  claude-code  " });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.token.length).toBeGreaterThanOrEqual(32);
    expect(data.device.label).toBe("claude-code");
    expect(data.device.source).toBe("manual");
    expect(reg.list()[0].label).toBe("claude-code");
    expect(MAX_DEVICE_LABEL_BYTES).toBe(64);
  });
});

describe("E16 — mint response envelope", () => {
  it("returns the plaintext once; the listing never carries token material", async () => {
    const { app, reg } = await mkRouteApp();
    const mint = await loopbackMint(app, { label: "cli" });
    expect(mint.statusCode).toBe(200);
    const body = mint.json();
    expect(Object.keys(body)).toEqual(["success", "data"]);
    expect(Object.keys(body.data)).toEqual(["device", "token"]);
    expect(Object.keys(body.data.device).sort()).toEqual(
      ["createdAt", "id", "label", "lastSeen", "source"].sort(),
    );
    expect(body.data.device).not.toHaveProperty("tokenHash");

    const list = await app.inject({ method: "GET", url: "/api/paired-devices" });
    expect(list.statusCode).toBe(200);
    const row = list.json().data.find((d: { id: string }) => d.id === body.data.device.id);
    expect(row).toBeTruthy();
    expect(row).not.toHaveProperty("token");
    expect(row).not.toHaveProperty("tokenHash");
  });
});

describe("X4 — a paired device cannot clone itself", () => {
  it("a device bearer alone is refused 401 with no registry row", async () => {
    const regPath = path.join(tmpDir, "paired.json");
    const { app, reg } = await mkRouteApp({ deviceBearer: true });
    const phone = reg.add("phone");
    const before = registryRowCount(regPath);
    const res = await app.inject({
      method: "POST",
      url: "/api/paired-devices",
      remoteAddress: "127.0.0.1",
      headers: { authorization: `Bearer ${phone.token}`, "x-forwarded-for": "203.0.113.9" },
      payload: { label: "clone" },
    });
    expect(res.statusCode).toBe(401);
    expect(registryRowCount(regPath)).toBe(before);
  });
});

describe("X5 — trusted network alone cannot mint", () => {
  it("401 on mint; the sibling GET still admits the same address", async () => {
    const { app } = await mkRouteApp({ trusted: ["10.0.0.0/8"] });
    const mint = await app.inject({
      method: "POST",
      url: "/api/paired-devices",
      remoteAddress: "10.1.2.3",
      payload: { label: "remote" },
    });
    expect(mint.statusCode).toBe(401);

    const list = await app.inject({ method: "GET", url: "/api/paired-devices", remoteAddress: "10.1.2.3" });
    expect(list.statusCode).toBe(200);
  });
});

describe("X6 — unadmitted Host refused even in report mode", () => {
  it("403 on mint; the global gate stays report-only for the sibling GET", async () => {
    const { app } = await mkRouteApp();
    const attackerHeaders = {
      host: "attacker.example:8000",
      origin: "http://attacker.example:8000",
    };
    const mint = await loopbackMint(app, { label: "rebind" }, attackerHeaders);
    expect(mint.statusCode).toBe(403);

    const list = await app.inject({
      method: "GET",
      url: "/api/paired-devices",
      remoteAddress: "127.0.0.1",
      headers: attackerHeaders,
    });
    expect(list.statusCode).toBe(200);
  });
});

describe("X7 — a local browser mints with authentication enabled", () => {
  it("loopback, no cookie, auth on → 200 with a token", async () => {
    const reg = new PairedDeviceRegistry(path.join(tmpDir, "paired.json"));
    const app = Fastify();
    openApps.push(app);
    const { registerAuthPlugin } = await import("../auth/auth-plugin.js");
    await registerAuthPlugin(app, {
      authConfig: {
        secret: "test-secret-32-chars-long-abcdef",
        providers: { github: { clientId: "cid", clientSecret: "csecret" } },
      },
      port: 8000,
    });
    registerPairingRoutes(app, {
      networkGuard: createNetworkGuard([]),
      identity: {} as never,
      pairing: {} as never,
      registry: reg,
      hostAdmission: () => ({
        allowedHosts: [],
        publicBaseUrls: [],
        configuredOrigins: [],
        getLiveTunnelOrigins: () => [],
        bindHost: "localhost",
      }),
    });
    await app.ready();

    const res = await app.inject({
      method: "POST",
      url: "/api/paired-devices",
      remoteAddress: "127.0.0.1",
      headers: { host: "localhost:8000" },
      payload: { label: "lb" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.token.length).toBeGreaterThanOrEqual(32);
  });
});

describe("X8 — a local token mints from a non-loopback address", () => {
  it("valid X-Pi-Local-Token → 200 with a token", async () => {
    const { app } = await mkRouteApp({ localToken: "local-secret-token" });
    const res = await app.inject({
      method: "POST",
      url: "/api/paired-devices",
      remoteAddress: "203.0.113.9",
      headers: { "x-pi-local-token": "local-secret-token", "x-forwarded-for": "203.0.113.9" },
      payload: { label: "cli" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.token.length).toBeGreaterThanOrEqual(32);
  });
});

describe("X9 — the mint route is not a public pairing prefix", () => {
  it("a remote unauthenticated request is 401, not admitted via any pairing path", async () => {
    const { app } = await mkRouteApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/paired-devices",
      remoteAddress: "203.0.113.9",
      payload: { label: "outsider" },
    });
    expect(res.statusCode).toBe(401);
  });
});
