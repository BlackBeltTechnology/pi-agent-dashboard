import { X509Certificate } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixture } from "../../../__tests__/helpers.js";
import { CertFiles } from "../../../cert-files.js";
import { CertManager } from "../../../cert-manager.js";
import { TlsCertStore } from "../../../cert-store.js";
import { AcmeCertSource } from "../acme-source.js";
import { normalizeAcmeEntry } from "../entry.js";
import { __resetAcmeDnsLocks, createAcmeDnsSolver } from "../solvers/acme-dns.js";
import { createCloudflareSolver } from "../solvers/cloudflare.js";
import {
  ACME_DNS,
  advance,
  baseEntry,
  build,
  DNS01,
  deferred,
  FakeClient,
  FakeDns,
  fastCrypto,
  MIN,
  pump,
  setConfiguredEntries,
  setupEnv,
  type TestEnv,
} from "./acme-source-helpers.js";

/**
 * AcmeCertSource driven by the REAL CertManager (status reads, gate-before-obtain, backoff, 15 min re-check):
 * readiness cache, gate-blocked names, acme-dns credential check, stage reporting, next attempt + config fields,
 * gated name recovers, renewal blocked, readiness check errors, DNS credential failure.
 * See change: add-acme-dns01-certs (test-plan E16, E18, E19, E20, E21, E29, E34, E36, X6; tasks 6.16 ... 6.50).
 */

// No real fs I/O for account keys: it would complete in real time while the clock is faked.
vi.mock("../accounts.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../accounts.js")>();
  return { ...orig, loadOrCreateAccountKey: async () => ({ hash: "0".repeat(32), keyPem: "test-account-key" }) };
});

const TOKEN = "cf-token-0123456789abcdef";
const DASH = "dash.example.com";
const quiet = { info: () => undefined, warn: vi.fn() };

let env: TestEnv;
let files: CertFiles;
let store: TlsCertStore;
let mgr: CertManager;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
  env = setupEnv();
  fastCrypto(DASH);
  __resetAcmeDnsLocks();
  files = new CertFiles(path.join(env.root, "certs"));
  store = new TlsCertStore();
  mgr = new CertManager({ files, store, log: quiet });
  env.creds.set("home", "cloudflareToken", TOKEN);
  quiet.warn.mockClear();
});

afterEach(() => {
  mgr.suspend();
  __resetAcmeDnsLocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  env.cleanup();
});

const row = (name = DASH) => mgr.status().certs.find((c) => c.name === name);
const srcDetails = () => mgr.status().sources.find((s) => s.id === "home")?.details ?? {};
const meta = (name = DASH) => files.readMeta("home", name);

/** Register the entry as configured (GC would otherwise delete the test's vault secrets) and reconcile. */
async function start(b: ReturnType<typeof build>, entry: Record<string, unknown> = baseEntry()): Promise<void> {
  setConfiguredEntries(env, [entry]);
  await mgr.reconcile([b.source]);
}

describe("E16 readiness cache (6.16)", () => {
  it("E16: status reads call nothing; a save calls once; unforced calls out only at +5:01; forced at once", async () => {
    const b = build();
    await start(b);
    await mgr.settle();
    const calls = (): number => b.solver.checkCalls.length;
    const creds = (): number => b.solver.credCalls;
    const c0 = calls();
    expect(c0).toBeGreaterThanOrEqual(1);

    // 20 status reads within 60 s: no external call
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(3000);
      mgr.status();
    }
    expect(calls()).toBe(c0);
    expect(creds()).toBe(b.solver.credCalls);

    // a secret save: cache dropped, one forced refresh = one domain check (+ one credentials check)
    const c1 = calls();
    const k1 = creds();
    b.source.invalidateReadiness();
    await mgr.refreshReadiness("home");
    expect(calls()).toBe(c1 + 1);
    expect(creds()).toBe(k1 + 1);
    const checkedAt = srcDetails()[`checkedAt:${DASH}`];
    expect(checkedAt).toBe(new Date(Date.now()).toISOString());

    // +4:59: status read + unforced readiness → nothing
    const c2 = calls();
    await vi.advanceTimersByTimeAsync(4 * MIN + 59_000);
    mgr.status();
    await b.source.readiness();
    expect(calls()).toBe(c2);

    // +5:01: status still reports the last checkedAt and calls nothing; unforced readiness calls out once
    await vi.advanceTimersByTimeAsync(2000);
    expect(srcDetails()[`checkedAt:${DASH}`]).toBe(checkedAt);
    expect(calls()).toBe(c2);
    const k2 = creds();
    await b.source.readiness();
    expect(calls()).toBe(c2 + 1);
    expect(creds()).toBe(k2); // the credentials check is not part of an unforced refresh

    // forced at +1 min after that check: immediate
    await vi.advanceTimersByTimeAsync(MIN);
    await b.source.readiness({ force: true });
    expect(calls()).toBe(c2 + 2);
  });
});

describe("E18 gate-blocked names (6.18)", () => {
  const untouched = (b: ReturnType<typeof build>): void => {
    expect(b.client.calls).toEqual([]);
    expect(b.solver.published).toEqual([]);
  };

  it("E18 (a): no credentials → source-wide credentials gate, no provider call", async () => {
    env.creds.clear("home");
    const b = build();
    const r = await b.source.readiness({ force: true });
    expect(r.gates).toEqual([expect.objectContaining({ id: "credentials", ok: false })]);
    expect(r.gates[0].name).toBeUndefined();
    expect(b.solver.checkCalls).toEqual([]);
    expect(b.solver.credCalls).toBe(0);
    untouched(b);
  });

  it("E18 (b): corrupt vault → credentials gate naming the credential vault", async () => {
    env.creds.state = "unavailable";
    const b = build();
    const r = await b.source.readiness({ force: true });
    expect(r.gates).toEqual([expect.objectContaining({ id: "credentials", ok: false, hint: expect.stringMatching(/credential vault/i) })]);
    expect(b.solver.checkCalls).toEqual([]);
    untouched(b);
  });

  it("E18 (c): CNAME missing for one name → one name-scoped gate; the other name is met", async () => {
    env.creds.clear("home");
    env.creds.set("home", "acmeDnsUser", "acme-user-0123456789");
    env.creds.set("home", "acmeDnsKey", "acme-key-0123456789abcdef");
    const b = build({ entry: { solver: ACME_DNS, domains: [DASH, "b.example.com"] } });
    b.solver.checkImpl = async (d) =>
      d === DASH ? { ok: false, gate: "dns-cname", hint: `_acme-challenge.${DASH} CNAME ${ACME_DNS.fulldomain}` } : { ok: true };
    const r = await b.source.readiness({ force: true });
    expect(r.gates).toEqual([{ id: "dns-cname", ok: false, name: DASH, hint: `_acme-challenge.${DASH} CNAME ${ACME_DNS.fulldomain}` }]);
    untouched(b);
  });

  it("E18: through the manager a gated name is skipped with no obtain() and no failure counted", async () => {
    const b = build();
    b.solver.checkImpl = async () => ({ ok: false, gate: "dns-zone", hint: "no zone" });
    await start(b);
    await mgr.settle();
    expect(b.client.orders).toEqual([]);
    expect(row()?.lastError).toBeUndefined();
    expect(mgr.status().gates).toContainEqual(expect.objectContaining({ id: "dns-zone", name: DASH, sourceId: "home" }));
  });
});

describe("E19 acme-dns credential check (6.19)", () => {
  const USER = "acme-user-0123456789";
  const KEY = "acme-key-0123456789abcdef";

  function setup() {
    env.creds.clear("home");
    env.creds.set("home", "acmeDnsUser", USER);
    env.creds.set("home", "acmeDnsKey", KEY);
    const updates: Array<{ txt: string }> = [];
    const state = { status: 200 };
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      updates.push(JSON.parse(String(init?.body)));
      return new Response("{}", { status: state.status });
    });
    const dns = new FakeDns();
    dns.resolveCnameAtAuthoritative = async () => ({ targets: [ACME_DNS.fulldomain], perServer: [{ server: "ns1", target: ACME_DNS.fulldomain }] });
    const solver = createAcmeDnsSolver(ACME_DNS, {
      sourceId: "home",
      readSecret: (l) => env.creds.readSecret("home", l),
      redact: (m) => m,
      cloudflareApiBase: "https://cf.test",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      dns,
    });
    const b = build({ solver: solver as never, dns, entry: { solver: ACME_DNS } });
    return { b, updates, state, solver };
  }

  it("E19: forced readiness with a free lock sends ONE placeholder /update; 401 → credentials gate unmet", async () => {
    const { b, updates, state } = setup();
    let r = await b.source.readiness({ force: true });
    expect(updates).toHaveLength(1);
    expect(updates[0].txt).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(r.gates).toEqual([]);

    state.status = 401;
    r = await b.source.readiness({ force: true });
    expect(updates).toHaveLength(2);
    expect(r.gates).toEqual([expect.objectContaining({ id: "credentials", ok: false })]);
  });

  it("E19: a running order holds the lock → no /update, the last result is kept", async () => {
    const { b, updates, state, solver } = setup();
    state.status = 401;
    await b.source.readiness({ force: true });
    expect(updates).toHaveLength(1);

    const holder = await solver.acquireOrderLock({ maxWaitMs: 0 });
    state.status = 200; // would pass, but it must not even be asked
    const r = await b.source.readiness({ force: true });
    expect(updates).toHaveLength(1);
    expect(r.gates).toEqual([expect.objectContaining({ id: "credentials", ok: false })]); // last (unmet) result kept
    holder.release();
  });

  it("E19: a credentials save (invalidate + forced refresh) re-checks and clears the gate", async () => {
    const { b, updates, state } = setup();
    state.status = 401;
    await b.source.readiness({ force: true });
    state.status = 200;
    b.source.invalidateReadiness();
    const r = await b.source.readiness({ force: true });
    expect(updates).toHaveLength(2);
    expect(r.gates).toEqual([]);
  });

  it("E19: an unforced readiness with an expired cache never writes", async () => {
    const { b, updates } = setup();
    await b.source.readiness({ force: true });
    expect(updates).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(6 * MIN);
    const before = b.dns.waits.length;
    await b.source.readiness();
    await b.source.readiness();
    expect(updates).toHaveLength(1);
    expect(b.dns.waits.length).toBe(before);
  });
});

describe("E20 stage reporting (6.20)", () => {
  it("E20: status shows order → propagation → idle with notAfter", async () => {
    const order = deferred<unknown>();
    const prop = deferred<void>();
    const client = new FakeClient({ createOrder: async (name) => (await order.promise, { name }) });
    const dns = new FakeDns();
    dns.waitImpl = () => prop.promise;
    const b = build({ client, dns });
    await start(b);
    await pump();
    expect(row()?.stage).toBe("order");
    expect(row()?.held).toBe(false);

    order.resolve(undefined);
    await pump();
    expect(row()?.stage).toBe("propagation");

    prop.resolve();
    await mgr.settle();
    const done = row();
    expect(done).toMatchObject({ stage: "idle", held: true, kind: "domain" });
    expect(typeof done?.notAfter).toBe("number");
  });
});

describe("E21 next attempt + config fields (6.21)", () => {
  it("E21: invalid challenge → redacted lastError, nextAttemptAt ≥ T + 1 h, source details", async () => {
    const KEY = "acme-key-0123456789abcdef";
    env.creds.clear("home");
    env.creds.set("home", "acmeDnsUser", "acme-user-0123456789");
    env.creds.set("home", "acmeDnsKey", KEY);
    const client = new FakeClient({
      getAuthorizations: async (i) => (i === 0 ? [{ status: "pending", challenges: [DNS01] }] : [{ status: "invalid", challenges: [] }]),
      waitForValidStatus: async () => {
        throw new Error(`CA says: validation failed for ${DASH} (x-api-key echoed: ${KEY})`);
      },
    });
    const b = build({ client, entry: { directory: "staging", solver: ACME_DNS } });
    const T = Date.now();
    await start(b, baseEntry({ solver: ACME_DNS }));
    await mgr.settle();

    const r = row();
    expect(r?.held).toBe(false);
    expect(r?.lastError).toMatch(/invalid/i);
    expect(r?.lastError).not.toContain(KEY);
    expect(r?.lastError).toContain("[redacted]");
    expect(r?.nextAttemptAt).toBeGreaterThanOrEqual(T + 60 * MIN);
    expect(srcDetails()).toMatchObject({ directory: "staging", staging: true, solverType: "acme-dns" });
    // the manager's own persisted record agrees
    expect((await meta())?.failures).toBe(1);
  });

  it("E21: no automatic attempt before the 1 h floor, one at 60 min (X5 manager part)", async () => {
    const client = new FakeClient({
      getAuthorizations: async (i) => (i % 2 === 0 ? [{ status: "pending", challenges: [DNS01] }] : [{ status: "invalid", challenges: [] }]),
      waitForValidStatus: async () => {
        throw new Error("validation failed");
      },
    });
    const b = build({ client });
    await start(b);
    await mgr.settle();
    expect(client.orders).toHaveLength(1);
    await advance(59 * MIN);
    await mgr.settle();
    expect(client.orders).toHaveLength(1);
    await advance(2 * MIN);
    await mgr.settle();
    expect(client.orders).toHaveLength(2);
  });

  it("X5: 'issue now' (trigger with a name) bypasses the 1 h floor", async () => {
    const client = new FakeClient({
      getAuthorizations: async (i) => (i % 2 === 0 ? [{ status: "pending", challenges: [DNS01] }] : [{ status: "invalid", challenges: [] }]),
      waitForValidStatus: async () => {
        throw new Error("validation failed");
      },
    });
    const b = build({ client });
    await start(b);
    await mgr.settle();
    await advance(MIN);
    await mgr.trigger("home", DASH);
    expect(client.orders).toHaveLength(2);
  });
});

describe("E29 gated name recovers (6.43)", () => {
  it("E29: CNAME created at t=1 min is picked up by the 15 min re-check; obtain before 20 min; failures unchanged", async () => {
    env.creds.clear("home");
    env.creds.set("home", "acmeDnsUser", "acme-user-0123456789");
    env.creds.set("home", "acmeDnsKey", "acme-key-0123456789abcdef");
    const t0 = Date.now();
    const orderAt: number[] = [];
    const client = new FakeClient({
      createOrder: async (name) => {
        orderAt.push(Date.now() - t0);
        return { name };
      },
    });
    const b = build({ client, entry: { solver: ACME_DNS } });
    let cnameOk = false;
    b.solver.checkImpl = async () => (cnameOk ? { ok: true } : { ok: false, gate: "dns-cname", hint: `_acme-challenge.${DASH} CNAME ${ACME_DNS.fulldomain}` });
    await start(b, baseEntry({ solver: ACME_DNS }));
    await mgr.settle();
    expect(orderAt).toEqual([]);
    expect(mgr.status().gates).toContainEqual(expect.objectContaining({ id: "dns-cname", name: DASH }));

    await advance(1 * MIN);
    cnameOk = true; // the operator creates the record; no operator call
    await advance(13 * MIN);
    expect(orderAt).toEqual([]); // not before the re-check (t = 15 min)
    await advance(6 * MIN);
    await mgr.settle();
    expect(orderAt).toHaveLength(1);
    expect(orderAt[0]).toBeGreaterThanOrEqual(15 * MIN);
    expect(orderAt[0]).toBeLessThan(20 * MIN);
    expect(row()?.held).toBe(true);
    expect((await meta())?.failures).toBe(0);
    expect(row()?.lastError).toBeUndefined();
  });
});

describe("E34 renewal blocked status (6.48)", () => {
  it("E34: 20 of 90 days left + unmet CNAME gate → no obtain(), failures 0, name listed with the gate and notAfter", async () => {
    fastCrypto("90d-host.example.ts.net");
    const x = new X509Certificate(fixture("90d-host.example.ts.net").certPem);
    const nb = Date.parse(x.validFrom);
    const na = Date.parse(x.validTo);
    const day = 24 * 60 * MIN;
    expect(Math.round((na - nb) / day)).toBe(90);

    vi.setSystemTime(nb + 10 * day);
    env.creds.clear("home");
    env.creds.set("home", "acmeDnsUser", "acme-user-0123456789");
    env.creds.set("home", "acmeDnsKey", "acme-key-0123456789abcdef");
    const b = build({ entry: { solver: ACME_DNS } });
    await start(b, baseEntry({ solver: ACME_DNS }));
    await mgr.settle();
    expect(b.client.orders).toHaveLength(1);
    expect(row()?.held).toBe(true);

    vi.setSystemTime(nb + 70 * day); // 20 days left
    b.solver.checkImpl = async () => ({ ok: false, gate: "dns-cname", hint: `_acme-challenge.${DASH} CNAME ${ACME_DNS.fulldomain}` });
    await mgr.tick();
    await mgr.settle();

    expect(b.client.orders).toHaveLength(1); // no obtain()
    expect((await meta())?.failures).toBe(0);
    const r = row();
    expect(r).toMatchObject({ held: true, notAfter: na });
    expect(r?.lastError).toBeUndefined();
    expect(mgr.status().gates).toContainEqual(expect.objectContaining({ id: "dns-cname", name: DASH, sourceId: "home", ok: false }));
  });
});

describe("E36 readiness check errors (6.50)", () => {
  it("E36: a met result survives a check error (kept, no gate, no attempt blocked)", async () => {
    const b = build();
    let fail = false;
    b.solver.checkImpl = async () => {
      if (fail) throw new Error("DoH timeout");
      return { ok: true };
    };
    expect((await b.source.readiness({ force: true })).gates).toEqual([]);
    fail = true;
    expect((await b.source.readiness({ force: true })).gates).toEqual([]);
  });

  it("E36: an unmet result survives a check error with the 'check failed: …' hint appended", async () => {
    const b = build({ entry: { solver: ACME_DNS } });
    env.creds.clear("home");
    env.creds.set("home", "acmeDnsUser", "acme-user-0123456789");
    env.creds.set("home", "acmeDnsKey", "acme-key-0123456789abcdef");
    let fail = false;
    b.solver.checkImpl = async () => {
      if (fail) throw new Error("DoH timeout");
      return { ok: false, gate: "dns-cname", hint: `_acme-challenge.${DASH} CNAME ${ACME_DNS.fulldomain}` };
    };
    await b.source.readiness({ force: true });
    fail = true;
    const r = await b.source.readiness({ force: true });
    expect(r.gates).toHaveLength(1);
    expect(r.gates[0]).toMatchObject({ id: "dns-cname", name: DASH, ok: false });
    expect(r.gates[0].hint).toContain("CNAME");
    expect(r.gates[0].hint).toMatch(/check failed: DoH timeout/);
  });

  it("E36: Cloudflare finds no zone for a.unknown.test → name-scoped dns-zone gate", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/user/tokens/verify")) return new Response(JSON.stringify({ success: true, result: { status: "active" } }), { status: 200 });
      return new Response(JSON.stringify({ success: true, result: [] }), { status: 200 });
    });
    const solver = createCloudflareSolver(
      {},
      { sourceId: "home", readSecret: (l) => env.creds.readSecret("home", l), redact: (m) => m, cloudflareApiBase: "https://cf.test/v4", fetchImpl: fetchImpl as unknown as typeof fetch, dns: new FakeDns() },
    );
    const b = build({ solver: solver as never, entry: { domains: ["a.unknown.test"] } });
    const r = await b.source.readiness({ force: true });
    expect(r.gates).toEqual([expect.objectContaining({ id: "dns-zone", name: "a.unknown.test", ok: false })]);
  });

  it("E36: no prior result + a 503 → the gate is unmet with the 'check failed' hint", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 503 }));
    const solver = createCloudflareSolver(
      {},
      { sourceId: "home", readSecret: (l) => env.creds.readSecret("home", l), redact: (m) => m, cloudflareApiBase: "https://cf.test/v4", fetchImpl: fetchImpl as unknown as typeof fetch, dns: new FakeDns() },
    );
    const b = build({ solver: solver as never });
    const r = await b.source.readiness({ force: true });
    expect(r.gates).toHaveLength(1);
    expect(r.gates[0]).toMatchObject({ ok: false, name: DASH });
    expect(r.gates[0].hint).toMatch(/check failed: .*503/);
  });
});

describe("X6 DNS credential failure (6.36)", () => {
  /** The source wired with its OWN Cloudflare solver over a stubbed global `fetch` (the production wiring). */
  function cloudflareViaSource(client: FakeClient) {
    const state = { verify: 200, post: 403, posts: 0 };
    const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/user/tokens/verify")) {
          return state.verify === 200 ? json(200, { success: true, result: { status: "active" } }) : json(state.verify, { success: false, errors: [{ message: "Invalid API Token" }] });
        }
        if ((init?.method ?? "GET") === "POST") {
          state.posts++;
          return state.post === 200 ? json(200, { success: true, result: { id: `rec${state.posts}` } }) : json(state.post, { success: false, errors: [{ message: "Authentication error" }] });
        }
        return json(200, { success: true, result: {} });
      }),
    );
    const entry = baseEntry({ solver: { type: "cloudflare", zoneId: "a".repeat(32) } });
    // no `solver` option → the source creates the real Cloudflare solver (using the stubbed global fetch)
    const source = new AcmeCertSource({ id: "home", entry: normalizeAcmeEntry(entry), clientFactory: () => client, dns: new FakeDns() });
    return { source, state, entry };
  }

  it("X6: one counted plain failure, credentials gate unmet, due ticks call no obtain(), a token save restarts the attempt", async () => {
    const client = new FakeClient();
    const { source, state, entry } = cloudflareViaSource(client);
    setConfiguredEntries(env, [entry]);
    await mgr.reconcile([source]);
    await mgr.settle();

    // first attempt: 403 on publish → ONE counted failure, plain error (not the 1 h RetryAfter floor)
    const T = Date.now();
    expect(state.posts).toBe(1);
    const r1 = row();
    expect(r1?.lastError).toMatch(/403/);
    expect((await meta())?.failures).toBe(1);
    expect(r1?.nextAttemptAt).toBeLessThan(T + 30 * MIN); // exponential backoff (5 min), not RetryAfter(1 h)
    expect((await source.readiness()).gates).toEqual([expect.objectContaining({ id: "credentials", ok: false })]);

    // the token really is dead now (verify 401): the forced 15 min re-check keeps the gate
    state.verify = 401;
    await advance(6 * MIN); // backoff elapsed: due tick #1 (unforced readiness → gate)
    await mgr.settle();
    expect(client.orders).toHaveLength(1);
    await advance(16 * MIN); // due tick #2 (the manager's forced gate re-check)
    await mgr.settle();
    await mgr.tick();
    await mgr.settle();
    expect(client.orders).toHaveLength(1); // no obtain() since the failure
    expect(state.posts).toBe(1);
    expect((await meta())?.failures).toBe(1);
    expect(mgr.status().gates).toContainEqual(expect.objectContaining({ id: "credentials", ok: false, sourceId: "home" }));

    // token save: gate re-checked, an attempt starts and succeeds
    state.verify = 200;
    state.post = 200;
    env.creds.set("home", "cloudflareToken", "cf-token-NEW-0123456789abcdef");
    source.invalidateReadiness();
    await mgr.refreshReadiness("home");
    expect(mgr.status().gates.filter((g) => g.id === "credentials")).toEqual([]);
    expect(await mgr.trigger("home")).not.toBe("unknown-source");
    await mgr.settle();
    expect(client.orders).toHaveLength(2);
    expect(row()?.held).toBe(true);
    expect((await meta())?.failures).toBe(0);
  });
});

describe("X3 (manager part) hung CA: a late stale certificate is never stored", () => {
  it("X3: at 10 min the attempt is a counted failure; the stale promise resolving later stores nothing", async () => {
    const stale = deferred<void>();
    const client = new FakeClient({ waitForValidStatus: () => stale.promise });
    const b = build({ client });
    await start(b);
    await advance(10 * MIN + 5000);
    await mgr.settle();
    expect(row()).toMatchObject({ held: false, stage: "idle" });
    expect(row()?.lastError).toMatch(/timed out/);
    expect((await meta())?.failures).toBe(1);

    stale.resolve();
    await advance(MIN);
    await mgr.settle();
    expect(row()?.held).toBe(false);
    expect(store.resolve(DASH)).toBeNull();
    expect(fs.existsSync(files.nameDir("home", DASH)) ? fs.readdirSync(files.nameDir("home", DASH)).filter((f) => f.endsWith(".pem")) : []).toEqual([]);
    expect(client.calls).not.toContain("finalizeOrder");
  });
});
