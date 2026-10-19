/**
 * `AcmeCertSource` — ACME (RFC 8555) certificates for operator-owned domains via
 * DNS-01, so a dashboard on a private/mesh IP gets a publicly trusted
 * certificate with no inbound exposure. Registered as cert-source type `acme`.
 *
 * Hang bounds (acme-client has no abort signal): 30 s axios timeout, 30 s on
 * every solver/DoH fetch, a 10 min per-attempt deadline measured from the start
 * of the attempt body (after any acme-dns lock wait) and an abort generation
 * (`AsyncLocalStorage`) checked per step and by an `acme.axios` request
 * interceptor, so an aborted attempt starts no new CA/DNS call except cleanup.
 *
 * See change: add-acme-dns01-certs (design D1–D9).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import * as acme from "acme-client";
import { type CertSource, type CertSourceType, type Gate, type ObtainedCert, RetryAfterError, type SourceDetails, type SourceReadiness } from "../../types.js";
import { getCachedAccountUrl, loadOrCreateAccountKey, setCachedAccountUrl } from "./accounts.js";
import { redactSecrets } from "./credentials.js";
import { createDnsApi } from "./dns.js";
import { resolveAcmeE2eOverrides } from "./e2e-overrides.js";
import {
  canonicalDirectory,
  canonicalDirectoryUrl,
  classifyDirectory,
  effectiveAdvertise,
  normalizeAcmeEntry,
  validateAcmeEntry,
} from "./entry.js";
import { acmeGc } from "./gc.js";
import { type AcmeRuntime, getAcmeRuntime } from "./runtime.js";
import { createAcmeDnsSolver } from "./solvers/acme-dns.js";
import { createCloudflareSolver } from "./solvers/cloudflare.js";
import { challengeOwner, type Dns01Solver, type DnsApi, type SolverCheck } from "./types.js";

type Json = Record<string, unknown>;

/** Source-side attempt deadline, measured from the start of the attempt body. */
const ATTEMPT_DEADLINE_MS = 10 * 60_000;
/** Backstop declared to the manager: deadline + 30 s (× names for acme-dns, where attempts queue). */
const BACKSTOP_PER_ATTEMPT_MS = ATTEMPT_DEADLINE_MS + 30_000;
const CA_INVALID_RETRY_MS = 60 * 60_000;
const CHECK_TTL_MS = 5 * 60_000;
const ERROR_MAX = 400;

/** The subset of `acme.Client` the source uses (test seam). */
export interface AcmeClientLike {
  createAccount(data: { termsOfServiceAgreed: boolean; contact: string[] }): Promise<unknown>;
  getAccountUrl(): string;
  // biome-ignore lint/suspicious/noExplicitAny: acme-client order/authorization objects are loosely typed
  createOrder(data: { identifiers: Array<{ type: string; value: string }> }): Promise<any>;
  // biome-ignore lint/suspicious/noExplicitAny: see above
  getAuthorizations(order: any): Promise<any[]>;
  // biome-ignore lint/suspicious/noExplicitAny: see above
  getChallengeKeyAuthorization(challenge: any): Promise<string>;
  // biome-ignore lint/suspicious/noExplicitAny: see above
  completeChallenge(challenge: any): Promise<unknown>;
  // biome-ignore lint/suspicious/noExplicitAny: see above
  waitForValidStatus(item: any): Promise<unknown>;
  // biome-ignore lint/suspicious/noExplicitAny: see above
  finalizeOrder(order: any, csr: Buffer | string): Promise<any>;
  // biome-ignore lint/suspicious/noExplicitAny: see above
  getCertificate(order: any): Promise<string>;
}
export type AcmeClientFactory = (o: { directoryUrl: string; accountKey: string; accountUrl?: string }) => AcmeClientLike;

const defaultClientFactory: AcmeClientFactory = (o) => new acme.Client(o) as unknown as AcmeClientLike;

interface AttemptCtx {
  aborted: boolean;
  refs: Array<{ ref: string }>;
  controller: AbortController;
  release: () => void;
}
const attemptStore = new AsyncLocalStorage<AttemptCtx>();

let libConfigured = false;
/** One-time configuration of the shared `acme-client` axios instance and logger. */
function configureAcmeLib(): void {
  if (libConfigured) return;
  libConfigured = true;
  acme.axios.defaults.timeout = 30_000;
  acme.setLogger(() => undefined);
  acme.axios.interceptors.request.use((config) => {
    if (attemptStore.getStore()?.aborted) throw new Error("ACME attempt aborted");
    return config;
  });
}

/** Live instance per source id, so the credentials route can invalidate its readiness. */
const live = new Map<string, AcmeCertSource>();
export function getLiveAcmeSource(id: string): AcmeCertSource | undefined {
  return live.get(id);
}

export interface AcmeSourceOptions {
  id: string;
  /** Already normalized (`normalizeAcmeEntry`). */
  entry: Json;
  runtime?: AcmeRuntime;
  clientFactory?: AcmeClientFactory;
  solver?: Dns01Solver;
  dns?: DnsApi;
  now?: () => number;
  deadlineMs?: number;
  checkTtlMs?: number;
}

interface CachedCheck {
  result: SolverCheck;
  at: number;
  /** Last check threw: the result is kept with a hint. */
  errorHint?: string;
}

const trunc = (s: string): string => (s.length > ERROR_MAX ? `${s.slice(0, ERROR_MAX)}…` : s);

export class AcmeCertSource implements CertSource {
  readonly type = "acme";
  readonly id: string;
  private readonly rt: AcmeRuntime;
  private readonly now: () => number;
  private readonly domains: string[];
  private readonly email: string;
  private readonly directory: string;
  private readonly advertiseOpt: boolean | undefined;
  private readonly solverType: "cloudflare" | "acme-dns";
  private readonly fulldomain?: string;
  private readonly solver: Dns01Solver;
  private readonly dns: DnsApi;
  private readonly clientFactory: AcmeClientFactory;
  private readonly deadlineMs: number;
  private readonly checkTtlMs: number;

  private removed = false;
  private readonly inflight = new Set<AttemptCtx>();
  private propagationMode: string | undefined;
  private redact: (m: string) => string = (m) => redactSecrets(m, []);

  // readiness state
  private checks = new Map<string, CachedCheck>();
  private credFailed = false;
  private credHint: string | undefined;
  private credLast: { ok: boolean; hint?: string } | undefined;
  private dirty = true;
  private readinessChain: Promise<unknown> = Promise.resolve();

  constructor(opts: AcmeSourceOptions) {
    configureAcmeLib();
    this.id = opts.id;
    this.rt = opts.runtime ?? getAcmeRuntime();
    this.now = opts.now ?? Date.now;
    const e = opts.entry;
    this.domains = (e.domains as string[]) ?? [];
    this.email = String(e.email ?? "");
    this.directory = canonicalDirectory(e.directory) ?? String(e.directory ?? "");
    this.advertiseOpt = typeof e.advertise === "boolean" ? e.advertise : undefined;
    const solver = (e.solver ?? {}) as Json;
    this.solverType = solver.type === "acme-dns" ? "acme-dns" : "cloudflare";
    if (this.solverType === "acme-dns") this.fulldomain = String(solver.fulldomain ?? "");
    this.deadlineMs = opts.deadlineMs ?? ATTEMPT_DEADLINE_MS;
    this.checkTtlMs = opts.checkTtlMs ?? CHECK_TTL_MS;
    this.clientFactory = opts.clientFactory ?? defaultClientFactory;

    const overrides = resolveAcmeE2eOverrides(this.rt.env, this.rt.log);
    this.dns = opts.dns ?? createDnsApi({ authoritativeOverride: overrides.authoritativeOverride });
    const deps = {
      sourceId: this.id,
      readSecret: (label: string) => this.rt.credentials.readSecret(this.id, label),
      redact: (m: string) => this.redact(m),
      cloudflareApiBase: overrides.cloudflareApiBase,
      onCredentialFailure: () => {
        this.credFailed = true;
        this.credHint = "The DNS provider rejected the saved credentials";
      },
      dns: this.dns,
      now: this.now,
    };
    this.solver =
      opts.solver ??
      (this.solverType === "acme-dns"
        ? createAcmeDnsSolver(
            { server: String(solver.server), subdomain: String(solver.subdomain), fulldomain: String(solver.fulldomain) },
            deps,
          )
        : createCloudflareSolver({ zoneId: typeof solver.zoneId === "string" ? solver.zoneId : undefined }, deps));
    live.set(this.id, this);
  }

  // ── CertSource ───────────────────────────────────────────────────────

  async names(): Promise<string[] | null> {
    return [...this.domains];
  }

  configFingerprint(name: string): string {
    const adv = effectiveAdvertise(this.directory, this.advertiseOpt);
    return createHash("sha256").update(`${this.directory}\n${adv}\n${name}`).digest("hex");
  }

  /** Backstop for the manager: queue time of an acme-dns registration is covered by multiplying with the name count. */
  get attemptTimeoutMs(): number {
    return this.solverType === "acme-dns" ? BACKSTOP_PER_ATTEMPT_MS * Math.max(1, this.domains.length) : BACKSTOP_PER_ATTEMPT_MS;
  }

  async onReconciled(): Promise<void> {
    await acmeGc();
  }

  async onRemoved(): Promise<void> {
    this.removed = true;
    for (const ctx of [...this.inflight]) this.abort(ctx);
    if (live.get(this.id) === this) live.delete(this.id);
    await acmeGc();
  }

  /** Credentials were saved/changed: drop cached results; the next readiness re-checks the credentials. */
  invalidateReadiness(): void {
    this.checks.clear();
    this.credFailed = false;
    this.credHint = undefined;
    this.dirty = true;
  }

  // ── readiness ────────────────────────────────────────────────────────

  readiness(opts?: { force?: boolean }): Promise<SourceReadiness> {
    const run = this.readinessChain.then(() => this.computeReadiness(opts?.force === true));
    this.readinessChain = run.catch(() => undefined);
    return run;
  }

  private baseDetails(): SourceDetails {
    const details: SourceDetails = {
      directory: this.directory,
      staging: classifyDirectory(this.directory) === "staging",
      solverType: this.solverType,
    };
    if (this.fulldomain) details.fulldomain = this.fulldomain;
    if (this.propagationMode) details.propagationMode = this.propagationMode;
    return details;
  }

  private async computeReadiness(force: boolean): Promise<SourceReadiness> {
    const details = this.baseDetails();
    const gates: Gate[] = [];
    const creds = this.rt.credentials;

    if (creds.vaultState() !== "ok") {
      return { gates: [{ id: "credentials", ok: false, hint: "credential vault unavailable" }], details };
    }
    let configured = false;
    try {
      configured = await creds.isConfigured(this.id, this.solverType);
    } catch {
      return { gates: [{ id: "credentials", ok: false, hint: "credential vault unavailable" }], details };
    }
    if (!configured) {
      return {
        gates: [{ id: "credentials", ok: false, hint: this.missingCredentialsHint() }],
        details,
      };
    }
    this.redact = await creds.redactorFor(this.id, this.solverType).catch(() => this.redact);

    // Source-wide credential validity: after a save, on a forced refresh, or when an attempt saw a 401/403.
    const credentialsCheckDue = force || this.dirty;
    if (credentialsCheckDue) {
      try {
        const r = await this.solver.checkCredentials();
        if (!r.skipped) {
          this.credLast = { ok: r.ok, hint: r.hint };
          this.credFailed = !r.ok;
          this.credHint = r.ok ? undefined : (r.hint ?? "The DNS provider rejected the saved credentials");
        }
      } catch (err) {
        // timeout / 5xx / network: keep the last result.
        this.credHint = this.credFailed ? this.credHint : undefined;
        details.credentialsCheck = `check failed: ${this.safeMessage(err)}`;
      }
      this.dirty = false;
    }
    if (this.credFailed) {
      gates.push({ id: "credentials", ok: false, hint: this.credHint ?? "The DNS provider rejected the saved credentials" });
      return { gates, details: this.withCheckTimes(details) };
    }

    for (const domain of this.domains) {
      const gate = await this.domainGate(domain, force);
      if (gate && gate.id === "credentials" && !gate.name) {
        if (!gates.some((g) => g.id === "credentials")) gates.push(gate);
      } else if (gate) gates.push(gate);
    }
    return { gates, details: this.withCheckTimes(details) };
  }

  private missingCredentialsHint(): string {
    return this.solverType === "acme-dns"
      ? "Save the acme-dns username and key in the credential vault."
      : "Save the Cloudflare API token in the credential vault.";
  }

  private withCheckTimes(details: SourceDetails): SourceDetails {
    for (const [domain, c] of this.checks) details[`checkedAt:${domain}`] = new Date(c.at).toISOString();
    return details;
  }

  private async domainGate(domain: string, force: boolean): Promise<Gate | null> {
    const cached = this.checks.get(domain);
    const stale = !cached || this.now() - cached.at >= this.checkTtlMs;
    let entry = cached;
    if (force || stale) {
      try {
        const result = await this.solver.check(domain);
        entry = { result, at: this.now() };
      } catch (err) {
        const hint = `check failed: ${this.safeMessage(err)}`;
        entry = cached
          ? { ...cached, errorHint: hint }
          : { result: { ok: false, hint }, at: this.now(), errorHint: hint };
        if (cached) entry.at = this.now();
      }
      this.checks.set(domain, entry);
    }
    if (!entry) return null;
    const r = entry.result;
    if (r.ok) return null;
    const id = r.gate ?? (this.solverType === "acme-dns" ? "dns-cname" : "dns-zone");
    const hint = entry.errorHint ? `${r.hint ?? ""}${r.hint ? " — " : ""}${entry.errorHint}` : r.hint;
    return id === "credentials" ? { id, ok: false, hint } : { id, ok: false, name: domain, hint };
  }

  private safeMessage(err: unknown): string {
    return trunc(this.redact(err instanceof Error ? err.message : String(err)));
  }

  // ── obtain ───────────────────────────────────────────────────────────

  async obtain(name: string, onStage: (stage: string) => void): Promise<ObtainedCert> {
    if (this.removed) throw new Error("source removed");
    const allowance = Math.max(0, this.attemptTimeoutMs - BACKSTOP_PER_ATTEMPT_MS);
    const lock = await this.solver.acquireOrderLock({ maxWaitMs: allowance });
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      lock.release();
    };
    const ctx: AttemptCtx = { aborted: false, refs: [], controller: new AbortController(), release };
    this.inflight.add(ctx);
    // Re-check staleness after the lock wait: removal flag (generation checks live in `step`).
    if (this.removed) {
      this.abort(ctx);
      this.inflight.delete(ctx);
      throw new Error("source removed");
    }
    try {
      this.redact = await this.rt.credentials.redactorFor(this.id, this.solverType).catch(() => this.redact);
    } catch {
      /* keep the previous redactor */
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        this.abort(ctx);
        reject(new Error(`ACME attempt timed out after ${Math.round(this.deadlineMs / 60_000)} min`));
      }, this.deadlineMs);
      timer.unref?.();
    });
    const body = attemptStore.run(ctx, () => this.runAttempt(name, onStage, ctx));
    body.catch(() => undefined);
    try {
      return await Promise.race([body, deadline]);
    } catch (err) {
      throw this.toSafeError(err);
    } finally {
      if (timer) clearTimeout(timer);
      if (!ctx.aborted) await this.cleanupRefs(ctx);
      else this.cleanupRefs(ctx).catch(() => undefined);
      this.inflight.delete(ctx);
      release();
    }
  }

  /** Abort an attempt: no new CA/DNS call (except cleanup), lock released, known records cleaned. */
  private abort(ctx: AttemptCtx): void {
    if (ctx.aborted) return;
    ctx.aborted = true;
    ctx.controller.abort();
    ctx.release();
    this.cleanupRefs(ctx).catch(() => undefined);
  }

  private async cleanupRefs(ctx: AttemptCtx): Promise<void> {
    const refs = ctx.refs.splice(0);
    await Promise.allSettled(
      refs.map((r) =>
        this.solver.cleanup(r).catch((err) => this.rt.log.warn(`cleanup failed source=${this.id}: ${this.safeMessage(err)}`)),
      ),
    );
  }

  private toSafeError(err: unknown): Error {
    const msg = trunc(this.redact(err instanceof Error ? err.message : String(err)));
    if (err instanceof RetryAfterError) return new RetryAfterError(msg, err.retryAfterMs);
    const out = new Error(msg);
    return out;
  }

  private async runAttempt(name: string, onStage: (stage: string) => void, ctx: AttemptCtx): Promise<ObtainedCert> {
    const step = (): void => {
      if (ctx.aborted) throw new Error("ACME attempt aborted");
    };
    step();
    onStage("order");
    const directoryUrl = canonicalDirectoryUrl(this.directory);
    if (!directoryUrl) throw new Error("invalid ACME directory");
    const { hash, keyPem: accountKey } = await loadOrCreateAccountKey(
      this.rt.tlsRoot,
      this.directory,
      this.email,
      () => !this.removed && !ctx.aborted,
    );
    step();
    const cached = getCachedAccountUrl(hash);
    const client = this.clientFactory({ directoryUrl, accountKey, ...(cached ? { accountUrl: cached } : {}) });
    if (!cached) {
      await client.createAccount({ termsOfServiceAgreed: true, contact: [`mailto:${this.email}`] });
      step();
      setCachedAccountUrl(hash, client.getAccountUrl());
    }
    const order = await client.createOrder({ identifiers: [{ type: "dns", value: name }] });
    step();
    const authorizations = await client.getAuthorizations(order);
    step();
    for (const authz of authorizations) {
      // biome-ignore lint/suspicious/noExplicitAny: loosely typed library objects
      const challenge = (authz.challenges as any[] | undefined)?.find((c) => c.type === "dns-01");
      if (!challenge) throw new Error(`The CA offered no dns-01 challenge for ${name}`);
      const value = await client.getChallengeKeyAuthorization(challenge);
      step();
      onStage("dns-publish");
      const ref = await this.solver.publish(name, value);
      if (ctx.aborted) {
        // A publish that resolved after the abort: delete it by its own ref, never hand it on.
        void this.solver.cleanup(ref).catch(() => undefined);
        throw new Error("ACME attempt aborted");
      }
      ctx.refs.push(ref);
      onStage("propagation");
      const { mode } = await this.dns.waitForTxt(challengeOwner(name), value, { signal: ctx.controller.signal });
      this.propagationMode = mode;
      step();
      onStage("validation");
      await client.completeChallenge(challenge);
      step();
      try {
        await client.waitForValidStatus(challenge);
      } catch (err) {
        throw await this.classifyValidationFailure(err, client, order, ctx);
      }
      step();
    }
    onStage("finalize");
    const certKey = await acme.crypto.createPrivateEcdsaKey("P-256");
    const [, csr] = await acme.crypto.createCsr({ commonName: name, altNames: [name] }, certKey);
    const finalized = await client.finalizeOrder(order, csr);
    step();
    const certPem = await client.getCertificate(finalized);
    step();
    const details: SourceDetails = {
      directory: this.directory,
      staging: classifyDirectory(this.directory) === "staging",
      solverType: this.solverType,
      ...(this.propagationMode ? { propagationMode: this.propagationMode } : {}),
    };
    return {
      certPem,
      keyPem: certKey.toString(),
      advertise: effectiveAdvertise(this.directory, this.advertiseOpt),
      kind: "domain",
      details,
    };
  }

  /** CA marked an authorization `invalid` → 1 h floor; anything else stays a plain (counted, backed-off) error. */
  private async classifyValidationFailure(err: unknown, client: AcmeClientLike, order: unknown, ctx: AttemptCtx): Promise<Error> {
    const detail = err instanceof Error ? err.message : String(err);
    if (!ctx.aborted) {
      try {
        const auths = await client.getAuthorizations(order);
        if (auths.some((a) => a?.status === "invalid")) {
          return new RetryAfterError(`The CA reported the challenge as invalid: ${detail}`, CA_INVALID_RETRY_MS);
        }
      } catch {
        /* fall through to the plain error */
      }
    }
    return err instanceof Error ? err : new Error(detail);
  }
}

export const acmeSourceType: CertSourceType = {
  type: "acme",
  validate: (entry) => validateAcmeEntry(entry),
  create: (entry, id) => new AcmeCertSource({ id, entry: normalizeAcmeEntry(entry) }),
};
