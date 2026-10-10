/**
 * ServiceManager (D1–D10): one lifecycle state machine for three ownership
 * modes behind one consumer contract (`ensure` / `heartbeat` / `release`).
 *
 * Invariants this module owns:
 * - nothing runs at boot without definitions; with definitions, boot is
 *   ADOPTION ONLY (one `ps -a` + `inspect` per referenced OCI runtime, native
 *   pid/port checks) — no health probe, no network I/O;
 * - every lifecycle operation is serialized per service (mutex → lifecycle
 *   file lock), so concurrent `ensure`s start at most once, across servers too;
 * - `healthy` only on a passing probe; alive-but-failing is `blocked`, never
 *   killed, relaunched or idle-stopped;
 * - a stop is confirmed by observation, else `stop-failed`;
 * - a failed start backs off (5 s doubling, cap 5 min) and NO start path
 *   overrides `retryAt` — only `retry` or a definition change clears it;
 * - no secret value in any payload, status or log line.
 * See change: add-service-registry-core.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import { findListenAddresses } from "@blackbelt-technology/pi-dashboard-shared/platform/process-scan.js";
import {
  definitionFromOffer,
  diffTemplates,
  discoverServiceOffers,
  type ParsedServiceOffers,
  type ServiceOffer,
  type TemplateDiffEntry,
  templateOfDefinition,
} from "@blackbelt-technology/pi-dashboard-shared/services/offers.js";
import {
  canonicalJson,
  type DriverName,
  type EnsurePayload,
  type EnsureState,
  type Exposure,
  effectiveTimings,
  type ManagedDriverId,
  type ServiceDefinition,
  type UnavailableReason,
  validateDefinition,
} from "@blackbelt-technology/pi-dashboard-shared/services/schema.js";
import { AttachedDriver, ExternalDriver } from "./attached-driver.js";
import type { CommandRunner } from "./command-runner.js";
import { DefinitionsCorruptError, DefinitionsStore } from "./definitions-store.js";
import type { AdoptResult, DriverInstance, ServiceDriver } from "./driver.js";
import { createLimiter, PROBE_CONCURRENCY, probeHttp, probeTcp, probeWsFirstMessage } from "./health.js";
import { LeaseTable } from "./leases.js";
import { NativeDriver } from "./native-driver.js";
import { OciDriver } from "./oci-driver.js";
import { ensurePrivateDir, type ServicesPaths } from "./paths.js";
import { RuntimeDetector as Detector, type RuntimeDetector, type RuntimeReport } from "./runtime-detect.js";
import { removeSecretMounts } from "./secret-delivery.js";
import { resolveServiceSecrets } from "./secrets-resolver.js";
import { SecretsCorruptError, SecretsStore } from "./secrets-store.js";
import {
  backoffMs,
  KeyedMutex,
  type LifecycleLockOptions,
  StateCell,
  shouldIdleStop,
  startPhaseOutcome,
  withLifecycleLock,
} from "./state-machine.js";

/** `unavailable` reasons that persist until an explicit stop / remove. */
const STICKY_REASONS = new Set<UnavailableReason>(["adoption-uncertain", "owner-conflict", "duplicate-instances"]);

export const REPROBE_INTERVAL_MS = 30_000;
const OFFERS_CACHE_MS = 10_000;
const MAX_SECRET_BYTES = 64 * 1024;

export interface ServiceManagerDeps {
  paths: ServicesPaths;
  run: CommandRunner;
  resolveBinary: (name: string) => string | null;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  discoverOffers?: () => ParsedServiceOffers;
  /** Driver overrides (tests); missing names get the real driver. */
  drivers?: Partial<Record<DriverName, ServiceDriver>>;
  /** Health probe override (tests). */
  probe?: (def: ServiceDefinition, inst: DriverInstance, driver: ServiceDriver) => Promise<boolean>;
  exposure?: (port: number) => Promise<Exposure>;
  detector?: RuntimeDetector;
  lockOptions?: LifecycleLockOptions;
  leaseTtlMs?: number;
  startPollMs?: number;
  tickMs?: number;
}

export interface ServiceStatus {
  id: string;
  mode?: ServiceDefinition["mode"];
  state: EnsureState | "idle" | "stopped" | "stopping";
  reason?: UnavailableReason;
  hint?: string;
  driver?: DriverName;
  endpoints?: Record<string, string>;
  exposure?: Exposure;
  startedBy?: "dashboard" | "external";
  pinned: boolean;
  leases: number;
  retryAt?: string;
  restartRequired?: boolean;
  tried?: EnsurePayload["tried"];
  origin?: ServiceDefinition["origin"];
  updateAvailable?: boolean;
  diff?: TemplateDiffEntry[];
  secrets: Record<string, { configured: boolean }>;
  errors?: string[];
}

export interface ServiceList {
  instanceId?: string;
  definitionsCorrupt?: boolean;
  backupPath?: string;
  secretsCorrupt?: boolean;
  secretsBackupPath?: string;
  services: ServiceStatus[];
}

export type AddRequest = { offer: string; dryRun?: boolean; update?: boolean } | { definition: unknown; dryRun?: boolean };

export interface AddReview {
  id: string;
  mode: ServiceDefinition["mode"];
  drivers?: ManagedDriverId[];
  image?: string;
  recipe?: { runner: string; package: string; bin?: string; args: string[] };
  ports: string[];
  volumes: string[];
  binds: string[];
  secrets: string[];
  templateHash?: string;
  diff?: TemplateDiffEntry[];
  /** Native packages are fetched only by an explicit prefetch. */
  needsPrefetch?: boolean;
}

export class ServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

interface Rec {
  cell: StateCell;
  instance?: DriverInstance;
  failures: number;
  retryAt?: number;
  hint?: string;
  tried?: EnsurePayload["tried"];
  idleSince?: number;
  idleResetAt?: number;
  fullHash?: string;
  exposure?: Exposure;
}

/** Hash of the runtime-relevant definition fields (`pi.def-hash`). */
export function definitionHash(def: ServiceDefinition): string {
  const { mode, drivers, oci, native, lifecycle, process: proc, secrets } = def;
  const secretShape = Object.fromEntries(Object.entries(secrets ?? {}).map(([n, s]) => [n, { env: s.env ?? null }]));
  return createHash("sha256")
    .update(canonicalJson({ mode, drivers, oci, native, lifecycle, process: proc, secrets: secretShape }))
    .digest("hex")
    .slice(0, 32);
}

function fullHash(def: ServiceDefinition): string {
  return createHash("sha256").update(canonicalJson(def)).digest("hex");
}

export class ServiceManager {
  readonly definitions: DefinitionsStore;
  readonly secrets: SecretsStore;
  readonly leases: LeaseTable;
  private readonly recs = new Map<string, Rec>();
  private readonly mutex = new KeyedMutex();
  private readonly limit = createLimiter(PROBE_CONCURRENCY);
  private readonly driverMap = new Map<DriverName, ServiceDriver>();
  private readonly detector: RuntimeDetector;
  private offersCache?: { at: number; value: ParsedServiceOffers };
  private timer?: ReturnType<typeof setInterval>;
  private pins = new Set<string>();

  constructor(private readonly deps: ServiceManagerDeps) {
    this.definitions = new DefinitionsStore(deps.paths.definitions);
    this.secrets = new SecretsStore(deps.paths.secrets);
    this.leases = new LeaseTable(deps.leaseTtlMs);
    const common = { run: deps.run, resolveBinary: deps.resolveBinary, paths: deps.paths };
    const sleep = deps.sleep;
    const now = deps.now;
    const real: Record<DriverName, ServiceDriver> = {
      "oci:docker": new OciDriver({ ...common, runtime: "docker", sleep, now }),
      "oci:podman": new OciDriver({ ...common, runtime: "podman", sleep, now }),
      native: new NativeDriver({ ...common, platform: deps.platform }),
      attached: new AttachedDriver({ run: deps.run, platform: deps.platform, sleep, now }),
      external: new ExternalDriver(),
    };
    for (const [name, d] of Object.entries(real) as Array<[DriverName, ServiceDriver]>) {
      this.driverMap.set(name, deps.drivers?.[name] ?? d);
    }
    this.detector =
      deps.detector ??
      new Detector({
        run: deps.run,
        resolveBinary: deps.resolveBinary,
        containerEnv: () => (this.driverMap.get("oci:docker") as OciDriver).runtimeEnv?.() ?? process.env,
      });
    this.loadPins();
  }

  // ── plumbing ──────────────────────────────────────────────────────────────

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  private sleep(ms: number): Promise<void> {
    return (this.deps.sleep ?? ((m) => new Promise<void>((r) => setTimeout(r, m))))(ms);
  }

  private log(line: string): void {
    (this.deps.log ?? console.log)(line);
  }

  private rec(id: string): Rec {
    let r = this.recs.get(id);
    if (!r) {
      r = { cell: new StateCell(id, (l) => this.log(l)), failures: 0 };
      this.recs.set(id, r);
    }
    return r;
  }

  driver(name: DriverName): ServiceDriver {
    const d = this.driverMap.get(name);
    if (!d) throw new Error(`unknown driver ${name}`);
    return d;
  }

  private driversOf(def: ServiceDefinition): ServiceDriver[] {
    if (def.mode === "managed") return (def.drivers ?? []).map((n) => this.driver(n));
    return [this.driver(def.mode)];
  }

  private loadPins(): void {
    try {
      for (const id of fs.readdirSync(this.deps.paths.runRoot)) {
        if (fs.existsSync(this.deps.paths.pinMarker(id))) this.pins.add(id);
      }
    } catch {
      /* no run dir yet */
    }
  }

  private instanceId(): string | undefined {
    const r = this.definitions.read();
    return r.ok ? r.instanceId : undefined;
  }

  /** Fresh read of one definition. */
  private lookup(id: string): { def?: ServiceDefinition; errors?: string[]; corrupt?: boolean; backupPath?: string; instanceId?: string } {
    const r = this.definitions.read();
    if (!r.ok) return { corrupt: true, backupPath: r.backupPath };
    const e = r.entries.find((x) => x.id === id);
    if (!e) return { instanceId: r.instanceId };
    return { def: e.def, errors: e.errors, instanceId: r.instanceId };
  }

  offers(): ParsedServiceOffers {
    const c = this.offersCache;
    if (c && this.now() - c.at < OFFERS_CACHE_MS) return c.value;
    const value = (this.deps.discoverOffers ?? (() => discoverServiceOffers(process.cwd())))();
    this.offersCache = { at: this.now(), value };
    return value;
  }

  private findOffer(ref: string): ServiceOffer | undefined {
    const { offers } = this.offers();
    const hash = ref.lastIndexOf("#");
    if (hash > 0) {
      const pkg = ref.slice(0, hash);
      const id = ref.slice(hash + 1);
      return offers.find((o) => o.package === pkg && o.template.id === id);
    }
    const matches = offers.filter((o) => o.template.id === ref);
    if (matches.length > 1) throw new ServiceError(409, "ambiguous-offer", `several packages offer "${ref}"; use <package>#${ref}`);
    return matches[0];
  }

  private updateInfo(def: ServiceDefinition): { updateAvailable?: boolean; diff?: TemplateDiffEntry[] } {
    if (def.origin === "user") return {};
    const origin = def.origin;
    const offer = this.offers().offers.find((o) => o.package === origin.package && o.template.id === def.id);
    if (!offer || offer.templateHash === origin.templateHash) return {};
    return { updateAvailable: true, diff: diffTemplates(templateOfDefinition(def), offer.template) };
  }

  /** Definition changed since last seen → clear backoff, reset the idle clock. */
  private noteDefinition(def: ServiceDefinition, rec: Rec): void {
    const h = fullHash(def);
    if (rec.fullHash !== undefined && rec.fullHash !== h) {
      rec.retryAt = undefined;
      rec.failures = 0;
      this.resetIdle(rec);
    }
    rec.fullHash = h;
  }

  private resetIdle(rec: Rec): void {
    const now = this.now();
    rec.idleResetAt = now;
    if (rec.idleSince !== undefined) rec.idleSince = Math.max(rec.idleSince, now);
  }

  // ── probing ───────────────────────────────────────────────────────────────

  private async probe(def: ServiceDefinition, inst: DriverInstance, driver: ServiceDriver): Promise<boolean> {
    return this.limit(async () => {
      if (this.deps.probe) return this.deps.probe(def, inst, driver);
      const h = def.health;
      if (h.kind === "oci-healthcheck") return driver.healthcheck ? driver.healthcheck(def, inst) : false;
      const base = inst.endpoints[h.endpoint];
      if (!base) return false;
      if (h.kind === "tcp") return probeTcp(base, h.timeoutMs);
      const url = h.path ? new URL(h.path, base).toString() : base;
      return h.kind === "http" ? probeHttp(url, h.timeoutMs) : probeWsFirstMessage(url, h.timeoutMs);
    });
  }

  /** Probe a known instance: healthy | blocked | gone. Opens a host-reachability fallback once. */
  private async observe(def: ServiceDefinition, rec: Rec, driver: ServiceDriver): Promise<"healthy" | "blocked" | "gone"> {
    const inst = rec.instance!;
    let ok = await this.probe(def, inst, driver);
    if (!ok && driver.onProbeFailed) {
      const next = await driver.onProbeFailed(def, inst);
      if (next) {
        rec.instance = next;
        ok = await this.probe(def, next, driver);
      }
    }
    if (ok) return "healthy";
    const alive = await driver.isAlive(def, rec.instance!);
    return alive === true ? "blocked" : "gone";
  }

  private toHealthy(rec: Rec, why: string): void {
    const from = rec.cell.state;
    if (from === "stopped") rec.cell.init("idle", "adopted");
    if (from === "blocked" || from === "idle" || from === "stopped") this.resetIdle(rec);
    rec.failures = 0;
    rec.retryAt = undefined;
    rec.hint = undefined;
    rec.tried = undefined;
    rec.cell.transition("healthy", why);
  }

  private toBlocked(rec: Rec, why: string): void {
    if (rec.cell.state === "stopped") rec.cell.init("idle", "adopted");
    rec.cell.transition("blocked", why);
    rec.hint = "the process is alive but its health probe fails; it is never killed or relaunched automatically";
  }

  private unavailable(rec: Rec, reason: UnavailableReason, hint?: string, tried?: EnsurePayload["tried"]): void {
    rec.cell.transition("unavailable", reason, reason);
    rec.hint = hint;
    rec.tried = tried;
  }

  private failStart(rec: Rec, why: string): void {
    rec.failures += 1;
    rec.retryAt = this.now() + backoffMs(rec.failures);
    rec.instance = undefined;
    rec.hint = why;
    rec.cell.transition("failed", why.slice(0, 120));
  }

  // ── ensure ────────────────────────────────────────────────────────────────

  private payload(def: ServiceDefinition | undefined, id: string, rec: Rec, leaseId?: string): EnsurePayload {
    const s = rec.cell.state;
    const state: EnsureState =
      s === "healthy" || s === "idle"
        ? "healthy"
        : s === "starting" || s === "blocked" || s === "failed" || s === "unavailable" || s === "stop-failed"
          ? s
          : "unavailable";
    const p: EnsurePayload = { id, state };
    if (state === "unavailable") p.reason = rec.cell.reason ?? "invalid-definition";
    if (state === "failed" && rec.retryAt !== undefined) p.retryAt = new Date(rec.retryAt).toISOString();
    if (state === "healthy" && rec.instance) p.endpoints = { ...rec.instance.endpoints };
    if (leaseId) p.leaseId = leaseId;
    if (rec.instance) p.driver = rec.instance.driver;
    if (rec.exposure && state === "healthy") p.exposure = rec.exposure;
    if (def) {
      const u = this.updateInfo(def);
      if (u.updateAvailable) p.updateAvailable = true;
      if (rec.instance?.defHash && rec.instance.defHash !== definitionHash(def)) p.restartRequired = true;
    }
    if (rec.tried && rec.tried.length > 0) p.tried = rec.tried;
    if (rec.hint && state !== "healthy") p.hint = rec.hint;
    return p;
  }

  async ensure(id: string, opts: { holder?: string; lease?: boolean } = {}): Promise<EnsurePayload> {
    const found = this.lookup(id);
    if (found.corrupt) {
      const rec = this.rec(id);
      this.unavailable(rec, "invalid-definition", `services.json is corrupt; backup: ${found.backupPath ?? "not written"}`);
      return this.payload(undefined, id, rec);
    }
    if (!found.def && !found.errors) {
      const offered = this.offers().offers.some((o) => o.template.id === id);
      return {
        id,
        state: "not-added",
        hint: offered ? `offered but not added — run: pi-dashboard service add ${id}` : `no service or offer named "${id}"`,
      };
    }
    if (!found.def) {
      const rec = this.rec(id);
      this.unavailable(rec, "invalid-definition", (found.errors ?? []).join("; "));
      return this.payload(undefined, id, rec);
    }
    const def = found.def;
    const instanceId = found.instanceId ?? "";
    return this.mutex.run(id, () => this.ensureLocked(def, instanceId, opts));
  }

  private lease(def: ServiceDefinition, rec: Rec, opts: { holder?: string; lease?: boolean }): string | undefined {
    if (rec.cell.state !== "healthy" || opts.lease === false) return undefined;
    return this.leases.create(def.id, this.now(), opts.holder).leaseId;
  }

  private async ensureLocked(def: ServiceDefinition, instanceId: string, opts: { holder?: string; lease?: boolean }): Promise<EnsurePayload> {
    const rec = this.rec(def.id);
    this.noteDefinition(def, rec);
    const now = this.now();
    const st = rec.cell.state;
    if (st === "failed" && rec.retryAt !== undefined && now < rec.retryAt) return this.payload(def, def.id, rec);
    if (st === "unavailable" && rec.cell.reason && STICKY_REASONS.has(rec.cell.reason)) return this.payload(def, def.id, rec);
    if (st === "stop-failed") return this.payload(def, def.id, rec);

    const secrets = await resolveServiceSecrets(def, {
      store: this.secrets,
      env: this.deps.env ?? process.env,
      platform: this.deps.platform ?? process.platform,
      run: this.deps.run,
      resolveBinary: this.deps.resolveBinary,
    });
    if (!secrets.ok) {
      this.unavailable(rec, "secret-unavailable", secrets.hint);
      return this.payload(def, def.id, rec);
    }

    // 1. A known instance: probe it (never restart a live one).
    if (rec.instance) {
      const driver = this.driver(rec.instance.driver);
      const seen = await this.observe(def, rec, driver);
      if (seen === "healthy") {
        this.toHealthy(rec, "probe ok");
        return this.payload(def, def.id, rec, this.lease(def, rec, opts));
      }
      if (seen === "blocked") {
        this.toBlocked(rec, "alive, probe failing");
        return this.payload(def, def.id, rec);
      }
      rec.instance = undefined;
      if (rec.cell.state !== "stopped" && rec.cell.state !== "unavailable" && rec.cell.state !== "failed") {
        rec.cell.transition("stopped", "instance gone");
      }
    }

    // 2. Under the cross-process lock: re-adopt (another server may have
    //    started it), else start.
    return withLifecycleLock(
      this.deps.paths.lockTarget(def.id),
      async () => {
        for (const driver of this.driversOf(def)) {
          const adopted = await driver.adopt(def, instanceId);
          if (adopted.kind === "unavailable") {
            this.unavailable(rec, adopted.reason, adopted.hint);
            return this.payload(def, def.id, rec);
          }
          if (adopted.kind === "running") {
            rec.instance = adopted.instance;
            const seen = await this.observe(def, rec, driver);
            if (seen === "healthy") {
              this.toHealthy(rec, "adopted, probe ok");
              return this.payload(def, def.id, rec, this.lease(def, rec, opts));
            }
            if (seen === "blocked") {
              this.toBlocked(rec, "adopted, alive, probe failing");
              return this.payload(def, def.id, rec);
            }
            rec.instance = undefined;
          }
        }
        return this.startFresh(def, rec, instanceId, secrets.values, opts);
      },
      this.deps.lockOptions,
    );
  }

  private async startFresh(
    def: ServiceDefinition,
    rec: Rec,
    instanceId: string,
    secretValues: Record<string, string>,
    opts: { holder?: string; lease?: boolean },
  ): Promise<EnsurePayload> {
    // Pick the first driver whose offline presence passes.
    const tried: NonNullable<EnsurePayload["tried"]> = [];
    let chosen: ServiceDriver | undefined;
    let firstHint: string | undefined;
    for (const driver of this.driversOf(def)) {
      if (!driver.canStart(def)) continue;
      const p = await driver.presence(def);
      if (p.ok) {
        chosen = driver;
        break;
      }
      tried.push({ driver: driver.name, reason: p.reason });
      firstHint ??= p.hint;
    }
    if (!chosen) {
      if (tried.length > 0) {
        this.unavailable(rec, tried[0].reason, firstHint, tried);
      } else {
        // No start path on this platform (external, or attached without a
        // command): ensure only probes, and the probe failed.
        this.unavailable(rec, "runtime-unreachable", `${def.id} is not reachable and the dashboard has no start command for it on this platform`);
      }
      return this.payload(def, def.id, rec);
    }

    const { startTimeoutMs } = effectiveTimings(def);
    rec.cell.transition("starting", "ensure");
    const startedAt = this.now();
    try {
      rec.instance = await chosen.start(def, { secrets: secretValues, defHash: definitionHash(def), instanceId });
    } catch (err) {
      this.failStart(rec, `start failed: ${(err as Error).message}`);
      return this.payload(def, def.id, rec);
    }
    for (;;) {
      let ok = await this.probe(def, rec.instance!, chosen);
      if (!ok && chosen.onProbeFailed && !rec.instance!.tunnelPid) {
        const next = await chosen.onProbeFailed(def, rec.instance!);
        if (next) {
          rec.instance = next;
          ok = await this.probe(def, next, chosen);
        }
      }
      const alive = ok ? true : await chosen.isAlive(def, rec.instance!);
      const outcome = startPhaseOutcome({ probeOk: ok, alive, elapsedMs: this.now() - startedAt, startTimeoutMs });
      if (outcome === "healthy") {
        rec.tried = tried.length > 0 ? tried : undefined;
        this.toHealthy(rec, "probe ok");
        rec.tried = tried.length > 0 ? tried : undefined;
        return this.payload(def, def.id, rec, this.lease(def, rec, opts));
      }
      if (outcome === "failed") {
        this.failStart(rec, alive === false ? "process exited during start" : "no passing probe within startTimeout");
        return this.payload(def, def.id, rec);
      }
      if (outcome === "blocked") {
        this.toBlocked(rec, "alive, probe failing past startTimeout");
        return this.payload(def, def.id, rec);
      }
      await this.sleep(this.deps.startPollMs ?? 1_000);
    }
  }

  // ── leases ────────────────────────────────────────────────────────────────

  heartbeat(id: string, leaseId: string): { ok: true; expiresAt: string } | { ok: false; code: "lease-unknown" } {
    const l = this.leases.heartbeat(leaseId, this.now());
    if (!l || l.serviceId !== id) return { ok: false, code: "lease-unknown" };
    return { ok: true, expiresAt: new Date(l.expiresAt).toISOString() };
  }

  release(id: string, leaseId: string): { ok: true } | { ok: false; code: "lease-unknown" } {
    const l = this.leases.get(leaseId, this.now());
    if (!l || l.serviceId !== id) return { ok: false, code: "lease-unknown" };
    this.leases.release(leaseId, this.now());
    return { ok: true };
  }

  // ── explicit verbs ────────────────────────────────────────────────────────

  /** `service start`: ensure without a lease (idle-stop applies afterwards). */
  start(id: string): Promise<EnsurePayload> {
    return this.ensure(id, { lease: false });
  }

  /** `service retry`: clear the backoff, then start once. */
  async retry(id: string): Promise<EnsurePayload> {
    const rec = this.rec(id);
    rec.retryAt = undefined;
    rec.failures = 0;
    return this.ensure(id, { lease: false });
  }

  async stop(id: string, opts: { force?: boolean; why?: string } = {}): Promise<{ ok: boolean; state: string; hint?: string }> {
    const found = this.lookup(id);
    if (!found.def) throw new ServiceError(404, "not-found", `no service "${id}"`);
    const def = found.def;
    return this.mutex.run(id, () =>
      withLifecycleLock(this.deps.paths.lockTarget(id), () => this.stopLocked(def, opts), this.deps.lockOptions),
    );
  }

  private async stopLocked(def: ServiceDefinition, opts: { force?: boolean; why?: string }): Promise<{ ok: boolean; state: string; hint?: string }> {
    const rec = this.rec(def.id);
    if (def.mode === "external") return { ok: true, state: rec.cell.state, hint: "an external service has no lifecycle" };
    const sticky = rec.cell.state === "unavailable" && rec.cell.reason && STICKY_REASONS.has(rec.cell.reason);
    if (rec.cell.reason === "adoption-uncertain" && !opts.force) {
      return { ok: false, state: "unavailable", hint: "adoption is uncertain; re-run with --force to signal the recorded pid group" };
    }
    if (rec.instance?.startedBy === "external" && !opts.force) {
      return { ok: false, state: rec.cell.state, hint: "this instance was not started by the dashboard; re-run with --force to stop it anyway" };
    }
    const drivers = rec.instance ? [this.driver(rec.instance.driver)] : this.driversOf(def);
    if (!drivers.some((d) => d.canStop(def))) return { ok: false, state: rec.cell.state, hint: "no stop command for this platform" };
    if (!rec.instance && !sticky && (rec.cell.state === "stopped" || rec.cell.state === "failed")) {
      return { ok: true, state: rec.cell.state };
    }
    const { stopTimeoutMs } = effectiveTimings(def);
    rec.cell.transition("stopping", opts.why ?? "stop");
    let outcome: "stopped" | "stop-failed" = "stopped";
    for (const d of drivers) {
      if (!d.canStop(def)) continue;
      const r = await d.stop(def, rec.instance?.driver === d.name ? rec.instance : undefined, stopTimeoutMs, { force: opts.force });
      if (r === "stop-failed") outcome = "stop-failed";
    }
    if (outcome === "stopped") {
      rec.instance = undefined;
      rec.hint = undefined;
      this.leases.dropService(def.id);
    } else {
      rec.hint = `the instance did not exit within ${stopTimeoutMs / 1000} s`;
    }
    rec.cell.transition(outcome, outcome === "stopped" ? "exit observed" : "no exit within stopTimeout");
    return { ok: outcome === "stopped", state: outcome, ...(rec.hint ? { hint: rec.hint } : {}) };
  }

  async pin(id: string, pinned: boolean): Promise<{ ok: true; pinned: boolean }> {
    if (!this.lookup(id).def) throw new ServiceError(404, "not-found", `no service "${id}"`);
    const marker = this.deps.paths.pinMarker(id);
    if (pinned) {
      ensurePrivateDir(this.deps.paths.runDir(id));
      fs.writeFileSync(marker, "", { mode: 0o600 });
      this.pins.add(id);
    } else {
      fs.rmSync(marker, { force: true });
      this.pins.delete(id);
    }
    this.resetIdle(this.rec(id));
    return { ok: true, pinned };
  }

  async prefetch(id: string): Promise<{ ok: boolean; message: string }> {
    const def = this.lookup(id).def;
    if (!def) throw new ServiceError(404, "not-found", `no service "${id}"`);
    if (def.mode !== "managed" || !def.native || !def.drivers?.includes("native")) {
      const image = def.oci?.image;
      return {
        ok: false,
        message: image
          ? `the dashboard never pulls images; pull it yourself: docker pull ${image} (or podman pull)`
          : "only native services can be prefetched",
      };
    }
    const native = this.driver("native") as NativeDriver;
    if (typeof native.prefetch !== "function") return { ok: false, message: "prefetch unsupported" };
    return native.prefetch(def);
  }

  async setSecret(id: string, name: string, value: unknown): Promise<{ configured: true }> {
    const def = this.lookup(id).def;
    if (!def) throw new ServiceError(404, "not-found", `no service "${id}"`);
    if (!def.secrets || !(name in def.secrets)) throw new ServiceError(404, "unknown-secret", `${id} declares no secret "${name}"`);
    const ref = def.secrets[name].ref;
    if (ref && !ref.startsWith("store:")) throw new ServiceError(409, "not-store", `${id}/${name} is resolved from ${ref.split(":")[0]}:, not the store`);
    if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value) > MAX_SECRET_BYTES) {
      throw new ServiceError(400, "invalid-value", "the secret value must be a non-empty string up to 64 KiB");
    }
    try {
      await this.secrets.set(id, name, value);
    } catch (err) {
      if (err instanceof SecretsCorruptError) throw new ServiceError(409, "secrets-corrupt", err.message);
      throw err;
    }
    return { configured: true };
  }

  // ── add / remove ──────────────────────────────────────────────────────────

  private async imageHealthcheckFact(def: ServiceDefinition): Promise<boolean | undefined> {
    if (def.health.kind !== "oci-healthcheck") return undefined;
    for (const d of this.driversOf(def)) {
      if (d.imageHasHealthcheck) {
        const v = await d.imageHasHealthcheck(def);
        if (v !== undefined) return v;
      }
    }
    return undefined;
  }

  private review(def: ServiceDefinition, diff?: TemplateDiffEntry[]): AddReview {
    return {
      id: def.id,
      mode: def.mode,
      ...(def.drivers ? { drivers: def.drivers } : {}),
      ...(def.oci ? { image: def.oci.image } : {}),
      ...(def.native ? { recipe: { runner: def.native.runner, package: def.native.package, bin: def.native.bin, args: def.native.args } } : {}),
      ports: [...Object.keys(def.oci?.ports ?? {}), ...Object.keys(def.native?.ports ?? {}), ...Object.keys(def.endpoints ?? {})],
      volumes: Object.keys(def.oci?.volumes ?? {}),
      binds: Object.keys(def.oci?.binds ?? {}),
      secrets: Object.keys(def.secrets ?? {}),
      ...(def.origin !== "user" ? { templateHash: def.origin.templateHash } : {}),
      ...(diff ? { diff } : {}),
      ...(def.drivers?.includes("native") ? { needsPrefetch: true } : {}),
    };
  }

  async add(req: AddRequest): Promise<{ dryRun: boolean; review: AddReview; secrets?: Record<string, { configured: boolean }> }> {
    let def: ServiceDefinition;
    let diff: TemplateDiffEntry[] | undefined;
    const existing = this.definitions.read();
    if (!existing.ok) throw new ServiceError(409, "definitions-corrupt", new DefinitionsCorruptError(this.definitions.file, existing.backupPath).message);
    if ("offer" in req) {
      const offer = this.findOffer(req.offer);
      if (!offer) throw new ServiceError(404, "unknown-offer", `no package offers "${req.offer}"`);
      def = definitionFromOffer(offer);
      const prev = existing.entries.find((e) => e.id === def.id);
      if (prev && !req.update) {
        throw new ServiceError(409, "already-added", `"${def.id}" is already added — use --update to apply a newer template`);
      }
      if (req.update) {
        const prevDef = prev?.def;
        if (!prevDef || prevDef.origin === "user" || prevDef.origin.package !== offer.package) {
          throw new ServiceError(409, "not-updatable", `"${def.id}" was not added from ${offer.package}`);
        }
        diff = diffTemplates(templateOfDefinition(prevDef), offer.template);
      }
    } else {
      const raw = req.definition as Record<string, unknown> | null;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ServiceError(400, "invalid-definition", "definition must be an object");
      if (raw.origin !== undefined && raw.origin !== "user") {
        throw new ServiceError(400, "invalid-definition", 'a definition added directly is user-authored: origin must be "user" or omitted');
      }
      const r = validateDefinition({ ...raw, origin: "user" });
      if (!r.ok) throw new ServiceError(400, "invalid-definition", r.errors.join("; "));
      def = r.value;
      if (existing.entries.some((e) => e.id === def.id)) throw new ServiceError(409, "already-added", `"${def.id}" already exists`);
    }
    const checked = validateDefinition(def, { imageHasHealthcheck: await this.imageHealthcheckFact(def) });
    if (!checked.ok) throw new ServiceError(400, "invalid-definition", checked.errors.join("; "));
    const review = this.review(def, diff);
    if (req.dryRun) return { dryRun: true, review };

    try {
      await this.definitions.mutate((file) => {
        const i = file.services.findIndex((s) => s.id === def.id);
        if (i >= 0) file.services[i] = def;
        else file.services.push(def);
      });
    } catch (err) {
      if (err instanceof DefinitionsCorruptError) throw new ServiceError(409, "definitions-corrupt", err.message);
      throw err;
    }
    const gen = Object.fromEntries(
      Object.entries(def.secrets ?? {})
        .filter(([, s]) => s.generate)
        .map(([n, s]) => [n, s.generate!.bytes]),
    );
    try {
      await this.secrets.generate(def.id, gen);
    } catch (err) {
      if (!(err instanceof SecretsCorruptError)) throw err;
    }
    this.log(`[services] ${def.id} ${diff ? "updated" : "added"} (${def.origin === "user" ? "user" : def.origin.package})`);
    return { dryRun: false, review, secrets: this.secrets.configured(def.id, Object.keys(def.secrets ?? {})) };
  }

  async remove(id: string, opts: { purgeData?: boolean } = {}): Promise<{ ok: boolean; hint?: string }> {
    const r = this.definitions.read();
    if (!r.ok) throw new ServiceError(409, "definitions-corrupt", new DefinitionsCorruptError(this.definitions.file, r.backupPath).message);
    const entry = r.entries.find((e) => e.id === id);
    if (!entry) throw new ServiceError(404, "not-found", `no service "${id}"`);
    const instanceId = r.instanceId ?? "";
    return this.mutex.run(id, () =>
      withLifecycleLock(
        this.deps.paths.lockTarget(id),
        async () => {
          const def = entry.def;
          const rec = this.rec(id);
          if (def) {
            const owned = rec.instance ? rec.instance.startedBy === "dashboard" : def.mode === "managed";
            if (owned && def.mode !== "external") {
              const res = await this.stopLocked(def, { force: true, why: "remove" });
              if (!res.ok && res.state === "stop-failed") return { ok: false, hint: res.hint };
            }
            for (const d of this.driversOf(def)) await d.remove(def, instanceId, { purgeData: opts.purgeData === true });
          }
          await this.secrets.deleteService(id);
          removeSecretMounts(this.deps.paths.secretsDir(id));
          fs.rmSync(this.deps.paths.runDir(id), { recursive: true, force: true });
          await this.definitions.mutate((file) => {
            file.services = file.services.filter((s) => (s as { id?: unknown }).id !== id);
          });
          this.leases.dropService(id);
          this.pins.delete(id);
          this.recs.delete(id);
          this.log(`[services] ${id} removed${opts.purgeData ? " (data purged)" : ""}`);
          return { ok: true };
        },
        this.deps.lockOptions,
      ),
    );
  }

  // ── reads ─────────────────────────────────────────────────────────────────

  private async exposureOf(inst: DriverInstance | undefined): Promise<Exposure | undefined> {
    if (!inst) return undefined;
    let worst: Exposure | undefined;
    for (const url of Object.values(inst.endpoints)) {
      let u: URL;
      try {
        u = new URL(url);
      } catch {
        continue;
      }
      const host = u.hostname.replace(/^\[|\]$/g, "");
      if (!["127.0.0.1", "localhost", "::1"].includes(host) || !u.port) continue;
      const e = await (this.deps.exposure ?? ((p) => findListenAddresses(p, { platform: this.deps.platform })))(Number(u.port));
      if (e === "all-interfaces") return e;
      if (e === "loopback" || worst === undefined) worst = e;
    }
    return worst;
  }

  private statusOf(id: string, def: ServiceDefinition | undefined, errors?: string[]): ServiceStatus {
    const rec = this.recs.get(id);
    const now = this.now();
    const s: ServiceStatus = {
      id,
      state: rec?.cell.state ?? "stopped",
      pinned: this.pins.has(id),
      leases: this.leases.live(id, now),
      secrets: def ? this.secrets.configured(id, Object.keys(def.secrets ?? {})) : {},
    };
    if (def) {
      s.mode = def.mode;
      s.origin = def.origin;
      Object.assign(s, this.updateInfo(def));
    }
    if (errors) {
      s.state = "unavailable";
      s.reason = "invalid-definition";
      s.errors = errors;
    }
    if (rec) {
      if (rec.cell.state === "unavailable") s.reason = rec.cell.reason;
      if (rec.hint) s.hint = rec.hint;
      if (rec.tried && rec.tried.length > 0 && rec.cell.state === "unavailable") s.tried = rec.tried;
      if (rec.retryAt !== undefined && rec.cell.state === "failed") s.retryAt = new Date(rec.retryAt).toISOString();
      if (rec.instance) {
        s.driver = rec.instance.driver;
        s.startedBy = rec.instance.startedBy;
        if (rec.cell.state === "healthy" || rec.cell.state === "idle") s.endpoints = { ...rec.instance.endpoints };
        if (def && rec.instance.defHash && rec.instance.defHash !== definitionHash(def)) s.restartRequired = true;
      }
      if (rec.exposure) s.exposure = rec.exposure;
    }
    return s;
  }

  async list(): Promise<ServiceList> {
    const r = this.definitions.read();
    const sec = this.secrets.status();
    const secFields = sec.corrupt ? { secretsCorrupt: true, secretsBackupPath: sec.backupPath } : {};
    if (!r.ok) {
      const services = [...this.recs.keys()].map((id) => {
        const s = this.statusOf(id, undefined);
        return { ...s, state: "unavailable" as const, reason: "invalid-definition" as const, endpoints: undefined };
      });
      return { definitionsCorrupt: true, backupPath: r.backupPath, ...secFields, services };
    }
    for (const e of r.entries) if (e.def) this.noteDefinition(e.def, this.rec(e.id));
    await Promise.all(
      r.entries.map(async (e) => {
        const rec = this.recs.get(e.id);
        if (rec?.instance && (rec.cell.state === "healthy" || rec.cell.state === "idle")) rec.exposure = await this.exposureOf(rec.instance);
      }),
    );
    return { instanceId: r.instanceId, ...secFields, services: r.entries.map((e) => this.statusOf(e.id, e.def, e.errors)) };
  }

  /** `status <id>`: re-probes a running instance (spec: on every status). */
  async status(id: string): Promise<ServiceStatus> {
    const found = this.lookup(id);
    if (found.corrupt) {
      return { id, state: "unavailable", reason: "invalid-definition", hint: `services.json is corrupt; backup: ${found.backupPath ?? "not written"}`, pinned: false, leases: 0, secrets: {} };
    }
    if (!found.def && !found.errors) throw new ServiceError(404, "not-found", `no service "${id}"`);
    const def = found.def;
    if (def) {
      await this.mutex.run(id, async () => {
        const rec = this.rec(id);
        this.noteDefinition(def, rec);
        if (!rec.instance || !["healthy", "idle", "blocked"].includes(rec.cell.state)) return;
        const seen = await this.observe(def, rec, this.driver(rec.instance.driver));
        if (seen === "healthy") {
          if (rec.cell.state === "blocked") this.toHealthy(rec, "probe recovered");
        } else if (seen === "blocked") {
          if (rec.cell.state !== "blocked") this.toBlocked(rec, "alive, probe failing");
        } else {
          rec.instance = undefined;
          rec.cell.transition("stopped", "instance gone");
        }
        if (rec.instance) rec.exposure = await this.exposureOf(rec.instance);
      });
    }
    return this.statusOf(id, def, found.errors);
  }

  listOffers(): { offers: Array<{ ref: string; package: string; version: string; id: string; mode: string; templateHash: string; added: boolean }>; errors: string[] } {
    const r = this.definitions.read();
    const added = new Set(r.ok ? r.entries.map((e) => e.id) : []);
    const { offers, errors } = this.offers();
    return {
      offers: offers.map((o) => ({
        ref: `${o.package}#${o.template.id}`,
        package: o.package,
        version: o.version,
        id: o.template.id,
        mode: o.template.mode,
        templateHash: o.templateHash,
        added: added.has(o.template.id),
      })),
      errors,
    };
  }

  runtimes(): Promise<RuntimeReport[]> {
    return this.detector.detect();
  }

  // ── boot adoption ─────────────────────────────────────────────────────────

  /**
   * Adoption only: no health probe, no network I/O. Without `services.json`
   * this returns before touching anything.
   */
  async boot(): Promise<void> {
    const r = this.definitions.read();
    if (!r.ok || !r.exists) return;
    const defs = r.entries.flatMap((e) => (e.def ? [e.def] : []));
    if (defs.length === 0 || !r.instanceId) return;
    const instanceId = r.instanceId;
    const results = new Map<string, AdoptResult[]>();
    const push = (id: string, a: AdoptResult) => results.set(id, [...(results.get(id) ?? []), a]);
    for (const runtime of ["oci:docker", "oci:podman"] as const) {
      const users = defs.filter((d) => d.mode === "managed" && d.drivers?.includes(runtime));
      if (users.length === 0) continue;
      const driver = this.driver(runtime) as OciDriver;
      if (typeof driver.adoptAll === "function") {
        for (const [id, a] of await driver.adoptAll(users, instanceId)) push(id, a);
      } else {
        for (const d of users) push(d.id, await driver.adopt(d, instanceId));
      }
    }
    for (const d of defs.filter((x) => x.mode === "managed" && x.drivers?.includes("native"))) {
      push(d.id, await this.driver("native").adopt(d, instanceId));
    }
    const now = this.now();
    for (const def of defs) {
      const list = results.get(def.id) ?? [];
      const rec = this.rec(def.id);
      rec.fullHash = fullHash(def);
      const bad = list.find((a): a is Extract<AdoptResult, { kind: "unavailable" }> => a.kind === "unavailable");
      const running = list.find((a): a is Extract<AdoptResult, { kind: "running" }> => a.kind === "running");
      if (bad) {
        rec.cell.init("unavailable", "adoption", bad.reason);
        rec.hint = bad.hint;
      } else if (running) {
        rec.instance = running.instance;
        rec.idleSince = now;
        rec.idleResetAt = now;
        rec.cell.init("idle", "adopted");
      } else if (list.some((a) => a.kind === "stopped")) {
        rec.cell.init("stopped", "adopted (exited)");
      }
    }
  }

  // ── background: lease expiry, idle-stop, leased re-probe ──────────────────

  /** One scheduler cycle. Exposed for tests (fake clock). */
  async tick(): Promise<void> {
    const now = this.now();
    this.leases.sweep(now);
    const r = this.definitions.read();
    const defs = new Map(r.ok ? r.entries.flatMap((e) => (e.def ? [[e.id, e.def] as const] : [])) : []);
    const leased = this.leases.servicesWithLiveLeases(now);
    const work: Array<Promise<unknown>> = [];
    for (const [id, rec] of this.recs) {
      const def = defs.get(id);
      if (!def) continue;
      if (rec.cell.state === "healthy" && !leased.has(id)) {
        rec.idleSince = Math.max(this.leases.lastEndedAt(id) ?? now, rec.idleResetAt ?? 0);
        rec.cell.transition("idle", "leases=0");
      }
      if (leased.has(id) && rec.instance && (rec.cell.state === "healthy" || rec.cell.state === "blocked")) {
        work.push(this.reprobe(id, def));
        continue;
      }
      const drivers = rec.instance ? [this.driver(rec.instance.driver)] : this.driversOf(def);
      const decide = shouldIdleStop({
        state: rec.cell.state,
        pinned: this.pins.has(id),
        startedBy: rec.instance?.startedBy,
        hasStopPath: drivers.some((d) => d.canStop(def)),
        idleStopMinutes: effectiveTimings(def).idleStopMinutes,
        idleSince: rec.idleSince,
        now,
      });
      if (decide) work.push(this.idleStop(id, def));
    }
    await Promise.all(work);
  }

  private reprobe(id: string, def: ServiceDefinition): Promise<void> {
    return this.mutex.run(id, async () => {
      const rec = this.rec(id);
      if (!rec.instance || (rec.cell.state !== "healthy" && rec.cell.state !== "blocked")) return;
      const seen = await this.observe(def, rec, this.driver(rec.instance.driver));
      if (seen === "healthy" && rec.cell.state === "blocked") this.toHealthy(rec, "probe recovered");
      else if (seen === "blocked" && rec.cell.state === "healthy") this.toBlocked(rec, "alive, probe failing");
      else if (seen === "gone") {
        rec.instance = undefined;
        rec.cell.transition("stopped", "instance gone");
      }
    });
  }

  private idleStop(id: string, def: ServiceDefinition): Promise<unknown> {
    return this.mutex
      .run(id, async () => {
        const rec = this.rec(id);
        // Re-check under the mutex: an ensure may have raced in.
        if (rec.cell.state !== "idle" || this.leases.live(id, this.now()) > 0) return;
        await withLifecycleLock(this.deps.paths.lockTarget(id), () => this.stopLocked(def, { why: "idle-stop" }), this.deps.lockOptions);
      })
      .catch((err: unknown) => this.log(`[services] ${id} idle-stop error: ${(err as Error).message}`));
  }

  startScheduler(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((err: unknown) => this.log(`[services] tick error: ${(err as Error).message}`));
    }, this.deps.tickMs ?? REPROBE_INTERVAL_MS);
    this.timer.unref?.();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
