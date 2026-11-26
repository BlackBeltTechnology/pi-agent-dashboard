/**
 * Tier selection at mint (D1): `selectMintTier` decision tables + the mint route's response shape / negotiation.
 * See change: serve-live-previews-on-capability-origin (D1; test-plan #E29-#E39, #E52, #X2, #X9).
 */
import { parsePreviewOrigins, resolvePreviewOrigins } from "@blackbelt-technology/pi-dashboard-shared/preview-origins.js";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { LiveCapabilityStore } from "../live-server/live-capability.js";
import type { LiveServerManager } from "../live-server/live-server-manager.js";
import { parseAccept, selectMintTier, type TierInput } from "../live-server/preview-tier.js";
import { registerLiveServerRoutes } from "../routes/live-server-routes.js";

const ctx: { port: number; piPort: number; allowedHosts: string[]; publicBaseUrls: string[]; corsOrigins: string[] } = { port: 8000, piPort: 9999, allowedHosts: [], publicBaseUrls: [], corsOrigins: [] };
const resolve = (raw: object, over: Partial<typeof ctx> = {}) => resolvePreviewOrigins(parsePreviewOrigins(raw).value, { ...ctx, ...over });
const ACCEPT = ["origin", "preview"];
const base = (over: Partial<TierInput> = {}): TierInput => ({
  hostHeader: "localhost:8000",
  socketPort: 8000,
  genuinelyLocal: true,
  forwardingHeaders: false,
  socketTls: false,
  originHeader: "http://localhost:8000",
  resolved: resolve({ enabled: true }),
  accept: ACCEPT,
  kind: "port",
  ...over,
});
const originOf = (d: ReturnType<typeof selectMintTier>, label = "k7q4mzxa2bcdefghijklmnopqr") =>
  "buildOrigin" in d ? d.buildOrigin(label).origin : undefined;
const tierOf = (d: ReturnType<typeof selectMintTier>) => d.tier;

describe("accept negotiation (E38)", () => {
  it("array only, first 8 entries, case-sensitive, unknown ignored", () => {
    expect(parseAccept(["origin", "preview"])).toEqual({ origin: true, preview: true });
    expect(parseAccept(["bogus", "origin"])).toEqual({ origin: true, preview: false });
    for (const bad of ["origin", [], ["ORIGIN"], ["bogus"], null, 1, undefined, {}]) expect(parseAccept(bad), String(bad)).toEqual({ origin: false, preview: false });
    expect(parseAccept([...Array(8).fill("x"), "origin"]).origin).toBe(false); // 9th entry
    expect(parseAccept([...Array(1000).fill("origin")]).origin).toBe(true);
  });
  it("decision: absent/malformed accept → legacy; origin-only on a non-tier-1 host → legacy; preview → tier5 candidate (port) / legacy (static)", () => {
    expect(tierOf(selectMintTier(base({ accept: undefined })))).toBe("legacy");
    expect(tierOf(selectMintTier(base({ accept: "origin" })))).toBe("legacy");
    expect(tierOf(selectMintTier(base({ accept: ["origin"] })))).toBe(1);
    expect(tierOf(selectMintTier(base({ accept: ["preview"] })))).toBe("tier5");
    expect(tierOf(selectMintTier(base({ accept: ["preview"], kind: "static" })))).toBe("legacy");
    expect(tierOf(selectMintTier(base({ accept: ["origin"], genuinelyLocal: false })))).toBe("legacy");
    expect(tierOf(selectMintTier(base({ resolved: resolve({ enabled: false }) })))).toBe("legacy");
  });
});

describe("tier 1 (E29, E30, E31, E32, X2, X9)", () => {
  it("E29: Host forms and peer/header/TLS combinations", () => {
    const yes = ["localhost:8000", "127.0.0.1:8000", "LOCALHOST.:8000", "localhost"];
    for (const h of yes) expect(tierOf(selectMintTier(base({ hostHeader: h, originHeader: undefined }))), h).toBe(1);
    for (const h of ["[::1]:8000", "::1:8000", "127.0.0.2:8000", "[::ffff:127.0.0.1]:8000", "evil.example/@localhost", "localhost:99999", "[::1", "", undefined]) {
      expect(tierOf(selectMintTier(base({ hostHeader: h as string | undefined }))), String(h)).not.toBe(1);
    }
    expect(tierOf(selectMintTier(base({ genuinelyLocal: false })))).not.toBe(1); // non-local peer
    expect(tierOf(selectMintTier(base({ socketTls: true, originHeader: "https://localhost:8443" })))).not.toBe(1);
  });
  it("E30: origin port — Host port, else the socket port, elided at 80; malformed ports → no tier 1", () => {
    const o = (h: string, socketPort = 8000) => originOf(selectMintTier(base({ hostHeader: h, socketPort, originHeader: undefined })));
    expect(o("localhost:8000")).toBe("http://k7q4mzxa2bcdefghijklmnopqr.localhost:8000");
    expect(o("localhost:80")).toBe("http://k7q4mzxa2bcdefghijklmnopqr.localhost");
    expect(o("localhost")).toBe("http://k7q4mzxa2bcdefghijklmnopqr.localhost:8000");
    expect(o("localhost:9000")).toBe("http://k7q4mzxa2bcdefghijklmnopqr.localhost:9000"); // ssh -L (E31)
    expect(o("localhost:65535")).toContain(":65535");
    for (const bad of ["localhost:0", "localhost:65536", "localhost:abc", "localhost:"]) expect(o(bad), bad).toBeUndefined();
  });
  it("E32: a non-local peer (Docker bridge) is not tier 1; the reason is recorded, port target → tier5, static → legacy", () => {
    const d = selectMintTier(base({ genuinelyLocal: false, hostHeader: "localhost:18000" }));
    expect(d).toMatchObject({ tier: "tier5", reason: "non-local-peer" });
    expect(selectMintTier(base({ genuinelyLocal: false, kind: "static" }))).toMatchObject({ tier: "legacy", reason: "non-local-peer" });
    expect(selectMintTier(base({ genuinelyLocal: false, forwardingHeaders: true }))).toMatchObject({ reason: "forwarding-headers" });
  });
  it("X9: a same-host proxy adding no forwarding header is indistinguishable from a local browser (pinned limitation, Q26)", () => {
    expect(tierOf(selectMintTier(base({ genuinelyLocal: true })))).toBe(1);
  });
  it("X2: malformed Host never yields tier 1/2/4 and never throws", () => {
    const all = resolve({ enabled: true, ipDnsSuffix: "sslip.io", wildcard: { suffix: "preview.test", forHosts: ["dash.test"], scheme: "http" } });
    for (const h of [undefined, "evil.example/@localhost", "localhost:99999", "[::1", ""]) {
      const d = selectMintTier(base({ hostHeader: h, resolved: all }));
      expect(typeof d.tier === "number", String(h)).toBe(false);
    }
  });
});

describe("tier 2 (E33, E34, E35, E37)", () => {
  const wc = (extra: object = {}) => resolve({ enabled: true, wildcard: { suffix: "preview.example.com", forHosts: ["dash.example.com"], ...extra } });
  it("E33: forHosts normalisation and misses", () => {
    for (const h of ["dash.example.com", "DASH.Example.com.", "dash.example.com:8443"]) {
      const d = selectMintTier(base({ hostHeader: h, originHeader: "https://dash.example.com", resolved: wc(), genuinelyLocal: false }));
      expect(tierOf(d), h).toBe(2);
      expect(originOf(d)).toBe("https://k7q4mzxa2bcdefghijklmnopqr.preview.example.com");
    }
    for (const h of ["other.example.com", "dash.example.com.evil.com", "xdash.example.com", "preview.example.com", "127.0.0.1"]) {
      expect(tierOf(selectMintTier(base({ hostHeader: h, originHeader: "https://dash.example.com", resolved: wc(), genuinelyLocal: false }))), h).not.toBe(2);
    }
    // never derived from publicBaseUrls / allowedHosts
    const noFor = resolve({ enabled: true, wildcard: { suffix: "preview.example.com", forHosts: [] } }, { publicBaseUrls: ["https://dash.example.com"] });
    expect(tierOf(selectMintTier(base({ hostHeader: "dash.example.com", originHeader: "https://dash.example.com", resolved: noFor, genuinelyLocal: false })))).not.toBe(2);
  });
  it("E34: scheme × ancestors × socket-TLS matrix", () => {
    const run = (scheme: object, origin: string | undefined, tls: boolean) =>
      tierOf(selectMintTier(base({ hostHeader: "dash.example.com", originHeader: origin, socketTls: tls, resolved: wc(scheme), genuinelyLocal: false })));
    // https / unset: needs https ancestors regardless of socket TLS (TLS-terminating proxy)
    for (const s of [{}, { scheme: "https" }]) {
      expect(run(s, "https://dash.example.com", false)).toBe(2);
      expect(run(s, "https://dash.example.com", true)).toBe(2);
      expect(run(s, "http://dash.example.com", false)).not.toBe(2);
      expect(run(s, undefined, false)).not.toBe(2); // fallback scheme from the raw socket: plain → http
      expect(run(s, undefined, true)).toBe(2); // TLS socket → https fallback
    }
    // http: plain socket AND http ancestors
    const h = { scheme: "http" };
    expect(run(h, "http://dash.example.com", false)).toBe(2);
    expect(run(h, undefined, false)).toBe(2);
    expect(run(h, "http://dash.example.com", true)).not.toBe(2);
    expect(run(h, "https://dash.example.com", false)).not.toBe(2);
  });
  it("E35: wildcard.port elided at the scheme default; invalid ports disable tier 2", () => {
    const o = (extra: object) => originOf(selectMintTier(base({ hostHeader: "dash.example.com", originHeader: "https://dash.example.com", resolved: wc(extra), genuinelyLocal: false })));
    expect(o({})).toBe("https://k7q4mzxa2bcdefghijklmnopqr.preview.example.com");
    expect(o({ port: 443 })).toBe("https://k7q4mzxa2bcdefghijklmnopqr.preview.example.com");
    expect(o({ port: 8443 })).toBe("https://k7q4mzxa2bcdefghijklmnopqr.preview.example.com:8443");
    expect(o({ port: 0 })).toBeUndefined();
    expect(o({ port: 65536 })).toBeUndefined();
  });
  it("E37: tier 1 beats tier 2 for loopback; tier 2 beats tier 4", () => {
    const r = resolve({ enabled: true, ipDnsSuffix: "sslip.io", wildcard: { suffix: "preview.example.com", forHosts: ["localhost", "dash.example.com"] } });
    expect(tierOf(selectMintTier(base({ resolved: r })))).toBe(1);
    expect(tierOf(selectMintTier(base({ hostHeader: "dash.example.com", originHeader: "https://dash.example.com", resolved: r, genuinelyLocal: false })))).toBe(2);
  });
});

describe("tier 4 (E36)", () => {
  const r = resolve({ enabled: true, ipDnsSuffix: "sslip.io" });
  const t4 = (h: string, over: Partial<TierInput> = {}) => selectMintTier(base({ hostHeader: h, originHeader: undefined, resolved: r, genuinelyLocal: false, ...over }));
  it("canonical IPv4 Host → tier 4 with the Host port, default-elided", () => {
    expect(originOf(t4("192.168.1.5:8000"))).toBe("http://k7q4mzxa2bcdefghijklmnopqr.192-168-1-5.sslip.io:8000");
    expect(originOf(t4("192.168.1.5", { socketPort: 80 }))).toBe("http://k7q4mzxa2bcdefghijklmnopqr.192-168-1-5.sslip.io");
  });
  it("non-canonical / IPv6 / loopback / TLS / https-ancestors fall through", () => {
    for (const h of ["192.168.001.005:8000", "192.168.1.5.:8000", "[::ffff:192.168.1.5]:8000", "[fe80::1]:8000", "127.0.0.1:8000"]) {
      expect(tierOf(t4(h, h.startsWith("127") ? { genuinelyLocal: false } : {})), h).not.toBe(4);
    }
    expect(tierOf(t4("192.168.1.5:8000", { socketTls: true }))).not.toBe(4);
    expect(tierOf(t4("192.168.1.5:8000", { originHeader: "https://192.168.1.5:8000" }))).not.toBe(4);
  });
  it("E152: IPv6 ancestors skip tiers 1-4; hostile Origin is dropped (fallback scheme://Host), never reflected", () => {
    const d = selectMintTier(base({ originHeader: "http://[::1]:8000" }));
    expect(d).toMatchObject({ tier: "tier5", reason: "ipv6-ancestors" });
    for (const bad of ["http://x.com; script-src *", "javascript:1", "null", "", "http://a b", "http://u:p@x.com", "http://x.com/path"]) {
      const g = selectMintTier(base({ originHeader: bad }));
      expect(g.tier, bad).toBe(1);
      expect("ancestors" in g && g.ancestors, bad).toEqual(["http://localhost:8000"]);
    }
    const v = selectMintTier(base({ originHeader: "http://127.0.0.1:8000" }));
    expect("ancestors" in v && v.ancestors).toEqual(["http://127.0.0.1:8000"]);
  });
});

describe("mint route response shape (E39, E52) + re-mint reuse", () => {
  const apps: FastifyInstance[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((a) => a.close()));
  });
  async function mk(resolved = resolve({ enabled: true })) {
    const app = Fastify({ logger: false });
    apps.push(app);
    const manager = {
      get: (id: string) => (id === "vite-5173" ? { id, label: id, host: "127.0.0.1", port: 5173 } : undefined),
      getStatic: () => undefined,
      has: (id: string) => id === "vite-5173",
      use: () => {},
      list: () => [],
    } as unknown as LiveServerManager;
    const store = new LiveCapabilityStore({ isTargetLive: () => true });
    app.decorateRequest("isAuthenticated", false);
    registerLiveServerRoutes(app, manager, { networkGuard: async () => undefined, capabilities: store, previewOrigins: () => resolved, log: () => {} });
    await app.ready();
    return { app, store };
  }
  const mint = (app: FastifyInstance, body: object, headers: Record<string, string> = {}) =>
    app.inject({ method: "POST", url: "/api/live-server/vite-5173/capability", remoteAddress: "127.0.0.1", headers: { host: "localhost:8000", ...headers }, payload: body });

  it("E39/E38: no accept → legacy shape; accept → tier 1 with origin + path '/'", async () => {
    const { app } = await mk();
    const legacy = (await mint(app, {})).json();
    expect(legacy).toMatchObject({ success: true, tier: "legacy" });
    expect(legacy.path).toMatch(/^\/live\/vite-5173\/~c\/[A-Za-z0-9_-]{22,}\/$/);
    expect(legacy.origin).toBeUndefined();
    const t1 = (await mint(app, { accept: ACCEPT }, { origin: "http://localhost:8000" })).json();
    expect(t1).toMatchObject({ success: true, tier: 1, path: "/" });
    expect(t1.origin).toMatch(/^http:\/\/[a-z2-7]{26}\.localhost:8000$/);
    for (const k of ["expiresAt", "tokenId", "policy"]) expect(t1[k], k).toBeDefined();
    for (const bad of ["origin", [], ["ORIGIN"], ["bogus"]]) {
      const r = await mint(app, { accept: bad });
      expect(r.statusCode).toBe(200);
      expect(r.json().tier).toBe("legacy");
    }
    expect((await mint(app, { accept: ["bogus", "origin"] }, { origin: "http://localhost:8000" })).json().tier).toBe(1);
  });
  it("a tier-5 outcome is the legacy path until group 8 mints /preview/<pid>/", async () => {
    const { app } = await mk();
    const r = (await mint(app, { accept: ["preview"] })).json();
    expect(r.tier).toBe("legacy");
    expect(r.path).toContain("/live/vite-5173/~c/");
  });
  it("re-mint from the same dashboard origin reuses the live entry; a different ancestors origin gets a NEW entry (E153)", async () => {
    const { app, store } = await mk();
    const a = (await mint(app, { accept: ACCEPT }, { origin: "http://localhost:8000" })).json();
    const b = (await mint(app, { accept: ACCEPT }, { origin: "http://localhost:8000" })).json();
    expect(b.origin).toBe(a.origin);
    expect(store.size()).toBe(1);
    const c = (await mint(app, { accept: ACCEPT }, { origin: "http://127.0.0.1:8000" })).json();
    expect(c.origin).not.toBe(a.origin);
    expect(store.size()).toBe(2);
  });
  it("E39: tier 2 shape through the route", async () => {
    const { app } = await mk(resolve({ enabled: true, wildcard: { suffix: "preview.example.com", forHosts: ["dash.example.com"] } }));
    const r = (await mint(app, { accept: ACCEPT }, { host: "dash.example.com", origin: "https://dash.example.com" })).json();
    expect(r).toMatchObject({ tier: 2, path: "/" });
    expect(r.origin).toMatch(/^https:\/\/[a-z2-7]{26}\.preview\.example\.com$/);
  });
});
