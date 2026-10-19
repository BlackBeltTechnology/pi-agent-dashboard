import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDnsApi, type AuthoritativeResolver } from "../dns.js";

/**
 * DNS discovery (SOA walk / NS / NS addresses over DoH) and authoritative propagation waits.
 * Fake timers + injected fetch/resolvers; no real network.
 * See change: add-acme-dns01-certs (D3; tests E17, E36, X1, X2).
 */

interface DohCall {
  host: string;
  name: string;
  type: string;
}

const NS = [
  { host: "ns1.example.com", ip: "10.0.0.1" },
  { host: "ns2.example.com", ip: "10.0.0.2" },
];

/** DoH fake: zone `example.com` with NS1/NS2; `failHosts` simulates an unreachable DoH endpoint. */
function makeFetch(opts: { failHosts?: string[]; txt?: Record<string, Record<string, string[]>> } = {}) {
  const calls: DohCall[] = [];
  const impl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const name = (url.searchParams.get("name") ?? "").toLowerCase();
    const type = url.searchParams.get("type") ?? "";
    calls.push({ host: url.host, name, type });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    if (opts.failHosts?.includes(url.host)) throw new Error("fetch failed");
    const answer: Array<{ name: string; type: number; data: string }> = [];
    if (type === "SOA" && name === "example.com") answer.push({ name: "example.com.", type: 6, data: "ns1.example.com. h.example.com. 1 2 3 4 5" });
    if (type === "NS" && name === "example.com") for (const n of NS) answer.push({ name: "example.com.", type: 2, data: `${n.host}.` });
    if (type === "A") for (const n of NS) if (name === n.host) answer.push({ name, type: 1, data: n.ip });
    if (type === "TXT") {
      const values = opts.txt?.[url.host]?.[name] ?? [];
      for (const v of values) answer.push({ name, type: 16, data: `"${v}"` });
    }
    return new Response(JSON.stringify({ Status: answer.length ? 0 : 3, Answer: answer.length ? answer : undefined }), { status: 200 });
  });
  return { impl: impl as unknown as typeof fetch, calls, spy: impl };
}

function notFound(): Error {
  return Object.assign(new Error("queryTxt ENODATA"), { code: "ENODATA" });
}

describe("discoverZone", () => {
  it("walks suffixes for SOA then resolves NS names to addresses over DoH", async () => {
    const f = makeFetch();
    const api = createDnsApi({ fetchImpl: f.impl, resolverFactory: () => ({ resolveTxt: async () => [], resolveCname: async () => [] }) });
    const zone = await api.discoverZone("_acme-challenge.dash.example.com");
    expect(zone.zone).toBe("example.com");
    expect(zone.servers).toEqual([
      { host: "ns1.example.com", addresses: ["10.0.0.1"] },
      { host: "ns2.example.com", addresses: ["10.0.0.2"] },
    ]);
    const soaNames = f.calls.filter((c) => c.type === "SOA").map((c) => c.name);
    expect(soaNames).toEqual(["_acme-challenge.dash.example.com", "dash.example.com", "example.com"]);
  });

  it("falls over to the second DoH resolver when the first is unreachable", async () => {
    const f = makeFetch({ failHosts: ["cloudflare-dns.com"] });
    const api = createDnsApi({ fetchImpl: f.impl, resolverFactory: () => ({ resolveTxt: async () => [], resolveCname: async () => [] }) });
    expect((await api.discoverZone("dash.example.com")).zone).toBe("example.com");
    expect(f.calls.some((c) => c.host === "dns.google")).toBe(true);
  });

  it("rejects when both DoH resolvers are unreachable (E36 fault: DoH timeout)", async () => {
    const f = makeFetch({ failHosts: ["cloudflare-dns.com", "dns.google"] });
    const api = createDnsApi({ fetchImpl: f.impl, resolverFactory: () => ({ resolveTxt: async () => [], resolveCname: async () => [] }) });
    await expect(api.discoverZone("dash.example.com")).rejects.toThrow(/DoH/);
  });

  it("rejects when no SOA exists for any suffix", async () => {
    const f = makeFetch();
    const api = createDnsApi({ fetchImpl: f.impl, resolverFactory: () => ({ resolveTxt: async () => [], resolveCname: async () => [] }) });
    await expect(api.discoverZone("dash.nowhere.test")).rejects.toThrow(/zone/i);
  });

  it("authoritativeOverride replaces discovery: single server, no DoH calls", async () => {
    const f = makeFetch();
    const api = createDnsApi({
      fetchImpl: f.impl,
      authoritativeOverride: { host: "127.0.0.1", port: 8053 },
      resolverFactory: () => ({ resolveTxt: async () => [], resolveCname: async () => [] }),
    });
    const zone = await api.discoverZone("dash.example.com");
    expect(zone.servers).toEqual([{ host: "127.0.0.1", addresses: ["127.0.0.1"] }]);
    expect(f.calls).toHaveLength(0);
  });

  it("uses the override port for queries", async () => {
    const seen: Array<{ addresses: string[]; port: number }> = [];
    const api = createDnsApi({
      authoritativeOverride: { host: "127.0.0.1", port: 8053 },
      resolverFactory: (addresses, port) => {
        seen.push({ addresses, port });
        return { resolveTxt: async () => [["v"]], resolveCname: async () => [] };
      },
    });
    await api.waitForTxt("_acme-challenge.dash.example.com", "v", {});
    expect(seen).toEqual([{ addresses: ["127.0.0.1"], port: 8053 }]);
  });
});

describe("resolveCnameAtAuthoritative (E17)", () => {
  it("queries only the discovered NS addresses and normalizes targets", async () => {
    const f = makeFetch();
    const asked: string[] = [];
    const api = createDnsApi({
      fetchImpl: f.impl,
      resolverFactory: (addresses) => {
        asked.push(addresses.join(","));
        return {
          resolveTxt: async () => [],
          resolveCname: async () => (addresses[0] === "10.0.0.1" ? ["Abc.Auth.Acme-DNS.io."] : (() => { throw notFound(); })()),
        };
      },
    });
    const r = await api.resolveCnameAtAuthoritative("_acme-challenge.dash.example.com");
    expect(asked).toEqual(["10.0.0.1", "10.0.0.2"]);
    expect(r.targets).toEqual(["abc.auth.acme-dns.io"]);
    expect(r.perServer).toEqual([
      { server: "ns1.example.com", target: "abc.auth.acme-dns.io" },
      { server: "ns2.example.com", target: null },
    ]);
  });

  it("reports per-server errors; throws when every server errored", async () => {
    const f = makeFetch();
    const api = createDnsApi({
      fetchImpl: f.impl,
      resolverFactory: (addresses) => ({
        resolveTxt: async () => [],
        resolveCname: async () => {
          if (addresses[0] === "10.0.0.2") return ["t.example.net"];
          throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
        },
      }),
    });
    const r = await api.resolveCnameAtAuthoritative("_acme-challenge.dash.example.com");
    expect(r.perServer[0]).toMatchObject({ server: "ns1.example.com", target: null, error: expect.stringContaining("ECONNREFUSED") });

    const dead = createDnsApi({
      fetchImpl: f.impl,
      resolverFactory: () => ({
        resolveTxt: async () => [],
        resolveCname: async () => {
          throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
        },
      }),
    });
    await expect(dead.resolveCnameAtAuthoritative("_acme-challenge.dash.example.com")).rejects.toThrow(/ECONNREFUSED/);
  });
});

describe("waitForTxt — authoritative propagation (X1)", () => {
  const OWNER = "_acme-challenge.dash.example.com";
  let t0: number;
  beforeEach(() => {
    vi.useFakeTimers();
    t0 = Date.now();
  });
  afterEach(() => vi.useRealTimers());

  const elapsed = () => Date.now() - t0;

  it("waits for a lagging server and succeeds at 175 s", async () => {
    const f = makeFetch();
    const api = createDnsApi({
      fetchImpl: f.impl,
      resolverFactory: (addresses) => ({
        resolveCname: async () => [],
        resolveTxt: async () => {
          if (addresses[0] === "10.0.0.1" || elapsed() >= 175_000) return [["tok"]];
          throw notFound();
        },
      }),
    });
    const p = api.waitForTxt(OWNER, "tok", {});
    let done = false;
    void p.then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(174_000);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(p).resolves.toEqual({ mode: "authoritative" });
    expect(elapsed()).toBeLessThanOrEqual(176_000);
  });

  it("fails at 180 s naming the lagging server; rounds stay 5 s apart despite a hung server", async () => {
    const f = makeFetch();
    const rounds: number[] = [];
    const api = createDnsApi({
      fetchImpl: f.impl,
      resolverFactory: (addresses) => ({
        resolveCname: async () => [],
        resolveTxt: async () => {
          if (addresses[0] === "10.0.0.1") {
            rounds.push(elapsed());
            return [["tok"]];
          }
          return new Promise<string[][]>(() => {}); // never answers
        },
      }),
    });
    const p = api.waitForTxt(OWNER, "tok", {});
    const assertion = expect(p).rejects.toThrow(/ns2\.example\.com/);
    await vi.advanceTimersByTimeAsync(180_000);
    await assertion;
    expect(elapsed()).toBe(180_000);
    expect(rounds[0]).toBe(0);
    expect(rounds[1]).toBe(5_000);
    expect(rounds[2]).toBe(10_000);
    expect(rounds.at(-1)).toBe(175_000);
    // a server that already has the value is not reported as lagging
    await p.catch((e: Error) => expect(e.message).not.toMatch(/ns1\.example\.com/));
  });

  it("a non-answering server counts as lagging after 3 s, not later", async () => {
    const f = makeFetch();
    let hungSince = -1;
    const api = createDnsApi({
      fetchImpl: f.impl,
      resolverFactory: (addresses) => ({
        resolveCname: async () => [],
        resolveTxt: async () => {
          if (addresses[0] === "10.0.0.1") return [["tok"]];
          if (hungSince < 0) hungSince = elapsed();
          return new Promise<string[][]>(() => {});
        },
      }),
    });
    const p = api.waitForTxt(OWNER, "tok", { timeoutMs: 20_000 });
    const assertion = expect(p).rejects.toThrow(/ns2\.example\.com.*(no answer|timed out)/s);
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
  });

  it("honours an explicit timeoutMs/intervalMs and an abort signal", async () => {
    const f = makeFetch();
    let calls = 0;
    const api = createDnsApi({
      fetchImpl: f.impl,
      resolverFactory: () => ({
        resolveCname: async () => [],
        resolveTxt: async () => {
          calls++;
          throw notFound();
        },
      }),
    });
    const p = api.waitForTxt(OWNER, "tok", { timeoutMs: 12_000, intervalMs: 4_000 });
    const assertion = expect(p).rejects.toThrow(/12s/);
    await vi.advanceTimersByTimeAsync(12_000);
    await assertion;
    expect(calls).toBe(3 * NS.length); // rounds at 0, 4, 8 s

    const ac = new AbortController();
    const q = api.waitForTxt(OWNER, "tok", { signal: ac.signal });
    const qa = expect(q).rejects.toThrow(/abort/i);
    await vi.advanceTimersByTimeAsync(7_000);
    ac.abort();
    await qa;
  });

  it("matches multi-string TXT records by concatenation", async () => {
    const f = makeFetch();
    const api = createDnsApi({
      fetchImpl: f.impl,
      resolverFactory: () => ({ resolveCname: async () => [], resolveTxt: async () => [["to", "k"]] }),
    });
    await expect(api.waitForTxt(OWNER, "tok", {})).resolves.toEqual({ mode: "authoritative" });
  });
});

describe("waitForTxt — DoH fallback (X2)", () => {
  const OWNER = "_acme-challenge.dash.example.com";
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const refused: AuthoritativeResolver = {
    resolveCname: async () => {
      throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
    },
    resolveTxt: async () => {
      throw Object.assign(new Error("refused"), { code: "ECONNREFUSED" });
    },
  };

  it("proceeds only once BOTH DoH resolvers return the value", async () => {
    const txt: Record<string, Record<string, string[]>> = { "cloudflare-dns.com": { [OWNER]: ["tok"] }, "dns.google": {} };
    const f = makeFetch({ txt });
    const api = createDnsApi({ fetchImpl: f.impl, resolverFactory: () => refused });
    const p = api.waitForTxt(OWNER, "tok", {});
    let done = false;
    void p.then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(done).toBe(false);
    txt["dns.google"][OWNER] = ["tok"];
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(p).resolves.toEqual({ mode: "doh-fallback" });
  });

  it("fails naming the DoH resolver that never returned the value", async () => {
    const f = makeFetch({ txt: { "cloudflare-dns.com": { [OWNER]: ["tok"] } } });
    const api = createDnsApi({ fetchImpl: f.impl, resolverFactory: () => refused });
    const p = api.waitForTxt(OWNER, "tok", { timeoutMs: 20_000 });
    const assertion = expect(p).rejects.toThrow(/dns\.google/);
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
  });

  it("does not fall back when some server merely lacks the record", async () => {
    const f = makeFetch({ txt: { "cloudflare-dns.com": { [OWNER]: ["tok"] }, "dns.google": { [OWNER]: ["tok"] } } });
    const api = createDnsApi({
      fetchImpl: f.impl,
      resolverFactory: (addresses) => (addresses[0] === "10.0.0.1" ? refused : { resolveCname: async () => [], resolveTxt: async () => { throw notFound(); } }),
    });
    const p = api.waitForTxt(OWNER, "tok", { timeoutMs: 10_000 });
    const assertion = expect(p).rejects.toThrow(/ns1\.example\.com|ns2\.example\.com/);
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    expect(f.calls.some((c) => c.type === "TXT")).toBe(false);
  });
});
