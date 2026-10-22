/**
 * Route checker — proof outcome matrix, access leg, latency, bounded concurrency,
 * and "an advert is a hint: a refused route only ever sees the challenge".
 * Uses REAL Ed25519 (WebCrypto) behind a stubbed `fetch`, so the proof path
 * (fingerprint recomputed from the key, signature verified) is exercised, not mocked.
 *
 * See change: group-servers-by-identity (tasks 5.1/5.2; test-plan #X4, #X5, #P1).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkRoute, createRouteChecker, isUsableCheck, ROUTE_CHECK_CONCURRENCY, routeBaseUrl } from "../server-route-check.js";

const b64url = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromB64url = (text: string): Uint8Array => {
  const pad = "=".repeat((4 - (text.length % 4)) % 4);
  return Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/") + pad), (c) => c.charCodeAt(0));
};

interface Identity {
  fingerprint: string;
  publicKey: string;
  sign: (nonce: string) => Promise<string>;
}

async function makeIdentity(): Promise<Identity> {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" } as never, true, ["sign", "verify"])) as CryptoKeyPair;
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  const digest = await crypto.subtle.digest("SHA-256", spki as unknown as ArrayBuffer);
  return {
    fingerprint: `sha256:${b64url(digest)}`,
    publicKey: b64url(spki),
    sign: async (nonce) => b64url(await crypto.subtle.sign({ name: "Ed25519" } as never, pair.privateKey, new TextEncoder().encode(nonce))),
  };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const ROUTE = { host: "192.168.16.204", port: 8000, scheme: "http" as const };

type Handler = (nonce: string) => Promise<Response> | Response;
/** Stub fetch: `challenge` answers POST /api/pair/challenge, `health` answers GET /api/health. */
function stubServer(challenge: Handler | "transport", health: () => Response | "transport" = () => json(200, { ok: true })) {
  const calls: Array<{ url: string; method: string; headers: Headers }> = [];
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    calls.push({ url: u, method, headers: new Headers(init?.headers) });
    if (u.endsWith("/api/pair/challenge")) {
      if (challenge === "transport") throw new TypeError("Failed to fetch");
      return challenge(JSON.parse(String(init?.body)).nonce);
    }
    if (u.endsWith("/api/health")) {
      const h = health();
      if (h === "transport") throw new TypeError("Failed to fetch");
      return h;
    }
    return json(404, {});
  });
  vi.stubGlobal("fetch", f);
  return { f, calls };
}

const provingAs = (id: Identity): Handler => async (nonce) =>
  json(200, { success: true, data: { fingerprint: id.fingerprint, publicKey: id.publicKey, signature: await id.sign(nonce), v: 1 } });

let F: Identity;
let G: Identity;
beforeEach(async () => {
  F = await makeIdentity();
  G = await makeIdentity();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("routeBaseUrl", () => {
  it("brackets IPv6 and keeps the scheme", () => {
    expect(routeBaseUrl({ host: "fd12::4", port: 8000, scheme: "http" })).toBe("http://[fd12::4]:8000");
    expect(routeBaseUrl({ host: "b0x7.share.zrok.io", port: 443, scheme: "https" })).toBe("https://b0x7.share.zrok.io:443");
  });
});

describe("X4 route proof outcome matrix", () => {
  it("proves F + health 200 → proven, usable", async () => {
    stubServer(provingAs(F));
    const out = await checkRoute(ROUTE, { expectedFingerprint: F.fingerprint });
    expect(out).toMatchObject({ kind: "proven", fingerprint: F.fingerprint, access: "ok" });
    expect(isUsableCheck(out)).toBe(true);
  });

  it("proves F + health 403 network_not_allowed → proven + Network not allowed (not usable)", async () => {
    stubServer(provingAs(F), () => json(403, { success: false, error: "network_not_allowed" }));
    const out = await checkRoute(ROUTE, { expectedFingerprint: F.fingerprint });
    expect(out).toMatchObject({ kind: "proven", access: "network-not-allowed" });
    expect(isUsableCheck(out)).toBe(false);
  });

  it("a 403 that is not network_not_allowed, or a health transport failure, is access unavailable", async () => {
    stubServer(provingAs(F), () => json(403, { error: "forbidden" }));
    expect(await checkRoute(ROUTE, { expectedFingerprint: F.fingerprint })).toMatchObject({ kind: "proven", access: "unavailable" });
    stubServer(provingAs(F), () => "transport");
    expect(await checkRoute(ROUTE, { expectedFingerprint: F.fingerprint })).toMatchObject({ kind: "proven", access: "unavailable" });
  });

  it("valid proof of G while F is expected → different identity naming G", async () => {
    stubServer(provingAs(G));
    expect(await checkRoute(ROUTE, { expectedFingerprint: F.fingerprint })).toEqual({
      kind: "different-identity",
      fingerprint: G.fingerprint,
    });
  });

  it("a server claiming F but holding another key is G, not F (fingerprint is recomputed from the key)", async () => {
    stubServer(async (nonce) =>
      json(200, { success: true, data: { fingerprint: F.fingerprint, publicKey: G.publicKey, signature: await G.sign(nonce), v: 1 } }),
    );
    expect(await checkRoute(ROUTE, { expectedFingerprint: F.fingerprint })).toEqual({
      kind: "different-identity",
      fingerprint: G.fingerprint,
    });
  });

  it("signature with one flipped byte → invalid identity proof", async () => {
    stubServer(async (nonce) => {
      const sig = fromB64url(await F.sign(nonce));
      sig[0] ^= 0xff;
      return json(200, { success: true, data: { fingerprint: F.fingerprint, publicKey: F.publicKey, signature: b64url(sig), v: 1 } });
    });
    expect(await checkRoute(ROUTE, { expectedFingerprint: F.fingerprint })).toEqual({ kind: "invalid-proof" });
  });

  it("unparseable public key → invalid identity proof", async () => {
    stubServer(async (nonce) =>
      json(200, { success: true, data: { fingerprint: F.fingerprint, publicKey: "AAAA", signature: await F.sign(nonce), v: 1 } }),
    );
    expect(await checkRoute(ROUTE, { expectedFingerprint: F.fingerprint })).toEqual({ kind: "invalid-proof" });
  });

  it("challenge 404 (older server) → can't prove identity, not usable", async () => {
    stubServer(() => json(404, {}));
    const out = await checkRoute(ROUTE, { expectedFingerprint: F.fingerprint });
    expect(out).toEqual({ kind: "cant-prove" });
    expect(isUsableCheck(out)).toBe(false);
  });

  it("challenge 200 without publicKey → can't prove identity", async () => {
    stubServer(() => json(200, { success: true, data: { fingerprint: F.fingerprint } }));
    expect(await checkRoute(ROUTE, { expectedFingerprint: F.fingerprint })).toEqual({ kind: "cant-prove" });
  });

  it("transport failure → unreachable", async () => {
    stubServer("transport");
    expect(await checkRoute(ROUTE, { expectedFingerprint: F.fingerprint })).toEqual({ kind: "unreachable" });
  });

  it("a stalled challenge is aborted at the 2 s bound → unreachable", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_u: string, init?: RequestInit) => new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))))),
    );
    const p = checkRoute(ROUTE, { expectedFingerprint: F.fingerprint });
    await vi.advanceTimersByTimeAsync(1999);
    let settled = false;
    void p.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toEqual({ kind: "unreachable" });
  });

  it("a browser without WebCrypto Ed25519 → can't prove in this browser (NotSupportedError)", async () => {
    stubServer(provingAs(F));
    const subtle = crypto.subtle;
    vi.spyOn(subtle, "importKey").mockRejectedValue(new DOMException("Unrecognized name", "NotSupportedError"));
    expect(await checkRoute(ROUTE, { expectedFingerprint: F.fingerprint })).toEqual({ kind: "cant-prove-in-browser" });
  });

  it("no WebCrypto at all (insecure context) → can't prove in this browser, and nothing is requested", async () => {
    const { f } = stubServer(provingAs(F));
    vi.stubGlobal("crypto", { getRandomValues: crypto.getRandomValues.bind(crypto) });
    expect(await checkRoute(ROUTE, { expectedFingerprint: F.fingerprint })).toEqual({ kind: "cant-prove-in-browser" });
    expect(f).not.toHaveBeenCalled();
  });

  it("latency is the challenge round trip (health time is not included)", async () => {
    let t = 1000;
    stubServer(async (nonce) => {
      t += 40; // the challenge takes 40 ms
      return provingAs(F)(nonce);
    }, () => {
      t += 900; // health is slow, and must not count
      return json(200, { ok: true });
    });
    const out = await checkRoute(ROUTE, { expectedFingerprint: F.fingerprint, now: () => t });
    expect(out).toMatchObject({ kind: "proven", latencyMs: 40 });
  });

  it("without an expected fingerprint a valid proof is proven and reports what it proved", async () => {
    stubServer(provingAs(G));
    expect(await checkRoute(ROUTE)).toMatchObject({ kind: "proven", fingerprint: G.fingerprint });
  });

  it("https routes are challenged over https at the stored host and port", async () => {
    const { calls } = stubServer(provingAs(F));
    await checkRoute({ host: "b0x7.share.zrok.io", port: 443, scheme: "https" }, { expectedFingerprint: F.fingerprint });
    expect(calls.map((c) => c.url)).toEqual([
      "https://b0x7.share.zrok.io:443/api/pair/challenge",
      "https://b0x7.share.zrok.io:443/api/health",
    ]);
  });
});

describe("X5 an advert is a hint: a refused route gets only POST /api/pair/challenge", () => {
  it.each([
    ["proves G", () => provingAs(G)],
    ["answers 404", () => () => json(404, {})],
  ])("advert claims F but the challenge %s → only the challenge request, no Authorization", async (_l, mk) => {
    const { calls } = stubServer(mk());
    const out = await checkRoute({ host: "192.168.16.204", port: 8000, scheme: "http" }, { expectedFingerprint: F.fingerprint });
    expect(isUsableCheck(out)).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "POST" });
    expect(calls[0].url.endsWith("/api/pair/challenge")).toBe(true);
    expect(calls[0].headers.get("authorization")).toBeNull();
  });
});

describe("5.1/P1 bounded concurrency", () => {
  it("12 routes that never answer: at most 6 in flight at every instant, all unreachable by 8 s", async () => {
    vi.useFakeTimers();
    let active = 0;
    let max = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_u: string, init?: RequestInit) =>
          new Promise((_res, rej) => {
            active += 1;
            max = Math.max(max, active);
            init?.signal?.addEventListener("abort", () => {
              active -= 1;
              rej(new DOMException("aborted", "AbortError"));
            });
          }),
      ),
    );
    const checker = createRouteChecker();
    const results: unknown[] = [];
    const routes = Array.from({ length: 12 }, (_, i) => ({ host: `10.0.0.${i + 1}`, port: 8000, scheme: "http" as const }));
    for (const r of routes) void checker.check(r, F.fingerprint).then((c) => results.push(c));
    await vi.advanceTimersByTimeAsync(8000);
    expect(max).toBeLessThanOrEqual(ROUTE_CHECK_CONCURRENCY);
    expect(max).toBe(6);
    expect(results).toHaveLength(12);
    expect(results.every((c) => (c as { kind: string }).kind === "unreachable")).toBe(true);
  });

  it("5 routes that answer at once never exceed 5 in flight and settle immediately", async () => {
    let active = 0;
    let max = 0;
    const server = provingAs(F);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
        active += 1;
        max = Math.max(max, active);
        try {
          await Promise.resolve();
          return String(u).endsWith("/api/health") ? json(200, { ok: true }) : await server(JSON.parse(String(init?.body)).nonce);
        } finally {
          active -= 1;
        }
      }),
    );
    const checker = createRouteChecker();
    const routes = Array.from({ length: 5 }, (_, i) => ({ host: `10.0.0.${i + 1}`, port: 8000, scheme: "http" as const }));
    const out = await Promise.all(routes.map((r) => checker.check(r, F.fingerprint)));
    expect(max).toBeLessThanOrEqual(5);
    expect(out.every((c) => c.kind === "proven")).toBe(true);
  });

  it("results are cached per checker (one round per menu open), keyed by route and expected fingerprint", async () => {
    const { f } = stubServer(provingAs(F));
    const checker = createRouteChecker();
    const a = await checker.check(ROUTE, F.fingerprint);
    const b = await checker.check({ ...ROUTE, host: "192.168.16.204" }, F.fingerprint);
    expect(b).toBe(a);
    expect(f).toHaveBeenCalledTimes(2); // one challenge + one health, once
    await createRouteChecker().check(ROUTE, F.fingerprint);
    expect(f).toHaveBeenCalledTimes(4); // a new open checks again
  });
});
