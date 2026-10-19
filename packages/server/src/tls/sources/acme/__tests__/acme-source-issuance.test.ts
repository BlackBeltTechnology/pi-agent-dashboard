import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acmeGc } from "../gc.js";
import { createCloudflareSolver } from "../solvers/cloudflare.js";
import {
  ACME_DNS,
  baseEntry,
  build,
  DNS01,
  FakeClient,
  FakeDns,
  HTTP01,
  KEY_AUTH,
  setConfiguredEntries,
  setupEnv,
  type TestEnv,
} from "./acme-source-helpers.js";

/**
 * AcmeCertSource issuance: advertisement classification, fingerprint scope, challenge owner/type,
 * account persistence. Fakes for the CA client, solver and DNS; no network.
 * See change: add-acme-dns01-certs (test-plan E5, E6, E7, E11; tasks 6.5, 6.6, 6.7, 6.11).
 */

let env: TestEnv;
beforeEach(() => {
  env = setupEnv();
});
afterEach(() => env.cleanup());

const noop = (): void => undefined;

describe("E5 advertisement classification (6.5)", () => {
  const dirs = [
    "staging",
    "production",
    "https://acme-staging-v02.api.letsencrypt.org/directory",
    "https://ACME-v02.api.letsencrypt.org/directory/",
    "https://pebble.test:14000/dir",
  ];
  // directory × advertise [unset, true], in this order
  const advertise = [false, false, true, true, false, false, true, true, false, true];
  const staging = [true, true, false, false, true, true, false, false, false, false];
  const cases = dirs.flatMap((directory, i) => [
    { directory, adv: undefined as boolean | undefined, idx: i * 2 },
    { directory, adv: true as boolean | undefined, idx: i * 2 + 1 },
  ]);

  it.each(cases)("E5: directory $directory advertise=$adv", async ({ directory, adv, idx }) => {
    const { source, factoryCalls } = build({ entry: { directory, ...(adv === undefined ? {} : { advertise: adv }) } });
    const res = await source.obtain("dash.example.com", noop);
    expect(res.advertise).toBe(advertise[idx]);
    expect(res.details?.staging).toBe(staging[idx]);
    expect(res.kind).toBe("domain");
    // keyword and explicit Let's Encrypt URL both reach the CA as the canonical URL
    if (idx < 8) expect(factoryCalls[0].directoryUrl).toMatch(/^https:\/\/acme-(staging-)?v02\.api\.letsencrypt\.org\/directory$/);
    else expect(factoryCalls[0].directoryUrl).toBe("https://pebble.test:14000/dir");
  });
});

describe("E6 fingerprint scope (6.6)", () => {
  const fp = (over: Record<string, unknown>): string => build({ entry: over }).source.configFingerprint("dash.example.com");
  const base = fp({ directory: "production" });

  it("E6: differs for a directory change", () => {
    expect(fp({ directory: "staging" })).not.toBe(base);
  });
  it("E6: equal when only advertise is toggled on a production directory (no effect there)", () => {
    expect(fp({ directory: "production", advertise: true })).toBe(base);
    expect(fp({ directory: "production", advertise: false })).toBe(base);
  });
  it("E6: equal when only advertise is toggled on staging", () => {
    expect(fp({ directory: "staging", advertise: true })).toBe(fp({ directory: "staging" }));
  });
  it("E6: equal for an email change", () => {
    expect(fp({ directory: "production", email: "other@example.com" })).toBe(base);
  });
  it("E6: equal for a solver change (cloudflare → acme-dns)", () => {
    expect(fp({ directory: "production", solver: ACME_DNS })).toBe(base);
  });
  it("E6: equal when a domain is added (the list is never in the fingerprint)", () => {
    expect(fp({ directory: "production", domains: ["dash.example.com", "b.example.com"] })).toBe(base);
  });
  it("E6: differs for the custom-directory advertise toggle", () => {
    const custom = "https://pebble.test:14000/dir";
    expect(fp({ directory: custom, advertise: true })).not.toBe(fp({ directory: custom }));
  });
  it("E6: differs per name", () => {
    const { source } = build({ entry: { domains: ["a.example.com", "b.example.com"] } });
    expect(source.configFingerprint("a.example.com")).not.toBe(source.configFingerprint("b.example.com"));
  });
  it("E6: keyword and the explicit Let's Encrypt URL fingerprint identically", () => {
    expect(fp({ directory: "https://acme-v02.api.letsencrypt.org/directory/" })).toBe(base);
  });
});

describe("E7 challenge owner + type (6.7)", () => {
  it("E7: dns-01 is picked from [http-01, dns-01]; owners follow the name (wildcard → parent)", async () => {
    for (const [name, owner] of [
      ["dash.example.com", "_acme-challenge.dash.example.com"],
      ["*.example.com", "_acme-challenge.example.com"],
    ]) {
      const b = build({ entry: { domains: [name] } });
      await b.source.obtain(name, noop);
      expect(b.dns.waits).toEqual([{ owner, value: KEY_AUTH }]);
      expect(b.client.completed).toEqual([DNS01]);
      expect(b.solver.published).toEqual([{ domain: name, value: KEY_AUTH }]);
    }
  });

  it("E7: the Cloudflare solver writes the TXT at the same owner", async () => {
    const requests: Array<{ method: string; url: string; body?: { name: string; content: string } }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({ method: init?.method ?? "GET", url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify({ success: true, result: { id: "rec1" } }), { status: 200 });
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
    for (const name of ["dash.example.com", "*.example.com"]) {
      const b = build({ solver: solver as never, entry: { domains: [name] } });
      await b.source.obtain(name, noop);
    }
    const posts = requests.filter((r) => r.method === "POST");
    expect(posts.map((p) => p.body?.name)).toEqual(["_acme-challenge.dash.example.com", "_acme-challenge.example.com"]);
  });

  it("E7: http-01 only → fails with 'no dns-01 challenge', no publish, no completeChallenge", async () => {
    const client = new FakeClient({ getAuthorizations: async () => [{ status: "pending", challenges: [HTTP01] }] });
    const b = build({ client });
    await expect(b.source.obtain("dash.example.com", noop)).rejects.toThrow(/no dns-01 challenge/i);
    expect(client.completed).toEqual([]);
    expect(client.calls).not.toContain("completeChallenge");
    expect(b.solver.published).toEqual([]);
  });

  it("E7: reports the stages in order", async () => {
    const b = build();
    const stages: string[] = [];
    await b.source.obtain("dash.example.com", (s) => stages.push(s));
    expect(stages).toEqual(["order", "dns-publish", "propagation", "validation", "finalize"]);
  });

  it("E7: cleans every published record on success and on a validation failure (one cleanup per publish)", async () => {
    const ok = build();
    await ok.source.obtain("dash.example.com", noop);
    expect(ok.solver.cleaned).toEqual(["ref-1"]);

    const client = new FakeClient({ waitForValidStatus: async () => Promise.reject(new Error("boom")) });
    const bad = build({ client });
    await expect(bad.source.obtain("dash.example.com", noop)).rejects.toThrow(/boom/);
    expect(bad.solver.cleaned).toEqual(["ref-1"]);
  });

  it("X1 (source level): a propagation timeout fails with no completeChallenge and the record is cleaned (DNS timing itself: dns.test.ts X1/X2)", async () => {
    const dns = new FakeDns();
    dns.waitImpl = async () => {
      throw new Error("TXT not visible at ns2.example.com (10.0.0.2) after 180 s");
    };
    const b = build({ dns });
    await expect(b.source.obtain("dash.example.com", noop)).rejects.toThrow(/ns2\.example\.com/);
    expect(b.client.completed).toEqual([]);
    expect(b.solver.cleaned).toEqual(["ref-1"]);
  });

  it("X2 (source level): the DoH-fallback mode reaches the result details", async () => {
    const dns = new FakeDns();
    dns.mode = "doh-fallback";
    const b = build({ dns });
    const res = await b.source.obtain("dash.example.com", noop);
    expect(res.details?.propagationMode).toBe("doh-fallback");
    expect((await b.source.readiness({ force: true })).details?.propagationMode).toBe("doh-fallback");
  });
});

describe("E11 account persistence (6.11)", () => {
  const accountKeys = (): string[] => (fs.existsSync(env.tlsRoot) ? fs.readdirSync(env.tlsRoot).filter((n) => /^acme-account-.*\.key$/.test(n)) : []);

  it("E11: one createAccount per equivalent (directory, email): keyword vs URL, email case/whitespace", async () => {
    const a = build({ entry: { id: "a", directory: "staging", email: "ops@example.com" } });
    const b = build({ entry: { id: "b", directory: "https://acme-staging-v02.api.letsencrypt.org/directory", email: "Ops@Example.com " } });
    const c = build({ entry: { id: "c", directory: "staging", email: "ops@example.com" } });
    await a.source.obtain("dash.example.com", noop);
    await b.source.obtain("dash.example.com", noop);
    await c.source.obtain("dash.example.com", noop);
    const created = [a, b, c].filter((x) => x.client.calls.includes("createAccount")).length;
    expect(created).toBe(1);
    expect(b.factoryCalls[0].accountUrl).toBe("https://ca.test/acct/1"); // later sources reuse the CA account URL
    expect(accountKeys()).toHaveLength(1);
  });

  it("E11: a different email or directory is a different account", async () => {
    const a = build({ entry: { id: "a" } });
    const b = build({ entry: { id: "b", email: "other@example.com" } });
    const c = build({ entry: { id: "c", directory: "production" } });
    for (const x of [a, b, c]) await x.source.obtain("dash.example.com", noop);
    expect([a, b, c].every((x) => x.client.calls.includes("createAccount"))).toBe(true);
    expect(accountKeys()).toHaveLength(3);
  });

  it.skipIf(process.platform === "win32")("E11: the account key file is mode 0600", async () => {
    const a = build();
    await a.source.obtain("dash.example.com", noop);
    const [file] = accountKeys();
    expect(fs.statSync(path.join(env.tlsRoot, file)).mode & 0o777).toBe(0o600);
  });

  it("E11: the old key is deleted by GC after an email change (the new one stays)", async () => {
    const entry = baseEntry({ email: "ops@example.com" });
    setConfiguredEntries(env, [entry]);
    const a = build({ entry });
    await a.source.obtain("dash.example.com", noop);
    const [oldKey] = accountKeys();

    const changed = baseEntry({ email: "new@example.com" });
    setConfiguredEntries(env, [changed]);
    const b = build({ entry: changed });
    await b.source.obtain("dash.example.com", noop);
    expect(accountKeys()).toHaveLength(2);
    await b.source.onReconciled();
    const left = accountKeys();
    expect(left).toHaveLength(1);
    expect(left).not.toContain(oldKey);
  });

  it("E11: the key is deleted after the last acme source is removed", async () => {
    const entry = baseEntry();
    setConfiguredEntries(env, [entry]);
    const a = build({ entry });
    await a.source.obtain("dash.example.com", noop);
    expect(accountKeys()).toHaveLength(1);
    setConfiguredEntries(env, []);
    await a.source.onRemoved();
    expect(accountKeys()).toEqual([]);
  });

  it("E11: GC keeps a key still produced by a configured source and does nothing with a corrupt config", async () => {
    const entry = baseEntry();
    setConfiguredEntries(env, [entry]);
    const a = build({ entry });
    await a.source.obtain("dash.example.com", noop);
    await acmeGc();
    expect(accountKeys()).toHaveLength(1);
    env.config = { state: "corrupt", raw: null }; // an unreadable config must never delete anything
    await acmeGc();
    expect(accountKeys()).toHaveLength(1);
  });

  it("E11: a removed source never writes an account key afterwards (E33 key part)", async () => {
    const a = build();
    await a.source.onRemoved();
    await expect(a.source.obtain("dash.example.com", noop)).rejects.toThrow(/removed/);
    expect(accountKeys()).toEqual([]);
  });
});
