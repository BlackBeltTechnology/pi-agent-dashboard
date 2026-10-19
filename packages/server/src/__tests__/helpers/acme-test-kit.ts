/**
 * Shared kit for the ROUTE / CONFIG / GC level ACME suites (`acme-*.test.ts`):
 * temp-HOME config + vault helpers, a Fastify app wiring `registerSystemRoutes`
 * + `registerAcmeRoutes` (optionally behind the real bearer / tier / vault
 * guards), a scriptable fake `TlsListener`, a real `TlsListener` builder, and
 * a pausable fake ACME CA / DNS-01 solver for `AcmeCertSource`.
 *
 * HOME must be a temp dir (`config.json`, `vault.json`, `tls/` live under
 * `~/.pi/dashboard`); the server vitest setup guarantees it.
 *
 * See change: add-acme-dns01-certs (test-plan E1-E4, E13-E15, E22-E24, E30-E31, E33, X5).
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { parseTlsConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { registerBearerAuth } from "../../auth/bearer-auth.js";
import { createLocalTrustContext, type LocalTrustContext } from "../../auth/local-proof.js";
import { createNetworkGuard } from "../../auth/localhost-guard.js";
import { createRouteTierGate } from "../../auth/route-tier-gate.js";
import { readConfigState } from "../../config-api.js";
import { PairedDeviceRegistry } from "../../pairing/paired-devices.js";
import { registerAcmeRoutes } from "../../routes/acme-routes.js";
import { registerSystemRoutes } from "../../routes/system-routes.js";
import { registerTlsRoutes } from "../../routes/tls-routes.js";
import { stampLegacyHook } from "../../test-support/local-credential-stamp.js";
import { registerCertSourceType } from "../../tls/source-registry.js";
import { resetAccountCache } from "../../tls/sources/acme/accounts.js";
import { AcmeCertSource, type AcmeClientLike, acmeSourceType } from "../../tls/sources/acme/acme-source.js";
import { type AcmeCredentials, createAcmeCredentials } from "../../tls/sources/acme/credentials.js";
import { normalizeAcmeEntry } from "../../tls/sources/acme/entry.js";
import { configureAcmeRuntime, resetAcmeRuntime } from "../../tls/sources/acme/runtime.js";
import type { Dns01Solver, DnsApi } from "../../tls/sources/acme/types.js";
import { tailscaleSourceType } from "../../tls/sources/tailscale-cert.js";
import { TlsListener } from "../../tls/tls-listener.js";
import { createVaultImport } from "../../vault/vault-import.js";
import { createVaultManageGuard, registerVaultRoutes } from "../../vault/vault-routes.js";
import { createVaultStore, type VaultStore } from "../../vault/vault-store.js";

export const ACME_TOKEN = "cf-secret-1234567890";
const LOCAL_TOKEN = "local-token-xyz";

// ── deferred ────────────────────────────────────────────────────────────

export interface Deferred<T = void> {
  promise: Promise<T>;
  resolve(v: T): void;
  reject(e: unknown): void;
}
export function deferred<T = void>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
    s.on("error", reject);
  });
}

export async function waitFor(pred: () => boolean, ms = 4000): Promise<void> {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
}

// ── temp HOME config / vault ────────────────────────────────────────────

export const dashDir = (): string => path.join(os.homedir(), ".pi", "dashboard");
export const cfgFile = (): string => path.join(dashDir(), "config.json");
export const vaultFile = (): string => path.join(dashDir(), "vault.json");
export const tlsRoot = (): string => path.join(dashDir(), "tls");

export function writeCfg(v: unknown): void {
  writeCfgRaw(JSON.stringify(v));
}
export function writeCfgRaw(text: string): void {
  fs.mkdirSync(dashDir(), { recursive: true });
  fs.writeFileSync(cfgFile(), text);
}
/** Raw bytes of `config.json`, or `null` when absent. */
export function cfgBytes(): string | null {
  return fs.existsSync(cfgFile()) ? fs.readFileSync(cfgFile(), "utf8") : null;
}
export const readCfg = (): any => JSON.parse(fs.readFileSync(cfgFile(), "utf8"));
export function vaultBytes(): string | null {
  return fs.existsSync(vaultFile()) ? fs.readFileSync(vaultFile(), "utf8") : null;
}

/** Wipe everything the ACME suites leave under the temp HOME. */
function resetHome(): void {
  fs.rmSync(cfgFile(), { force: true });
  fs.rmSync(vaultFile(), { force: true });
  for (const f of fs.existsSync(dashDir()) ? fs.readdirSync(dashDir()) : []) {
    if (f.startsWith("vault.json")) fs.rmSync(path.join(dashDir(), f), { force: true });
  }
  fs.rmSync(tlsRoot(), { recursive: true, force: true });
}

export interface AcmeEnv {
  store: VaultStore;
  credentials: AcmeCredentials;
}
/** Point the acme runtime at a real vault store under the temp HOME (call `resetAcmeEnv` in `afterEach`). */
export function setupAcmeEnv(wrap?: (c: AcmeCredentials) => AcmeCredentials): AcmeEnv {
  resetHome();
  resetAcmeRuntime();
  resetAccountCache();
  registerCertSourceType(acmeSourceType);
  registerCertSourceType(tailscaleSourceType);
  const store = createVaultStore();
  const base = createAcmeCredentials(store);
  const credentials = wrap ? wrap(base) : base;
  configureAcmeRuntime({ credentials, tlsRoot: tlsRoot(), log: { info: () => undefined, warn: () => undefined } });
  return { store, credentials: base };
}
export function resetAcmeEnv(): void {
  resetAcmeRuntime();
  resetAccountCache();
  registerCertSourceType(acmeSourceType);
}

/** A valid cloudflare acme entry named `home`. */
export function homeEntry(over: Record<string, unknown> = {}): Record<string, any> {
  return {
    type: "acme",
    id: "home",
    domains: ["dash.example.com"],
    email: "ops@example.com",
    agreeTos: true,
    directory: "staging",
    solver: { type: "cloudflare" },
    ...over,
  };
}
export function acmeDnsEntry(id = "home", over: Record<string, unknown> = {}): Record<string, any> {
  return homeEntry({
    id,
    solver: { type: "acme-dns", server: "https://auth.example.net", subdomain: "sub-1", fulldomain: "sub-1.auth.example.net" },
    ...over,
  });
}

// ── fake TlsListener (route-level) ──────────────────────────────────────

export interface FakeListener {
  /** Mutate to script `manager.status().gates`. */
  gates: Array<{ id: string; ok: boolean; sourceId?: string; name?: string; hint?: string }>;
  calls: { reconcile: number; trigger: Array<[string, string | undefined]>; refreshReadiness: string[] };
  /** Returned by `status(detailed)`; `detailed` is recorded. */
  statusDetailed: boolean[];
  asListener(): any;
}
export function makeFakeListener(): FakeListener {
  const f: FakeListener = {
    gates: [],
    calls: { reconcile: 0, trigger: [], refreshReadiness: [] },
    statusDetailed: [],
    asListener() {
      return {
        manager: { status: () => ({ gates: [...f.gates], sources: [], certs: [] }), hasSource: () => true },
        reconcile: async () => {
          f.calls.reconcile++;
        },
        trigger: async (id: string, name?: string) => {
          f.calls.trigger.push([id, name]);
        },
        refreshReadiness: async (id: string) => {
          f.calls.refreshReadiness.push(id);
          return true;
        },
        status: (detailed: boolean) => {
          f.statusDetailed.push(detailed);
          return { enabled: true, bound: true };
        },
        tlsListenerUrls: () => [],
        isEnabled: true,
      };
    },
  };
  return f;
}

// ── app ─────────────────────────────────────────────────────────────────

export interface AcmeApp {
  app: FastifyInstance;
  tokens: { observe: string; control: string; operate: string };
  localTrust: LocalTrustContext;
}
export interface BuildAcmeAppOpts {
  /** Listener handed to the system + acme routes (`makeFakeListener().asListener()` or a real one). */
  listener: any;
  /**
   * `false` (default): every guard allows. `true`: real bearer auth + tier gate + network guard +
   * the vault management guard, with strict local-proof mode per `strict`.
   */
  auth?: boolean;
  strict?: boolean;
  /** Also mount the real vault routes (to compare refusals). */
  vaultRoutes?: VaultStore;
  /** Also mount `POST /api/tls/issue` (needs a real or fake listener with `isEnabled` + `manager.hasSource`). */
  tlsRoutes?: boolean;
}
export async function buildAcmeApp(opts: BuildAcmeAppOpts): Promise<AcmeApp> {
  const app = Fastify({ logger: false });
  const localTrust = createLocalTrustContext(LOCAL_TOKEN, () => opts.strict === true);
  const trusted = "198.51.100.0/24";
  const reg = new PairedDeviceRegistry(path.join(os.tmpdir(), `acme-kit-paired-${process.pid}-${Date.now()}.json`));
  const tokens = {
    observe: reg.add("o", "manual", "observe").token,
    control: reg.add("c", "manual", "control").token,
    operate: reg.add("p", "manual", "operate").token,
  };
  let networkGuard: (req: any, reply: any) => Promise<void> = async () => undefined;
  let manageGuard: (req: any, reply: any) => Promise<void> = async () => undefined;
  if (opts.auth) {
    await app.register(rateLimit, { global: true, max: 100_000, timeWindow: "1 minute" });
    app.decorateRequest("isAuthenticated", false);
    stampLegacyHook(app, LOCAL_TOKEN);
    registerBearerAuth(app, { registry: reg });
    app.addHook("onRequest", createRouteTierGate({ getTrustedNetworks: () => [trusted], localTrust, logRefusal: () => undefined }));
    networkGuard = createNetworkGuard([trusted], { localTrust }) as never;
    manageGuard = createVaultManageGuard({ localTrust, loginAvailable: () => false }) as never;
  }
  registerSystemRoutes(app, {
    sessionManager: { listActive: () => [], listAll: () => [] },
    preferencesStore: { flush: () => undefined },
    metaPersistence: { flushAll: () => undefined },
    config: { port: 8000, piPort: 9999, dev: false },
    networkGuard,
    version: "test",
    clientDir: null,
    tls: opts.listener,
  } as never);
  registerAcmeRoutes(app, { networkGuard: networkGuard as never, manageGuard: manageGuard as never, listener: opts.listener });
  if (opts.tlsRoutes) registerTlsRoutes(app, { networkGuard: networkGuard as never, listener: opts.listener });
  if (opts.vaultRoutes) {
    registerVaultRoutes(app, {
      store: opts.vaultRoutes,
      importer: createVaultImport({ store: opts.vaultRoutes, candidates: () => [] }),
      networkGuard: networkGuard as never,
      localTrust,
      loginAvailable: () => false,
      listOpenProjects: () => [],
      projects: { list: () => [] },
    } as never);
  }
  await app.ready();
  return { app, tokens, localTrust };
}

export const putJson = (app: FastifyInstance, url: string, payload: unknown, extra: Record<string, unknown> = {}) =>
  app.inject({ method: "PUT", url, payload: payload as never, ...extra } as never);

// ── real TlsListener (never binds the network unless the config enables it) ──

export function makeRealListener(opts: { now?: () => number } = {}): TlsListener {
  return new TlsListener({
    dataRoot: tlsRoot(),
    getTlsConfig: () => parseTlsConfig(readConfigState().raw?.tls),
    dispatch: { request: () => undefined, upgrade: (_r, s) => s.destroy(), clientError: (_e, s) => s.destroy() },
    log: { info: () => undefined, warn: () => undefined },
    ...(opts.now ? { now: opts.now } : {}),
  });
}

// ── pausable fake ACME CA + solver + DNS ────────────────────────────────

type PausePoint = "createAccount" | "createOrder" | "waitForTxt" | "waitForValidStatus";

export interface FakeAcmeParts {
  /** Ordered log of every CA / solver / DNS call: `createAccount`, `createOrder`, `publish`, `cleanup`, `waitForTxt`, ... */
  calls: string[];
  count(name: string): number;
  /** Set a deferred to pause the call; the call resumes when it resolves. */
  pause: Partial<Record<PausePoint, Deferred<void>>>;
  /** `waitForValidStatus` rejects and the CA reports the authorization `invalid`. */
  failValidation: boolean;
  client: AcmeClientLike;
  solver: Dns01Solver;
  dns: DnsApi;
}
export function makeFakeAcmeParts(): FakeAcmeParts {
  const p: FakeAcmeParts = {
    calls: [],
    count: (n) => p.calls.filter((c) => c === n).length,
    pause: {},
    failValidation: false,
    client: undefined as never,
    solver: undefined as never,
    dns: undefined as never,
  };
  const hit = async (name: string): Promise<void> => {
    p.calls.push(name);
    const d = p.pause[name as PausePoint];
    if (d) await d.promise;
  };
  p.client = {
    createAccount: async () => {
      await hit("createAccount");
      return {};
    },
    getAccountUrl: () => "https://ca.test/acct/1",
    createOrder: async () => {
      await hit("createOrder");
      return { url: "https://ca.test/order/1" };
    },
    getAuthorizations: async () => {
      p.calls.push("getAuthorizations");
      return [{ status: p.failValidation ? "invalid" : "pending", challenges: [{ type: "dns-01" }] }];
    },
    getChallengeKeyAuthorization: async () => "key-authorization",
    completeChallenge: async () => {
      p.calls.push("completeChallenge");
      return {};
    },
    waitForValidStatus: async () => {
      await hit("waitForValidStatus");
      if (p.failValidation) throw new Error("authorization marked invalid");
      return {};
    },
    finalizeOrder: async () => {
      p.calls.push("finalizeOrder");
      throw new Error("fake CA does not finalize");
    },
    getCertificate: async () => {
      p.calls.push("getCertificate");
      throw new Error("fake CA does not issue");
    },
  };
  let refN = 0;
  p.solver = {
    type: "cloudflare",
    publish: async () => {
      p.calls.push("publish");
      return { ref: `ref-${++refN}` };
    },
    cleanup: async () => {
      p.calls.push("cleanup");
    },
    check: async () => ({ ok: true }),
    checkCredentials: async () => ({ ok: true }),
    acquireOrderLock: async () => ({ release: () => undefined }),
  };
  p.dns = {
    discoverZone: async () => ({ zone: "example.com", servers: [] }),
    resolveCnameAtAuthoritative: async () => ({ targets: [], perServer: [] }),
    waitForTxt: async () => {
      await hit("waitForTxt");
      return { mode: "authoritative" };
    },
  };
  return p;
}

/** Make `new TlsListener(...)` build `acme` sources with the fake CA / solver / DNS (undo with `resetAcmeEnv()`). */
export function installFakeAcmeType(parts: FakeAcmeParts, extra: { now?: () => number } = {}): void {
  registerCertSourceType({
    type: "acme",
    validate: acmeSourceType.validate,
    create: (entry, id) =>
      new AcmeCertSource({
        id,
        entry: normalizeAcmeEntry(entry),
        clientFactory: () => parts.client,
        solver: parts.solver,
        dns: parts.dns,
        ...(extra.now ? { now: extra.now } : {}),
      }),
  });
}
