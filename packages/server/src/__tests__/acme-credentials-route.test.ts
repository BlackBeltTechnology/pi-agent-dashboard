/**
 * `PUT /api/tls/acme/:sourceId/credentials`: authority, id handling, trigger
 * semantics, atomic acme-dns pair, `configured` projection.
 * test-plan E12 (route half), E14, E30 (route half), E31 (route half); tasks 6.14, 6.44, 6.45.
 * See change: add-acme-dns01-certs.
 */
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signLocalProof } from "../auth/local-proof.js";
import { AcmeCertSource } from "../tls/sources/acme/acme-source.js";
import type { AcmeCredentials } from "../tls/sources/acme/credentials.js";
import { normalizeAcmeEntry } from "../tls/sources/acme/entry.js";
import {
  ACME_TOKEN,
  type AcmeApp,
  type AcmeEnv,
  acmeDnsEntry,
  buildAcmeApp,
  dashDir,
  type FakeListener,
  homeEntry,
  makeFakeAcmeParts,
  makeFakeListener,
  putJson,
  resetAcmeEnv,
  setupAcmeEnv,
  vaultBytes,
  vaultFile,
  waitFor,
  writeCfg,
} from "./helpers/acme-test-kit.js";

let env: AcmeEnv;
let fake: FakeListener;
let built: AcmeApp;
let app: FastifyInstance;
let vaultCalls: string[];

/** Records every call that reaches the vault adapter. */
const spyCredentials = (c: AcmeCredentials): AcmeCredentials =>
  new Proxy(c, {
    get(target, key) {
      const v = (target as never)[key];
      return typeof v === "function"
        ? (...a: unknown[]) => {
            vaultCalls.push(String(key));
            return (v as (...x: unknown[]) => unknown).apply(target, a);
          }
        : v;
    },
  });

async function boot(opts: { strict?: boolean; auth?: boolean } = {}): Promise<void> {
  built = await buildAcmeApp({ listener: fake.asListener(), vaultRoutes: env.store, ...opts });
  app = built.app;
}

beforeEach(() => {
  vaultCalls = [];
  env = setupAcmeEnv(spyCredentials);
  fake = makeFakeListener();
});
afterEach(async () => {
  await app?.close();
  resetAcmeEnv();
});

const seedHome = (solver: "cloudflare" | "acme-dns" = "cloudflare") =>
  writeCfg({ tls: { enabled: false, sources: [solver === "cloudflare" ? homeEntry() : acmeDnsEntry("home")] } });
const putCreds = (id: string, body: unknown, extra: Record<string, unknown> = {}) => putJson(app, `/api/tls/acme/${id}/credentials`, body, extra);
const unmet = { id: "credentials", ok: false, sourceId: "home" };

describe("E14 route authority", () => {
  const LAN = "203.0.113.5";

  it.each([
    ["strict loopback without proof", { remoteAddress: "127.0.0.1" }],
    ["off-host observe bearer", { remoteAddress: LAN, tier: "observe" }],
    ["off-host control bearer", { remoteAddress: LAN, tier: "control" }],
  ] as const)("E14 %s is refused like a vault management route; the vault is unchanged", async (_l, who) => {
    seedHome();
    await boot({ auth: true, strict: true });
    const headers = "tier" in who ? { authorization: `Bearer ${built.tokens[who.tier]}` } : {};
    const common = { remoteAddress: who.remoteAddress, headers };
    const vaultWrite = await app.inject({ method: "POST", url: "/api/vault/accounts", ...common, payload: { provider: "g", label: "l", value: "abcdefgh12" } });
    const res = await putCreds("home", { token: ACME_TOKEN }, common);
    expect([401, 403]).toContain(res.statusCode);
    expect(res.statusCode).toBe(vaultWrite.statusCode);
    expect(res.body).not.toContain(ACME_TOKEN);
    expect(vaultBytes()).toBeNull();
    expect(vaultCalls).toEqual([]);
    expect(fake.calls.refreshReadiness).toEqual([]);
    expect(fake.calls.trigger).toEqual([]);
  });

  it("E14 an off-host operate bearer and a strict-proof local caller are admitted", async () => {
    seedHome();
    await boot({ auth: true, strict: true });
    const viaBearer = await putCreds("home", { token: ACME_TOKEN }, { remoteAddress: LAN, headers: { authorization: `Bearer ${built.tokens.operate}` } });
    expect(viaBearer.statusCode, viaBearer.body).toBe(200);
    const cookie = signLocalProof(built.localTrust);
    const viaProof = await putCreds("home", { token: `${ACME_TOKEN}-2` }, { remoteAddress: "127.0.0.1", headers: { cookie: `pi_dash_local=${cookie}` } });
    expect(viaProof.statusCode, viaProof.body).toBe(200);
    expect(viaBearer.body + viaProof.body).not.toContain(ACME_TOKEN);
  });

  it.each(["nope", "..", "%2e%2e", "a/b", "Home", "tailscale", ""])("E14 id %j → 404 with no vault access", async (id) => {
    writeCfg({ tls: { enabled: false, sources: [{ type: "tailscale" }, homeEntry()] } });
    await boot();
    const res = await putCreds(id, { token: ACME_TOKEN });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain(ACME_TOKEN);
    expect(vaultCalls).toEqual([]);
    expect(vaultBytes()).toBeNull();
    expect(fake.calls.refreshReadiness).toEqual([]);
    expect(fake.calls.trigger).toEqual([]);
  });

  it("E14 an id that is well-formed but not a configured acme source → 404 even with no config.json", async () => {
    await boot();
    expect((await putCreds("home", { token: ACME_TOKEN })).statusCode).toBe(404);
    expect(vaultCalls).toEqual([]);
  });

  it("E14 home with its credentials gate unmet → 200, one forced refresh, one trigger", async () => {
    seedHome();
    fake.gates.push(unmet);
    await boot();
    const res = await putCreds("home", { token: ACME_TOKEN });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({ success: true });
    expect(fake.calls.refreshReadiness).toEqual(["home"]);
    await waitFor(() => fake.calls.trigger.length > 0);
    await new Promise((r) => setTimeout(r, 40));
    expect(fake.calls.trigger).toEqual([["home", undefined]]);
    expect(await env.credentials.isConfigured("home", "cloudflare")).toBe(true);
  });

  it("E14 a gate of ANOTHER source or another id does not count as unmet", async () => {
    seedHome();
    fake.gates.push({ id: "credentials", ok: false, sourceId: "other" }, { id: "dns-zone", ok: false, sourceId: "home", name: "dash.example.com" });
    await boot();
    expect((await putCreds("home", { token: ACME_TOKEN })).statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 40));
    expect(fake.calls.trigger).toEqual([]);
  });

  it("E14 a body that is not an object → 400, no vault write", async () => {
    seedHome();
    await boot();
    expect((await putCreds("home", [ACME_TOKEN])).statusCode).toBe(400);
    expect(vaultBytes()).toBeNull();
  });
});

describe("E12 vault account (route half)", () => {
  it("E12 two saves leave ONE tls-solver account with the second value, mode 0600, config clean", async () => {
    seedHome();
    await boot();
    expect((await putCreds("home", { token: ACME_TOKEN })).statusCode).toBe(200);
    expect((await putCreds("home", { token: "cf-secret-SECOND-9999" })).statusCode).toBe(200);
    const doc = JSON.parse(fs.readFileSync(vaultFile(), "utf8"));
    const accounts = doc.accounts.filter((a: any) => a.kind === "tls-solver");
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ kind: "tls-solver", namespace: "tls:home", provider: "cloudflare", label: "cloudflareToken", value: "cf-secret-SECOND-9999" });
    expect(fs.statSync(vaultFile()).mode & 0o777).toBe(0o600);
    const cfg = fs.readFileSync(path.join(dashDir(), "config.json"), "utf8");
    expect(cfg).not.toContain("cf-secret");
  });
});

describe("E30 save keeps the retry wait (route half)", () => {
  it("E30 credentials gate met before the save → forced refresh but NO trigger", async () => {
    seedHome();
    fake.gates.push({ id: "dns-zone", ok: false, sourceId: "home", name: "dash.example.com" }); // some other gate, credentials met
    await boot();
    const res = await putCreds("home", { token: ACME_TOKEN });
    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 60));
    expect(fake.calls.refreshReadiness).toEqual(["home"]);
    expect(fake.calls.trigger).toEqual([]);
  });
});

describe("E31 acme-dns pair atomic + `configured` (route half)", () => {
  const OLD = { user: "old-user-111111", key: "old-key-1111111" };
  const readAcmeDns = async () => ({
    user: await env.store.readTlsSecret("home", "acmeDnsUser"),
    key: await env.store.readTlsSecret("home", "acmeDnsKey"),
  });

  async function seedOld(): Promise<void> {
    seedHome("acme-dns");
    await boot();
    expect((await putCreds("home", OLD)).statusCode).toBe(200);
    expect(await readAcmeDns()).toEqual(OLD);
  }

  it("E31 a bad SECOND label (too short) → 400, neither label changed", async () => {
    await seedOld();
    const before = vaultBytes();
    const res = await putCreds("home", { user: "new-user-222222", key: "short" });
    expect(res.statusCode).toBe(400);
    expect(await readAcmeDns()).toEqual(OLD);
    expect(vaultBytes()).toBe(before);
  });

  it("E31 a missing / extra / wrong-typed field → 400, nothing written", async () => {
    await seedOld();
    const before = vaultBytes();
    for (const body of [{ user: "new-user-222222" }, { key: "new-key-2222222" }, { token: ACME_TOKEN }, { user: "new-user-222222", key: "new-key-2222222", extra: "x" }, { user: 5, key: "new-key-2222222" }]) {
      expect((await putCreds("home", body)).statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(vaultBytes()).toBe(before);
    expect(await readAcmeDns()).toEqual(OLD);
  });

  it.skipIf(typeof process.getuid === "function" && process.getuid() === 0)(
    "E31 a vault WRITE failure on the pair leaves both labels as they were",
    async () => {
      await seedOld();
      const before = vaultBytes();
      fs.chmodSync(dashDir(), 0o500); // the atomic write (temp file + rename) cannot create its temp file
      try {
        const res = await putCreds("home", { user: "new-user-222222", key: "new-key-2222222" });
        expect(res.statusCode).toBeGreaterThanOrEqual(400);
        expect(res.body).not.toContain("new-key-2222222");
      } finally {
        fs.chmodSync(dashDir(), 0o700);
      }
      expect(vaultBytes()).toBe(before);
      expect(await readAcmeDns()).toEqual(OLD);
    },
  );

  it("E31 only acmeDnsUser present → solver.configured:false and the credentials gate unmet; both labels → true", async () => {
    seedHome("acme-dns");
    await boot();
    await env.store.upsertTlsSecrets({ sourceId: "home", provider: "acme-dns", entries: [{ label: "acmeDnsUser", value: "only-user-123456" }] });
    const projected = async () => (await app.inject({ method: "GET", url: "/api/config" })).json().data.tls.sources[0].solver.configured;
    expect(await projected()).toBe(false);

    const parts = makeFakeAcmeParts();
    const source = new AcmeCertSource({
      id: "home",
      entry: normalizeAcmeEntry(acmeDnsEntry("home")),
      runtime: undefined,
      clientFactory: () => parts.client,
      solver: parts.solver,
      dns: parts.dns,
    });
    const readiness = await source.readiness({ force: true });
    expect(readiness.gates.find((g) => g.id === "credentials")).toMatchObject({ ok: false });
    expect(parts.calls).toEqual([]);

    expect((await putCreds("home", OLD)).statusCode).toBe(200);
    expect(await projected()).toBe(true);
    expect((await source.readiness({ force: true })).gates.some((g) => g.id === "credentials")).toBe(false);
  });
});

describe("credentials route error mapping", () => {
  it("a corrupt vault → 409 vault_corrupt, the file untouched, no value echoed", async () => {
    seedHome();
    fs.mkdirSync(dashDir(), { recursive: true });
    fs.writeFileSync(vaultFile(), "{corrupt");
    await boot();
    const res = await putCreds("home", { token: ACME_TOKEN });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("vault_corrupt");
    expect(res.body).not.toContain(ACME_TOKEN);
    expect(fs.readFileSync(vaultFile(), "utf8")).toBe("{corrupt");
  });
});
