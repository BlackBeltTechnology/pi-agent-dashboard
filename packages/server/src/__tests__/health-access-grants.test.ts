/**
 * `/api/health` access-grant counters (change: add-access-grant-dialog, task 9.3;
 * test-plan #E23 diagnosability).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AccessGrantHealth, snapshotAccessGrantHealth } from "../access/access-health.js";
import { AccessPlaneRegistry } from "../access/access-plane.js";
import { GrantCoordinator } from "../access/grant-coordinator.js";
import { createFilesystemPlane } from "../access/planes.js";
import { CspReportStore, type CspReportsSnapshot } from "../auth/csp-report-store.js";
import { createLocalTrustContext } from "../auth/local-proof.js";
import { canDiscloseAccessPosture } from "../auth/localhost-guard.js";
import { noteNetworkOnlyAdmission, resetNetworkTrustTelemetryForTests } from "../auth/network-trust-telemetry.js";
import { resetTrustModeForTests } from "../auth/trust-mode.js";
import { resetConfigSnapshot } from "../config-snapshot.js";
import { registerSystemRoutes } from "../routes/system-routes.js";

const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

async function makeApp(readAccessGrants?: () => AccessGrantHealth): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  apps.push(app);
  registerSystemRoutes(app, {
    sessionManager: { listActive: () => [], listAll: () => [] },
    preferencesStore: { flush: () => {} },
    metaPersistence: { flushAll: () => {} },
    config: { port: 8000, piPort: 9999, dev: false },
    networkGuard: async () => {},
    version: "test",
    clientDir: null,
    readAccessGrants,
  } as never);
  await app.ready();
  return app;
}

async function health(app: FastifyInstance): Promise<Record<string, unknown>> {
  const res = await app.inject({ method: "GET", url: "/api/health" });
  expect(res.statusCode).toBe(200);
  return res.json();
}

function coordinator() {
  const planes = new AccessPlaneRegistry();
  planes.register(createFilesystemPlane());
  return new GrantCoordinator({
    planes,
    broadcast: () => {},
    hostGateMode: () => "enforce",
    promptEnabled: () => true,
    killSwitch: () => false,
    operatorChannels: () => 1,
    onTransition: () => {},
  });
}

const yoloIdle = { status: () => null, counters: () => ({ autoAllowed: 0, refusedByPriorRefusal: 0 }) };

describe("9.3 access-grant counters", () => {
  it("counts every transition, by reason, so per-channel starvation is told apart from the global cap", () => {
    const c = coordinator();
    const d = (subject: string, channel: string) =>
      c.onDenial({ plane: "filesystem", rawSubject: subject, origin: "s", channel, requestHoldsCapability: true }, false);
    d("/a1", "A"); // prompted
    d("/a2", "A"); // flooded: channel-concurrent
    d("/b1", "B"); // prompted (second global slot)
    d("/c1", "C"); // flooded: concurrent-cap
    const snap = snapshotAccessGrantHealth({
      coordinator: c,
      yolo: yoloIdle,
      refusalCount: () => 3,
      promptEnabled: () => true,
      killSwitch: () => false,
      hostGateMode: () => "enforce",
      operatorChannels: () => 2,
    });
    expect(snap.registry).toMatchObject({ recorded: 4, prompted: 2, pending: 4 });
    expect(snap.registry.flooded).toEqual({ "channel-concurrent": 1, "concurrent-cap": 1 });
    expect(snap.prompting).toEqual({ enabled: true, killSwitch: false, hostGateMode: "enforce", operatorChannels: 2 });
    expect(snap.refusals).toBe(3);
  });

  it("reports YOLO state and cumulative auto-answers", () => {
    const snap = snapshotAccessGrantHealth({
      coordinator: coordinator(),
      yolo: {
        status: () => ({ source: "env", activatedAt: 0, expiresAt: null, unscoped: false, roots: [{ path: "/r", addedAt: 0 }] }),
        counters: () => ({ autoAllowed: 250, refusedByPriorRefusal: 4 }),
      },
      refusalCount: () => 0,
      promptEnabled: () => false,
      killSwitch: () => true,
      hostGateMode: () => "report",
      operatorChannels: () => 0,
    });
    // 250 is past the bounded history's 200: the counter must not cap.
    expect(snap.yolo).toEqual({
      active: true,
      source: "env",
      unscoped: false,
      roots: 1,
      expiresAt: null,
      autoAllowed: 250,
      refusedByPriorRefusal: 4,
    });
  });

  it("appears in /api/health", async () => {
    const snap = snapshotAccessGrantHealth({
      coordinator: coordinator(),
      yolo: yoloIdle,
      refusalCount: () => 0,
      promptEnabled: () => false,
      killSwitch: () => false,
      hostGateMode: () => "report",
      operatorChannels: () => 0,
    });
    const body = await health(await makeApp(() => snap));
    expect(body.accessGrants).toEqual(JSON.parse(JSON.stringify(snap)));
  });

  it("is null when unwired, and a throwing read never breaks /api/health", async () => {
    expect((await health(await makeApp())).accessGrants).toBeNull();
    const throwing = vi.fn(() => {
      throw new Error("boom");
    });
    const body = await health(await makeApp(throwing));
    expect(body.accessGrants).toBeNull();
    expect(body.ok).toBe(true);
  });

  it("hides accessGrants from a remote or tunnel-forwarded caller (unguarded endpoint)", async () => {
    const app = await makeApp(() => ({ sentinel: true }) as unknown as AccessGrantHealth);
    const remote = await app.inject({ method: "GET", url: "/api/health", remoteAddress: "203.0.113.9" });
    expect(remote.json().accessGrants).toBeNull();
    const tunnel = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { "x-forwarded-for": "198.51.100.4" },
    });
    expect(tunnel.json().accessGrants).toBeNull();
    const local = await health(app);
    expect(local.accessGrants).not.toBeNull();
  });
});

// test-plan #E22 — `/api/health` `piTrustMirror.live` counters, same disclosure gate as
// `accessGrants`. See change: mirror-dashboard-trust-live-remote (D6).
describe("E22 /api/health piTrustMirror.live", () => {
  const counters = { covered: 3, notCovered: 2, refused: 1, rateLimited: 4, budgetMissed: 5 };

  async function liveApp(read?: () => typeof counters): Promise<FastifyInstance> {
    const app = Fastify({ logger: false });
    apps.push(app);
    registerSystemRoutes(app, {
      sessionManager: { listActive: () => [], listAll: () => [] },
      preferencesStore: { flush: () => {} },
      metaPersistence: { flushAll: () => {} },
      config: { port: 8000, piPort: 9999, dev: false },
      networkGuard: async () => {},
      version: "test",
      clientDir: null,
      readPiTrustLive: read,
    } as never);
    await app.ready();
    return app;
  }

  it("exposes the five counters to a genuinely-local caller", async () => {
    const body = await health(await liveApp(() => counters));
    expect(body.piTrustMirror).toEqual({ live: counters });
  });

  it("is null when unwired, and a throwing read never breaks /api/health", async () => {
    expect((await health(await liveApp())).piTrustMirror).toBeNull();
    const body = await health(
      await liveApp(() => {
        throw new Error("boom");
      }),
    );
    expect(body.piTrustMirror).toBeNull();
    expect(body.ok).toBe(true);
  });

  it("hides the counters from a remote or tunnel-forwarded caller", async () => {
    const app = await liveApp(() => counters);
    const remote = await app.inject({ method: "GET", url: "/api/health", remoteAddress: "203.0.113.9" });
    expect(remote.json().piTrustMirror).toBeNull();
    const tunnel = await app.inject({ method: "GET", url: "/api/health", headers: { "x-forwarded-for": "198.51.100.4" } });
    expect(tunnel.json().piTrustMirror).toBeNull();
  });
});

// test-plan #E14 / #E17 — additive `trustPosture` on /api/health, disclosed only
// to an authenticated or genuinely-local caller. See change:
// fix-trusted-network-tunnel-bypass (D3), retire-trusted-networks-bypass (D4).
describe("E14/E17 /api/health trustPosture disclosure", () => {
  let home: string;
  let origHome: string | undefined;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-health-trust-"));
    fs.mkdirSync(path.join(home, ".pi", "dashboard"), { recursive: true });
    origHome = process.env.HOME;
    process.env.HOME = home;
    resetConfigSnapshot();
    resetTrustModeForTests();
    resetNetworkTrustTelemetryForTests();
  });

  afterEach(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    resetConfigSnapshot();
    resetTrustModeForTests();
    resetNetworkTrustTelemetryForTests();
    fs.rmSync(home, { recursive: true, force: true });
  });

  const setMode = (network: Record<string, string> | undefined) =>
    fs.writeFileSync(path.join(home, ".pi", "dashboard", "config.json"), JSON.stringify(network ? { network } : {}));

  async function trustApp(trusted: string[]): Promise<FastifyInstance> {
    const app = Fastify({ logger: false });
    apps.push(app);
    // Stands in for the auth hooks: tags a request carrying `x-test-auth`.
    app.addHook("onRequest", async (request) => {
      if (request.headers["x-test-auth"]) (request as any).isAuthenticated = true;
    });
    registerSystemRoutes(app, {
      sessionManager: { listActive: () => [], listAll: () => [] },
      preferencesStore: { flush: () => {} },
      metaPersistence: { flushAll: () => {} },
      config: { port: 8000, piPort: 9999, dev: false },
      networkGuard: async () => {},
      version: "test",
      clientDir: null,
      readTrustedNetworks: () => trusted,
    } as never);
    await app.ready();
    return app;
  }
  const callers = {
    genuineLocal: { remoteAddress: "127.0.0.1" },
    remote: { remoteAddress: "203.0.113.9" },
    relayed: { remoteAddress: "127.0.0.1", headers: { "x-forwarded-for": "203.0.113.9" } },
  };

  // add-request-access-remedy X4: the `request-access` remedy does not widen this predicate.
  it("X4 an on-link trusted-network caller with no credential still gets null posture", async () => {
    const app = await trustApp(["192.168.16.0/24"]);
    const body = (await app.inject({ method: "GET", url: "/api/health", remoteAddress: "192.168.16.40" })).json();
    expect(body.accessGrants).toBeNull();
    expect(body.trustPosture).toBeNull();
    expect(JSON.stringify(body)).not.toContain("request-access");
  });

  for (const [trusted, flag] of [[["127.0.0.1"], true], [["192.168.16.0/24"], false]] as const) {
    it(`trusted ${JSON.stringify(trusted)}: genuine-local sees trustedHasLoopback=${flag}; others get null`, async () => {
      setMode({ trustMode: "legacy", trustModeOrigin: "upgrade" });
      const app = await trustApp([...trusted]);
      const local = (await app.inject({ method: "GET", url: "/api/health", ...callers.genuineLocal })).json();
      expect(local.trustPosture).toEqual({
        trustedHasLoopback: flag,
        trustMode: "legacy",
        trustModeOrigin: "upgrade",
        networkOnly: { admissions: 0, distinctPeers: 0, lastAt: null },
      });
      expect(local).toHaveProperty("accessGrants", null);
      for (const c of [callers.remote, callers.relayed]) {
        const body = (await app.inject({ method: "GET", url: "/api/health", ...c })).json();
        expect(body.trustPosture).toBeNull();
        expect(body).toHaveProperty("accessGrants", null);
      }
    });
  }

  // E17 — legacy with two network-only peers.
  it("#E17 legacy + 2 network-only peers: object for local and authenticated callers, null for network-admitted / remote; no IP leaks", async () => {
    setMode({ trustMode: "legacy", trustModeOrigin: "operator" });
    noteNetworkOnlyAdmission({ ip: "192.168.16.20" });
    noteNetworkOnlyAdmission({ ip: "192.168.16.21" });
    noteNetworkOnlyAdmission({ ip: "192.168.16.21" }); // same peer again: 3 admissions, 2 peers
    const app = await trustApp(["192.168.16.0/24"]);

    const bodies: string[] = [];
    const call = async (init: { remoteAddress: string; headers?: Record<string, string> }) => {
      const res = await app.inject({ method: "GET", url: "/api/health", ...init });
      bodies.push(res.body);
      return res.json();
    };

    const local = await call({ remoteAddress: "127.0.0.1" });
    const authed = await call({ remoteAddress: "198.51.100.7", headers: { "x-test-auth": "1" } });
    const lan = await call({ remoteAddress: "192.168.16.40" }); // network-admitted, no credential
    const remote = await call({ remoteAddress: "203.0.113.9" });

    for (const body of [local, authed]) {
      expect(body.trustPosture).toMatchObject({ trustMode: "legacy", trustModeOrigin: "operator" });
      expect(body.trustPosture.networkOnly.distinctPeers).toBe(2);
      expect(body.trustPosture.networkOnly.admissions).toBe(3);
      expect(typeof body.trustPosture.networkOnly.lastAt).toBe("number");
    }
    expect(lan.trustPosture).toBeNull();
    expect(remote.trustPosture).toBeNull();
    for (const b of bodies) {
      expect(b).not.toContain("192.168.16.20");
      expect(b).not.toContain("192.168.16.21");
    }
  });

  it("#E17 pair mode reports the mode with a zeroed networkOnly even if counters hold stale peers", async () => {
    noteNetworkOnlyAdmission({ ip: "192.168.16.20" });
    setMode({ trustMode: "pair", trustModeOrigin: "upgrade" });
    const app = await trustApp(["192.168.16.0/24"]);
    const body = (await app.inject({ method: "GET", url: "/api/health", ...callers.genuineLocal })).json();
    expect(body.trustPosture).toEqual({
      trustedHasLoopback: false,
      trustMode: "pair",
      trustModeOrigin: "upgrade",
      networkOnly: { admissions: 0, distinctPeers: 0, lastAt: null },
    });
  });

  it("#E17 an unrecognised stored mode reports fail-closed pair with a null origin", async () => {
    setMode({ trustMode: "open" });
    const app = await trustApp([]);
    const body = (await app.inject({ method: "GET", url: "/api/health", ...callers.genuineLocal })).json();
    expect(body.trustPosture).toMatchObject({ trustMode: "pair", trustModeOrigin: null });
  });
});


describe("cspReports health block (WE33, WE54, WX6)", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-health-csp-"));
  });

  async function cspApp(opts: {
    read?: () => CspReportsSnapshot;
    strictProof?: boolean;
  }): Promise<FastifyInstance> {
    const app = Fastify({ logger: false });
    apps.push(app);
    app.addHook("onRequest", async (request) => {
      if (request.headers["x-test-auth"]) (request as any).isAuthenticated = true;
    });
    registerSystemRoutes(app, {
      sessionManager: { listActive: () => [], listAll: () => [] },
      preferencesStore: { flush: () => {} },
      metaPersistence: { flushAll: () => {} },
      config: { port: 8000, piPort: 9999, dev: false },
      networkGuard: async () => {},
      version: "test",
      clientDir: null,
      // The existing disclosure-gated block: its presence is the oracle for `canDiscloseAccessPosture`.
      readAccessGrants: () => ({ marker: true }) as never,
      readCspReports: opts.read,
      localTrust: opts.strictProof ? createLocalTrustContext("tok", () => true) : undefined,
    } as never);
    await app.ready();
    return app;
  }

  const populated = () => {
    const store = new CspReportStore({ filePath: path.join(tmp, "csp-reports.json"), warn: () => {} });
    store.record("strict", "script-src-elem", "/settings/security");
    store.record("baseline", "img-src", "/secret/path");
    store.record("trusted-types", "require-trusted-types-for");
    store.recordDropped();
    return store;
  };

  const callers: Array<[string, { remoteAddress: string; headers?: Record<string, string> }, boolean]> = [
    ["genuine loopback", { remoteAddress: "127.0.0.1" }, false],
    ["tunnel-forwarded loopback peer", { remoteAddress: "127.0.0.1", headers: { "x-forwarded-for": "203.0.113.9" } }, false],
    ["remote trusted-network peer", { remoteAddress: "192.168.16.40" }, false],
    ["remote authenticated (bearer/session)", { remoteAddress: "198.51.100.7", headers: { "x-test-auth": "1" } }, false],
    ["bare loopback, requireLocalProof on, no proof", { remoteAddress: "127.0.0.1" }, true],
  ];

  it("WE33: present iff canDiscloseAccessPosture passes (differential oracle); otherwise absent, not null, nothing leaks", async () => {
    const store = populated();
    for (const [name, init, strictProof] of callers) {
      const withBlock = await cspApp({ read: () => store.snapshot(), strictProof });
      const without = await cspApp({ strictProof });
      const a = await withBlock.inject({ method: "GET", url: "/api/health", ...init });
      const b = await without.inject({ method: "GET", url: "/api/health", ...init });
      expect(a.statusCode, name).toBe(200);
      const oracle = canDiscloseAccessPosture({
        ip: init.remoteAddress,
        headers: init.headers ?? {},
        ...(init.headers?.["x-test-auth"] ? { isAuthenticated: true } : {}),
      } as never);
      const body = a.json() as Record<string, unknown>;
      // The pre-existing disclosure outcome for the same caller agrees with the predicate.
      expect(body.accessGrants !== null, name).toBe(oracle);
      expect("cspReports" in body, name).toBe(oracle);
      if (!oracle) {
        expect(a.body, name).not.toContain("cspReports");
        expect(a.body, name).not.toContain("script-src-elem");
        expect(body.cspReports, name).toBeUndefined();
      }
      // the rest of the body is the pre-change shape (process-volatile numbers aside)
      const VOLATILE = ["startedAt", "server", "socketBufferOccupancy", "storeRetention", "keeperLogs", "droppedFrames", "pollCost", "ppid", "bootParentPid", "pid", "cspReports"];
      const stable = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => !VOLATILE.includes(k)));
      expect(stable(body), name).toEqual(stable(b.json() as Record<string, unknown>));
    }
  });

  it("WE54: the block is exactly { since, dropped, counts } with counts only — no URL, path or report content", async () => {
    const store = populated();
    const app = await cspApp({ read: () => store.snapshot() });
    const body = (await app.inject({ method: "GET", url: "/api/health", remoteAddress: "127.0.0.1" })).json();
    const block = body.cspReports as Record<string, unknown>;
    expect(Object.keys(block).sort()).toEqual(["counts", "dropped", "since"]);
    expect(new Date(block.since as string).toISOString()).toBe(block.since);
    expect(block.dropped).toBe(1);
    expect(block.counts).toEqual({
      baseline: { "img-src": 1 },
      strict: { "script-src-elem": 1 },
      "trusted-types": { "require-trusted-types-for": 1 },
    });
    const text = JSON.stringify(block);
    for (const frag of ["/secret/path", "/settings/security", "http", "://"]) expect(text).not.toContain(frag);
  });

  it("WX6: a throwing counter read omits the block (absent, not null) and health still answers 200", async () => {
    const throwing = await cspApp({ read: () => { throw new Error("boom"); } });
    const plain = await cspApp({});
    const res = await throwing.inject({ method: "GET", url: "/api/health", remoteAddress: "127.0.0.1" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect("cspReports" in body).toBe(false);
    const ref = (await plain.inject({ method: "GET", url: "/api/health", remoteAddress: "127.0.0.1" })).json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(Object.keys(ref).sort());
  });
});
