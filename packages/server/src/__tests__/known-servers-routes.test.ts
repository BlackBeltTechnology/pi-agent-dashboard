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
import { ensureServerIdentity } from "../auth/identity.js";
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

  async function mkCtx(opts: { moves?: Partial<ReturnType<typeof createKnownServerMoves>> } = {}): Promise<Ctx> {
    const app = Fastify();
    apps.push(app);
    stampLegacyHook(app, TOKEN);
    app.addHook("onRequest", async (req) => {
      if (req.headers["x-test-device"] === "1") (req as unknown as { authVia: string }).authVia = "device";
    });
    const answers: Record<string, ProveResult | "hang"> = {};
    const prove = vi.fn(async (baseUrl: string): Promise<ProveResult> => {
      const a = answers[baseUrl.replace(/^http:\/\//, "")];
      if (a === "hang") return new Promise(() => {});
      return a ?? { refused: "unreachable" };
    });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, pid: 1 }), { status: 200 }));
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
      prove,
      lookup,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      moves,
      log: () => {},
      timeouts: { challengeMs: 100, dnsMs: 100, httpMs: 80 },
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

    it("refuses a known identity whose stored address still proves it (409 already_known)", async () => {
      seed([{ host: "old.local", port: 8000, addedAt: T0, fingerprint: F }]);
      await mkCtx();
      ctx.answers["new.local:8000"] = { proven: F };
      ctx.answers["old.local:8000"] = { proven: F };
      const before = JSON.stringify(entries());
      const r = await operator("POST", "/api/known-servers", { host: "new.local", port: 8000 });
      expect(r.statusCode).toBe(409);
      expect(r.json()).toMatchObject({ error: "already_known", host: "old.local", port: 8000 });
      expect(JSON.stringify(entries())).toBe(before);
    });

    it("updates the holder when its stored address no longer proves the identity", async () => {
      seed([{ host: "old.local", port: 8000, label: "Keep", addedAt: T0, fingerprint: F }]);
      await mkCtx();
      ctx.answers["new.local:8000"] = { proven: F };
      let r = await operator("POST", "/api/known-servers", { host: "new.local", port: 8000, label: "" });
      expect(r.json()).toEqual({ success: true, data: { updated: true } });
      expect(entries()).toHaveLength(1);
      expect(entries()[0]).toMatchObject({ host: "new.local", label: "Keep", addedAt: T0, fingerprint: F });
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
      expect(entries()[0]).toEqual({ ...entry, host: "192.168.16.220" });
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
