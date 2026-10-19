/**
 * Shared fakes for the `AcmeCertSource` suites (`acme-source-*.test.ts`): in-memory credential vault
 * adapter, fake ACME client / solver / DNS, temp-dir runtime wiring, fixture-cert plumbing for
 * manager-driven tests and a fake-timer pump that also lets real fs I/O complete.
 *
 * See change: add-acme-dns01-certs (test-plan section 6).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as acme from "acme-client";
import { type MockInstance, vi } from "vitest";
import { type FixtureName, fixture } from "../../../__tests__/helpers.js";
import { resetAccountCache } from "../accounts.js";
import { AcmeCertSource, type AcmeClientLike, type AcmeSourceOptions } from "../acme-source.js";
import { type AcmeCredentials, redactSecrets, type SolverType } from "../credentials.js";
import { normalizeAcmeEntry } from "../entry.js";
import { configureAcmeRuntime, resetAcmeRuntime } from "../runtime.js";
import { type Dns01Solver, type DnsApi, SOLVER_LABELS, type SolverCheck } from "../types.js";

type Json = Record<string, unknown>;

// ── timers ───────────────────────────────────────────────────────────────

const realTick = (): Promise<void> => new Promise((r) => setImmediate(r));

/** Let real fs I/O and promise chains settle (setImmediate is never faked by these suites). */
export async function pump(n = 12): Promise<void> {
  for (let i = 0; i < n; i++) await realTick();
}

/** Advance fake time in `step` chunks, pumping between chunks so I/O-driven continuations run. */
export async function advance(ms: number, step = 30_000): Promise<void> {
  let left = ms;
  await pump();
  while (left > 0) {
    const d = Math.min(step, left);
    await vi.advanceTimersByTimeAsync(d);
    await pump(4);
    left -= d;
  }
}

export const MIN = 60_000;

// ── credentials ──────────────────────────────────────────────────────────

class FakeCreds implements AcmeCredentials {
  state: "ok" | "unavailable" = "ok";
  secrets = new Map<string, string>();
  deleted: string[] = [];

  set(id: string, label: string, value: string): void {
    this.secrets.set(`${id}\0${label}`, value);
  }
  clear(id: string): void {
    for (const k of [...this.secrets.keys()]) if (k.startsWith(`${id}\0`)) this.secrets.delete(k);
  }
  async readSecret(id: string, label: string): Promise<string | null> {
    if (this.state !== "ok") throw new Error("vault_corrupt");
    return this.secrets.get(`${id}\0${label}`) ?? null;
  }
  async isConfigured(id: string, type: SolverType): Promise<boolean> {
    if (this.state !== "ok") return false;
    return SOLVER_LABELS[type].labels.every((l) => this.secrets.has(`${id}\0${l}`));
  }
  vaultState(): "ok" | "unavailable" {
    return this.state;
  }
  async save(): Promise<void> {
    throw new Error("not used by the source suites");
  }
  async redactorFor(id: string, type: SolverType): Promise<(m: string) => string> {
    const values = SOLVER_LABELS[type].labels.flatMap((l) => this.secrets.get(`${id}\0${l}`) ?? []);
    return (m) => redactSecrets(m, values);
  }
  async deleteNamespace(id: string): Promise<void> {
    this.deleted.push(id);
    this.clear(id);
  }
  async listNamespaces(): Promise<string[]> {
    return [...new Set([...this.secrets.keys()].map((k) => k.split("\0")[0]))];
  }
}

// ── runtime wiring ───────────────────────────────────────────────────────

export interface TestEnv {
  root: string;
  tlsRoot: string;
  creds: FakeCreds;
  logLines: string[];
  log: { info: MockInstance; warn: MockInstance };
  /** What `readConfigState()` reports (GC reads it). */
  config: { state: "absent" | "ok" | "corrupt"; raw: Json | null };
  env: NodeJS.ProcessEnv;
  cleanup(): void;
}

/** Fresh temp dir + runtime wiring. Call `env.cleanup()` in `afterEach`. */
export function setupEnv(): TestEnv {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "acme-src-"));
  const tlsRoot = path.join(root, "tls");
  const creds = new FakeCreds();
  const logLines: string[] = [];
  const log = {
    info: vi.fn((m: string) => void logLines.push(m)),
    warn: vi.fn((m: string) => void logLines.push(m)),
  };
  const env: TestEnv = {
    root,
    tlsRoot,
    creds,
    logLines,
    log,
    config: { state: "ok", raw: { tls: { sources: [] } } },
    env: {},
    cleanup() {
      resetAcmeRuntime();
      resetAccountCache();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
  resetAccountCache();
  configureAcmeRuntime({
    credentials: creds,
    tlsRoot,
    env: env.env,
    log,
    readConfigState: () => env.config as ReturnType<typeof import("../../../../config-api.js").readConfigState>,
  });
  return env;
}

/** Put these acme entries into the fake `config.json` (what GC considers configured). */
export function setConfiguredEntries(env: TestEnv, entries: Json[]): void {
  env.config = { state: "ok", raw: { tls: { sources: [{ type: "tailscale", id: "tailscale" }, ...entries] } } };
}

// ── entry + source ───────────────────────────────────────────────────────

export function baseEntry(over: Json = {}): Json {
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

export const ACME_DNS = { type: "acme-dns", server: "https://auth.acme-dns.io", subdomain: "sub-1234", fulldomain: "sub-1234.auth.acme-dns.io" };

// ── fake ACME client ─────────────────────────────────────────────────────

export interface ClientHooks {
  createAccount?: () => Promise<unknown>;
  createOrder?: (name: string) => Promise<unknown>;
  getAuthorizations?: (callIndex: number) => Promise<Array<{ status?: string; challenges: unknown[] }>>;
  completeChallenge?: (challenge: unknown) => Promise<unknown>;
  waitForValidStatus?: (challenge: unknown) => Promise<unknown>;
  getCertificate?: (name: string) => Promise<string>;
}

export const DNS01 = { type: "dns-01", token: "tok", url: "https://ca.test/chall/1" };
export const HTTP01 = { type: "http-01", token: "tok2", url: "https://ca.test/chall/2" };
export const KEY_AUTH = "dGVzdC1rZXktYXV0aG9yaXphdGlvbi1kaWdlc3QtNDNjaA";

export class FakeClient implements AcmeClientLike {
  calls: string[] = [];
  orders: string[] = [];
  completed: unknown[] = [];
  authCalls = 0;
  hooks: ClientHooks;
  /** Certificate returned by `getCertificate` (default: the fixture of the ordered name, else dash). */
  certFor: (name: string) => string = (name) => fixtureCertFor(name);

  constructor(hooks: ClientHooks = {}) {
    this.hooks = hooks;
  }

  async createAccount(): Promise<unknown> {
    this.calls.push("createAccount");
    return this.hooks.createAccount ? this.hooks.createAccount() : {};
  }
  getAccountUrl(): string {
    return "https://ca.test/acct/1";
  }
  async createOrder(data: { identifiers: Array<{ type: string; value: string }> }): Promise<unknown> {
    const name = data.identifiers[0].value;
    this.calls.push("createOrder");
    this.orders.push(name);
    return this.hooks.createOrder ? this.hooks.createOrder(name) : { name, status: "pending" };
  }
  async getAuthorizations(order: unknown): Promise<Array<{ status?: string; challenges: unknown[] }>> {
    this.calls.push("getAuthorizations");
    const i = this.authCalls++;
    void order;
    return this.hooks.getAuthorizations ? this.hooks.getAuthorizations(i) : [{ status: "pending", challenges: [HTTP01, DNS01] }];
  }
  async getChallengeKeyAuthorization(): Promise<string> {
    this.calls.push("getChallengeKeyAuthorization");
    return KEY_AUTH;
  }
  async completeChallenge(challenge: unknown): Promise<unknown> {
    this.calls.push("completeChallenge");
    this.completed.push(challenge);
    return this.hooks.completeChallenge ? this.hooks.completeChallenge(challenge) : {};
  }
  async waitForValidStatus(item: unknown): Promise<unknown> {
    this.calls.push("waitForValidStatus");
    return this.hooks.waitForValidStatus ? this.hooks.waitForValidStatus(item) : {};
  }
  async finalizeOrder(order: unknown): Promise<unknown> {
    this.calls.push("finalizeOrder");
    return order;
  }
  async getCertificate(order: unknown): Promise<string> {
    this.calls.push("getCertificate");
    const name = (order as { name?: string }).name ?? "dash.example.com";
    return this.hooks.getCertificate ? this.hooks.getCertificate(name) : this.certFor(name);
  }
}

interface FactoryCall {
  directoryUrl: string;
  accountUrl?: string;
}

/** A `clientFactory` that hands out the one client and records what it was asked for. */
function factoryFor(client: FakeClient): { factory: AcmeSourceOptions["clientFactory"]; calls: FactoryCall[] } {
  const calls: FactoryCall[] = [];
  return {
    calls,
    factory: (o) => {
      calls.push({ directoryUrl: o.directoryUrl, accountUrl: o.accountUrl });
      return client;
    },
  };
}

// ── fake solver / dns ────────────────────────────────────────────────────

class FakeSolver implements Dns01Solver {
  type: "cloudflare" | "acme-dns";
  published: Array<{ domain: string; value: string }> = [];
  cleaned: string[] = [];
  checkCalls: string[] = [];
  credCalls = 0;
  nextRef = 1;
  checkImpl: (domain: string) => Promise<SolverCheck> = async () => ({ ok: true });
  credImpl: () => Promise<SolverCheck & { skipped?: boolean }> = async () => ({ ok: true });
  publishImpl?: (domain: string, value: string) => Promise<{ ref: string }>;
  cleanupImpl?: (ref: { ref: string }) => Promise<void>;
  lockImpl: (o: { maxWaitMs: number }) => Promise<{ release(): void }> = async () => ({ release() {} });

  constructor(type: "cloudflare" | "acme-dns" = "cloudflare") {
    this.type = type;
  }

  async publish(domain: string, value: string): Promise<{ ref: string }> {
    this.published.push({ domain, value });
    if (this.publishImpl) return this.publishImpl(domain, value);
    return { ref: `ref-${this.nextRef++}` };
  }
  async cleanup(ref: { ref: string }): Promise<void> {
    this.cleaned.push(ref.ref);
    if (this.cleanupImpl) return this.cleanupImpl(ref);
  }
  async check(domain: string): Promise<SolverCheck> {
    this.checkCalls.push(domain);
    return this.checkImpl(domain);
  }
  async checkCredentials(): Promise<SolverCheck & { skipped?: boolean }> {
    this.credCalls++;
    return this.credImpl();
  }
  acquireOrderLock(o: { maxWaitMs: number }): Promise<{ release(): void }> {
    return this.lockImpl(o);
  }
}

export class FakeDns implements DnsApi {
  waits: Array<{ owner: string; value: string }> = [];
  mode: "authoritative" | "doh-fallback" = "authoritative";
  waitImpl?: (owner: string, value: string, signal?: AbortSignal) => Promise<void>;
  async discoverZone(): Promise<{ zone: string; servers: Array<{ host: string; addresses: string[] }> }> {
    return { zone: "example.com", servers: [] };
  }
  async resolveCnameAtAuthoritative(): Promise<{ targets: string[]; perServer: Array<{ server: string; target: string | null }> }> {
    return { targets: [], perServer: [] };
  }
  async waitForTxt(owner: string, value: string, opts: { signal?: AbortSignal }): Promise<{ mode: "authoritative" | "doh-fallback" }> {
    this.waits.push({ owner, value });
    if (this.waitImpl) await this.waitImpl(owner, value, opts.signal);
    return { mode: this.mode };
  }
}

export interface Built {
  source: AcmeCertSource;
  client: FakeClient;
  solver: FakeSolver;
  dns: FakeDns;
  factoryCalls: FactoryCall[];
}

/** An `AcmeCertSource` over fakes. `entry` overrides are merged into `baseEntry()` and normalized. */
export function build(opts: { entry?: Json; client?: FakeClient; solver?: Dns01Solver; dns?: DnsApi; source?: Partial<AcmeSourceOptions> } = {}): Built {
  const entry = normalizeAcmeEntry(baseEntry(opts.entry));
  const client = opts.client ?? new FakeClient();
  const { factory, calls } = factoryFor(client);
  const solverType = (entry.solver as Json).type === "acme-dns" ? "acme-dns" : "cloudflare";
  const solver = (opts.solver as FakeSolver | undefined) ?? new FakeSolver(solverType);
  const dns = (opts.dns as FakeDns | undefined) ?? new FakeDns();
  const source = new AcmeCertSource({
    id: String(entry.id),
    entry,
    clientFactory: factory,
    solver,
    dns,
    ...opts.source,
  });
  return { source, client, solver: solver as FakeSolver, dns: dns as FakeDns, factoryCalls: calls };
}

// ── fixture certificates for manager-driven tests ───────────────────────

let fixtureName: FixtureName = "dash.example.com";

function fixtureCertFor(name: string): string {
  void name;
  return fixture(fixtureName).certPem;
}

/**
 * Make the source's generated certificate key the committed fixture key so the manager's
 * cert/key pairing check passes with a fake CA. Returns the spy to restore.
 */
function useFixture(name: FixtureName): MockInstance {
  fixtureName = name;
  return vi.spyOn(acme.crypto, "createPrivateEcdsaKey").mockImplementation((async () => Buffer.from(fixture(name).keyPem)) as never);
}

/**
 * Replace the library's async key/CSR generation (threadpool work that finishes in REAL time) with
 * instant stubs, so fake-timer suites stay deterministic. Returns nothing; undo with `vi.restoreAllMocks()`.
 */
export function fastCrypto(name: FixtureName = "dash.example.com"): void {
  useFixture(name);
  vi.spyOn(acme.crypto, "createCsr").mockImplementation((async () => [Buffer.from(fixture(name).keyPem), Buffer.from("csr")]) as never);
}

export const NEVER = new Promise<never>(() => undefined);

export function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
