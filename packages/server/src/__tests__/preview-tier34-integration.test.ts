/**
 * Tiers 3 and 4 end to end with an INJECTED Host and a REAL pool listener (task 14.6): the mint route picks tier 3 (a bound
 * pool port) and, with the pool full, tier 4 (ip-dns); the dashboard page's `frame-src` admits exactly the origins those
 * mints return; the tier-3 first navigation works against the real listener and its response CSP names the dashboard as the
 * only framing ancestor besides itself.
 * See change: serve-live-previews-on-capability-origin (D1, D5, D6; test-plan #X62).
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerCsp } from "../auth/csp.js";
import { resetConfigSnapshot, setPreviewOriginsRuntime } from "../config-snapshot.js";
import { createPreviewPool, type PreviewPool } from "../live-server/preview-pool.js";
import { createHarness, createMintRoute, freeRange, type Harness } from "./preview-pool-harness.js";

const DASH_HOST = "192.168.1.5:8000";
const cleanups: (() => Promise<void> | void)[] = [];
let tmp: string;
let origHome: string | undefined;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tier34-"));
  origHome = process.env.HOME;
  process.env.HOME = tmp;
  vi.stubEnv("PI_DASHBOARD_PORT", "");
  vi.stubEnv("PI_DASHBOARD_PI_PORT", "");
  vi.stubEnv("PI_GATEWAY_PORT", "");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  resetConfigSnapshot();
  setPreviewOriginsRuntime({});
});
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  process.env.HOME = origHome;
  setPreviewOriginsRuntime({});
  resetConfigSnapshot();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeConfig(portPool: string): void {
  const file = path.join(tmp, ".pi", "dashboard", "config.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ port: 8000, piPort: 9999, liveServer: { previewOrigins: { portPool, ipDnsSuffix: "sslip.io" } } }), { mode: 0o600 });
}

/** Does CSP source expression `src` (scheme://host[:port], `*.` host wildcard, `:*` port wildcard) admit `origin`? */
function admits(src: string, origin: string): boolean {
  const m = /^(https?):\/\/(\*\.)?([a-z0-9.-]+)(?::(\*|\d+))?$/i.exec(src);
  if (!m) return false;
  const u = new URL(origin);
  const portOf = (url: URL) => url.port || (url.protocol === "https:" ? "443" : "80");
  if (`${u.protocol}`.replace(":", "") !== m[1]) return false;
  const hostOk = m[2] ? u.hostname.endsWith(`.${m[3]}`) && u.hostname.length > m[3].length + 1 : u.hostname === m[3];
  const srcPort = m[4] ?? (m[1] === "https" ? "443" : "80");
  return hostOk && (srcPort === "*" || srcPort === portOf(u));
}

/** The mint route over a REAL pool bound on every interface, with `192.168.1.5` injected as a local interface address. */
async function setup(poolSize: number) {
  const range = await freeRange(poolSize);
  writeConfig(`${range.from}-${range.to}`);
  const h: Harness = await createHarness({ range });
  cleanups.push(() => h.close());
  // The harness pool binds loopback; replace it with a wildcard-bound pool that answers the injected Host IP.
  await h.pool.close();
  const pool: PreviewPool = createPreviewPool({
    range: () => range,
    bindHost: () => "0.0.0.0",
    findByPoolPort: (p) => h.store.findByPoolPort(p),
    revokeByPoolPort: (p, r) => h.store.revokeByPoolPort(p, r),
    manager: h.manager,
    interfaceAddresses: () => ["192.168.1.5"],
    log: (l) => h.logs.push(l),
  });
  cleanups.push(() => pool.close());
  // `store.onDelete` of the harness points at the closed pool; re-point it at this one.
  (h.store as unknown as { onDelete?: unknown }).onDelete = (e: never, r: never) => pool.onDelete(e, r);
  const route = await createMintRoute({ pool, store: h.store, manager: h.manager, range, ipDnsSuffix: "sslip.io" });
  cleanups.push(() => route.app.close());
  return { h, pool, route, range };
}

/** A request to a pool listener (reached on loopback) carrying the injected Host header. */
const poolReq = (port: number, pathAndQuery: string, host: string, cookie?: string) =>
  new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    const headers: Record<string, string> = { host };
    if (cookie) headers.cookie = cookie;
    const r = http.request({ host: "127.0.0.1", port, path: pathAndQuery, headers, setHost: false, agent: false }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    r.on("error", reject);
    r.end();
  });

describe("T.X62 — tiers 3 and 4: injected Host, real pool listener, frame-src", () => {
  it("tier 3: the mint binds a REAL pool port for the injected Host IP; first navigation works; the response CSP frames only the dashboard", async () => {
    const { h, pool, route, range } = await setup(2);
    const res = await route.mint("s1", "t1", DASH_HOST);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tier).toBe(3);
    expect(body.origin).toBe(`http://192.168.1.5:${range.from}`);
    expect(body.path).toMatch(/^\/\?k=[A-Za-z0-9_-]{43}$/);
    expect(pool.heldPorts()).toEqual([range.from]);
    // the listener is real: a TCP connect to the pool port succeeds
    const origin = new URL(body.origin);
    const hop = await poolReq(Number(origin.port), body.path, origin.host, "pi_dash_token=s1");
    expect(hop.status).toBe(302);
    const poolCookie = String(([] as string[]).concat(hop.headers["set-cookie"] ?? [])[0]).split(";")[0];
    expect(poolCookie).toMatch(new RegExp(`^pi_dash_pool_${range.from}=`));
    const page = await poolReq(Number(origin.port), "/", origin.host, `pi_dash_token=s1; ${poolCookie}`);
    expect(page.status).toBe(200);
    expect(page.body).toBe("upstream-body");
    const csp = String(page.headers["content-security-policy"]);
    expect(csp).toContain("sandbox");
    expect(csp).toContain(`frame-ancestors http://192.168.1.5:8000 ${body.origin}`);
    expect(csp).not.toMatch(/frame-ancestors[^;]*(\*|'self')/);
    // the wrong Host is refused (403) by the real listener: the origin binding is part of the capability
    expect((await poolReq(Number(origin.port), "/", `192.168.1.5:${Number(origin.port) + 1}`, `pi_dash_token=s1; ${poolCookie}`)).status).toBe(403);
    expect(h.logs.some((l) => l.includes("pool bind"))).toBe(true);
  });

  it("tier 4: with the pool full the same injected Host mints an ip-dns origin on the dashboard port", async () => {
    const { pool, route } = await setup(1);
    expect((await route.mint("s1", "t1", DASH_HOST)).json().tier).toBe(3); // takes the only port
    const res = await route.mint("s1", "t2", DASH_HOST);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tier).toBe(4);
    expect(body.origin).toMatch(/^http:\/\/[a-z2-7]{26}\.192-168-1-5\.sslip\.io:8000$/);
    expect(body.path).toMatch(/^\//);
    expect(pool.heldPorts()).toHaveLength(1); // tier 4 holds no listener
  });

  it("frame-src of the dashboard page (real registerCsp, same injected Host) admits exactly the tier-3 and tier-4 origins the mints return", async () => {
    const { route, range } = await setup(1);
    const t3 = (await route.mint("s1", "t1", DASH_HOST)).json();
    const t4 = (await route.mint("s1", "t2", DASH_HOST)).json();
    expect([t3.tier, t4.tier]).toEqual([3, 4]);

    const app: FastifyInstance = Fastify();
    cleanups.push(() => app.close());
    registerCsp(app, "enforce");
    app.get("/", async () => "x");
    await app.ready();
    const page = await app.inject({ url: "/", headers: { host: DASH_HOST } });
    const frameSrc = String(page.headers["content-security-policy"]).split("; ").find((d) => d.startsWith("frame-src ")) ?? "";
    const sources = frameSrc.split(" ").slice(1);
    expect(sources).toContain("http://192.168.1.5:*"); // tier 3: any pool port on the Host IP
    expect(sources).toContain("http://*.192-168-1-5.sslip.io:8000"); // tier 4: the ip-dns wildcard on the page's own port
    expect(sources.some((s) => admits(s, t3.origin)), `${frameSrc} admits ${t3.origin}`).toBe(true);
    expect(sources.some((s) => admits(s, t4.origin)), `${frameSrc} admits ${t4.origin}`).toBe(true);
    // ...and nothing wider: another host or a non-dashboard port on the ip-dns host is not admitted
    for (const other of ["http://192.168.1.77:8100", `http://k7q4mzxa2bcdefghijklmnopqr.192-168-1-5.sslip.io:9000`, "http://evil.example:8000"]) {
      expect(sources.some((s) => admits(s, other)), other).toBe(false);
    }
    expect(range.from).toBeGreaterThan(1023);
  });
});
