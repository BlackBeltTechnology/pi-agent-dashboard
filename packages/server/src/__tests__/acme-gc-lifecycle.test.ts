/**
 * ACME GC (`acmeGc()`: vault namespaces + account keys), removal during an
 * attempt, the readiness/health surfaces over a REAL `TlsListener` +
 * `CertManager` + `AcmeCertSource` (fake CA / solver / DNS), and the
 * "issue now" / credentials-save interplay with the 1 h CA-invalid floor.
 * test-plan E13 (health), E15, E30 (integration), E33, X5 (route half);
 * tasks 6.13, 6.15, 6.35, 6.44, 6.47.
 * See change: add-acme-dns01-certs.
 */
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listAccountKeyHashes } from "../tls/sources/acme/accounts.js";
import { AcmeCertSource } from "../tls/sources/acme/acme-source.js";
import { accountHash, accountKeyFileName, normalizeAcmeEntry } from "../tls/sources/acme/entry.js";
import { acmeGc } from "../tls/sources/acme/gc.js";
import type { TlsListener } from "../tls/tls-listener.js";
import {
  ACME_TOKEN,
  type AcmeEnv,
  buildAcmeApp,
  cfgBytes,
  deferred,
  type FakeAcmeParts,
  freePort,
  homeEntry,
  installFakeAcmeType,
  makeFakeAcmeParts,
  makeFakeListener,
  makeRealListener,
  resetAcmeEnv,
  setupAcmeEnv,
  tlsRoot,
  vaultBytes,
  vaultFile,
  waitFor,
  writeCfg,
  writeCfgRaw,
} from "./helpers/acme-test-kit.js";

let env: AcmeEnv;
let app: FastifyInstance | undefined;
let listener: TlsListener | undefined;
let parts: FakeAcmeParts;

beforeEach(() => {
  env = setupAcmeEnv();
  parts = makeFakeAcmeParts();
});
afterEach(async () => {
  for (const d of Object.values(parts.pause)) d.resolve(); // never leave a paused call dangling
  await app?.close();
  await listener?.stop();
  app = undefined;
  listener = undefined;
  resetAcmeEnv();
});

const hashOf = (entry: Record<string, any>): string => accountHash(entry.directory, entry.email);
const keyPath = (hash: string): string => path.join(tlsRoot(), accountKeyFileName(hash));
const writeKey = (hash: string): void => {
  fs.mkdirSync(tlsRoot(), { recursive: true });
  fs.writeFileSync(keyPath(hash), "key");
};
const solverNamespaces = async (): Promise<string[]> => (await env.store.listTlsNamespaces()).sort();
const userKeys = async (): Promise<string[]> => (await env.store.listAccounts()).filter((a) => a.kind === "key").map((a) => a.label);
const putSecret = (id: string): Promise<void> =>
  env.store.upsertTlsSecrets({ sourceId: id, provider: "cloudflare", entries: [{ label: "cloudflareToken", value: `token-for-${id}-1234` }] });
const sourceFor = (entry: Record<string, any>): AcmeCertSource =>
  new AcmeCertSource({ id: entry.id, entry: normalizeAcmeEntry(entry), clientFactory: () => parts.client, solver: parts.solver, dns: parts.dns });

const HOME = homeEntry({ email: "ops@example.com" });
const LAB = homeEntry({ id: "lab", domains: ["lab.example.com"], email: "lab@example.com" });
const ORPHAN_HASH = "0".repeat(32);

describe("E15 GC on remove / rename", () => {
  async function seedAll(): Promise<void> {
    await putSecret("home");
    await putSecret("lab");
    await env.store.addAccount({ provider: "gemini", label: "personal", value: "abcdefgh12" });
    writeKey(hashOf(HOME));
    writeKey(hashOf(LAB));
    writeKey(ORPHAN_HASH);
  }

  it("E15 keeps configured namespaces + user keys; deletes orphaned namespaces and account keys step by step", async () => {
    await seedAll();
    writeCfg({ tls: { enabled: true, sources: [HOME, LAB] } });
    const lab = sourceFor(LAB);

    // 1. nothing is orphaned except the stray account key
    await lab.onReconciled();
    expect(await solverNamespaces()).toEqual(["home", "lab"]);
    expect(await listAccountKeyHashes(tlsRoot())).toEqual(expect.arrayContaining([hashOf(HOME), hashOf(LAB)]));
    expect(await listAccountKeyHashes(tlsRoot())).not.toContain(ORPHAN_HASH);

    // 2. config without `home`: onReconciled() of the surviving source drops tls:home and home's key
    writeCfg({ tls: { enabled: true, sources: [LAB] } });
    await lab.onReconciled();
    expect(await solverNamespaces()).toEqual(["lab"]);
    expect(await listAccountKeyHashes(tlsRoot())).toEqual([hashOf(LAB)]);
    expect(await userKeys()).toEqual(["personal"]);

    // 3. config without ANY acme source: the last source's onRemoved() covers it (no instance gets onReconciled)
    writeCfg({ tls: { enabled: true, sources: [{ type: "tailscale" }] } });
    await lab.onRemoved();
    expect(await solverNamespaces()).toEqual([]);
    expect(await listAccountKeyHashes(tlsRoot())).toEqual([]);
    expect(await userKeys()).toEqual(["personal"]);

    // 4. a start-time run (registration at server start) leaves it absent, `user` untouched
    await acmeGc();
    expect(await solverNamespaces()).toEqual([]);
    expect(await userKeys()).toEqual(["personal"]);
  });

  it("E15 a config WITHOUT a tls block counts as 'no acme source' (state ok)", async () => {
    await seedAll();
    writeCfg({ port: 8000 });
    await acmeGc();
    expect(await solverNamespaces()).toEqual([]);
    expect(await userKeys()).toEqual(["personal"]);
  });

  it("E15 a start-time run removes namespaces of a config hand-edited while the server was down", async () => {
    await seedAll();
    writeCfg({ tls: { enabled: true, sources: [LAB] } });
    await acmeGc();
    expect(await solverNamespaces()).toEqual(["lab"]);
  });

  it("E15 corrupt config.json → no vault write and no key removal", async () => {
    await seedAll();
    const before = vaultBytes();
    writeCfgRaw("{not json");
    await acmeGc();
    await sourceFor(LAB).onRemoved();
    expect(vaultBytes()).toBe(before);
    expect(await listAccountKeyHashes(tlsRoot())).toEqual(expect.arrayContaining([hashOf(HOME), hashOf(LAB), ORPHAN_HASH]));
    expect(cfgBytes()).toBe("{not json");
  });

  it("E15 an ABSENT config.json is not read as 'no acme sources': nothing is deleted", async () => {
    await seedAll();
    const before = vaultBytes();
    await acmeGc();
    expect(vaultBytes()).toBe(before);
    expect(await listAccountKeyHashes(tlsRoot())).toContain(ORPHAN_HASH);
  });

  it("E15 corrupt vault.json → no vault write, account keys left for the next healthy run", async () => {
    await seedAll();
    writeCfg({ tls: { enabled: true, sources: [LAB] } });
    fs.writeFileSync(vaultFile(), "{corrupt");
    await acmeGc();
    await sourceFor(LAB).onReconciled();
    expect(fs.readFileSync(vaultFile(), "utf8")).toBe("{corrupt");
    expect(await listAccountKeyHashes(tlsRoot())).toEqual(expect.arrayContaining([ORPHAN_HASH, hashOf(HOME)]));
  });

  it("E15 account-key GC: an email change orphans the old key; both keys survive while a source needs them", async () => {
    const before = homeEntry({ email: "ops@example.com" });
    const after = homeEntry({ email: "new@example.com" });
    writeKey(hashOf(before));
    writeCfg({ tls: { enabled: true, sources: [before] } });
    await acmeGc();
    expect(await listAccountKeyHashes(tlsRoot())).toEqual([hashOf(before)]);
    writeCfg({ tls: { enabled: true, sources: [after] } });
    writeKey(hashOf(after));
    await acmeGc();
    expect(await listAccountKeyHashes(tlsRoot())).toEqual([hashOf(after)]);
    // directory keyword vs its explicit URL is the same account
    const explicit = homeEntry({ directory: "https://acme-staging-v02.api.letsencrypt.org/directory", email: "new@example.com" });
    writeCfg({ tls: { enabled: true, sources: [explicit] } });
    await acmeGc();
    expect(await listAccountKeyHashes(tlsRoot())).toEqual([hashOf(after)]);
  });

  it("E15 non-key files in tls/ are never touched", async () => {
    fs.mkdirSync(tlsRoot(), { recursive: true });
    fs.writeFileSync(path.join(tlsRoot(), "acme-account-notahash.key"), "x");
    fs.writeFileSync(path.join(tlsRoot(), "other.txt"), "x");
    writeCfg({ tls: { sources: [] } });
    await acmeGc();
    expect(fs.readdirSync(tlsRoot()).sort()).toEqual(["acme-account-notahash.key", "other.txt"]);
  });

  it("E15 concurrent acmeGc() calls are coalesced and all settle", async () => {
    await seedAll();
    writeCfg({ tls: { sources: [LAB] } });
    await Promise.all([acmeGc(), acmeGc(), acmeGc()]);
    expect(await solverNamespaces()).toEqual(["lab"]);
  });
});

// ── real listener integration ─────────────────────────────────────────

const NAME = "dash.example.com";
const clock = { t: Date.now() };
const HOUR = 60 * 60_000;

async function startReal(entries: Array<Record<string, any>>): Promise<void> {
  installFakeAcmeType(parts, { now: () => clock.t });
  writeCfg({ tls: { enabled: true, port: await freePort(), host: "127.0.0.1", sources: entries } });
  listener = makeRealListener({ now: () => clock.t });
  await listener.markReady();
  await waitFor(() => listener?.manager.hasSource(entries[0].id as string) === true);
}

describe("E33 removal during an attempt", () => {
  it("E33 DELETE while paused in createAccount: no further CA/DNS call, no key written after GC, tls:home gone", async () => {
    await env.credentials.save("home", "cloudflare", { token: ACME_TOKEN });
    parts.pause.createAccount = deferred();
    await startReal([HOME]);
    await waitFor(() => parts.count("createAccount") === 1);
    expect(await listAccountKeyHashes(tlsRoot())).toEqual([hashOf(HOME)]); // the key exists before removal
    expect(await solverNamespaces()).toEqual(["home"]);

    ({ app } = await buildAcmeApp({ listener }));
    const res = await app.inject({ method: "DELETE", url: "/api/tls/acme/home" });
    expect(res.statusCode, res.body).toBe(200);
    expect(await solverNamespaces()).toEqual([]);
    expect(await listAccountKeyHashes(tlsRoot())).toEqual([]);

    parts.pause.createAccount.resolve();
    await new Promise((r) => setTimeout(r, 120));
    expect(parts.calls).toEqual(["createAccount"]); // nothing after the paused call: no order, no publish, no DNS
    expect(await listAccountKeyHashes(tlsRoot())).toEqual([]);
    expect(await solverNamespaces()).toEqual([]);
    expect(listener?.manager.hasSource("home")).toBe(false);
  });

  it("E33 DELETE while paused in propagation: no validation / finalize after the resume; the record is cleaned up", async () => {
    await env.credentials.save("home", "cloudflare", { token: ACME_TOKEN });
    parts.pause.waitForTxt = deferred();
    await startReal([HOME]);
    await waitFor(() => parts.count("waitForTxt") === 1);
    expect(parts.count("publish")).toBe(1);

    ({ app } = await buildAcmeApp({ listener }));
    expect((await app.inject({ method: "DELETE", url: "/api/tls/acme/home" })).statusCode).toBe(200);
    await waitFor(() => parts.count("cleanup") >= 1); // the published record is deleted by its ref
    expect(await solverNamespaces()).toEqual([]);

    const callsAtResume = parts.calls.length;
    parts.pause.waitForTxt.resolve();
    await new Promise((r) => setTimeout(r, 120));
    const after = parts.calls.slice(callsAtResume);
    expect(after.filter((c) => c !== "cleanup")).toEqual([]);
    expect(parts.count("completeChallenge")).toBe(0);
    expect(parts.count("waitForValidStatus")).toBe(0);
    expect(parts.count("finalizeOrder")).toBe(0);
    expect(await listAccountKeyHashes(tlsRoot())).toEqual([]);
    expect(await solverNamespaces()).toEqual([]);
  });
});

describe("X5 / E30 CA-invalid floor, issue now, credentials save (route halves)", () => {
  const row = (): { nextAttemptAt?: number; lastError?: string } | undefined =>
    (listener?.status(true) as { certs?: Array<{ name: string; nextAttemptAt?: number; lastError?: string }> } | undefined)?.certs?.find((c) => c.name === NAME);
  const nextAttemptAt = (): number | undefined => row()?.nextAttemptAt;

  it("X5 a CA-invalid failure sets nextAttemptAt >= T + 1 h; E30 a credentials save neither triggers nor shortens it; X5 issue now at +1 min starts an attempt", async () => {
    await env.credentials.save("home", "cloudflare", { token: ACME_TOKEN });
    parts.failValidation = true;
    const T = clock.t;
    await startReal([HOME]);
    await listener?.manager.settle();
    await waitFor(() => parts.count("waitForValidStatus") === 1);
    await listener?.manager.settle();
    expect(parts.count("createOrder")).toBe(1);
    const floor = nextAttemptAt();
    expect(floor).toBeGreaterThanOrEqual(T + HOUR);
    expect(row()?.lastError).toMatch(/invalid/i);

    // E30: new credentials at T + 10 min, credentials gate met -> forced refresh only, no attempt
    clock.t = T + 10 * 60_000;
    ({ app } = await buildAcmeApp({ listener, tlsRoutes: true }));
    const save = await app.inject({ method: "PUT", url: "/api/tls/acme/home/credentials", payload: { token: "cf-secret-REPLACED-9999" } });
    expect(save.statusCode, save.body).toBe(200);
    await new Promise((r) => setTimeout(r, 150));
    expect(parts.count("createOrder")).toBe(1);
    expect(nextAttemptAt()).toBe(floor);

    // X5: the operator's "issue now" at +1 min bypasses the floor and starts one attempt
    clock.t = T + 11 * 60_000;
    const issue = await app.inject({ method: "POST", url: "/api/tls/issue", payload: { sourceId: "home", name: NAME } });
    expect(issue.statusCode, issue.body).toBe(202);
    await waitFor(() => parts.count("createOrder") === 2);
    await listener?.manager.settle();
    expect(nextAttemptAt()).toBeGreaterThanOrEqual(clock.t + HOUR);
  });
});

describe("E13 /api/health carries no ACME data beyond the prerequisite's disclosure", () => {
  it("E13 local gets the detailed status, non-local only {enabled,bound}; the token is in neither body", async () => {
    await env.credentials.save("home", "cloudflare", { token: ACME_TOKEN });
    parts.pause.createAccount = deferred(); // keep the source in `order`, no CA traffic
    await startReal([HOME]);
    ({ app } = await buildAcmeApp({ listener }));

    const local = await app.inject({ method: "GET", url: "/api/health", remoteAddress: "127.0.0.1" });
    const remote = await app.inject({ method: "GET", url: "/api/health", remoteAddress: "203.0.113.5" });
    expect(local.statusCode).toBe(200);
    expect(remote.statusCode).toBe(200);

    const l = local.json().tls;
    expect(l.sources.map((s: { id: string }) => s.id)).toEqual(["home"]);
    expect(remote.json().tls).toEqual({ enabled: true, bound: true });
    for (const body of [local.body, remote.body]) {
      expect(body).not.toContain(ACME_TOKEN);
      expect(body).not.toContain("tls-solver");
      expect(body).not.toContain("cloudflareToken");
    }
    for (const leak of [NAME, "ops@example.com", "home", "cloudflare"]) expect(remote.body).not.toContain(leak);
  });

  it("E13 a fake listener is asked for the detailed view only for a disclosable caller", async () => {
    const fake = makeFakeListener();
    ({ app } = await buildAcmeApp({ listener: fake.asListener() }));
    await app.inject({ method: "GET", url: "/api/health", remoteAddress: "203.0.113.5" });
    await app.inject({ method: "GET", url: "/api/health", remoteAddress: "127.0.0.1" });
    expect(fake.statusDetailed).toEqual([false, true]);
  });
});
