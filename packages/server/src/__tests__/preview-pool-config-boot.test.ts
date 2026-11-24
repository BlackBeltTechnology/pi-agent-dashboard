/**
 * Tier 3 port pool, config → boot → mint (D5): the `portPool` parser's invalid / boundary inputs resolved through the
 * REAL config snapshot (one boot line, no listener, the mint falls to tier 4/5, other tiers unaffected) and the pool
 * ports being the dashboard's own (`ownPorts`) for target registration and the reserve-path REST route.
 * See change: serve-live-previews-on-capability-origin (D5; test-plan #E58, #E59, #E70).
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { parsePreviewOrigins } from "@blackbelt-technology/pi-dashboard-shared/preview-origins.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getResolvedPreviewOrigins, resetConfigSnapshot, setPreviewOriginsRuntime } from "../config-snapshot.js";
import { LiveCapabilityStore } from "../live-server/live-capability.js";
import { createLiveServerManager } from "../live-server/live-server-manager.js";
import { PreviewPathStore } from "../live-server/preview-path-store.js";
import { createPreviewPool, type PreviewPool } from "../live-server/preview-pool.js";
import { registerLiveServerRoutes } from "../routes/live-server-routes.js";

const COOKIE = "session-cookie-value";
const DASH_PORT = 8000;
const PI_PORT = 9999;
const TLS_PORT = 8443;
const MODEL_PROXY_PORT = 8200;

let tmp: string;
let origHome: string | undefined;
let tick = 0;
const cfgFile = () => path.join(tmp, ".pi", "dashboard", "config.json");
/** Write the config file and force a distinct mtime so the snapshot stamp moves even within one millisecond. */
function writeConfig(data: object): void {
  fs.mkdirSync(path.dirname(cfgFile()), { recursive: true });
  fs.writeFileSync(cfgFile(), JSON.stringify(data), { mode: 0o600 });
  tick += 2;
  const t = new Date(1_700_000_000_000 + tick * 1000);
  fs.utimesSync(cfgFile(), t, t);
}
const lines = (spy: { mock: { calls: unknown[][] } }, needle: string) => spy.mock.calls.filter((c) => String(c[0]).includes(needle));

const apps: FastifyInstance[] = [];
const pools: PreviewPool[] = [];
const stores: LiveCapabilityStore[] = [];

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pool-boot-"));
  origHome = process.env.HOME;
  process.env.HOME = tmp;
  // The dashboard's own ports come from the config file only in these tests.
  vi.stubEnv("PI_DASHBOARD_PORT", "");
  vi.stubEnv("PI_DASHBOARD_PI_PORT", "");
  vi.stubEnv("PI_GATEWAY_PORT", "");
  resetConfigSnapshot();
  setPreviewOriginsRuntime({});
});
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
  for (const s of stores.splice(0)) s.close();
  await Promise.all(pools.splice(0).map((p) => p.close()));
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  process.env.HOME = origHome;
  setPreviewOriginsRuntime({});
  resetConfigSnapshot();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const baseCfg = (previewOrigins: object, extra: object = {}) => ({
  port: DASH_PORT,
  piPort: PI_PORT,
  ...extra,
  liveServer: { previewOrigins },
});

/** A free run of `n` consecutive loopback ports. */
async function freeRange(n: number): Promise<{ from: number; to: number }> {
  for (let base = 22000 + Math.floor(Math.random() * 20000); ; base += n + 1) {
    const servers: net.Server[] = [];
    try {
      for (let i = 0; i < n; i++) {
        const s = net.createServer();
        await new Promise<void>((res, rej) => {
          s.once("error", rej);
          s.listen(base + i, "127.0.0.1", () => res());
        });
        servers.push(s);
      }
      await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
      return { from: base, to: base + n - 1 };
    } catch {
      await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
    }
  }
}

/** The mint route wired like `server.ts`: the pool reads its range from the live resolved config. */
async function mintApp() {
  const manager = {
    get: (id: string) => (id === "t1" ? { id, label: id, host: "127.0.0.1", port: 5173 } : undefined),
    getStatic: () => undefined,
    has: (id: string) => id === "t1",
    use: () => {},
    list: () => [],
  } as unknown as Parameters<typeof registerLiveServerRoutes>[1];
  let pool!: PreviewPool;
  const store = new LiveCapabilityStore({ isTargetLive: () => true, onDelete: (e, r) => pool.onDelete(e, r), getPreviewConfig: () => getResolvedPreviewOrigins() });
  stores.push(store);
  const allocateSpy = vi.fn();
  pool = createPreviewPool({
    range: () => {
      const r = getResolvedPreviewOrigins();
      return r.enabled ? r.pool : undefined;
    },
    bindHost: () => "0.0.0.0",
    findByPoolPort: (p) => store.findByPoolPort(p),
    revokeByPoolPort: (p, r) => store.revokeByPoolPort(p, r),
    manager: manager as never,
    interfaceAddresses: () => ["192.168.1.5"],
    log: () => {},
  });
  pools.push(pool);
  const realAllocate = pool.allocate.bind(pool);
  pool.allocate = async (...a) => {
    const out = await realAllocate(...a);
    allocateSpy(out);
    return out;
  };
  const app = Fastify({ logger: false });
  apps.push(app);
  app.decorateRequest("isAuthenticated", false);
  app.addHook("onRequest", async (r) => {
    const x = r as unknown as Record<string, unknown>;
    x.authVia = "session";
    x.principalTier = "control";
    x.cookies = { pi_dash_token: COOKIE };
  });
  registerLiveServerRoutes(app, manager, { networkGuard: async () => undefined, capabilities: store, pool, previewPaths: new PreviewPathStore(), previewOrigins: () => getResolvedPreviewOrigins(), log: () => {} });
  await app.ready();
  const mint = () =>
    app.inject({
      method: "POST",
      url: "/api/live-server/t1/capability",
      remoteAddress: "192.168.1.9",
      headers: { host: "192.168.1.5:8000", origin: "http://192.168.1.5:8000" },
      payload: { accept: ["origin", "preview"] },
    });
  return { mint, pool, store, allocateSpy };
}

describe("T.E58 — invalid portPool disables tier 3 only (D5 parser → boot → mint)", () => {
  const invalid: { label: string; pool: string; extra?: object; issueKey: string }[] = [
    { label: "inverted 8199-8100", pool: "8199-8100", issueKey: "portPool" },
    { label: "101 ports 8100-8300", pool: "8100-8300", issueKey: "portPool" },
    { label: "below the 1024 floor 1000-1010", pool: "1000-1010", issueKey: "portPool" },
    { label: "contains the dashboard port 8000-8010", pool: "8000-8010", issueKey: "port" },
    { label: "contains piPort 9990-10000", pool: "9990-10000", issueKey: "piPort" },
    { label: "contains the TLS port 8440-8450", pool: "8440-8450", extra: { tls: { enabled: true, port: TLS_PORT + 5 } }, issueKey: "tls.port" },
    { label: "contains the model-proxy second port 8190-8210", pool: "8190-8210", extra: { modelProxy: { enabled: true, secondPort: MODEL_PROXY_PORT } }, issueKey: "modelProxy.secondPort" },
    { label: "not a range: abc", pool: "abc", issueKey: "portPool" },
  ];

  for (const c of invalid) {
    it(`${c.label}: one log line per boot, no listener, mint selects tier 4 (ip-dns), tier 2 unaffected`, async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(console, "log").mockImplementation(() => {});
      writeConfig(
        baseCfg(
          { portPool: c.pool, ipDnsSuffix: "sslip.io", wildcard: { suffix: "preview.example.com", forHosts: ["dash.example.com"] } },
          c.extra ?? {},
        ),
      );
      const { mint, pool, allocateSpy } = await mintApp();

      const resolved = getResolvedPreviewOrigins();
      expect(resolved.tiers, "tier 3 is off, 2 / 4 / 1 / 5 untouched").toEqual([1, 2, 4, 5]);
      expect(resolved.pool).toBeUndefined();
      expect(resolved.portPool).toBeUndefined();

      // Several mints re-read the resolved config; the diagnostic is still one line for this boot.
      const tiers: unknown[] = [];
      for (let i = 0; i < 3; i++) {
        const res = await mint();
        expect(res.statusCode).toBe(200);
        tiers.push(res.json().tier);
      }
      expect(tiers).toEqual([4, 4, 4]);

      const poolLines = lines(warn, "tier 3 (port pool) disabled");
      expect(poolLines, "exactly one diagnostic line for the pool, whatever the number of reads").toHaveLength(1);
      expect(String(poolLines[0][0])).toContain(c.issueKey === "portPool" ? "liveServer.previewOrigins.portPool" : `contains the ${c.issueKey}`);
      // No listener: nothing allocated, nothing held, the pool says disabled.
      expect(pool.heldPorts()).toEqual([]);
      expect(pool.poolPorts()).toEqual([]);
      expect(allocateSpy).not.toHaveBeenCalled();
      expect(await pool.allocate("k", "192.168.1.5")).toEqual({ ok: false, reason: "disabled" });
    });

    it(`${c.label}: without ipDnsSuffix the mint falls to tier 5`, async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.spyOn(console, "log").mockImplementation(() => {});
      writeConfig(baseCfg({ portPool: c.pool }, c.extra ?? {}));
      const { mint, pool } = await mintApp();
      const res = await mint();
      expect(res.statusCode).toBe(200);
      expect(res.json().tier).toBe(5);
      expect(res.json().origin).toBeUndefined();
      expect(pool.heldPorts()).toEqual([]);
    });
  }

  it("control: a valid pool on the same config binds ONE listener and the mint is tier 3", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const r = await freeRange(3);
    writeConfig(baseCfg({ portPool: `${r.from}-${r.to}`, ipDnsSuffix: "sslip.io" }));
    const { mint, pool } = await mintApp();
    const res = await mint();
    expect(res.json().tier).toBe(3);
    expect(res.json().origin).toBe(`http://192.168.1.5:${r.from}`);
    expect(pool.heldPorts()).toEqual([r.from]);
    expect(getResolvedPreviewOrigins().tiers).toEqual([1, 3, 4, 5]);
  });
});

describe("T.E59 — portPool size and floor boundaries", () => {
  const accepted = (s: string) => parsePreviewOrigins({ portPool: s }).value.portPool === s;

  it("parser: 100 ports and the 1024 floor are accepted; 101 ports and 1023 are rejected with exactly one issue", () => {
    expect(accepted("8100-8199")).toBe(true); // 100 ports
    expect(accepted("1024-1030")).toBe(true); // floor
    expect(accepted("65436-65535")).toBe(true); // 100 ports at the ceiling
    for (const bad of ["8100-8200", "1023-1030", "65535-65536"]) {
      const r = parsePreviewOrigins({ portPool: bad });
      expect(r.value.portPool, bad).toBeUndefined();
      expect(r.issues, bad).toHaveLength(1);
      expect(r.issues[0].keys).toEqual(["liveServer.previewOrigins.portPool"]);
    }
  });

  it("boot: accepted ranges enable tier 3 with the full port list; rejected ones switch it off", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const cases: { pool: string; on: boolean; size?: number }[] = [
      { pool: "8100-8199", on: true, size: 100 },
      { pool: "8100-8200", on: false },
      { pool: "1024-1030", on: true, size: 7 },
      { pool: "1023-1030", on: false },
    ];
    for (const c of cases) {
      resetConfigSnapshot();
      writeConfig(baseCfg({ portPool: c.pool }));
      const { pool } = await mintApp();
      const resolved = getResolvedPreviewOrigins();
      expect(resolved.tiers.includes(3), c.pool).toBe(c.on);
      expect(pool.poolPorts(), c.pool).toHaveLength(c.size ?? 0);
      if (c.on) {
        const [from, to] = c.pool.split("-").map(Number);
        expect(pool.poolPorts()[0]).toBe(from);
        expect(pool.poolPorts().at(-1)).toBe(to);
        expect(pool.isPoolPort(from)).toBe(true);
        expect(pool.isPoolPort(to)).toBe(true);
        expect(pool.isPoolPort(from - 1)).toBe(false);
        expect(pool.isPoolPort(to + 1)).toBe(false);
      }
      // nothing was bound just by configuring
      expect(pool.heldPorts()).toEqual([]);
    }
  });
});

describe("T.E70 — pool ports are the dashboard's own (ownPorts): registration and reserve-path refuse them", () => {
  const prefs = () => {
    let store: unknown[] = [];
    return { getLiveServers: () => store, setLiveServers: (t: unknown[]) => void (store = t) } as never;
  };

  it("start / startPreset / REST register / REST reserve of a pool port are refused exactly like the dashboard's own port; nothing is reserved", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    writeConfig(baseCfg({ portPool: "8100-8199" }));
    // Wired as `server.ts` does: the manager's `ownPorts` reads the pool at call time.
    let pool: PreviewPool | undefined;
    const manager = createLiveServerManager(prefs(), { ownPorts: () => [DASH_PORT, PI_PORT, ...(pool?.poolPorts() ?? [])] });
    pool = createPreviewPool({
      range: () => {
        const r = getResolvedPreviewOrigins();
        return r.enabled ? r.pool : undefined;
      },
      bindHost: () => "127.0.0.1",
      findByPoolPort: () => null,
      revokeByPoolPort: () => {},
      manager,
      log: () => {},
    });
    pools.push(pool);
    expect(pool.poolPorts()).toHaveLength(100);

    const refusedStart = manager.start({ host: "127.0.0.1", port: 8150 });
    const refusedOwn = manager.start({ host: "127.0.0.1", port: DASH_PORT });
    expect(refusedStart).toEqual({ ok: false, error: expect.stringContaining("dashboard's own") });
    expect(refusedStart).toEqual(refusedOwn); // same refusal as the dashboard's own port
    expect(manager.startPreset({ host: "127.0.0.1", port: 8150, sessionId: "s" }).ok).toBe(false);
    for (const p of [8100, 8199]) expect(manager.start({ host: "localhost", port: p }).ok, String(p)).toBe(false); // both edges
    expect(manager.start({ host: "localhost", port: 8200 }).ok).toBe(true); // just outside
    expect(manager.portRefusal(8150)).toBe(manager.portRefusal(DASH_PORT));
    expect(manager.portRefusal(8150)).not.toBeNull();
    expect(manager.list().some((t) => t.port === 8150)).toBe(false);

    const app = Fastify({ logger: false });
    apps.push(app);
    app.decorateRequest("isAuthenticated", false);
    const paths = new PreviewPathStore({ targetIdForPort: (p) => manager.getByPort(p)?.id, isPortAllowed: (p) => manager.portRefusal(p) === null });
    registerLiveServerRoutes(app, manager, {
      networkGuard: async () => undefined,
      capabilities: new LiveCapabilityStore({ isTargetLive: () => true }),
      previewPaths: paths,
      hasTier5Viewer: () => true,
      previewOrigins: () => getResolvedPreviewOrigins(),
      log: () => {},
    });
    await app.ready();
    const post = (url: string, payload: object) => app.inject({ method: "POST", url, remoteAddress: "127.0.0.1", headers: { host: "localhost:8000" }, payload });

    const regPool = await post("/api/live-server/start", { host: "127.0.0.1", port: 8150 });
    const regOwn = await post("/api/live-server/start", { host: "127.0.0.1", port: DASH_PORT });
    expect(regPool.statusCode).toBe(400);
    expect(regPool.statusCode).toBe(regOwn.statusCode);
    expect(regPool.json()).toEqual(regOwn.json());

    const resPool = await post("/api/live-server/preview-path", { port: 8150 });
    const resOwn = await post("/api/live-server/preview-path", { port: DASH_PORT });
    expect(resPool.statusCode).toBe(400);
    expect(resPool.statusCode).toBe(resOwn.statusCode);
    expect(resPool.json()).toEqual(resOwn.json());
    expect(paths.reservationCount()).toBe(0);
    expect((await post("/api/live-server/preview-path", { port: 8200 })).statusCode).toBe(200); // a non-pool port reserves
    expect(paths.reservationCount()).toBe(1);
  });

  it("a persisted target on a pool port is dropped on the next seed", () => {
    const persisted = [{ id: "pooled01", label: "x", host: "127.0.0.1", port: 8150 }];
    let stored: unknown[] = persisted;
    const p = { getLiveServers: () => stored, setLiveServers: (t: unknown[]) => void (stored = t) } as never;
    const m = createLiveServerManager(p, { ownPorts: () => Array.from({ length: 100 }, (_, i) => 8100 + i) });
    expect(m.list()).toEqual([]);
    expect(stored).toEqual([]);
  });
});
