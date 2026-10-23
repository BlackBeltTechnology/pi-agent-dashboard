/**
 * harden-cors-and-csp-reporting — B19 + R2 (test-plan #WE1–#WE4, #WE7–#WE9, #WE55, #WX2).
 *
 * B19: the zrok wildcard is OFF on the read path unless `allowZrokWildcard === true`.
 * R2: tunnel-URL comparison is canonical (case, default port, one trailing dot, path).
 *
 * See change: harden-cors-and-csp-reporting.
 */
import cors from "@fastify/cors";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import {
  type CorsOriginOptions,
  canonicalOrigin,
  classifyCorsOrigin,
  isCorsOriginAllowed,
  isOriginAdmitted,
  isSameOriginByHost,
} from "../auth/cors-origin.js";
import { createCorsDenialObserver } from "../access/cors-denial.js";

const TUNNEL = "https://abc.shares.zrok.io";

function opts(over: Partial<CorsOriginOptions> = {}): CorsOriginOptions {
  return { configuredOrigins: [], trustedNetworks: [], ...over };
}

describe("canonicalOrigin (R2)", () => {
  it.each([
    ["HTTPS://ABC.Shares.Zrok.IO", "https://abc.shares.zrok.io"],
    ["https://abc.shares.zrok.io:443/path", "https://abc.shares.zrok.io"],
    ["http://abc.shares.zrok.io:80/", "http://abc.shares.zrok.io"],
    ["https://ABC.shares.zrok.io.:443", "https://abc.shares.zrok.io"],
    ["https://abc.shares.zrok.io:8443/", "https://abc.shares.zrok.io:8443"],
  ])("%s → %s", (raw, want) => expect(canonicalOrigin(raw)).toBe(want));

  it.each(["", "not a url", "null", "https://", "https://abc.shares.zrok.io:99999", "ftp://x.example"])(
    "malformed %j → null",
    (raw) => expect(canonicalOrigin(raw)).toBeNull(),
  );

  it("strips exactly one trailing dot", () => {
    expect(canonicalOrigin("https://abc.shares.zrok.io..")).toBe("https://abc.shares.zrok.io.");
  });
});

describe("WE1 — Origin variants vs the live tunnel (wildcard unset)", () => {
  const A = [
    "HTTPS://ABC.Shares.Zrok.IO",
    "https://abc.shares.zrok.io:443",
    "https://abc.shares.zrok.io.",
    "https://ABC.shares.zrok.io.:443",
    "https://abc.shares.zrok.io/",
  ];
  const B = [
    "https://abc.shares.zrok.io:8443",
    "https://abc.shares.zrok.io:80",
    "http://abc.shares.zrok.io",
    "http://abc.shares.zrok.io:443",
    "https://abc.shares.zrok.io..",
    "https://xabc.shares.zrok.io",
    "https://abc.shares.zrok.io.attacker.com",
  ];
  for (const [label, o, kind] of [
    ["getTunnelUrl", opts({ getTunnelUrl: () => TUNNEL }), "active-tunnel"],
    ["getLiveTunnelOrigins", opts({ getLiveTunnelOrigins: () => [TUNNEL] }), "live-tunnel"],
  ] as const) {
    it.each(A)(`${label}: %s admitted as ${kind}`, (origin) => {
      expect(classifyCorsOrigin(origin, o)).toMatchObject({ allowed: true, kind });
    });
    it.each(B)(`${label}: %s denied`, (origin) => {
      expect(classifyCorsOrigin(origin, o)).toMatchObject({ allowed: false, kind: "denied" });
    });
  }
});

describe("WE2 — recorded tunnel URL forms", () => {
  it.each([
    "https://abc.shares.zrok.io:443/",
    "https://ABC.shares.zrok.io./",
    "https://abc.shares.zrok.io:443/path",
    "http://abc.shares.zrok.io:80/",
  ])("%s admits the canonical-equivalent origin", (url) => {
    const canonical = new URL(url).protocol === "http:" ? "http://abc.shares.zrok.io" : TUNNEL;
    for (const o of [opts({ getTunnelUrl: () => url }), opts({ getLiveTunnelOrigins: () => [url] })]) {
      expect(classifyCorsOrigin(canonical, o).allowed).toBe(true);
      expect(classifyCorsOrigin(`${canonical}:${canonical.startsWith("https") ? 443 : 80}`, o).allowed).toBe(true);
    }
  });

  it(":8443 URL admits only the explicit-port origin", () => {
    const url = "https://abc.shares.zrok.io:8443/";
    for (const o of [opts({ getTunnelUrl: () => url }), opts({ getLiveTunnelOrigins: () => [url] })]) {
      expect(classifyCorsOrigin("https://abc.shares.zrok.io:8443", o).allowed).toBe(true);
      expect(classifyCorsOrigin(TUNNEL, o).allowed).toBe(false);
    }
  });
});

describe("WE3 — isSameOriginByHost canonical Host", () => {
  it.each(["ABC.shares.zrok.io", "abc.shares.zrok.io:443", "abc.shares.zrok.io."])("Host %s → true", (host) => {
    expect(isSameOriginByHost(TUNNEL, host, opts({ hostGateMode: "report" }))).toBe(true);
  });
  it.each(["abc.shares.zrok.io:8443", "abc.shares.zrok.io:80"])("Host %s → false", (host) => {
    expect(isSameOriginByHost(TUNNEL, host, opts({ hostGateMode: "report" }))).toBe(false);
  });
});

describe("WE4 — allowZrokWildcard is true-only", () => {
  const values: unknown[] = [undefined, false, true, "true", 1, "TRUE", null, {}];
  const origins = [
    ["https://other.share.zrok.io", true],
    ["https://other.shares.zrok.io", true],
    ["https://shares.zrok.io", false],
    ["https://evilshares.zrok.io", false],
    ["https://share.zrok.io.attacker.com", false],
  ] as const;
  for (const v of values) {
    for (const live of [true, false]) {
      it(`allowZrokWildcard=${JSON.stringify(v)} live=${live}`, () => {
        const o = opts({
          allowZrokWildcard: v as boolean | undefined,
          ...(live ? { getLiveTunnelOrigins: () => [TUNNEL] } : {}),
        });
        expect(classifyCorsOrigin(TUNNEL, o).allowed).toBe(live || v === true);
        for (const [origin, suffix] of origins) {
          const c = classifyCorsOrigin(origin, o);
          expect(c.allowed).toBe(v === true && suffix);
          if (c.allowed) expect(c.kind).toBe("zrok-wildcard");
        }
      });
    }
  }
});

describe("WE7 — admission forces the wildcard off", () => {
  it("non-live zrok origin denied, live tunnel admitted", () => {
    const o = opts({ allowZrokWildcard: true, getLiveTunnelOrigins: () => [TUNNEL] });
    expect(isOriginAdmitted("https://other.share.zrok.io", "localhost:8000", o)).toBe(false);
    expect(isOriginAdmitted(TUNNEL, "localhost:8000", o)).toBe(true);
  });
});

describe("WE8 — live tunnel transitions without restart", () => {
  it("follows connect / rotate / disconnect / reconnect", () => {
    let zrok: string | null = "https://abc.shares.zrok.io";
    let live: string[] = [zrok];
    const tailscale = "https://box.tailnet.ts.net";
    const o = opts({ getTunnelUrl: () => zrok, getLiveTunnelOrigins: () => live });
    const ok = (x: string) => classifyCorsOrigin(x, o).allowed;
    expect([ok("https://abc.shares.zrok.io"), ok("https://def.shares.zrok.io")]).toEqual([true, false]);
    zrok = "https://def.shares.zrok.io";
    live = [zrok];
    expect([ok("https://abc.shares.zrok.io"), ok("https://def.shares.zrok.io")]).toEqual([false, true]);
    zrok = null;
    live = [];
    expect([ok("https://abc.shares.zrok.io"), ok("https://def.shares.zrok.io")]).toEqual([false, false]);
    zrok = "https://abc.shares.zrok.io";
    live = [zrok, tailscale];
    expect([ok("https://abc.shares.zrok.io"), ok(tailscale)]).toEqual([true, true]);
    live = [zrok];
    expect([ok("https://abc.shares.zrok.io"), ok(tailscale)]).toEqual([true, false]);
  });
});

describe("WE9 — a non-live zrok origin is denied exactly like any stranger", () => {
  it("no ACAO, one denial record each, same shape and status as the control", async () => {
    const o = opts();
    const denials: Array<{ origin: string; kind: string }> = [];
    const app = Fastify();
    const observe = createCorsDenialObserver(() => o, (origin) => denials.push({ origin, kind: classifyCorsOrigin(origin, o).kind }));
    app.addHook("onRequest", observe);
    await app.register(cors, { origin: (origin, cb) => cb(null, isCorsOriginAllowed(origin ?? undefined, o)), credentials: true });
    app.get("/x", async () => ({ ok: true }));
    await app.ready();
    const res: Record<string, { status: number; acao: unknown; pre: unknown }> = {};
    for (const origin of ["https://other.share.zrok.io", "https://evil.example"]) {
      const get = await app.inject({ method: "GET", url: "/x", headers: { origin } });
      const pre = await app.inject({
        method: "OPTIONS",
        url: "/x",
        headers: { origin, "access-control-request-method": "GET" },
      });
      res[origin] = { status: get.statusCode, acao: get.headers["access-control-allow-origin"], pre: pre.headers["access-control-allow-origin"] };
    }
    await app.close();
    expect(res["https://other.share.zrok.io"]).toEqual(res["https://evil.example"]);
    expect(res["https://other.share.zrok.io"].acao).toBeUndefined();
    expect(res["https://other.share.zrok.io"].pre).toBeUndefined();
    const zrok = denials.filter((d) => d.origin === "https://other.share.zrok.io");
    const control = denials.filter((d) => d.origin === "https://evil.example");
    expect(zrok.length).toBe(control.length);
    expect(zrok.map((d) => d.kind)).toEqual(control.map((d) => d.kind));
  });
});

describe("WE55 — trailing-dot / case variants of the opt-in wildcard", () => {
  const o = opts({ allowZrokWildcard: true });
  it.each([
    "https://x.shares.zrok.io",
    "https://x.shares.zrok.io.",
    "https://X.SHARES.ZROK.IO:443",
    "https://x.share.zrok.io.",
  ])("%s → zrok-wildcard", (origin) => {
    expect(classifyCorsOrigin(origin, o)).toMatchObject({ allowed: true, kind: "zrok-wildcard" });
  });
  it.each(["https://shares.zrok.io.", "https://evilshares.zrok.io."])("%s → denied", (origin) => {
    expect(classifyCorsOrigin(origin, o).allowed).toBe(false);
  });
});

describe("WX2 — malformed inputs never throw", () => {
  it("skips malformed live entries, honours the valid one", () => {
    const o = opts({ getLiveTunnelOrigins: () => ["", "not a url", "https://abc.shares.zrok.io:99999", TUNNEL] });
    expect(classifyCorsOrigin(TUNNEL, o).allowed).toBe(true);
  });
  it("a throwing getter means no live tunnels", () => {
    const boom = () => {
      throw new Error("boom");
    };
    const o = opts({ getLiveTunnelOrigins: boom, getTunnelUrl: boom });
    expect(() => classifyCorsOrigin(TUNNEL, o)).not.toThrow();
    expect(classifyCorsOrigin(TUNNEL, o).allowed).toBe(false);
    expect(isOriginAdmitted(TUNNEL, "x", o)).toBe(false);
  });
  it.each(["https://", " https://abc.shares.zrok.io ", "https://abc.shares.zrok.io\u0000", `https://${"a".repeat(10_000)}.example`])(
    "malformed Origin %#→ denied",
    (origin) => {
      const o = opts({ getLiveTunnelOrigins: () => [TUNNEL], getTunnelUrl: () => TUNNEL, allowZrokWildcard: true });
      expect(classifyCorsOrigin(origin, o).allowed).toBe(false);
      expect(isOriginAdmitted(origin, "x", o)).toBe(false);
    },
  );
});
