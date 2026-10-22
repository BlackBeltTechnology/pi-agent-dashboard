/**
 * E28 (test-plan expand-mcp-tiered-surface) — `GET /api/pair/reachable-urls`.
 *
 * Merges the public URLs the pairing payload already exposes (tunnel +
 * configured public) with this host's loopback + LAN endpoints, deduped, so a
 * `claude mcp add` snippet minted in Settings works from the machine that will
 * run the agent. See change: expand-mcp-tiered-surface (D8).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub the host endpoint enumeration so the assertion is deterministic.
vi.mock("../tunnel/tunnel-endpoints.js", () => ({
  localEndpoints: vi.fn(() => [
    { kind: "local", url: "http://localhost:8000", tls: false },
    { kind: "lan", url: "http://192.168.1.4:8000", tls: false },
  ]),
}));

import { ensureServerIdentity } from "../auth/identity.js";
import { createNetworkGuard } from "../auth/localhost-guard.js";
import { PairedDeviceRegistry } from "../pairing/paired-devices.js";
import { PairingManager } from "../pairing/pairing.js";
import { registerPairingRoutes } from "../routes/pairing-routes.js";

let tmpDir: string;
const openApps: FastifyInstance[] = [];

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-pair-urls-"));
});

afterEach(async () => {
  for (const app of openApps.splice(0)) {
    await app.close();
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function mkApp(getReachableUrls: () => string[]): Promise<FastifyInstance> {
  const app = Fastify();
  openApps.push(app);
  registerPairingRoutes(app, {
    networkGuard: createNetworkGuard([]),
    identity: {} as never,
    pairing: { reachableUrls: getReachableUrls } as never,
    registry: new PairedDeviceRegistry(path.join(tmpDir, "paired.json")),
    hostAdmission: () => ({
      allowedHosts: [],
      publicBaseUrls: [],
      configuredOrigins: [],
      getLiveTunnelOrigins: () => [],
      bindHost: "localhost",
    }),
    getReachableUrls,
    getPort: () => 8000,
  });
  await app.ready();
  return app;
}

describe("E28 — reachable-urls merge", () => {
  it("lists the public tunnel first, then loopback + LAN, deduped", async () => {
    const app = await mkApp(() => ["https://x.share.zrok.io"]);
    const res = await app.inject({
      method: "GET",
      url: "/api/pair/reachable-urls",
      remoteAddress: "127.0.0.1",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([
      "https://x.share.zrok.io",
      "http://localhost:8000",
      "http://192.168.1.4:8000",
    ]);
  });

  it("drops duplicates between the public list and the local list", async () => {
    const app = await mkApp(() => ["https://x.share.zrok.io", "http://localhost:8000"]);
    const res = await app.inject({
      method: "GET",
      url: "/api/pair/reachable-urls",
      remoteAddress: "127.0.0.1",
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as string[];
    expect(data.filter((u) => u === "http://localhost:8000")).toHaveLength(1);
    expect(data).toHaveLength(3);
  });

  it("strips a trailing slash", async () => {
    const app = await mkApp(() => ["https://x.share.zrok.io/"]);
    const res = await app.inject({
      method: "GET",
      url: "/api/pair/reachable-urls",
      remoteAddress: "127.0.0.1",
    });
    expect(res.json().data[0]).toBe("https://x.share.zrok.io");
  });
});

// ════════════════════════════════════════════════════════════════════════
// #E12 — `POST /api/pair/poll` carries the https origins of the reachable list,
// once, on the approved answer only. See change: group-servers-by-identity (D7).
// ════════════════════════════════════════════════════════════════════════
describe("#E12 poll routes", () => {
  const managers: PairingManager[] = [];
  const ZROK = "https://k3x9p2.share.zrok.io";
  const MIXED = [ZROK, "wss://k3x9p2.share.zrok.io", "http://127.0.0.1:8000", `${ZROK}/`];

  afterEach(() => {
    for (const m of managers.splice(0)) m.dispose();
    delete process.env.PI_E2E_SEED;
  });

  async function mkRealApp(reachable: string[]) {
    const registry = new PairedDeviceRegistry(path.join(tmpDir, "paired.json"));
    const mgr = new PairingManager({ registry, getFingerprint: () => "sha256:test-fp", getReachableUrls: () => reachable });
    managers.push(mgr);
    const app = Fastify();
    openApps.push(app);
    registerPairingRoutes(app, {
      networkGuard: createNetworkGuard([]),
      identity: ensureServerIdentity(path.join(tmpDir, "identity.key")),
      pairing: mgr,
      registry,
      hostAdmission: () => ({
        allowedHosts: [],
        publicBaseUrls: [],
        configuredOrigins: [],
        getLiveTunnelOrigins: () => [],
        bindHost: "localhost",
      }),
      getReachableUrls: () => mgr.reachableUrls(),
      getPort: () => 8000,
    });
    await app.ready();
    return { app, mgr };
  }

  const pend = (mgr: PairingManager) => {
    const payload = mgr.createPayload()!;
    const r = mgr.redeem(payload.code);
    if (!r.ok) throw new Error("redeem failed");
    return { payload, pendingId: r.pendingId, confirmCode: r.confirmCode };
  };
  const poll = async (app: FastifyInstance, pendingId: string) =>
    (await app.inject({ method: "POST", url: "/api/pair/poll", payload: { pendingId } })).json();

  it("approved answer carries only the https origin, with the token, exactly once", async () => {
    process.env.PI_E2E_SEED = "1"; // admits the loopback http origin into reachableUrls
    const { app, mgr } = await mkRealApp(MIXED);
    const d = pend(mgr);
    // the QR payload keeps wss and the loopback seed: routes is a route-layer filter only
    expect(d.payload.urls).toEqual(expect.arrayContaining([ZROK, "wss://k3x9p2.share.zrok.io", "http://127.0.0.1:8000"]));
    expect(mgr.approvePending(d.pendingId, d.confirmCode).ok).toBe(true);

    const first = await poll(app, d.pendingId);
    expect(first.success).toBe(true);
    expect(first.data).toEqual({ status: "approved", token: expect.any(String), routes: [ZROK] });

    const second = await poll(app, d.pendingId);
    expect(second.data).toEqual({ status: "unknown" });
    expect("routes" in second.data).toBe(false);
    expect("token" in second.data).toBe(false);
  });

  it("a plain-http-only server answers an empty routes list", async () => {
    const { app, mgr } = await mkRealApp(["http://192.168.16.9:8000"]);
    // no reachable https url: mint the pending slot by knock (createPayload needs one)
    const k = mgr.knock({ sourceKey: "192.168.16.50", unencrypted: true, meta: {} });
    if (!k.ok) throw new Error("knock failed");
    expect(mgr.approvePending(k.pendingId, k.confirmCode).ok).toBe(true);
    expect((await poll(app, k.pendingId)).data).toEqual({ status: "approved", token: expect.any(String), routes: [] });
  });

  it("pending, rejected and unknown answers carry no routes key", async () => {
    const { app, mgr } = await mkRealApp(MIXED);
    const pending = pend(mgr);
    const pendingAnswer = (await poll(app, pending.pendingId)).data;
    expect(pendingAnswer).toEqual({ status: "pending" });

    const denied = pend(mgr);
    expect(mgr.deny(denied.pendingId)).toEqual({ ok: true });
    expect((await poll(app, denied.pendingId)).data).toEqual({ status: "rejected" });

    expect((await poll(app, "no-such-pending")).data).toEqual({ status: "unknown" });
  });

  it("/api/pair/challenge answers no routes", async () => {
    const { app } = await mkRealApp(MIXED);
    const res = await app.inject({ method: "POST", url: "/api/pair/challenge", payload: { nonce: "0123456789abcdef" } });
    expect(res.statusCode).toBe(200);
    expect("routes" in res.json().data).toBe(false);
    expect(JSON.stringify(res.json())).not.toContain("zrok");
  });

  it("normalises each https url to its origin and de-duplicates", async () => {
    const { app, mgr } = await mkRealApp([`${ZROK}/`, ZROK, "https://b0x7.share.zrok.io:8443/some/path"]);
    const d = pend(mgr);
    mgr.approvePending(d.pendingId, d.confirmCode);
    expect((await poll(app, d.pendingId)).data.routes).toEqual([ZROK, "https://b0x7.share.zrok.io:8443"]);
  });
});
