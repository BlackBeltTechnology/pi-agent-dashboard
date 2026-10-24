import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import type { DiscoveredServer } from "@blackbelt-technology/pi-dashboard-shared/mdns-discovery.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeConfigPartial } from "../config-api.js";

describe("known-servers CRUD", () => {
  let testDir: string;
  let configFile: string;
  let origHome: string;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `test-known-servers-${Date.now()}`);
    fs.mkdirSync(path.join(testDir, ".pi", "dashboard"), { recursive: true });
    configFile = path.join(testDir, ".pi", "dashboard", "config.json");
    fs.writeFileSync(configFile, JSON.stringify({}));
    origHome = process.env.HOME!;
    process.env.HOME = testDir;
  });

  afterEach(() => {
    process.env.HOME = origHome;
    if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true });
  });

  it("should default to empty knownServers", () => {
    const config = loadConfig();
    expect(config.knownServers).toEqual([]);
  });

  it("should add a known server", () => {
    const server = { host: "office-mac", port: 8000, label: "Office", addedAt: new Date().toISOString() };
    writeConfigPartial({ knownServers: [server] });
    const config = loadConfig();
    expect(config.knownServers).toHaveLength(1);
    expect(config.knownServers[0].host).toBe("office-mac");
    expect(config.knownServers[0].port).toBe(8000);
    expect(config.knownServers[0].label).toBe("Office");
  });

  it("should update label on duplicate host:port", () => {
    const servers = [
      { host: "office-mac", port: 8000, label: "Old Label", addedAt: new Date().toISOString() },
    ];
    writeConfigPartial({ knownServers: servers });

    // Simulate "add duplicate" by reading, updating, writing
    const config = loadConfig();
    const existing = config.knownServers;
    const idx = existing.findIndex((s) => s.host === "office-mac" && s.port === 8000);
    expect(idx).toBe(0);
    existing[idx] = { ...existing[idx], label: "New Label" };
    writeConfigPartial({ knownServers: existing });

    const updated = loadConfig();
    expect(updated.knownServers).toHaveLength(1);
    expect(updated.knownServers[0].label).toBe("New Label");
  });

  it("should remove a known server", () => {
    const servers = [
      { host: "office-mac", port: 8000, label: "Office", addedAt: new Date().toISOString() },
      { host: "build-server", port: 8000, label: "Build", addedAt: new Date().toISOString() },
    ];
    writeConfigPartial({ knownServers: servers });

    const config = loadConfig();
    const filtered = config.knownServers.filter((s) => !(s.host === "office-mac" && s.port === 8000));
    writeConfigPartial({ knownServers: filtered });

    const updated = loadConfig();
    expect(updated.knownServers).toHaveLength(1);
    expect(updated.knownServers[0].host).toBe("build-server");
  });

  it("should be idempotent when removing non-existent server", () => {
    const servers = [
      { host: "office-mac", port: 8000, label: "Office", addedAt: new Date().toISOString() },
    ];
    writeConfigPartial({ knownServers: servers });

    const config = loadConfig();
    const filtered = config.knownServers.filter((s) => !(s.host === "nonexistent" && s.port === 9999));
    writeConfigPartial({ knownServers: filtered });

    const updated = loadConfig();
    expect(updated.knownServers).toHaveLength(1);
  });

  it("should list known servers from config", () => {
    const servers = [
      { host: "a", port: 8000, addedAt: "2024-01-01T00:00:00Z" },
      { host: "b", port: 9000, label: "B Server", addedAt: "2024-01-02T00:00:00Z" },
    ];
    writeConfigPartial({ knownServers: servers });

    const config = loadConfig();
    expect(config.knownServers).toHaveLength(2);
    expect(config.knownServers[0].host).toBe("a");
    expect(config.knownServers[1].label).toBe("B Server");
  });

  it("should handle entries without label", () => {
    const servers = [{ host: "no-label", port: 8000, addedAt: "2024-01-01T00:00:00Z" }];
    writeConfigPartial({ knownServers: servers });

    const config = loadConfig();
    expect(config.knownServers[0].label).toBeUndefined();
  });

  it("should ignore invalid entries in knownServers", () => {
    // Write raw JSON with invalid entries
    fs.writeFileSync(configFile, JSON.stringify({
      knownServers: [
        { host: "valid", port: 8000, addedAt: "2024-01-01T00:00:00Z" },
        { host: "no-port" }, // missing port
        "invalid-string",
        null,
        { port: 8000 }, // missing host
      ],
    }));

    const config = loadConfig();
    expect(config.knownServers).toHaveLength(1);
    expect(config.knownServers[0].host).toBe("valid");
  });
});

// ════════════════════════════════════════════════════════════════════════
// Identity-pinned known servers: operator-only mutations, probe, backfill,
// accept-move, peer wiring. See change: stabilize-mdns-server-identity
// (test-plan #E13–#E23, #E27–#E29, #P1, #X5, #X6)
// ════════════════════════════════════════════════════════════════════════
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { advertiseDashboard, stopAdvertising } from "@blackbelt-technology/pi-dashboard-shared/mdns-discovery.js";
import { type ProveResult, proveServerIdentity } from "@blackbelt-technology/pi-dashboard-shared/server-pinning.js";
import { Service } from "bonjour-service";
import Fastify, { type FastifyInstance } from "fastify";
import { vi } from "vitest";
import { ensureServerIdentity, signNonce } from "../auth/identity.js";
import { createNetworkGuard } from "../auth/localhost-guard.js";
import type { createKnownServerMoves } from "../known-server-moves.js";
import { PairedDeviceRegistry } from "../pairing/paired-devices.js";
import { PairingManager } from "../pairing/pairing.js";
import { buildSelfServer, wirePeerServers } from "../peer-servers.js";
import { registerKnownServersRoutes } from "../routes/known-servers-routes.js";
import { registerPairingRoutes } from "../routes/pairing-routes.js";
import { stampLegacyHook } from "../test-support/local-credential-stamp.js";

const TOKEN = "ks-local-token";
const T0 = "2026-01-01T00:00:00.000Z";
const F = "sha256:FFFF";
const G = "sha256:GGGG";

interface Ctx {
  app: FastifyInstance;
  prove: ReturnType<typeof vi.fn>;
  fetchImpl: ReturnType<typeof vi.fn>;
  lookup: ReturnType<typeof vi.fn>;
  answers: Record<string, ProveResult | "hang">;
  moves: ReturnType<typeof createKnownServerMoves>;
  suggest: { current?: { host: string; port: number } };
}

describe("known-servers routes (identity pinning)", () => {
  let home: string;
  let origHome: string;
  let ctx: Ctx;
  const apps: FastifyInstance[] = [];

  const entries = () => loadConfig().knownServers;
  const seed = (list: unknown[]) => {
    writeConfigPartial({ knownServers: list as never });
  };

  async function mkCtx(
    opts: {
      moves?: Partial<ReturnType<typeof createKnownServerMoves>>;
      /** Use the real bounded `proveServerIdentity` over `fetchImpl` instead of the `prove` seam. */
      realProve?: boolean;
      fetchImpl?: typeof fetch;
      timeouts?: { challengeMs?: number; dnsMs?: number; httpMs?: number } | null;
      log?: (m: string) => void;
      /** This server's own fingerprint (harden-peer-address-identity). */
      own?: string;
    } = {},
  ): Promise<Ctx> {
    const app = Fastify();
    apps.push(app);
    stampLegacyHook(app, TOKEN);
    app.addHook("onRequest", async (req) => {
      if (req.headers["x-test-device"] === "1") (req as unknown as { authVia: string }).authVia = "device";
    });
    const answers: Record<string, ProveResult | "hang"> = {};
    const prove = vi.fn(async (baseUrl: string): Promise<ProveResult> => {
      // http routes key as `host:port`; https routes keep their scheme (`https://host:port`).
      const a = answers[baseUrl.replace(/^http:\/\//, "")];
      if (a === "hang") return new Promise(() => {});
      return a ?? { refused: "unreachable" };
    });
    const fetchImpl = vi.fn(
      (opts.fetchImpl as never) ?? (async () => new Response(JSON.stringify({ ok: true, pid: 1 }), { status: 200 })),
    );
    const lookup = vi.fn(async () => ({ address: "192.168.16.9", family: 4 }));
    const suggest: Ctx["suggest"] = {};
    const moves = {
      onPeer: async () => {},
      onPeerDown: () => {},
      suggestionFor: () => suggest.current,
      withdraw: vi.fn(),
      ...(opts.moves ?? {}),
    } as unknown as ReturnType<typeof createKnownServerMoves>;
    registerKnownServersRoutes(app, {
      networkGuard: createNetworkGuard(["192.168.16.0/24"]),
      getPeerServers: () => new Map(),
      localToken: TOKEN,
      hostAdmission: () => ({
        allowedHosts: [],
        publicBaseUrls: [],
        configuredOrigins: [],
        getLiveTunnelOrigins: () => [],
        bindHost: "localhost",
      }),
      ...(opts.realProve ? {} : { prove }),
      lookup,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      moves,
      ...(opts.own ? { ownFingerprint: () => opts.own } : {}),
      log: opts.log ?? (() => {}),
      ...(opts.timeouts === null ? {} : { timeouts: opts.timeouts ?? { challengeMs: 100, dnsMs: 100, httpMs: 80 } }),
    });
    await app.ready();
    ctx = { app, prove, fetchImpl, lookup, answers, moves, suggest };
    return ctx;
  }

  const operator = (method: "GET" | "POST" | "DELETE", url: string, payload?: unknown) =>
    ctx.app.inject({
      method,
      url,
      remoteAddress: "192.168.16.60",
      headers: { "x-pi-local-token": TOKEN, ...(payload ? { "content-type": "application/json" } : {}) },
      ...(payload ? { payload: payload as Record<string, unknown> } : {}),
    });
  const trustedPeer = (method: "GET" | "POST" | "DELETE", url: string, payload?: unknown, headers: Record<string, string> = {}) =>
    ctx.app.inject({
      method,
      url,
      remoteAddress: "192.168.16.50",
      headers: { ...(payload ? { "content-type": "application/json" } : {}), ...headers },
      ...(payload ? { payload: payload as Record<string, unknown> } : {}),
    });

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "ks-routes-"));
    fs.mkdirSync(path.join(home, ".pi", "dashboard"), { recursive: true });
    fs.writeFileSync(path.join(home, ".pi", "dashboard", "config.json"), "{}");
    origHome = process.env.HOME!;
    process.env.HOME = home;
  });

  afterEach(async () => {
    for (const a of apps.splice(0)) await a.close();
    process.env.HOME = origHome;
    fs.rmSync(home, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe("E13 add decision table", () => {
    it("pins the proven identity of a new entry", async () => {
      await mkCtx();
      ctx.answers["new.local:8000"] = { proven: F };
      const r = await operator("POST", "/api/known-servers", { host: "new.local", port: 8000, label: "N" });
      expect(r.json()).toEqual({ success: true });
      expect(entries()[0]).toMatchObject({ host: "new.local", port: 8000, label: "N", fingerprint: F });
    });

    it("stores no fingerprint when the challenge fails", async () => {
      await mkCtx();
      await operator("POST", "/api/known-servers", { host: "new.local", port: 8000 });
      expect(entries()[0].fingerprint).toBeUndefined();
    });

    it("keeps an existing pin when the re-add challenge fails", async () => {
      seed([{ host: "a.local", port: 8000, addedAt: T0, fingerprint: F }]);
      await mkCtx();
      await operator("POST", "/api/known-servers", { host: "a.local", port: 8000, label: "L" });
      expect(entries()[0]).toMatchObject({ fingerprint: F, label: "L" });
    });

    it("pins what is proven, never the hint", async () => {
      await mkCtx();
      ctx.answers["new.local:8000"] = { proven: G };
      await operator("POST", "/api/known-servers", { host: "new.local", port: 8000, fingerprint: F });
      expect(entries()[0].fingerprint).toBe(G);
    });

    it("attaches the proven route to the entry holding the identity (no 409 already_known), even while the stored route still proves it", async () => {
      seed([{ host: "old.local", port: 8000, addedAt: T0, fingerprint: F }]);
      await mkCtx();
      ctx.answers["new.local:8000"] = { proven: F };
      ctx.answers["old.local:8000"] = { proven: F };
      const r = await operator("POST", "/api/known-servers", { host: "new.local", port: 8000 });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({ success: true, data: { updated: true } });
      expect(entries()).toHaveLength(1);
      expect(entries()[0].routes.map((x) => `${x.scheme}://${x.host}:${x.port}`)).toEqual(["http://old.local:8000", "http://new.local:8000"]);
      // the holder is no longer re-probed (D6)
      expect(ctx.prove.mock.calls.map(([u]) => u)).toEqual(["http://new.local:8000"]);
    });

    it("attaches even when the stored route no longer proves the identity; stale route kept, label and addedAt rules", async () => {
      seed([{ host: "old.local", port: 8000, label: "Keep", addedAt: T0, fingerprint: F }]);
      await mkCtx();
      ctx.answers["new.local:8000"] = { proven: F };
      let r = await operator("POST", "/api/known-servers", { host: "new.local", port: 8000, label: "" });
      expect(r.json()).toEqual({ success: true, data: { updated: true } });
      expect(entries()).toHaveLength(1);
      expect(entries()[0]).toMatchObject({ host: "old.local", label: "Keep", addedAt: T0, fingerprint: F });
      expect(entries()[0].routes).toHaveLength(2);
      // non-empty label replaces
      seed([{ host: "old.local", port: 8000, label: "Keep", addedAt: T0, fingerprint: F }]);
      r = await operator("POST", "/api/known-servers", { host: "new.local", port: 8000, label: "Fresh" });
      expect(entries()[0].label).toBe("Fresh");
    });

    it("refuses a changed identity at a pinned address (409 identity_changed)", async () => {
      seed([{ host: "a.local", port: 8000, addedAt: T0, fingerprint: F }]);
      await mkCtx();
      ctx.answers["a.local:8000"] = { proven: G };
      const r = await operator("POST", "/api/known-servers", { host: "a.local", port: 8000 });
      expect(r.statusCode).toBe(409);
      expect(r.json()).toMatchObject({ error: "identity_changed", expected: F, proven: G });
      expect(entries()[0].fingerprint).toBe(F);
    });
  });

  // See change: harden-peer-address-identity (test-plan #E11 #E12)
  describe("#E11 self_address: an address that reaches this very dashboard", () => {
    const OWN = "sha256:OWNOWN";

    it("operator add whose address proves this server's own fingerprint ⇒ 409 self_address, nothing stored", async () => {
      await mkCtx({ own: OWN });
      ctx.answers["192.168.64.1:8000"] = { proven: OWN };
      const r = await operator("POST", "/api/known-servers", { host: "192.168.64.1", port: 8000 });
      expect(r.statusCode).toBe(409);
      expect(r.json()).toMatchObject({ success: false, error: "self_address" });
      expect(entries()).toEqual([]);
    });

    it("self_address takes precedence over identity_changed (a pinned entry whose address now answers as this server)", async () => {
      seed([{ host: "192.168.64.1", port: 8000, addedAt: T0, fingerprint: F }]);
      await mkCtx({ own: OWN });
      ctx.answers["192.168.64.1:8000"] = { proven: OWN };
      const r = await operator("POST", "/api/known-servers", { host: "192.168.64.1", port: 8000 });
      expect(r.statusCode).toBe(409);
      expect(r.json().error).toBe("self_address");
      expect(entries()[0].fingerprint).toBe(F);
    });

    it("a non-operator add is refused by the guard and never contacts the target", async () => {
      await mkCtx({ own: OWN });
      ctx.answers["192.168.64.1:8000"] = { proven: OWN };
      const r = await trustedPeer("POST", "/api/known-servers", { host: "192.168.64.1", port: 8000 });
      expect(r.statusCode).toBeGreaterThanOrEqual(401);
      expect(ctx.prove).not.toHaveBeenCalled();
    });

    it("a pinned entry whose address proves a THIRD identity is still identity_changed", async () => {
      seed([{ host: "a.local", port: 8000, addedAt: T0, fingerprint: F }]);
      await mkCtx({ own: OWN });
      ctx.answers["a.local:8000"] = { proven: G };
      const r = await operator("POST", "/api/known-servers", { host: "a.local", port: 8000 });
      expect(r.statusCode).toBe(409);
      expect(r.json()).toMatchObject({ error: "identity_changed", expected: F, proven: G });
    });
  });

  it("#E12 backfill never pins this server's own fingerprint", async () => {
    const OWN = "sha256:OWNOWN";
    seed([{ host: "192.168.64.1", port: 8000, addedAt: T0 }]);
    await mkCtx({ own: OWN });
    ctx.answers["192.168.64.1:8000"] = { proven: OWN };
    await operator("POST", "/api/known-servers/probe", { host: "192.168.64.1", port: 8000 });
    expect(entries()[0].fingerprint).toBeUndefined();
  });

  it("rejects a host that is not a DNS name / IP literal before any outbound challenge", async () => {
    await mkCtx();
    for (const host of ["evil.com#@x", "user@host.local", "a/b", "h.local?x=1", "a b"]) {
      const r = await operator("POST", "/api/known-servers", { host, port: 8000 });
      expect(r.statusCode, host).toBe(400);
      expect(r.json().error).toBe("invalid_host");
    }
    expect(ctx.prove).not.toHaveBeenCalled();
    expect(entries()).toEqual([]);
  });

  describe("E14 non-operator mutations are refused", () => {
    it.each([
      ["trusted-network peer", {} as Record<string, string>],
      ["paired-device bearer", { "x-test-device": "1" }],
    ])("%s cannot add / remove / accept-move / probe", async (_label, headers) => {
      seed([{ host: "a.local", port: 8000, addedAt: T0 }]);
      await mkCtx();
      const before = JSON.stringify(entries());
      const attempts = [
        trustedPeer("POST", "/api/known-servers", { host: "x.local", port: 8000 }, headers),
        trustedPeer("DELETE", "/api/known-servers", { host: "a.local", port: 8000 }, headers),
        trustedPeer("DELETE", "/api/known-servers", { fingerprint: F }, headers),
        trustedPeer("POST", "/api/known-servers/accept-move", { host: "a.local", port: 8000 }, headers),
        trustedPeer("POST", "/api/known-servers/probe", { host: "a.local", port: 8000 }, headers),
      ];
      for (const r of await Promise.all(attempts)) expect([401, 403]).toContain(r.statusCode);
      expect(ctx.prove).not.toHaveBeenCalled();
      expect(ctx.fetchImpl).not.toHaveBeenCalled();
      expect(ctx.lookup).not.toHaveBeenCalled();
      expect(JSON.stringify(entries())).toBe(before);
    });
  });

  it("E15 GET reports canManage per caller with identical entries", async () => {
    seed([{ host: "a.local", port: 8000, addedAt: T0, fingerprint: F }]);
    await mkCtx();
    const plain = (await trustedPeer("GET", "/api/known-servers")).json();
    const op = (await operator("GET", "/api/known-servers")).json();
    expect(plain.canManage).toBe(false);
    expect(op.canManage).toBe(true);
    expect(plain.data).toEqual(op.data);
    expect(op.data[0].fingerprint).toBe(F);
  });

  it("GET carries movedTo when a suggestion exists", async () => {
    seed([{ host: "a.local", port: 8000, addedAt: T0, fingerprint: F }]);
    await mkCtx();
    ctx.suggest.current = { host: "192.168.16.220", port: 8000 };
    const op = (await operator("GET", "/api/known-servers")).json();
    expect(op.data[0].movedTo).toEqual({ host: "192.168.16.220", port: 8000 });
  });

  describe("E16/E17/E18/P1 probe", () => {
    const probe = (host = "a.local", port = 8000) => operator("POST", "/api/known-servers/probe", { host, port });
    const status = async (host?: string, port?: number) => (await probe(host, port)).json().data?.status;

    beforeEach(() => seed([{ host: "a.local", port: 8000, addedAt: T0 }]));

    it("maps lookup failures", async () => {
      await mkCtx();
      ctx.lookup.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "ENOTFOUND" }));
      expect(await status()).toBe("name-not-resolved");
      ctx.lookup.mockImplementationOnce(async () => {
        await new Promise((r) => setTimeout(r, 40));
        throw Object.assign(new Error("x"), { code: "ENOTFOUND" });
      });
      expect(await status()).toBe("name-not-resolved");
      ctx.lookup.mockImplementationOnce(() => new Promise(() => {}));
      expect(await status()).toBe("timeout");
      expect(ctx.fetchImpl).not.toHaveBeenCalled();
    });

    it("maps HTTP outcomes", async () => {
      await mkCtx();
      ctx.fetchImpl.mockRejectedValueOnce(Object.assign(new Error("x"), { cause: { code: "ECONNREFUSED" } }));
      expect(await status()).toBe("refused");
      ctx.fetchImpl.mockImplementationOnce((_u: unknown, init: RequestInit) => new Promise((_res, rej) => {
        init.signal?.addEventListener("abort", () => rej(Object.assign(new Error("t"), { name: "TimeoutError" })));
      }));
      expect(await status()).toBe("timeout");
      expect(await status()).toBe("reachable");
      ctx.fetchImpl.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }));
      expect(await status()).toBe("error");
      expect(ctx.fetchImpl.mock.calls.every(([u]) => !String(u).includes("169.254"))).toBe(true);
      expect(ctx.fetchImpl.mock.calls.every(([, init]) => (init as RequestInit).redirect === "manual")).toBe(true);
      ctx.fetchImpl.mockResolvedValueOnce(new Response("nope", { status: 404 }));
      expect(await status()).toBe("error");
      ctx.fetchImpl.mockResolvedValueOnce(new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }));
      expect(await status()).toBe("error");
    });

    it("E17 refuses a target that is not a persisted entry without contacting it", async () => {
      await mkCtx();
      const r = await probe("10.0.0.1", 22);
      expect(r.statusCode).toBe(403);
      expect(ctx.lookup).not.toHaveBeenCalled();
      expect(ctx.fetchImpl).not.toHaveBeenCalled();
    });

    it("E18 concurrent probes (case / trailing dot) collapse into one outbound request", async () => {
      await mkCtx();
      ctx.lookup.mockImplementation(() => new Promise((r) => setTimeout(() => r({ address: "1.1.1.1" }), 40)));
      const rs = await Promise.all([probe("a.local"), probe("A.LOCAL"), probe("a.local.")]);
      expect(rs.map((r) => r.json().data.status)).toEqual(["reachable", "reachable", "reachable"]);
      expect(ctx.fetchImpl).toHaveBeenCalledTimes(1);
      expect(ctx.lookup).toHaveBeenCalledTimes(1);
    });

    it("P1 a slow lookup plus a hanging HTTP answer stays within dns + http budgets", async () => {
      await mkCtx();
      ctx.lookup.mockImplementationOnce(() => new Promise((r) => setTimeout(() => r({ address: "1.1.1.1" }), 90)));
      ctx.fetchImpl.mockImplementationOnce((_u: unknown, init: RequestInit) => new Promise((_res, rej) => {
        init.signal?.addEventListener("abort", () => rej(Object.assign(new Error("t"), { name: "TimeoutError" })));
      }));
      const t0 = Date.now();
      expect(await status()).toBe("timeout");
      expect(Date.now() - t0).toBeLessThan(100 + 80 + 250);
    });
  });

  describe("E19 backfill", () => {
    it("pins an unpinned reachable entry", async () => {
      seed([{ host: "192.168.16.220", port: 8000, addedAt: T0 }]);
      await mkCtx();
      ctx.answers["192.168.16.220:8000"] = { proven: F };
      await operator("POST", "/api/known-servers/probe", { host: "192.168.16.220", port: 8000 });
      expect(entries()[0].fingerprint).toBe(F);
    });

    it("merges a stale duplicate holder into the verified entry", async () => {
      seed([
        { host: "192.168.16.220", port: 8000, addedAt: T0 },
        { host: "home-imac-75112.local", port: 8000, label: "iMac", addedAt: T0, fingerprint: F },
      ]);
      const logs: string[] = [];
      vi.spyOn(console, "log").mockImplementation((m: string) => void logs.push(String(m)));
      await mkCtx();
      ctx.answers["192.168.16.220:8000"] = { proven: F };
      await operator("POST", "/api/known-servers/probe", { host: "192.168.16.220", port: 8000 });
      expect(entries()).toHaveLength(1);
      expect(entries()[0]).toMatchObject({ host: "192.168.16.220", fingerprint: F, label: "iMac" });
      // the backfilled entry survives and gains the other entry's routes (3.5)
      expect(entries()[0].routes.map((r) => r.host)).toEqual(["192.168.16.220", "home-imac-75112.local"]);
    });
  });

  describe("E23 accept-move", () => {
    const entry = { host: "old.local", port: 8000, label: "iMac", addedAt: T0, fingerprint: F };
    const move = { host: "192.168.16.220", port: 8000 };
    const accept = () => operator("POST", "/api/known-servers/accept-move", { host: "old.local", port: 8000 });

    it("moves the entry when both re-verifications hold, preserving label/fp/addedAt", async () => {
      seed([entry]);
      await mkCtx();
      ctx.suggest.current = move;
      ctx.answers["192.168.16.220:8000"] = { proven: F };
      const logs: string[] = [];
      const log = vi.spyOn(console, "log").mockImplementation((m: string) => void logs.push(String(m)));
      const r = await accept();
      expect(r.json().success).toBe(true);
      expect(entries()[0]).toMatchObject({ ...entry, host: "192.168.16.220" });
      expect(entries()[0].routes).toEqual([{ host: "192.168.16.220", port: 8000, scheme: "http", source: "saved" }]);
      expect(ctx.moves.withdraw).toHaveBeenCalled();
      log.mockRestore();
    });

    it("refuses when the suggested address no longer proves the identity", async () => {
      seed([entry]);
      await mkCtx();
      ctx.suggest.current = move;
      const r = await accept();
      expect(r.statusCode).toBe(409);
      expect(entries()[0].host).toBe("old.local");
    });

    it("refuses when the stored address proves the identity again", async () => {
      seed([entry]);
      await mkCtx();
      ctx.suggest.current = move;
      ctx.answers["old.local:8000"] = { proven: F };
      ctx.answers["192.168.16.220:8000"] = { proven: F };
      const r = await accept();
      expect(r.statusCode).toBe(409);
      expect(entries()[0].host).toBe("old.local");
    });
  });

  describe("X5/X6 write ordering", () => {
    it("X5 an add whose challenge resolves after a DELETE does not recreate the entry", async () => {
      seed([{ host: "a.local", port: 8000, addedAt: T0 }]);
      await mkCtx();
      let release: (r: ProveResult) => void = () => {};
      ctx.prove.mockImplementationOnce(() => new Promise<ProveResult>((res) => (release = res)));
      const add = operator("POST", "/api/known-servers", { host: "a.local", port: 8000, label: "X" });
      await vi.waitFor(() => expect(ctx.prove).toHaveBeenCalled());
      await operator("DELETE", "/api/known-servers", { host: "a.local", port: 8000 });
      release({ proven: F });
      await add;
      expect(entries()).toEqual([]);
    });

    it("X5 accept-move after a DELETE does not recreate the entry", async () => {
      const entry = { host: "old.local", port: 8000, addedAt: T0, fingerprint: F };
      seed([entry]);
      await mkCtx();
      ctx.suggest.current = { host: "192.168.16.220", port: 8000 };
      let release: (r: ProveResult) => void = () => {};
      ctx.prove.mockImplementation((u: string) =>
        u.includes("192.168.16.220") ? new Promise<ProveResult>((res) => (release = res)) : Promise.resolve({ refused: "x" }),
      );
      const acc = operator("POST", "/api/known-servers/accept-move", { host: "old.local", port: 8000 });
      await vi.waitFor(() => expect(ctx.prove).toHaveBeenCalledTimes(2));
      await operator("DELETE", "/api/known-servers", { host: "old.local", port: 8000 });
      release({ proven: F });
      await acc;
      expect(entries()).toEqual([]);
    });

    it("X5 backfill after a DELETE does not recreate the entry", async () => {
      seed([{ host: "a.local", port: 8000, addedAt: T0 }]);
      await mkCtx();
      let release: (r: ProveResult) => void = () => {};
      ctx.prove.mockImplementationOnce(() => new Promise<ProveResult>((res) => (release = res)));
      const probe = operator("POST", "/api/known-servers/probe", { host: "a.local", port: 8000 });
      await vi.waitFor(() => expect(ctx.prove).toHaveBeenCalled());
      await operator("DELETE", "/api/known-servers", { host: "a.local", port: 8000 });
      release({ proven: F });
      await probe;
      expect(entries()).toEqual([]);
    });

    it("X6 a hanging add challenge never blocks another entry's DELETE and stores no fingerprint", async () => {
      seed([{ host: "b.local", port: 8000, addedAt: T0 }]);
      await mkCtx();
      ctx.answers["slow.local:8000"] = "hang";
      const t0 = Date.now();
      const add = operator("POST", "/api/known-servers", { host: "slow.local", port: 8000 });
      await vi.waitFor(() => expect(ctx.prove).toHaveBeenCalled());
      const del = await operator("DELETE", "/api/known-servers", { host: "b.local", port: 8000 });
      const delDone = Date.now() - t0;
      expect(del.json().success).toBe(true);
      await add;
      expect(Date.now() - t0).toBeLessThan(100 + 400); // challengeMs=100 + slack
      expect(delDone).toBeLessThan(80);
      expect(entries().map((e) => [e.host, e.fingerprint])).toEqual([["slow.local", undefined]]);
    });
  });

  // ════════════════════════════════════════════════════════════════════
  // group-servers-by-identity: routes, attach, bounded challenge, logs.
  // (test-plan #X1 #X2 #X3 #X6 #X7 #X8 #X9 #X13, #E11 log half)
  // ════════════════════════════════════════════════════════════════════
  const FULL_F = `sha256:${"A".repeat(43)}`;
  const FULL_G = `sha256:${"B".repeat(43)}`;
  const route = (host: string, port: number, scheme: "http" | "https" = "http", source = "saved") => ({ host, port, scheme, source });
  const routeUrls = (i = 0) => entries()[i].routes.map((r) => `${r.scheme}://${r.host}:${r.port}`);
  const rawConfig = () => JSON.parse(fs.readFileSync(path.join(home, ".pi", "dashboard", "config.json"), "utf-8"));

  /** A real server identity answering the challenge, for the real bounded `proveServerIdentity`. */
  const challengeResponse = (identity: ReturnType<typeof ensureServerIdentity>, init: RequestInit) => {
    const nonce = JSON.parse(String(init.body)).nonce as string;
    return new Response(
      JSON.stringify({ success: true, data: { fingerprint: identity.fingerprint, publicKey: identity.publicKeyB64, signature: signNonce(identity, nonce), v: 1 } }),
      { status: 200 },
    );
  };
  const mkIdentity = () => ensureServerIdentity(path.join(home, `identity-${Math.random().toString(36).slice(2)}.key`));
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  describe("#X6 add / attach / delete decisions", () => {
    it("a new entry answers plain success and pins the proven identity with one saved route", async () => {
      await mkCtx();
      ctx.answers["new.local:8000"] = { proven: F };
      const r = await operator("POST", "/api/known-servers", { host: "new.local", port: 8000 });
      expect(r.json()).toEqual({ success: true });
      expect(entries()).toHaveLength(1);
      expect(entries()[0].routes).toEqual([route("new.local", 8000)]);
    });

    it("an https route joins the entry holding the identity and the mirror stays the http route", async () => {
      seed([{ host: "a.local", port: 8000, addedAt: T0, fingerprint: F }]);
      await mkCtx();
      ctx.answers["https://lab.example.org:443"] = { proven: F };
      const r = await operator("POST", "/api/known-servers", { host: "lab.example.org", port: 443, scheme: "https" });
      expect(r.json()).toEqual({ success: true, data: { updated: true } });
      expect(entries()).toHaveLength(1);
      expect(routeUrls()).toEqual(["http://a.local:8000", "https://lab.example.org:443"]);
      expect(entries()[0]).toMatchObject({ host: "a.local", port: 8000 });
    });

    it("an https-only new entry is written with its host/port mirror and routes (previous parsers keep it)", async () => {
      await mkCtx();
      ctx.answers["https://lab.example.org:443"] = { proven: F };
      const r = await operator("POST", "/api/known-servers", { host: "lab.example.org", port: 443, scheme: "https", label: "Lab" });
      expect(r.json()).toEqual({ success: true });
      expect(rawConfig().knownServers).toEqual([
        { host: "lab.example.org", port: 443, label: "Lab", addedAt: expect.any(String), fingerprint: F, routes: [route("lab.example.org", 443, "https")] },
      ]);
    });

    it("the same identity on another http port starts a second entry (no updated flag)", async () => {
      seed([{ host: "a.local", port: 8000, addedAt: T0, fingerprint: F }]);
      await mkCtx();
      ctx.answers["b.local:9000"] = { proven: F };
      const r = await operator("POST", "/api/known-servers", { host: "b.local", port: 9000 });
      expect(r.json()).toEqual({ success: true });
      expect(entries().map((e) => `${e.host}:${e.port}`)).toEqual(["a.local:8000", "b.local:9000"]);
    });

    it("re-adding a stored route answers plain success, adds no duplicate and refreshes the label", async () => {
      seed([{ host: "a.local", port: 8000, label: "Old", addedAt: T0, fingerprint: F }]);
      await mkCtx();
      ctx.answers["a.local:8000"] = { proven: F };
      const r = await operator("POST", "/api/known-servers", { host: "A.LOCAL", port: 8000, label: "New" });
      expect(r.json()).toEqual({ success: true });
      expect(entries()).toHaveLength(1);
      expect(routeUrls()).toEqual(["http://a.local:8000"]);
      expect(entries()[0].label).toBe("New");
    });

    it("a hint that does not prove is never persisted", async () => {
      await mkCtx();
      const r = await operator("POST", "/api/known-servers", { host: "new.local", port: 8000, fingerprint: F });
      expect(r.json()).toEqual({ success: true });
      expect(entries()[0].fingerprint).toBeUndefined();
    });

    it("a stored route pinned F that proves G is refused with 409 identity_changed naming both; entry unmodified", async () => {
      seed([{ host: "a.local", port: 8000, addedAt: T0, fingerprint: F, routes: [route("a.local", 8000), route("lab.example.org", 443, "https")] }]);
      await mkCtx();
      ctx.answers["a.local:8000"] = { proven: G };
      const before = JSON.stringify(entries());
      const r = await operator("POST", "/api/known-servers", { host: "a.local", port: 8000 });
      expect(r.statusCode).toBe(409);
      expect(r.json()).toMatchObject({ error: "identity_changed", expected: F, proven: G });
      expect(JSON.stringify(entries())).toBe(before);
    });

    it("an unpinned stored route that newly proves an identity held by another entry folds that entry in (backfilled entry survives)", async () => {
      seed([
        { host: "a.local", port: 8000, addedAt: T0 },
        { host: "b.local", port: 8000, label: "B", addedAt: T0, fingerprint: F },
      ]);
      await mkCtx();
      ctx.answers["a.local:8000"] = { proven: F };
      const r = await operator("POST", "/api/known-servers", { host: "a.local", port: 8000 });
      expect(r.json()).toEqual({ success: true });
      expect(entries()).toHaveLength(1);
      expect(entries()[0]).toMatchObject({ host: "a.local", label: "B", fingerprint: F });
      expect(routeUrls()).toEqual(["http://a.local:8000", "http://b.local:8000"]);
    });

    it("review B1: backfill does not fold two instances that share a fingerprint on different http ports", async () => {
      seed([
        { host: "a.local", port: 8000, addedAt: T0, routes: [route("a.local", 8000), route("lab.example.org", 443, "https")] },
        { host: "b.local", port: 9000, addedAt: T0, fingerprint: F, routes: [route("b.local", 9000)] },
      ]);
      await mkCtx();
      ctx.answers["a.local:8000"] = { proven: F };
      const r = await operator("POST", "/api/known-servers", { host: "a.local", port: 8000 });
      expect(r.json()).toEqual({ success: true });
      expect(entries()).toHaveLength(2);
      expect(entries().map((e) => e.fingerprint)).toEqual([F, F]);
      expect(entries().map((e) => e.routes.map((x) => `${x.scheme}://${x.host}:${x.port}`))).toEqual([
        ["http://a.local:8000", "https://lab.example.org:443"],
        ["http://b.local:9000"],
      ]);
    });

    it("review B1: backfill still folds an https-only entry into the instance that holds the identity", async () => {
      seed([
        { host: "lab.example.org", port: 443, addedAt: T0, routes: [route("lab.example.org", 443, "https")] },
        { host: "b.local", port: 9000, addedAt: T0, fingerprint: F, routes: [route("b.local", 9000)] },
      ]);
      await mkCtx();
      ctx.answers["https://lab.example.org:443"] = { proven: F };
      await operator("POST", "/api/known-servers", { host: "lab.example.org", port: 443, scheme: "https" });
      expect(entries()).toHaveLength(1);
    });

    describe("delete", () => {
      const twoRoutes = {
        host: "a.local",
        port: 8000,
        addedAt: T0,
        fingerprint: F,
        routes: [route("a.local", 8000), route("lab.example.org", 443, "https")],
      };

      it("removes one route and keeps the entry; the last route removes the entry", async () => {
        seed([twoRoutes]);
        await mkCtx();
        let r = await operator("DELETE", "/api/known-servers", { host: "lab.example.org", port: 443, scheme: "https" });
        expect(r.json()).toEqual({ success: true });
        expect(routeUrls()).toEqual(["http://a.local:8000"]);
        r = await operator("DELETE", "/api/known-servers", { host: "a.local", port: 8000 });
        expect(r.json().success).toBe(true);
        expect(entries()).toEqual([]);
      });

      it("a scheme names the route: an http delete does not remove the https route of the same port", async () => {
        seed([{ ...twoRoutes, routes: [route("lab.example.org", 443, "https"), route("lab.example.org", 443, "http")] }]);
        await mkCtx();
        await operator("DELETE", "/api/known-servers", { host: "lab.example.org", port: 443, scheme: "http" });
        expect(routeUrls()).toEqual(["https://lab.example.org:443"]);
      });

      it("{fingerprint} removes the whole entry with all its routes", async () => {
        seed([twoRoutes, { host: "other.local", port: 8000, addedAt: T0 }]);
        await mkCtx();
        const r = await operator("DELETE", "/api/known-servers", { fingerprint: F });
        expect(r.json()).toEqual({ success: true });
        expect(entries().map((e) => e.host)).toEqual(["other.local"]);
      });

      it("an unknown route or fingerprint is idempotent success", async () => {
        seed([twoRoutes]);
        await mkCtx();
        expect((await operator("DELETE", "/api/known-servers", { host: "nope.local", port: 1 })).json().success).toBe(true);
        expect((await operator("DELETE", "/api/known-servers", { fingerprint: G })).json().success).toBe(true);
        expect(entries()).toHaveLength(1);
      });

      it("refuses an invalid scheme", async () => {
        seed([twoRoutes]);
        await mkCtx();
        const r = await operator("DELETE", "/api/known-servers", { host: "a.local", port: 8000, scheme: "ftp" });
        expect(r.statusCode).toBe(400);
        expect(r.json().error).toBe("invalid_scheme");
        expect(entries()).toHaveLength(1);
      });
    });

    it("list entries carry routes", async () => {
      seed([{ host: "a.local", port: 8000, addedAt: T0, fingerprint: F }]);
      await mkCtx();
      const op = (await operator("GET", "/api/known-servers")).json();
      expect(op.data[0].routes).toEqual([route("a.local", 8000)]);
    });
  });

  describe("#X7 concurrent adds of one identity", () => {
    it("two simultaneous adds proving F make one entry with two routes in deterministic order, valid JSON, one attached line", async () => {
      const logs: string[] = [];
      await mkCtx({ log: (m) => logs.push(m) });
      ctx.prove.mockImplementation(async (u: string) => {
        if (u.includes("b.example")) await sleep(15);
        return { proven: F };
      });
      const rs = await Promise.all([
        operator("POST", "/api/known-servers", { host: "a.example", port: 8000 }),
        operator("POST", "/api/known-servers", { host: "b.example", port: 8000 }),
      ]);
      expect(rs.map((r) => r.statusCode)).toEqual([200, 200]);
      const disk = rawConfig().knownServers;
      expect(disk).toHaveLength(1);
      expect(disk[0].routes.map((r: { host: string }) => r.host)).toEqual(["a.example", "b.example"]);
      expect(logs.filter((l) => /route attached/.test(l))).toHaveLength(1);
    });
  });

  describe("#X2 scheme and host allowlist before any request", () => {
    it.each(["ftp", "file", "javascript", "ws", "HTTP", "", null, 5])("scheme %j is refused with 400 invalid_scheme before any request", async (scheme) => {
      seed([{ host: "keep.local", port: 8000, addedAt: T0 }]);
      await mkCtx();
      const before = JSON.stringify(entries());
      const r = await operator("POST", "/api/known-servers", { host: "lab.example.org", port: 443, scheme });
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toBe("invalid_scheme");
      expect(ctx.prove).not.toHaveBeenCalled();
      expect(ctx.fetchImpl).not.toHaveBeenCalled();
      expect(JSON.stringify(entries())).toBe(before);
    });

    it.each(["lab.example.org/x", "a@b", "h:80", "lab.example.org:443"])("host %j is refused before any request", async (host) => {
      await mkCtx();
      const r = await operator("POST", "/api/known-servers", { host, port: 443, scheme: "https" });
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toBe("invalid_host");
      expect(ctx.prove).not.toHaveBeenCalled();
      expect(ctx.fetchImpl).not.toHaveBeenCalled();
      expect(entries()).toEqual([]);
    });

    it("probe refuses an invalid scheme without contacting the target", async () => {
      seed([{ host: "a.local", port: 8000, addedAt: T0 }]);
      await mkCtx();
      const r = await operator("POST", "/api/known-servers/probe", { host: "a.local", port: 8000, scheme: "ftp" });
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toBe("invalid_scheme");
      expect(ctx.lookup).not.toHaveBeenCalled();
      expect(ctx.fetchImpl).not.toHaveBeenCalled();
    });
  });

  describe("#X1 bounded add-path challenge toward an operator-supplied host", () => {
    const addHttps = () => operator("POST", "/api/known-servers", { host: "lab.example.org", port: 443, scheme: "https" });
    const expectStoredUnpinned = () => {
      expect(entries()).toHaveLength(1);
      expect(entries()[0].fingerprint).toBeUndefined();
      expect(routeUrls()).toEqual(["https://lab.example.org:443"]);
    };

    it("a redirect answer is never followed and stores no fingerprint", async () => {
      const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }));
      await mkCtx({ realProve: true, fetchImpl: fetchImpl as never });
      const r = await addHttps();
      expect(r.json()).toEqual({ success: true });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://lab.example.org:443/api/pair/challenge");
      expect(init.redirect).toBe("manual");
      expectStoredUnpinned();
    });

    it("a 64 KiB body is refused and stores no fingerprint", async () => {
      const fetchImpl = vi.fn(async () => new Response("x".repeat(64 * 1024), { status: 200 }));
      await mkCtx({ realProve: true, fetchImpl: fetchImpl as never });
      expect((await addHttps()).json()).toEqual({ success: true });
      expectStoredUnpinned();
    });

    it("an endless chunked body is read only up to the 4 KiB cap, then cancelled", async () => {
      let pulled = 0;
      let cancelled = false;
      const fetchImpl = vi.fn(async () => {
        const body = new ReadableStream<Uint8Array>({
          pull(controller) {
            pulled += 1024;
            controller.enqueue(new Uint8Array(1024).fill(120));
          },
          cancel() {
            cancelled = true;
          },
        });
        return new Response(body, { status: 200 });
      });
      await mkCtx({ realProve: true, fetchImpl: fetchImpl as never });
      expect((await addHttps()).json()).toEqual({ success: true });
      expect(cancelled).toBe(true);
      expect(pulled).toBeLessThanOrEqual(4096 + 2048);
      expectStoredUnpinned();
    });

    it("an answer inside the timeout pins the identity; one past it stores no fingerprint", async () => {
      const identity = mkIdentity();
      const slow = (ms: number) =>
        vi.fn(async (_u: unknown, init?: RequestInit) => {
          await sleep(ms);
          return challengeResponse(identity, init as RequestInit);
        });
      // challenge budget 300 ms: 150 ms answers in time, 450 ms does not
      await mkCtx({ realProve: true, fetchImpl: slow(150) as never, timeouts: { challengeMs: 300, dnsMs: 100, httpMs: 80 } });
      expect((await addHttps()).json()).toEqual({ success: true });
      expect(entries()[0].fingerprint).toBe(identity.fingerprint);
      await operator("DELETE", "/api/known-servers", { fingerprint: identity.fingerprint });

      const t0 = Date.now();
      await ctx.app.close();
      apps.splice(apps.indexOf(ctx.app), 1);
      await mkCtx({ realProve: true, fetchImpl: slow(450) as never, timeouts: { challengeMs: 300, dnsMs: 100, httpMs: 80 } });
      expect((await addHttps()).json()).toEqual({ success: true });
      expect(Date.now() - t0).toBeLessThan(450 + 300);
      expectStoredUnpinned();
    });
  });

  describe("#X3 server-side proofs are scheme-aware and bounded", () => {
    /** Answers the challenge as `identity` over any scheme; everything else as a healthy dashboard. */
    const serving = (identity: ReturnType<typeof ensureServerIdentity>, only?: (url: string) => boolean) =>
      vi.fn(async (u: unknown, init?: RequestInit) => {
        const url = String(u);
        if (only && !only(url)) throw Object.assign(new Error("unreachable"), { cause: { code: "ECONNREFUSED" } });
        if (url.endsWith("/api/pair/challenge")) return challengeResponse(identity, init as RequestInit);
        return new Response(JSON.stringify({ ok: true, pid: 1 }), { status: 200 });
      });
    const noTlsOverride = (init: RequestInit) => {
      expect(init.redirect).toBe("manual");
      expect(init.signal).toBeInstanceOf(AbortSignal);
      for (const key of ["dispatcher", "agent", "rejectUnauthorized", "tls"]) expect(key in init).toBe(false);
    };

    it("add: https challenge, redirect manual, 2 s timeout, no TLS override", async () => {
      const identity = mkIdentity();
      const fetchImpl = serving(identity);
      const timeout = vi.spyOn(AbortSignal, "timeout");
      await mkCtx({ realProve: true, fetchImpl: fetchImpl as never, timeouts: null });
      await operator("POST", "/api/known-servers", { host: "lab.example.org", port: 443, scheme: "https" });
      const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://lab.example.org:443/api/pair/challenge");
      noTlsOverride(init);
      expect(timeout).toHaveBeenCalledWith(2000);
      expect(entries()[0].fingerprint).toBe(identity.fingerprint);
    });

    it("probe: https health leg and challenge, then the proven fingerprint is returned and the entry backfilled", async () => {
      const identity = mkIdentity();
      seed([{ host: "lab.example.org", port: 443, addedAt: T0, routes: [route("lab.example.org", 443, "https")] }]);
      const fetchImpl = serving(identity);
      await mkCtx({ realProve: true, fetchImpl: fetchImpl as never, timeouts: null });
      const r = await operator("POST", "/api/known-servers/probe", { host: "lab.example.org", port: 443, scheme: "https" });
      expect(r.json().data).toEqual({ status: "reachable", scheme: "https", fingerprint: identity.fingerprint });
      const urls = fetchImpl.mock.calls.map(([u]) => String(u));
      expect(urls).toContain("https://lab.example.org:443/api/health");
      expect(urls).toContain("https://lab.example.org:443/api/pair/challenge");
      expect(urls.every((u) => u.startsWith("https://"))).toBe(true);
      for (const [, init] of fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>) noTlsOverride(init);
      expect(entries()[0].fingerprint).toBe(identity.fingerprint);
    });

    it("probe: a certificate failure is 'error' with no fingerprint and no pin", async () => {
      seed([{ host: "lab.example.org", port: 443, addedAt: T0, routes: [route("lab.example.org", 443, "https")] }]);
      const fetchImpl = vi.fn(async () => {
        throw Object.assign(new TypeError("fetch failed"), { cause: { code: "DEPTH_ZERO_SELF_SIGNED_CERT" } });
      });
      await mkCtx({ realProve: true, fetchImpl: fetchImpl as never, timeouts: null });
      const r = await operator("POST", "/api/known-servers/probe", { host: "lab.example.org", port: 443, scheme: "https" });
      expect(r.json().data).toEqual({ status: "error", scheme: "https" });
      expect(entries()[0].fingerprint).toBeUndefined();
    });

    it("accept-move: the stored primary route is re-proved in its own scheme, the suggested peer over http", async () => {
      const identity = mkIdentity();
      seed([{ host: "lab.example.org", port: 443, addedAt: T0, fingerprint: identity.fingerprint, routes: [route("lab.example.org", 443, "https")] }]);
      const fetchImpl = serving(identity, (u) => u.startsWith("http://192.168.16.220:8000"));
      await mkCtx({ realProve: true, fetchImpl: fetchImpl as never, timeouts: null });
      ctx.suggest.current = { host: "192.168.16.220", port: 8000 };
      const r = await operator("POST", "/api/known-servers/accept-move", { host: "lab.example.org", port: 443 });
      expect(r.json().success).toBe(true);
      const urls = fetchImpl.mock.calls.map(([u]) => String(u));
      expect(urls).toEqual(["https://lab.example.org:443/api/pair/challenge", "http://192.168.16.220:8000/api/pair/challenge"]);
      for (const [, init] of fetchImpl.mock.calls as unknown as Array<[string, RequestInit]>) noTlsOverride(init);
      expect(routeUrls()).toEqual(["http://192.168.16.220:8000"]);
    });
  });

  describe("#X9 probe bounds (routes)", () => {
    it("a stored https route is probed over https; a route that is not stored is refused without contact; the scheme defaults to http", async () => {
      seed([{ host: "lab.example.org", port: 443, addedAt: T0, routes: [route("lab.example.org", 443, "https")] }]);
      await mkCtx();
      ctx.answers["https://lab.example.org:443"] = { proven: F };
      const ok = await operator("POST", "/api/known-servers/probe", { host: "lab.example.org", port: 443, scheme: "https" });
      expect(ok.json().data).toEqual({ status: "reachable", scheme: "https", fingerprint: F });
      expect(String(ctx.fetchImpl.mock.calls[0][0])).toBe("https://lab.example.org:443/api/health");
      ctx.fetchImpl.mockClear();
      ctx.lookup.mockClear();
      const refused = await operator("POST", "/api/known-servers/probe", { host: "lab.example.org", port: 443 });
      expect(refused.statusCode).toBe(403);
      expect(ctx.fetchImpl).not.toHaveBeenCalled();
      expect(ctx.lookup).not.toHaveBeenCalled();
    });

    it("a probed route's own challenge fingerprint is returned for an already pinned entry and logged once", async () => {
      seed([{ host: "a.local", port: 8000, addedAt: T0, fingerprint: F }]);
      const logs: string[] = [];
      await mkCtx({ log: (m) => logs.push(m) });
      ctx.answers["a.local:8000"] = { proven: F };
      const r = await operator("POST", "/api/known-servers/probe", { host: "a.local", port: 8000 });
      expect(r.json().data).toEqual({ status: "reachable", scheme: "http", fingerprint: F });
      expect(logs.filter((l) => /probe proved/.test(l))).toHaveLength(1);
    });

    it("an unreachable route returns no fingerprint and makes no challenge", async () => {
      seed([{ host: "a.local", port: 8000, addedAt: T0 }]);
      await mkCtx();
      ctx.fetchImpl.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "http://x/" } }));
      const r = await operator("POST", "/api/known-servers/probe", { host: "a.local", port: 8000 });
      expect(r.json().data).toEqual({ status: "error", scheme: "http" });
      expect(ctx.prove).not.toHaveBeenCalled();
    });
  });

  describe("#X8 accept-move rewrites only the primary route", () => {
    it("other routes, label, fingerprint and addedAt survive; one log line names old and new address", async () => {
      const entry = {
        host: "old.local",
        port: 8000,
        label: "iMac",
        addedAt: T0,
        fingerprint: F,
        routes: [route("old.local", 8000), route("tunnel.example.org", 443, "https", "pairing")],
      };
      seed([entry]);
      const logs: string[] = [];
      await mkCtx({ log: (m) => logs.push(m) });
      ctx.suggest.current = { host: "192.168.16.220", port: 8000 };
      ctx.answers["192.168.16.220:8000"] = { proven: F };
      const r = await operator("POST", "/api/known-servers/accept-move", { host: "old.local", port: 8000 });
      expect(r.json().success).toBe(true);
      expect(entries()[0]).toMatchObject({ host: "192.168.16.220", port: 8000, label: "iMac", addedAt: T0, fingerprint: F });
      expect(entries()[0].routes).toEqual([route("192.168.16.220", 8000), route("tunnel.example.org", 443, "https", "pairing")]);
      const moved = logs.filter((l) => /moved/.test(l));
      expect(moved).toHaveLength(1);
      expect(moved[0]).toContain("old.local:8000");
      expect(moved[0]).toContain("192.168.16.220:8000");
    });

    it("a suggested address already held as another route is not duplicated", async () => {
      seed([{ host: "old.local", port: 8000, addedAt: T0, fingerprint: F, routes: [route("old.local", 8000), route("192.168.16.220", 8000)] }]);
      await mkCtx();
      ctx.suggest.current = { host: "192.168.16.220", port: 8000 };
      ctx.answers["192.168.16.220:8000"] = { proven: F };
      await operator("POST", "/api/known-servers/accept-move", { host: "old.local", port: 8000 });
      expect(routeUrls()).toEqual(["http://192.168.16.220:8000"]);
    });
  });

  describe("#X13 route log lines carry no secrets", () => {
    const SENTINELS = ["BEARER-ZZ9", "48217730", "PAIR-ZZ9", "pi:pair:v1.ZZ9"];

    it("attached, refused, first-write and probe lines: one each, short fingerprint, host:port, no sentinel or full fingerprint", async () => {
      // a file still in the previous shape, so the first write is the migration
      fs.writeFileSync(
        path.join(home, ".pi", "dashboard", "config.json"),
        JSON.stringify({ knownServers: [{ host: "a.local", port: 8000, addedAt: T0, fingerprint: FULL_F }] }),
      );
      const logs: string[] = [];
      const consoleLines: string[] = [];
      for (const level of ["log", "info", "warn", "error"] as const) {
        vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void consoleLines.push(a.join(" ")));
      }
      await mkCtx({ log: (m) => logs.push(m) });
      const secretBody = { bearer: SENTINELS[0], confirmCode: SENTINELS[1], code: SENTINELS[2], payload: SENTINELS[3] };

      ctx.answers["b.local:8000"] = { proven: FULL_F };
      await operator("POST", "/api/known-servers", { host: "b.local", port: 8000, label: SENTINELS[0], ...secretBody });
      ctx.answers["a.local:8000"] = { proven: FULL_G };
      const refused = await operator("POST", "/api/known-servers", { host: "a.local", port: 8000, ...secretBody });
      expect(refused.statusCode).toBe(409);
      ctx.answers["b.local:8000"] = { proven: FULL_F };
      await operator("POST", "/api/known-servers/probe", { host: "b.local", port: 8000 });

      const all = [...logs, ...consoleLines];
      const only = (re: RegExp) => all.filter((l) => re.test(l));
      expect(only(/route attached/)).toHaveLength(1);
      expect(only(/route refused/)).toHaveLength(1);
      expect(only(/first written in routes shape/)).toHaveLength(1);
      expect(only(/probe proved/)).toHaveLength(1);
      const short = (fp: string) => fp.slice(0, "sha256:".length + 16);
      expect(only(/route attached/)[0]).toContain(short(FULL_F));
      expect(only(/route attached/)[0]).toContain("b.local:8000");
      expect(only(/route refused/)[0]).toContain(short(FULL_F));
      expect(only(/route refused/)[0]).toContain(short(FULL_G));
      expect(only(/route refused/)[0]).toContain("a.local:8000");
      expect(only(/probe proved/)[0]).toContain(short(FULL_F));
      for (const line of all) {
        for (const secret of SENTINELS) expect(line).not.toContain(secret);
        expect(line).not.toContain("A".repeat(17));
        expect(line).not.toContain("B".repeat(17));
      }
    });
  });

  describe("#E11 first write in routes shape", () => {
    it("logs exactly one 'first written in routes shape' line over two writes, and the file ends in routes shape", async () => {
      fs.writeFileSync(
        path.join(home, ".pi", "dashboard", "config.json"),
        JSON.stringify({ knownServers: [{ host: "a.local", port: 8000, addedAt: T0 }] }),
      );
      const before = fs.readFileSync(path.join(home, ".pi", "dashboard", "config.json"), "utf-8");
      const logs: string[] = [];
      await mkCtx({ log: (m) => logs.push(m) });
      expect(await operator("GET", "/api/known-servers")).toBeTruthy(); // a read never rewrites
      expect(fs.readFileSync(path.join(home, ".pi", "dashboard", "config.json"), "utf-8")).toBe(before);
      await operator("POST", "/api/known-servers", { host: "b.local", port: 8000 });
      await operator("POST", "/api/known-servers", { host: "c.local", port: 8000 });
      expect(logs.filter((l) => /first written in routes shape/.test(l))).toHaveLength(1);
      expect(rawConfig().knownServers.every((e: { routes?: unknown[] }) => Array.isArray(e.routes) && e.routes.length > 0)).toBe(true);
    });
  });

  it("E29 discover-servers rows carry fingerprint and name", async () => {
    await mkCtx();
    const peers = new Map<string, any>([
      ["k", { host: "h", port: 8000, piPort: 9999, version: "1", pid: 1, isLocal: false, source: "mdns", fingerprint: F, name: "Studio" }],
      ["old", { host: "o", port: 8000, piPort: 9999, version: "1", pid: 1, isLocal: false, source: "mdns" }],
    ]);
    const app = Fastify();
    apps.push(app);
    registerKnownServersRoutes(app, {
      networkGuard: async () => {},
      getPeerServers: () => peers,
      hostAdmission: () => ({ allowedHosts: [], publicBaseUrls: [], configuredOrigins: [], getLiveTunnelOrigins: () => [], bindHost: "localhost" }),
    });
    const r = await app.inject({ method: "POST", url: "/api/discover-servers" });
    const [a, b] = r.json().data;
    expect(a).toMatchObject({ fingerprint: F, name: "Studio" });
    expect("fingerprint" in b).toBe(false);
  });
});

describe("peer wiring (E27, E29 self entry)", () => {
  const self = { fingerprint: F, port: 8000, piPort: 9999, version: "0.9.0", name: "Studio", host: "mac.local" };
  const peer = (over: Record<string, unknown>) => ({
    host: "h", port: 8000, piPort: 9999, version: "1", pid: 1, isLocal: false, source: "mdns" as const, ...over,
  });

  function wire() {
    const browser = Object.assign(new EventEmitter(), { servers: new Map() }) as any;
    const peers = new Map<string, any>();
    const broadcasts: any[][] = [];
    wirePeerServers({ browser, peers, self: () => self, broadcast: (s) => broadcasts.push(s) });
    return { browser, peers, broadcasts };
  }

  it("E27 excludes own identity locally, lists a copy elsewhere, keeps the legacy rule for fp-less peers", () => {
    const { browser, peers } = wire();
    browser.emit("server-up", peer({ instance: "a", isLocal: true, fingerprint: F }));
    browser.emit("server-up", peer({ instance: "b", isLocal: false, fingerprint: F }));
    browser.emit("server-up", peer({ instance: "c", isLocal: true }));
    expect(Array.from(peers.keys())).toEqual(["b"]);
  });

  it("keys peers by instance for up, update and down", () => {
    const { browser, peers, broadcasts } = wire();
    browser.emit("server-up", peer({ instance: "x", host: "1.1.1.1" }));
    browser.emit("server-update", peer({ instance: "x", host: "2.2.2.2" }));
    expect(peers.get("x").host).toBe("2.2.2.2");
    browser.emit("server-down", peer({ instance: "x" }));
    expect(peers.size).toBe(0);
    expect(broadcasts).toHaveLength(3);
  });

  it("E29 the self entry carries own fingerprint and name", () => {
    expect(buildSelfServer(self)).toMatchObject({ host: "mac.local", port: 8000, fingerprint: F, name: "Studio", isLocal: true });
  });
});

describe("E28 advertised fp equals the proven identity", () => {
  it("TXT fp equals what the challenge endpoint proves", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ks-identity-"));
    const identity = ensureServerIdentity(path.join(dir, "identity.key"));
    const app = Fastify();
    const reg = new PairedDeviceRegistry(path.join(dir, "paired.json"));
    const mgr = new PairingManager({ registry: reg, getFingerprint: () => identity.fingerprint, getReachableUrls: () => [] });
    registerPairingRoutes(app, {
      networkGuard: async () => {},
      identity,
      pairing: mgr,
      registry: reg,
      hostAdmission: () => ({ allowedHosts: [], publicBaseUrls: [], configuredOrigins: [], getLiveTunnelOrigins: () => [], bindHost: "localhost" }),
    });
    await app.ready();
    let txt: Record<string, string> = {};
    advertiseDashboard(8000, 9999, {
      fingerprint: identity.fingerprint,
      addresses: ["192.168.16.31"],
      publish: (config) => {
        txt = config.txt;
        const svc = new Service(config as never, () => {}, (() => {}) as never);
        return svc;
      },
      log: () => {},
    });
    const fetchImpl = (async (_u: unknown, init?: RequestInit) => {
      const r = await app.inject({ method: "POST", url: "/api/pair/challenge", payload: JSON.parse(String(init?.body)) });
      return new Response(r.body, { status: r.statusCode });
    }) as typeof fetch;
    const proven = await proveServerIdentity("http://inject", { fetchImpl });
    // the proof also carries the key whose possession was proven (callers may pin it)
    expect(proven).toEqual({ proven: txt.fp, publicKey: identity.publicKeyB64 });
    stopAdvertising();
    mgr.dispose();
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
