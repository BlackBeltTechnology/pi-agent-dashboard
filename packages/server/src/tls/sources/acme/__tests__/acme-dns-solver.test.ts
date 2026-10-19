import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAcmeDnsLocks, createAcmeDnsSolver } from "../solvers/acme-dns.js";
import type { DnsApi, SolverDeps } from "../types.js";

/**
 * acme-dns solver: /update request shape, per-registration FIFO lock (module-level, survives rebuilds),
 * credential check only when the lock is free, CNAME check at authoritative servers.
 * See change: add-acme-dns01-certs (D2; tests E10 lock part, E17, E19, E32 queue part).
 */

const USER = "acme-user-0123456789";
const KEY = "acme-key-0123456789abcdef";
const CONFIG = { server: "https://auth.acme-dns.io", subdomain: "sub-1234", fulldomain: "sub-1234.auth.acme-dns.io" };

interface Req {
  url: string;
  method: string;
  headers: Headers;
  body: unknown;
}

function setup(opts: { status?: number | (() => number); dns?: Partial<DnsApi>; deps?: Partial<SolverDeps> } = {}) {
  const calls: Req[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    calls.push({ url: String(input), method: init?.method ?? "GET", headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const status = typeof opts.status === "function" ? opts.status() : (opts.status ?? 200);
    return new Response(JSON.stringify({ txt: "ok" }), { status });
  });
  const deps: SolverDeps = {
    sourceId: "home",
    readSecret: async (label) => ({ acmeDnsUser: USER, acmeDnsKey: KEY })[label] ?? null,
    redact: (m) => m.split(KEY).join("[REDACTED]").split(USER).join("[REDACTED]"),
    cloudflareApiBase: "https://cf.test",
    fetchImpl: fetchImpl as unknown as typeof fetch,
    dns: { discoverZone: vi.fn(), resolveCnameAtAuthoritative: vi.fn(), waitForTxt: vi.fn(), ...opts.dns } as DnsApi,
    ...opts.deps,
  };
  return { deps, calls, solver: createAcmeDnsSolver(CONFIG, deps) };
}

beforeEach(() => __resetAcmeDnsLocks());

describe("publish / cleanup", () => {
  it("POSTs /update with credential headers and {subdomain, txt}", async () => {
    const { solver, calls } = setup();
    const r = await solver.publish("*.dash.example.com", "v".repeat(43));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://auth.acme-dns.io/update");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers.get("x-api-user")).toBe(USER);
    expect(calls[0].headers.get("x-api-key")).toBe(KEY);
    expect(calls[0].headers.get("content-type")).toMatch(/json/);
    expect(calls[0].body).toEqual({ subdomain: "sub-1234", txt: "v".repeat(43) });
    expect(typeof r.ref).toBe("string");
  });

  it("a trailing slash on the server does not double up", async () => {
    const { deps, calls } = setup();
    await createAcmeDnsSolver({ ...CONFIG, server: "https://auth.acme-dns.io/" }, deps).publish("a.example.com", "x");
    expect(calls[0].url).toBe("https://auth.acme-dns.io/update");
  });

  for (const status of [401, 403]) {
    it(`${status} → onCredentialFailure + plain redacted error`, async () => {
      const onCredentialFailure = vi.fn();
      const { solver } = setup({ status, deps: { onCredentialFailure, redact: (m) => m.replace(KEY, "[R]") } });
      const err = await solver.publish("a.example.com", "x").catch((e: Error) => e);
      expect(onCredentialFailure).toHaveBeenCalledTimes(1);
      expect((err as Error).constructor).toBe(Error);
      expect((err as Error).message).toContain(String(status));
      expect((err as Error).message).not.toContain(KEY);
    });
  }

  it("5xx → plain error, no credential flag", async () => {
    const onCredentialFailure = vi.fn();
    const { solver } = setup({ status: 500, deps: { onCredentialFailure } });
    await expect(solver.publish("a.example.com", "x")).rejects.toThrow(/500/);
    expect(onCredentialFailure).not.toHaveBeenCalled();
  });

  it("missing credentials → error without a request", async () => {
    const { solver, calls } = setup({ deps: { readSecret: async () => null } });
    await expect(solver.publish("a.example.com", "x")).rejects.toThrow(/credentials/i);
    expect(calls).toHaveLength(0);
  });

  it("cleanup is a no-op (no request)", async () => {
    const { solver, calls } = setup();
    await solver.cleanup({ ref: "whatever" });
    expect(calls).toHaveLength(0);
    expect(solver.type).toBe("acme-dns");
  });
});

describe("order lock", () => {
  afterEach(() => vi.useRealTimers());

  it("grants FIFO; release wakes the next waiter; release is idempotent", async () => {
    const { solver } = setup();
    const order: string[] = [];
    const a = await solver.acquireOrderLock({ maxWaitMs: 1000 });
    const pb = solver.acquireOrderLock({ maxWaitMs: 60_000 }).then((l) => (order.push("b"), l));
    const pc = solver.acquireOrderLock({ maxWaitMs: 60_000 }).then((l) => (order.push("c"), l));
    await Promise.resolve();
    expect(order).toEqual([]);
    a.release();
    a.release(); // idempotent: must not hand the lock to c as well
    const b = await pb;
    expect(order).toEqual(["b"]);
    b.release();
    const c = await pc;
    expect(order).toEqual(["b", "c"]);
    c.release();
    const d = await solver.acquireOrderLock({ maxWaitMs: 0 }); // free again
    d.release();
  });

  it("rejects 'acme-dns registration busy' after maxWaitMs and never runs the waiter later", async () => {
    vi.useFakeTimers();
    const { solver } = setup();
    const holder = await solver.acquireOrderLock({ maxWaitMs: 0 });
    const waiter = solver.acquireOrderLock({ maxWaitMs: 630_000 });
    const assertion = expect(waiter).rejects.toThrow("acme-dns registration busy");
    await vi.advanceTimersByTimeAsync(629_999);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    holder.release();
    // the timed-out waiter must not own the lock now: a fresh try-acquire succeeds
    const fresh = await solver.acquireOrderLock({ maxWaitMs: 0 });
    fresh.release();
  });

  it("maxWaitMs 0 on a held lock rejects without waiting", async () => {
    const { solver } = setup();
    const holder = await solver.acquireOrderLock({ maxWaitMs: 0 });
    await expect(solver.acquireOrderLock({ maxWaitMs: 0 })).rejects.toThrow("acme-dns registration busy");
    holder.release();
  });

  it("is shared across solver instances of the same (server, subdomain) — survives rebuilds", async () => {
    const one = setup();
    const rebuilt = createAcmeDnsSolver({ ...CONFIG, server: "https://auth.acme-dns.io/" }, setup().deps);
    const holder = await one.solver.acquireOrderLock({ maxWaitMs: 0 });
    await expect(rebuilt.acquireOrderLock({ maxWaitMs: 0 })).rejects.toThrow("busy");
    holder.release();
    (await rebuilt.acquireOrderLock({ maxWaitMs: 0 })).release();
  });

  it("different subdomains / servers do not block each other", async () => {
    const { deps, solver } = setup();
    const other = createAcmeDnsSolver({ ...CONFIG, subdomain: "other" }, deps);
    const otherServer = createAcmeDnsSolver({ ...CONFIG, server: "https://other.example" }, deps);
    const a = await solver.acquireOrderLock({ maxWaitMs: 0 });
    (await other.acquireOrderLock({ maxWaitMs: 0 })).release();
    (await otherServer.acquireOrderLock({ maxWaitMs: 0 })).release();
    a.release();
  });
});

describe("checkCredentials (E19)", () => {
  it("lock free → exactly one /update with a fixed 43-char placeholder, lock released afterwards", async () => {
    const { solver, calls } = setup();
    expect(await solver.checkCredentials()).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    const txt = (calls[0].body as { txt: string }).txt;
    expect(txt).toHaveLength(43);
    expect((await solver.checkCredentials()) && (calls[1].body as { txt: string }).txt).toBe(txt); // fixed
    (await solver.acquireOrderLock({ maxWaitMs: 0 })).release(); // not leaked
  });

  it("lock held → skipped, no request", async () => {
    const { solver, calls } = setup();
    const holder = await solver.acquireOrderLock({ maxWaitMs: 0 });
    expect(await solver.checkCredentials()).toEqual({ ok: true, skipped: true });
    expect(calls).toHaveLength(0);
    holder.release();
  });

  for (const status of [401, 403]) {
    it(`${status} → ok:false gate credentials, lock released`, async () => {
      const { solver } = setup({ status });
      expect(await solver.checkCredentials()).toMatchObject({ ok: false, gate: "credentials" });
      (await solver.acquireOrderLock({ maxWaitMs: 0 })).release();
    });
  }

  it("5xx throws and still releases the lock", async () => {
    const { solver } = setup({ status: 502 });
    await expect(solver.checkCredentials()).rejects.toThrow(/502/);
    (await solver.acquireOrderLock({ maxWaitMs: 0 })).release();
  });

  it("missing credentials → gate credentials without a request", async () => {
    const { solver, calls } = setup({ deps: { readSecret: async () => null } });
    expect(await solver.checkCredentials()).toMatchObject({ ok: false, gate: "credentials" });
    expect(calls).toHaveLength(0);
  });
});

describe("check — CNAME at authoritative servers (E17)", () => {
  const record = "_acme-challenge.dash.example.com CNAME sub-1234.auth.acme-dns.io";

  it("met when every answering server returns the fulldomain (case/dot-insensitive)", async () => {
    const resolveCnameAtAuthoritative = vi.fn(async () => ({
      targets: ["sub-1234.auth.acme-dns.io"],
      perServer: [
        { server: "ns1", target: "sub-1234.auth.acme-dns.io" },
        { server: "ns2", target: "sub-1234.auth.acme-dns.io" },
      ],
    }));
    const { solver, calls } = setup({ dns: { resolveCnameAtAuthoritative } });
    expect(await solver.check("dash.example.com")).toEqual({ ok: true });
    expect(resolveCnameAtAuthoritative).toHaveBeenCalledWith("_acme-challenge.dash.example.com");
    expect(calls).toHaveLength(0);
  });

  it("missing at the authoritative servers → dns-cname gate with the exact record", async () => {
    const resolveCnameAtAuthoritative = vi.fn(async () => ({ targets: [], perServer: [{ server: "ns1", target: null }] }));
    const { solver } = setup({ dns: { resolveCnameAtAuthoritative } });
    expect(await solver.check("dash.example.com")).toEqual({ ok: false, gate: "dns-cname", hint: record });
  });

  it("wrong target or one server still missing → not met", async () => {
    const wrong = setup({ dns: { resolveCnameAtAuthoritative: vi.fn(async () => ({ targets: ["x.example.net"], perServer: [{ server: "ns1", target: "x.example.net" }] })) } });
    expect(await wrong.solver.check("dash.example.com")).toMatchObject({ ok: false, gate: "dns-cname" });
    const partial = setup({
      dns: {
        resolveCnameAtAuthoritative: vi.fn(async () => ({
          targets: ["sub-1234.auth.acme-dns.io"],
          perServer: [
            { server: "ns1", target: "sub-1234.auth.acme-dns.io" },
            { server: "ns2", target: null },
          ],
        })),
      },
    });
    expect(await partial.solver.check("dash.example.com")).toMatchObject({ ok: false, gate: "dns-cname" });
  });

  it("a server that errored does not count against the CNAME", async () => {
    const { solver } = setup({
      dns: {
        resolveCnameAtAuthoritative: vi.fn(async () => ({
          targets: ["sub-1234.auth.acme-dns.io"],
          perServer: [
            { server: "ns1", target: "sub-1234.auth.acme-dns.io" },
            { server: "ns2", target: null, error: "ETIMEOUT" },
          ],
        })),
      },
    });
    expect(await solver.check("dash.example.com")).toEqual({ ok: true });
  });

  it("wildcard owner is _acme-challenge.<parent>", async () => {
    const resolveCnameAtAuthoritative = vi.fn(async () => ({ targets: [], perServer: [{ server: "ns1", target: null }] }));
    const { solver } = setup({ dns: { resolveCnameAtAuthoritative } });
    const r = await solver.check("*.example.com");
    expect(resolveCnameAtAuthoritative).toHaveBeenCalledWith("_acme-challenge.example.com");
    expect(r.hint).toBe("_acme-challenge.example.com CNAME sub-1234.auth.acme-dns.io");
  });

  it("lookup failures propagate so the caller keeps the last result", async () => {
    const { solver } = setup({ dns: { resolveCnameAtAuthoritative: vi.fn(async () => { throw new Error("DoH timeout"); }) } });
    await expect(solver.check("dash.example.com")).rejects.toThrow("DoH timeout");
  });
});
