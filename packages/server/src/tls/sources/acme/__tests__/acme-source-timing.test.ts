import * as acme from "acme-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAcmeDnsLocks, createAcmeDnsSolver } from "../solvers/acme-dns.js";
import { createCloudflareSolver } from "../solvers/cloudflare.js";
import type { SolverDeps } from "../types.js";
import {
  ACME_DNS,
  advance,
  build,
  deferred,
  FakeClient,
  FakeDns,
  fastCrypto,
  MIN,
  NEVER,
  pump,
  setupEnv,
  type TestEnv,
} from "./acme-source-helpers.js";

/**
 * AcmeCertSource time-bounded behaviour under fake timers: acme-dns serialization, queue allowance,
 * hung CA abandoned, late publish after abort, removal during an attempt.
 * See change: add-acme-dns01-certs (test-plan E10, E32, X3, X4, E33; tasks 6.10, 6.33, 6.34, 6.46).
 */

// No real fs I/O in the timing suites: it would complete in real time while the clock is faked.
vi.mock("../accounts.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../accounts.js")>();
  return { ...orig, loadOrCreateAccountKey: async () => ({ hash: "0".repeat(32), keyPem: "test-account-key" }) };
});

let env: TestEnv;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
  env = setupEnv();
  fastCrypto();
  __resetAcmeDnsLocks();
});
afterEach(() => {
  __resetAcmeDnsLocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
  env.cleanup();
});

const noop = (): void => undefined;
const USER = "acme-user-0123456789";
const KEY = "acme-key-0123456789abcdef";

function acmeDnsDeps(fetchImpl: typeof fetch): SolverDeps {
  return {
    sourceId: "home",
    readSecret: async (label) => ({ acmeDnsUser: USER, acmeDnsKey: KEY })[label] ?? null,
    redact: (m) => m,
    cloudflareApiBase: "https://cf.test",
    fetchImpl,
    dns: new FakeDns(),
  };
}

const okFetch = (): { impl: typeof fetch; calls: string[] } => {
  const calls: string[] = [];
  const impl = vi.fn(async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response("{}", { status: 200 });
  });
  return { impl: impl as unknown as typeof fetch, calls };
};

const acmeDnsSolver = (fetchImpl: typeof fetch) => createAcmeDnsSolver(ACME_DNS, acmeDnsDeps(fetchImpl));

describe("E10 acme-dns serialization + deadline start (6.10)", () => {
  it("E10: orders run one at a time at 0/4/8/12 min across rebuilt and sibling instances; none abandoned", async () => {
    const t0 = Date.now();
    const starts: Array<{ name: string; at: number }> = [];
    const client = new FakeClient({
      createOrder: async (name) => {
        starts.push({ name, at: Date.now() - t0 });
        return { name, status: "pending" };
      },
      waitForValidStatus: () => new Promise((r) => setTimeout(r, 4 * MIN)),
    });
    const fetchA = okFetch();
    const fetchB = okFetch();
    const domainsA = ["a.test", "b.test", "c.test"];
    const a = build({ client, solver: acmeDnsSolver(fetchA.impl) as never, entry: { id: "home", domains: domainsA, solver: ACME_DNS } });
    expect(a.source.attemptTimeoutMs).toBeGreaterThanOrEqual(3 * (10 * MIN + 30_000));

    const results = domainsA.map((n) => a.source.obtain(n, noop).then(() => "ok", (e: Error) => `fail: ${e.message}`));
    await advance(1 * MIN);

    // reconcile at t=1 min: the old instance is replaced by one built from the same entry, and a sibling source
    // shares the same (server, subdomain)
    const rebuilt = build({ client, solver: acmeDnsSolver(fetchA.impl) as never, entry: { id: "home", domains: domainsA, solver: ACME_DNS } });
    await expect(rebuilt.solver.acquireOrderLock({ maxWaitMs: 0 })).rejects.toThrow(/busy/);
    const sibling = build({
      client,
      solver: acmeDnsSolver(fetchB.impl) as never,
      entry: { id: "lab", domains: ["d.test", "e.test", "f.test"], solver: ACME_DNS },
    });
    const siblingResult = sibling.source.obtain("d.test", noop).then(() => "ok", (e: Error) => `fail: ${e.message}`);

    await advance(16 * MIN); // t = 17 min: the fourth order (12–16) is done
    expect(starts.map((s) => s.at / MIN)).toEqual([0, 4, 8, 12]);
    expect(starts.map((s) => s.name)).toEqual(["a.test", "b.test", "c.test", "d.test"]);
    expect(await Promise.all([...results, siblingResult])).toEqual(["ok", "ok", "ok", "ok"]);
  });

  it("E10: the 10 min deadline starts at lock acquisition, not at obtain() entry", async () => {
    const t0 = Date.now();
    const done: Record<string, number | string> = {};
    const client = new FakeClient({ waitForValidStatus: () => new Promise((r) => setTimeout(r, 8 * MIN)) });
    const f = okFetch();
    const a = build({ client, solver: acmeDnsSolver(f.impl) as never, entry: { domains: ["a.test", "b.test"], solver: ACME_DNS } });
    for (const n of ["a.test", "b.test"]) {
      a.source.obtain(n, noop).then(
        () => (done[n] = (Date.now() - t0) / MIN),
        (e: Error) => (done[n] = `fail: ${e.message}`),
      );
    }
    await advance(17 * MIN);
    // b waited 8 min for the lock then ran 8 min: past 10 min since entry, but inside its own 10 min deadline
    expect(done).toEqual({ "a.test": 8, "b.test": 16 });
  });
});

describe("E32 acme-dns queue allowance (6.46)", () => {
  it("E32: a queued obtain rejects 'registration busy' by 10.5 min, before the backstop, with no CA/DNS call, and never runs later", async () => {
    const f = okFetch();
    const holderSolver = acmeDnsSolver(f.impl);
    const lock = await holderSolver.acquireOrderLock({ maxWaitMs: 0 }); // a hung holder
    const b = build({ solver: acmeDnsSolver(f.impl) as never, entry: { domains: ["a.test", "b.test"], solver: ACME_DNS } });
    expect(b.source.attemptTimeoutMs).toBe(21 * MIN);

    let settledAt: number | undefined;
    let error: Error | undefined;
    const t0 = Date.now();
    void b.source.obtain("b.test", noop).catch((e: Error) => {
      error = e;
      settledAt = Date.now() - t0;
    });
    await advance(10 * MIN);
    expect(error).toBeUndefined();
    await advance(1 * MIN);
    expect(error?.message).toMatch(/registration busy/);
    expect(settledAt).toBeLessThanOrEqual(10.5 * MIN);

    lock.release(); // the holder frees at 11 min
    await advance(15 * MIN);
    expect(b.client.calls).toEqual([]);
    expect(f.calls).toEqual([]);
    expect(b.dns.waits).toEqual([]);
  });
});

describe("X3 hung CA abandoned (6.33)", () => {
  it("X3: cloudflare: obtain rejects at 10 min, the record is cleaned, issue-now starts a fresh order; the stale poll is rejected by the interceptor and no certificate is produced", async () => {
    let attempt = 0;
    const stale = deferred<void>();
    const adapterCalls: string[] = [];
    const pollResults: string[] = [];
    const client = new FakeClient({
      waitForValidStatus: async () => {
        attempt++;
        if (attempt > 1) return {};
        // first attempt hangs; at 10 min 30 s the library "issues one more poll" from inside the stale attempt
        await new Promise((r) => setTimeout(r, 10 * MIN + 30_000));
        try {
          await acme.axios.request({
            url: "http://poll.test/authz",
            adapter: async (config) => {
              adapterCalls.push(String(config.url));
              return { data: {}, status: 200, statusText: "OK", headers: {}, config } as never;
            },
          });
          pollResults.push("sent");
        } catch (err) {
          pollResults.push(`rejected: ${(err as Error).message}`);
        }
        await stale.promise; // …and the original promise only settles afterwards
        return {};
      },
    });
    const b = build({ client });
    let error: Error | undefined;
    const t0 = Date.now();
    let rejectedAt = 0;
    b.source.obtain("dash.example.com", noop).catch((e: Error) => {
      error = e;
      rejectedAt = Date.now() - t0;
    });
    await advance(10 * MIN - 1000);
    expect(error).toBeUndefined();
    await advance(2000);
    expect(error?.message).toMatch(/timed out after 10 min/);
    expect(rejectedAt).toBe(10 * MIN);
    expect(b.solver.cleaned).toEqual(["ref-1"]);

    // issue now → a new createOrder
    const second = await b.source.obtain("dash.example.com", noop);
    expect(client.orders).toEqual(["dash.example.com", "dash.example.com"]);
    expect(second.certPem).toContain("BEGIN CERTIFICATE");

    // the stale poll: rejected by the request interceptor, the transport never touched
    await advance(MIN);
    expect(pollResults).toEqual(["rejected: ACME attempt aborted"]);
    expect(adapterCalls).toEqual([]);

    // the stale promise resolves: the aborted attempt must not go on to finalize
    const finalizeBefore = client.calls.filter((c) => c === "finalizeOrder").length;
    stale.resolve();
    await advance(MIN);
    expect(client.calls.filter((c) => c === "finalizeOrder")).toHaveLength(finalizeBefore); // only the second attempt finalized
    expect(client.calls.filter((c) => c === "getCertificate")).toHaveLength(finalizeBefore);
  });

  it("X3: the interceptor passes requests of a live attempt and of no attempt at all", async () => {
    const seen: string[] = [];
    const adapter = async (config: { url?: string }) => {
      seen.push(String(config.url));
      return { data: {}, status: 200, statusText: "OK", headers: {}, config } as never;
    };
    const client = new FakeClient({
      waitForValidStatus: async () => {
        await acme.axios.request({ url: "http://poll.test/live", adapter });
        return {};
      },
    });
    const b = build({ client });
    await b.source.obtain("dash.example.com", noop);
    await acme.axios.request({ url: "http://poll.test/outside", adapter });
    expect(seen).toEqual(["http://poll.test/live", "http://poll.test/outside"]);
  });

  it("X3: acme-dns: the registration lock is free right after the 10 min abort", async () => {
    const f = okFetch();
    const client = new FakeClient({ waitForValidStatus: () => NEVER });
    const b = build({ client, solver: acmeDnsSolver(f.impl) as never, entry: { solver: ACME_DNS } });
    let error: Error | undefined;
    b.source.obtain("dash.example.com", noop).catch((e: Error) => (error = e));
    await advance(5 * MIN);
    await expect(acmeDnsSolver(f.impl).acquireOrderLock({ maxWaitMs: 0 })).rejects.toThrow(/busy/); // held while running
    await advance(5 * MIN);
    expect(error?.message).toMatch(/timed out/);
    const lock = await acmeDnsSolver(f.impl).acquireOrderLock({ maxWaitMs: 0 });
    lock.release();
    // issue now → a new order starts immediately
    b.source.obtain("dash.example.com", noop).catch(() => undefined);
    await advance(1000);
    expect(client.orders).toHaveLength(2);
  });
});

describe("X4 late publish after abort (6.34)", () => {
  it("X4: a Cloudflare POST that resolves after the abort is deleted by its own id; the ref never reaches the next attempt", async () => {
    const requests: string[] = [];
    let post = 0;
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const url = new URL(String(input));
      requests.push(`${method} ${url.pathname.replace("/v4", "")}`);
      if (method === "POST") {
        post++;
        if (post === 1) await new Promise((r) => setTimeout(r, 10 * MIN + 5000)); // late
        return new Response(JSON.stringify({ success: true, result: { id: post === 1 ? "late" : "rec2" } }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true, result: {} }), { status: 200 });
    });
    const solver = createCloudflareSolver(
      { zoneId: "a".repeat(32) },
      {
        sourceId: "home",
        readSecret: async () => "cf-token-0123456789",
        redact: (m) => m,
        cloudflareApiBase: "https://cf.test/v4",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        dns: new FakeDns(),
      },
    );
    const b = build({ solver: solver as never });
    let error: Error | undefined;
    b.source.obtain("dash.example.com", noop).catch((e: Error) => (error = e));
    await advance(10 * MIN + 1000);
    expect(error?.message).toMatch(/timed out/);
    expect(requests.filter((r) => r.startsWith("DELETE"))).toEqual([]); // nothing known at abort time

    await advance(5000); // the late POST resolves at 10 min 5 s
    const zone = `/zones/${"a".repeat(32)}/dns_records`;
    expect(requests.filter((r) => r.startsWith("DELETE"))).toEqual([`DELETE ${zone}/late`]);
    expect(b.dns.waits).toEqual([]); // the aborted attempt went no further

    // the next attempt publishes and cleans only its own record
    await b.source.obtain("dash.example.com", noop);
    const deletes = requests.filter((r) => r.startsWith("DELETE"));
    expect(deletes).toEqual([`DELETE ${zone}/late`, `DELETE ${zone}/rec2`]);
  });
});

describe("E33 removal during an attempt (6.47, source part)", () => {
  it("E33: onRemoved() aborts a paused attempt: no further CA/DNS call, the lock is released", async () => {
    const paused = deferred<unknown>();
    const client = new FakeClient({ createOrder: () => paused.promise });
    const f = okFetch();
    const b = build({ client, solver: acmeDnsSolver(f.impl) as never, entry: { solver: ACME_DNS } });
    b.source.obtain("dash.example.com", noop).then(
      () => "ok",
      (e: Error) => `fail: ${e.message}`,
    );
    await pump();
    expect(client.calls).toContain("createOrder");
    await b.source.onRemoved();
    // lock released by the abort
    (await acmeDnsSolver(f.impl).acquireOrderLock({ maxWaitMs: 0 })).release();
    paused.resolve({ name: "dash.example.com" });
    await advance(MIN);
    expect(client.calls).not.toContain("getAuthorizations");
    expect(f.calls).toEqual([]);
  });

  it("E33: a queued obtain that acquires the lock after removal returns without any call", async () => {
    const f = okFetch();
    const holder = await acmeDnsSolver(f.impl).acquireOrderLock({ maxWaitMs: 0 });
    const b = build({ solver: acmeDnsSolver(f.impl) as never, entry: { domains: ["a.test", "b.test"], solver: ACME_DNS } });
    const p = b.source.obtain("a.test", noop).then(
      () => "ok",
      (e: Error) => `fail: ${e.message}`,
    );
    await pump();
    await b.source.onRemoved();
    holder.release();
    expect(await p).toMatch(/fail: source removed/);
    expect(b.client.calls).toEqual([]);
  });
});
