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
import { isProcessAlive, type KillFn, signalZero } from "@blackbelt-technology/pi-dashboard-shared/platform/process.js";
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
  SERVICE_ID_PATTERN,
  type ServiceDefinition,
  type UnavailableReason,
  validateDefinition,
} from "@blackbelt-technology/pi-dashboard-shared/services/schema.js";
import {
  type AddReview,
  type LeaseHolder,
  LOGS_DEFAULT_TAIL,
  LOGS_MAX_TAIL,
  type LogsResponse,
  type PruneCandidate,
  type PruneRequest,
  type PruneResult,
  type PruneSkipped,
  type ResetDataResult,
  type ServiceList,
  type ServiceStatus,
  type VolumeOutcome,
} from "@blackbelt-technology/pi-dashboard-shared/services/status.js";
import { AttachedDriver, ExternalDriver } from "./attached-driver.js";
import { CHANGE_COALESCE_MS, type ChangeCoalescer, createChangeCoalescer } from "./change-notifier.js";
import type { CommandRunner } from "./command-runner.js";
import { DefinitionsCorruptError, DefinitionsStore } from "./definitions-store.js";
import type { AdoptResult, DriverInstance, ServiceDriver } from "./driver.js";
import { createLimiter, PROBE_CONCURRENCY, probeHttp, probeTcp, probeWsFirstMessage } from "./health.js";
import { LeaseTable } from "./leases.js";
import { capLines, longestSecretLines, MIN_REDACTABLE_LENGTH, redactSecrets, splitLines } from "./log-text.js";
import { NativeDriver } from "./native-driver.js";
import { OciDriver } from "./oci-driver.js";
import { OutputCapture } from "./output-capture.js";
import { ensurePrivateDir, readJsonFile, type ServicesPaths } from "./paths.js";
import { RuntimeDetector as Detector, type RuntimeDetector, type RuntimeReport } from "./runtime-detect.js";
import { removeSecretMounts } from "./secret-delivery.js";
import { defaultSecretRef, resolveEachSecret, resolveServiceSecrets, storeSlotOf } from "./secrets-resolver.js";
import { SecretsCorruptError, SecretsStore } from "./secrets-store.js";
import { loadDigestKey, readStartRecord, type StartRecord, secretsDigest, writeStartRecord } from "./start-record.js";
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

const REPROBE_INTERVAL_MS = 30_000;
const OFFERS_CACHE_MS = 10_000;
const EXPOSURE_CACHE_MS = 30_000;
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
  /** Content-free "something about a service changed" hook (coalesced). */
  onChange?: () => void;
  /** Coalescing window of `onChange`; 0 = every change fires. Default 500 ms. */
  changeCoalesceMs?: number;
  /** Output-cap sweep period. Default 5 s. */
  capMs?: number;
  /** Output capture override (tests). */
  output?: OutputCapture;
  /** Signal-0 sender used by prune's liveness check (tests). */
  kill?: KillFn;
}

export type { AddReview, LeaseHolder, ServiceList, ServiceStatus };

export type AddRequest = { offer: string; dryRun?: boolean; update?: boolean } | { definition: unknown; dryRun?: boolean };

export class ServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(
    status: number,
    code: string,
    message: string,
  ) {
    super(message);
    this.status = status;
    this.code = code;
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
  /** `start.json` of the current/last dashboard start (undefined = not read yet). */
  start?: StartRecord | null;
}

/** Hash of the runtime-relevant definition fields (`pi.def-hash`). */
function definitionHash(def: ServiceDefinition): string {
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
  private readonly deps: ServiceManagerDeps;
  readonly definitions: DefinitionsStore;
  readonly secrets: SecretsStore;
  readonly leases: LeaseTable;
  private readonly recs = new Map<string, Rec>();
  private readonly mutex = new KeyedMutex();
  private readonly limit = createLimiter(PROBE_CONCURRENCY);
  private readonly driverMap = new Map<DriverName, ServiceDriver>();
  private readonly detector: RuntimeDetector;
  private offersCache?: { at: number; value: ParsedServiceOffers };
  /** port → exposure, 30 s: reads (observe tier) must not drive a subprocess per call. */
  private readonly exposureCache = new Map<number, { at: number; value: Exposure }>();
  private timer?: ReturnType<typeof setInterval>;
  /** Set by `dispose()`: a boot settling after shutdown must not start a scheduler. */
  private disposed = false;
  private pins = new Set<string>();
  readonly output: OutputCapture;
  private readonly notifier: ChangeCoalescer;
  private capTimer?: ReturnType<typeof setInterval>;
  private digestKeyCache?: Buffer;

  constructor(deps: ServiceManagerDeps) {
    this.deps = deps;
    this.definitions = new DefinitionsStore(deps.paths.definitions);
    this.secrets = new SecretsStore(deps.paths.secrets);
    this.leases = new LeaseTable(deps.leaseTtlMs);
    this.output = deps.output ?? new OutputCapture(deps.paths);
    this.notifier = createChangeCoalescer(() => deps.onChange?.(), deps.changeCoalesceMs ?? CHANGE_COALESCE_MS);
    this.leases.onChange = () => this.notify();
    const common = { run: deps.run, resolveBinary: deps.resolveBinary, paths: deps.paths };
    const sleep = deps.sleep;
    const now = deps.now;
    const real: Record<DriverName, ServiceDriver> = {
      "oci:docker": new OciDriver({ ...common, runtime: "docker", sleep, now }),
      "oci:podman": new OciDriver({ ...common, runtime: "podman", sleep, now }),
      native: new NativeDriver({ ...common, platform: deps.platform, output: this.output }),
      attached: new AttachedDriver({ run: deps.run, platform: deps.platform, sleep, now, output: this.output }),
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

  /** Something a Services page shows changed (content-free; coalesced). */
  private notify(): void {
    this.notifier.notify();
  }

  private digestKey(): Buffer {
    this.digestKeyCache ??= loadDigestKey(this.deps.paths);
    return this.digestKeyCache;
  }

  /** The start record of `rec`'s service, read once and cached (`null` = none on disk). */
  private startOf(id: string, rec: Rec): StartRecord | null {
    if (rec.start === undefined) rec.start = readStartRecord(this.deps.paths, id);
    return rec.start;
  }

  private rec(id: string): Rec {
    let r = this.recs.get(id);
    if (!r) {
      r = { cell: new StateCell(id, (l) => this.log(l), () => this.notify()), failures: 0 };
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

  /** Definition changed since the start, OR a secret value was saved while it ran. */
  private restartRequiredOf(id: string, def: ServiceDefinition, rec: Rec): boolean {
    const inst = rec.instance;
    if (!inst) return false;
    if (inst.defHash && inst.defHash !== definitionHash(def)) return true;
    return inst.startedBy === "dashboard" && this.startOf(id, rec)?.secretsSavedSinceStart === true;
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
      if (this.restartRequiredOf(id, def, rec)) p.restartRequired = true;
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
            rec.start = readStartRecord(this.deps.paths, def.id);
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
    const startedAtIso = new Date(startedAt).toISOString();
    try {
      rec.instance = await chosen.start(def, { secrets: secretValues, defHash: definitionHash(def), instanceId });
    } catch (err) {
      this.failStart(rec, `start failed: ${(err as Error).message}`);
      return this.payload(def, def.id, rec);
    }
    if (rec.instance.startedBy === "dashboard") this.recordStart(def, rec, chosen, startedAtIso, secretValues);
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

  /** Write `start.json` for a dashboard start (any driver). A failure must never fail the start. */
  private recordStart(
    def: ServiceDefinition,
    rec: Rec,
    driver: ServiceDriver,
    startedAt: string,
    secretValues: Record<string, string>,
  ): void {
    try {
      const output = driver.name === "native" || driver.name === "attached" ? this.output.identity(def.id) : null;
      const record: StartRecord = {
        driver: driver.name,
        startedAt,
        secretsDigest: secretsDigest(this.digestKey(), secretValues),
        secretsSavedSinceStart: false,
        ...(output ? { output } : {}),
      };
      writeStartRecord(this.deps.paths, def.id, record);
      rec.start = record;
    } catch (err) {
      rec.start = null;
      this.log(`[services] ${def.id} start record not written: ${(err as Error).message}`);
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

  private async stopLocked(
    def: ServiceDefinition,
    opts: { force?: boolean; why?: string; removing?: boolean },
  ): Promise<{ ok: boolean; state: string; hint?: string }> {
    const rec = this.rec(def.id);
    if (def.mode === "external") return { ok: true, state: rec.cell.state, hint: "an external service has no lifecycle" };
    const sticky = rec.cell.state === "unavailable" && rec.cell.reason && STICKY_REASONS.has(rec.cell.reason);
    if (rec.cell.reason === "adoption-uncertain" && !opts.force && !opts.removing) {
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
      // `remove` never force-signals: a recorded pid that no longer verifies is
      // dropped, not killed (it may have been reused by an unrelated group).
      const r = await d.stop(def, rec.instance?.driver === d.name ? rec.instance : undefined, stopTimeoutMs, {
        force: opts.force === true,
        instanceId: this.instanceId(),
      });
      if (r === "stop-failed") outcome = "stop-failed";
    }
    if (outcome === "stopped") {
      rec.instance = undefined;
      rec.hint = undefined;
      this.output.close(def.id);
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
    this.notify();
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
    const slot = storeSlotOf(def, name);
    if (!slot) throw new ServiceError(409, "not-store", `${id}/${name} is resolved from ${String(def.secrets[name].ref).split(":")[0]}:, not the store`);
    if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value) > MAX_SECRET_BYTES) {
      throw new ServiceError(400, "invalid-value", "the secret value must be a non-empty string up to 64 KiB");
    }
    try {
      await this.secrets.set(slot.id, slot.name, value);
    } catch (err) {
      if (err instanceof SecretsCorruptError) throw new ServiceError(409, "secrets-corrupt", err.message);
      throw err;
    }
    this.markSecretSaved(id);
    this.notify();
    return { configured: true };
  }

  /**
   * A value was saved while a dashboard-started instance runs: persist the mark
   * in `start.json` so `restartRequired` survives a server restart.
   */
  private markSecretSaved(id: string): void {
    const rec = this.recs.get(id);
    if (rec?.instance?.startedBy !== "dashboard") return;
    const record = readStartRecord(this.deps.paths, id);
    if (!record) return;
    record.secretsSavedSinceStart = true;
    try {
      writeStartRecord(this.deps.paths, id, record);
      rec.start = record;
    } catch (err) {
      this.log(`[services] ${id} start record not updated: ${(err as Error).message}`);
    }
  }

  /** Store-backed secrets of `def` → their slots (env:/keychain: refs are not store-backed). */
  private slotsOf(def: ServiceDefinition): Record<string, { id: string; name: string }> {
    return Object.fromEntries(
      Object.keys(def.secrets ?? {}).flatMap((n) => {
        const slot = storeSlotOf(def, n);
        return slot ? [[n, slot] as const] : [];
      }),
    );
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
      secretSources: Object.fromEntries(
        Object.entries(def.secrets ?? {}).map(([n, sp]) => [
          n,
          `${sp.ref ?? `store:${def.id}/${n}`}${sp.generate ? ` (generated, ${sp.generate.bytes} bytes)` : sp.ref ? "" : " (user-entered)"}`,
        ]),
      ),
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
    const gen = Object.entries(def.secrets ?? {}).flatMap(([n, s]) => {
      const slot = storeSlotOf(def, n);
      return s.generate && slot ? [{ ...slot, bytes: s.generate.bytes }] : [];
    });
    try {
      await this.secrets.generate(gen);
    } catch (err) {
      if (!(err instanceof SecretsCorruptError)) throw err;
    }
    this.log(`[services] ${def.id} ${diff ? "updated" : "added"} (${def.origin === "user" ? "user" : def.origin.package})`);
    this.notify();
    return { dryRun: false, review, secrets: this.secrets.configured(this.slotsOf(def)) };
  }

  /** Volume names declared by every defined service OTHER than `id` (runtime-global names). */
  private volumesDeclaredElsewhere(entries: Array<{ id: string; def?: ServiceDefinition }>, id: string): Set<string> {
    const out = new Set<string>();
    for (const e of entries) {
      if (e.id === id || !e.def) continue;
      for (const v of Object.keys(e.def.oci?.volumes ?? {})) out.add(v);
    }
    return out;
  }

  async remove(id: string, opts: { purgeData?: boolean } = {}): Promise<{ ok: boolean; hint?: string; volumes?: VolumeOutcome[] }> {
    const r = this.definitions.read();
    if (!r.ok) throw new ServiceError(409, "definitions-corrupt", new DefinitionsCorruptError(this.definitions.file, r.backupPath).message);
    const entry = r.entries.find((e) => e.id === id);
    if (!entry) throw new ServiceError(404, "not-found", `no service "${id}"`);
    // Check BEFORE any teardown: a corrupt store would otherwise fail the
    // secret deletion half-way, leaving a removed container but a live entry.
    const sec = this.secrets.status();
    if (sec.corrupt) {
      throw new ServiceError(409, "secrets-corrupt", new SecretsCorruptError(this.secrets.file, sec.backupPath).message);
    }
    const instanceId = r.instanceId ?? "";
    return this.mutex.run(id, () =>
      withLifecycleLock(
        this.deps.paths.lockTarget(id),
        async () => {
          const def = entry.def;
          const rec = this.rec(id);
          const purged: VolumeOutcome[] = [];
          if (def) {
            const owned = rec.instance ? rec.instance.startedBy === "dashboard" : def.mode === "managed";
            if (owned && def.mode !== "external") {
              const res = await this.stopLocked(def, { removing: true, why: "remove" });
              if (!res.ok && res.state === "stop-failed") return { ok: false, hint: res.hint };
            }
            const sharedVolumes = this.volumesDeclaredElsewhere(r.entries, id);
            for (const d of this.driversOf(def)) {
              const res = await d.remove(def, instanceId, { purgeData: opts.purgeData === true, sharedVolumes });
              if (res?.volumes) purged.push(...res.volumes);
            }
          }
          // Keep slots another definition still references (`store:<id>/<n>`).
          const keep = new Set<string>();
          for (const other of r.entries) {
            if (other.id === id || !other.def) continue;
            for (const n of Object.keys(other.def.secrets ?? {})) {
              const slot = storeSlotOf(other.def, n);
              if (slot?.id === id) keep.add(`${slot.id}/${slot.name}`);
            }
          }
          await this.secrets.deleteService(id, keep);
          removeSecretMounts(this.deps.paths.secretsDir(id));
          fs.rmSync(this.deps.paths.runDir(id), { recursive: true, force: true });
          await this.definitions.mutate((file) => {
            file.services = file.services.filter((s) => (s as { id?: unknown }).id !== id);
          });
          this.leases.dropService(id);
          this.pins.delete(id);
          this.output.close(id);
          this.recs.delete(id);
          this.log(`[services] ${id} removed${opts.purgeData ? " (data purged)" : ""}`);
          this.notify();
          return { ok: true, ...(opts.purgeData ? { volumes: purged } : {}) };
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
      const port = Number(u.port);
      const cached = this.exposureCache.get(port);
      let e: Exposure;
      if (cached && this.now() - cached.at < EXPOSURE_CACHE_MS) e = cached.value;
      else {
        e = await (this.deps.exposure ?? ((p) => findListenAddresses(p, { platform: this.deps.platform })))(port);
        this.exposureCache.set(port, { at: this.now(), value: e });
      }
      if (e === "all-interfaces") return e;
      if (e === "loopback" || worst === undefined) worst = e;
    }
    return worst;
  }

  /** What the definition declares that the pages need: secret refs (never values) and named volumes. */
  private declared(def: ServiceDefinition): Pick<ServiceStatus, "secretRefs" | "volumes"> {
    const volumes = Object.keys(def.oci?.volumes ?? {});
    return {
      secretRefs: Object.fromEntries(Object.entries(def.secrets ?? {}).map(([n, sp]) => [n, sp.ref ?? defaultSecretRef(def.id, n)])),
      ...(volumes.length > 0 ? { volumes } : {}),
    };
  }

  private statusOf(id: string, def: ServiceDefinition | undefined, errors?: string[]): ServiceStatus {
    const rec = this.recs.get(id);
    const now = this.now();
    const s: ServiceStatus = {
      id,
      state: rec?.cell.state ?? "stopped",
      pinned: this.pins.has(id),
      leases: this.leases.live(id, now),
      leaseHolders: this.leases.holders(id, now),
      secrets: def ? this.secrets.configured(this.slotsOf(def)) : {},
    };
    if (def) {
      s.mode = def.mode;
      if (def.drivers) s.drivers = def.drivers;
      s.origin = def.origin;
      Object.assign(s, this.declared(def));
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
        if (def && this.restartRequiredOf(id, def, rec)) s.restartRequired = true;
      }
      if (rec.exposure) s.exposure = rec.exposure;
    }
    return s;
  }

  async list(opts: { canOperate?: boolean } = {}): Promise<ServiceList> {
    const caller = opts.canOperate === undefined ? {} : { canOperate: opts.canOperate };
    const r = this.definitions.read();
    const sec = this.secrets.status();
    const secFields = sec.corrupt ? { secretsCorrupt: true, secretsBackupPath: sec.backupPath } : {};
    if (!r.ok) {
      const services = [...this.recs.keys()].map((id) => {
        const s = this.statusOf(id, undefined);
        return { ...s, state: "unavailable" as const, reason: "invalid-definition" as const, endpoints: undefined };
      });
      return { definitionsCorrupt: true, backupPath: r.backupPath, ...secFields, ...caller, services };
    }
    for (const e of r.entries) if (e.def) this.noteDefinition(e.def, this.rec(e.id));
    await Promise.all(
      r.entries.map(async (e) => {
        const rec = this.recs.get(e.id);
        if (rec?.instance && (rec.cell.state === "healthy" || rec.cell.state === "idle")) rec.exposure = await this.exposureOf(rec.instance);
      }),
    );
    return { instanceId: r.instanceId, ...secFields, ...caller, services: r.entries.map((e) => this.statusOf(e.id, e.def, e.errors)) };
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

  // ── logs ──────────────────────────────────────────────────────────────────

  /** `tail` query value → N, or 400 `invalid-tail`. Absent = default; anything but 1–2000 is refused. */
  static parseTail(raw: unknown): number {
    if (raw === undefined) return LOGS_DEFAULT_TAIL;
    const n = typeof raw === "string" && /^\d{1,6}$/.test(raw) ? Number(raw) : Number.NaN;
    if (!Number.isInteger(n) || n < 1 || n > LOGS_MAX_TAIL) {
      throw new ServiceError(400, "invalid-tail", `tail must be an integer from 1 to ${LOGS_MAX_TAIL}`);
    }
    return n;
  }

  /**
   * The last `tail` lines of the current run's output, with every secret value
   * replaced by `«secret:<name>»`. Fails CLOSED: an unreadable or too-short
   * secret, or a secret changed since the start, withholds the output.
   * See change: add-services-settings-ui (D5).
   */
  async logs(id: string, tailRaw?: unknown): Promise<LogsResponse> {
    const n = ServiceManager.parseTail(tailRaw);
    const found = this.lookup(id);
    if (found.corrupt) throw new ServiceError(409, "definitions-corrupt", new DefinitionsCorruptError(this.definitions.file, found.backupPath).message);
    const def = found.def;
    if (!def) throw new ServiceError(404, "not-found", `no service "${id}"`);
    if (def.mode === "external") return { available: false, reason: "external" };

    const rec = this.recs.get(id);
    const source = this.logSource(def, rec);
    if ("unavailable" in source) return source.unavailable;
    const { start, driver, externalStart } = source;

    const redaction = await this.logRedaction(def, start);
    if ("withheld" in redaction) return redaction.withheld;

    await this.output.enforceCap(id, start.output ?? null);
    const window = n + longestSecretLines(redaction.values.map((v) => v.value)) - 1;
    const got = await driver.logs(def, rec?.instance, { instanceId: found.instanceId ?? "", lines: window, startedAt: start.startedAt });
    if (!got.ok) return { available: false, reason: got.reason === "no-output" && externalStart ? "external" : got.reason };
    const lines = capLines(splitLines(redactSecrets(got.text, redaction.values)), n);
    return { available: true, driver: driver.name, lines, stale: rec?.instance === undefined };
  }

  /** Which driver's output (and start record) a logs read uses, or why there is none — before any secret is touched. */
  private logSource(
    def: ServiceDefinition,
    rec: Rec | undefined,
  ):
    | { start: StartRecord; driver: ServiceDriver & Required<Pick<ServiceDriver, "logs">>; externalStart: boolean }
    | { unavailable: Extract<LogsResponse, { available: false }> } {
    const externalStart = rec?.instance?.startedBy === "external";
    // An instance the dashboard did not start has no output file unless a past dashboard start made one.
    if (externalStart && !fs.existsSync(this.deps.paths.outputLog(def.id))) return { unavailable: { available: false, reason: "external" } };
    const start = readStartRecord(this.deps.paths, def.id);
    const driver = start ? this.driverMap.get(rec?.instance?.driver ?? start.driver) : undefined;
    if (!start || !driver?.logs) return { unavailable: { available: false, reason: "no-output" } };
    return { start, driver: driver as ServiceDriver & Required<Pick<ServiceDriver, "logs">>, externalStart };
  }

  /**
   * Per-secret resolution for the logs route: an unset secret is skipped, an unreadable or too-short
   * one fails closed naming the first in declaration order, and a digest differing from the start
   * record means the output was produced with other values.
   */
  private async logRedaction(
    def: ServiceDefinition,
    start: StartRecord,
  ): Promise<{ values: Array<{ name: string; value: string }> } | { withheld: Extract<LogsResponse, { available: false }> }> {
    const resolved = await resolveEachSecret(def, {
      store: this.secrets,
      env: this.deps.env ?? process.env,
      platform: this.deps.platform ?? process.platform,
      run: this.deps.run,
      resolveBinary: this.deps.resolveBinary,
    });
    const values: Array<{ name: string; value: string }> = [];
    for (const { name, resolution } of resolved) {
      if (resolution.ok) {
        if (resolution.value.length < MIN_REDACTABLE_LENGTH) return { withheld: { available: false, reason: "secret-too-short", secret: name } };
        values.push({ name, value: resolution.value });
      } else if (resolution.kind === "unreadable") {
        return { withheld: { available: false, reason: "secret-unavailable", secret: name } };
      }
    }
    const digest = secretsDigest(this.digestKey(), Object.fromEntries(values.map((v) => [v.name, v.value])));
    if (digest !== start.secretsDigest) return { withheld: { available: false, reason: "secrets-changed" } };
    return { values };
  }

  // ── reset-data / prune ────────────────────────────────────────────────────

  /**
   * Remove the data volumes of a stopped service (definition, secrets and run
   * dir untouched). Refuses while anything may be running or its containers
   * cannot be enumerated; the shared volume guard keeps a volume another
   * definition declares or a foreign container uses.
   */
  async resetData(id: string): Promise<ResetDataResult> {
    const r = this.definitions.read();
    if (!r.ok) throw new ServiceError(409, "definitions-corrupt", new DefinitionsCorruptError(this.definitions.file, r.backupPath).message);
    const def = r.entries.find((e) => e.id === id)?.def;
    if (!def) throw new ServiceError(404, "not-found", `no service "${id}"`);
    const instanceId = r.instanceId ?? "";
    const shared = this.volumesDeclaredElsewhere(r.entries, id);
    return this.mutex.run(id, () =>
      withLifecycleLock(
        this.deps.paths.lockTarget(id),
        async () => {
          this.assertResettable(def);
          const volumes = await this.resetVolumes(def, instanceId, shared);
          this.log(`[services] ${id} data reset (${volumes.length} volumes)`);
          this.notify();
          return { volumes };
        },
        this.deps.lockOptions,
      ),
    );
  }

  /** `stopped`, or `unavailable` for a reason other than the sticky ones (which may involve containers we do not own). */
  private assertResettable(def: ServiceDefinition): void {
    const rec = this.rec(def.id);
    const { state, reason } = { state: rec.cell.state, reason: rec.cell.reason };
    const resettable = !rec.instance && (state === "stopped" || (state === "unavailable" && !(reason && STICKY_REASONS.has(reason))));
    if (!resettable) {
      throw new ServiceError(409, "not-resettable", `${def.id} is ${state}${reason ? ` (${reason})` : ""}; stop it first (or wait until it is stopped)`);
    }
    if (Object.keys(def.oci?.volumes ?? {}).length === 0) throw new ServiceError(409, "no-data", `${def.id} declares no named volumes`);
  }

  private static resetRefusal(id: string, kind: "unreachable" | "busy" | "rm-failed"): ServiceError {
    if (kind === "unreachable") {
      return new ServiceError(409, "runtime-unreachable", "the container runtime could not list or inspect this service's containers; nothing was removed");
    }
    if (kind === "busy") return new ServiceError(409, "not-resettable", `a container of ${id} is running; stop it first`);
    return new ServiceError(409, "not-resettable", `a container of ${id} could not be removed; no volume was touched`);
  }

  /** Remove containers then volumes through every runtime driver that has any; a failure aborts with 409. */
  private async resetVolumes(def: ServiceDefinition, instanceId: string, shared: ReadonlySet<string>): Promise<VolumeOutcome[]> {
    const merged = new Map<string, VolumeOutcome>();
    let reached = false;
    for (const d of this.driversOf(def)) {
      const out = d.resetData ? await d.resetData(def, instanceId, shared) : ({ kind: "na" } as const);
      if (out.kind === "na") continue;
      if (out.kind !== "ok") throw ServiceManager.resetRefusal(def.id, out.kind);
      reached = true;
      for (const v of out.volumes) {
        const prev = merged.get(v.name);
        if (!prev || (!prev.removed && v.removed)) merged.set(v.name, v);
      }
    }
    if (!reached) throw new ServiceError(409, "runtime-unreachable", "no container runtime is available to remove the volumes");
    return [...merged.values()];
  }

  /** Liveness of a recorded pid: POSIX = the process GROUP (workers included); EPERM counts as alive. */
  private recordedAlive(pid: number): boolean {
    if ((this.deps.platform ?? process.platform) === "win32") return isProcessAlive(pid, { kill: this.deps.kill });
    return signalZero(-pid, { kill: this.deps.kill }) !== "esrch";
  }

  /** Orphan containers and run dirs of services that are no longer defined. */
  private async pruneCandidates(
    defined: ReadonlySet<string>,
    instanceId: string,
    only?: ReadonlySet<string>,
  ): Promise<{ candidates: PruneCandidate[]; skipped: PruneSkipped[]; unreachableRuntimes: Array<"docker" | "podman"> }> {
    const wanted = (id: string) => !defined.has(id) && (!only || only.has(id));
    const containers = await this.orphanContainers(instanceId, wanted);
    return { ...containers, candidates: [...containers.candidates, ...this.deadRunDirs(wanted)] };
  }

  /** Containers labelled with this installation's `pi.owner` whose service is not defined, per reachable runtime. */
  private async orphanContainers(
    instanceId: string,
    wanted: (id: string) => boolean,
  ): Promise<{ candidates: PruneCandidate[]; skipped: PruneSkipped[]; unreachableRuntimes: Array<"docker" | "podman"> }> {
    const candidates: PruneCandidate[] = [];
    const skipped: PruneSkipped[] = [];
    const unreachableRuntimes: Array<"docker" | "podman"> = [];
    for (const runtime of ["docker", "podman"] as const) {
      const listing = await this.driver(`oci:${runtime}`).listOwned?.(instanceId);
      if (!listing || listing.state === "absent") continue;
      if (listing.state === "unreachable") {
        unreachableRuntimes.push(runtime);
        continue;
      }
      for (const c of listing.containers.filter((x) => wanted(x.serviceId))) {
        if (c.running) skipped.push({ id: c.serviceId, kind: "container", reason: "running" });
        else candidates.push({ kind: "container", id: c.serviceId, containerId: c.containerId, runtime });
      }
    }
    return { candidates, skipped, unreachableRuntimes };
  }

  /** `services-run/<id>/` directories of undefined services with no live recorded process (group-aware; EPERM = live). */
  private deadRunDirs(wanted: (id: string) => boolean): PruneCandidate[] {
    let dirs: string[] = [];
    try {
      dirs = fs.readdirSync(this.deps.paths.runRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      /* no run root yet */
    }
    return dirs
      .filter((name) => SERVICE_ID_PATTERN.test(name) && wanted(name))
      .filter((name) => {
        const rec = readJsonFile<{ pid?: number }>(this.deps.paths.instanceFile(name));
        return !(rec && Number.isInteger(rec.pid) && this.recordedAlive(rec.pid as number));
      })
      .map((name) => ({ kind: "run-dir" as const, id: name }));
  }

  /** Re-check one previewed id under its lifecycle lock (after re-reading `services.json`), then remove it. */
  private async pruneOne(
    id: string,
    instanceId: string,
    definedNow: () => Set<string> | null,
    removed: string[],
    skipped: PruneSkipped[],
  ): Promise<void> {
    const skip = (kind: PruneSkipped["kind"], reason: string) => void skipped.push({ id, kind, reason });
    const defined = definedNow();
    if (!defined) return skip("run-dir", "services.json is missing or corrupt");
    if (defined.has(id)) return skip("run-dir", "defined since the preview");
    const again = await this.pruneCandidates(defined, instanceId, new Set([id]));
    if (again.candidates.length === 0) return skip("run-dir", "no longer a leftover");
    for (const runtime of ["docker", "podman"] as const) {
      const cids = again.candidates.filter((c) => c.kind === "container" && c.runtime === runtime).map((c) => c.containerId as string);
      if (cids.length > 0 && !(await this.driver(`oci:${runtime}`).removeContainers?.(cids))) {
        return skip("container", `${runtime} could not remove the container`);
      }
    }
    fs.rmSync(this.deps.paths.runDir(id), { recursive: true, force: true });
    this.output.close(id);
    removed.push(id);
  }

  /**
   * Remove dashboard-owned leftovers: containers of this installation whose
   * service is no longer defined, and dead run dirs. Dry run first; the confirm
   * considers only the previewed `ids` and re-checks each under its lifecycle
   * lock after re-reading `services.json`.
   */
  async prune(req: PruneRequest): Promise<PruneResult> {
    const r = this.definitions.read();
    if (!r.ok) throw new ServiceError(409, "definitions-corrupt", new DefinitionsCorruptError(this.definitions.file, r.backupPath).message);
    // A missing file reads as "zero services": every owned container and run dir would be a candidate.
    if (!r.exists) throw new ServiceError(409, "definitions-missing", "services.json does not exist; refusing to prune (nothing is defined to compare against)");
    const instanceId = r.instanceId ?? "";
    const definedNow = () => {
      const fresh = this.definitions.read();
      return fresh.ok && fresh.exists ? new Set(fresh.entries.map((e) => e.id)) : null;
    };
    if (req.dryRun) {
      const out = await this.pruneCandidates(new Set(r.entries.map((e) => e.id)), instanceId);
      return { dryRun: true, ...out };
    }
    const wanted = new Set((Array.isArray(req.ids) ? req.ids : []).filter((x): x is string => typeof x === "string" && SERVICE_ID_PATTERN.test(x)));
    const removed: string[] = [];
    const skipped: PruneSkipped[] = [];
    const first = await this.pruneCandidates(new Set(r.entries.map((e) => e.id)), instanceId, wanted);
    const ids = [...new Set(first.candidates.map((c) => c.id))];
    // A previewed id that has become a defined service meanwhile is reported, not silently dropped;
    // an id that was never a candidate is ignored.
    const definedAtConfirm = new Set(r.entries.map((e) => e.id));
    for (const id of wanted) {
      if (!ids.includes(id) && definedAtConfirm.has(id)) skipped.push({ id, kind: "run-dir", reason: "defined since the preview" });
    }
    for (const id of ids) {
      await this.mutex.run(id, () =>
        withLifecycleLock(this.deps.paths.lockTarget(id), () => this.pruneOne(id, instanceId, definedNow, removed, skipped), this.deps.lockOptions),
      );
    }
    this.log(`[services] prune removed ${removed.length}, skipped ${skipped.length}`);
    this.notify();
    return { dryRun: false, removed, skipped };
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
        rec.start = readStartRecord(this.deps.paths, def.id);
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
    if (this.timer || this.disposed) return;
    this.timer = setInterval(() => {
      this.tick().catch((err: unknown) => this.log(`[services] tick error: ${(err as Error).message}`));
    }, this.deps.tickMs ?? REPROBE_INTERVAL_MS);
    this.timer.unref?.();
    // Output cap: an `fstat` of a local file per service, not a health probe —
    // runs for every service with an output file, leased or not.
    this.capTimer = setInterval(() => {
      this.capOutputs().catch((err: unknown) => this.log(`[services] output cap error: ${(err as Error).message}`));
    }, this.deps.capMs ?? 5_000);
    this.capTimer.unref?.();
  }

  /** One output-cap sweep over every run dir that has an `output.log`. Exposed for tests. */
  async capOutputs(): Promise<void> {
    let names: string[];
    try {
      names = fs.readdirSync(this.deps.paths.runRoot);
    } catch {
      return;
    }
    await Promise.all(
      names
        .filter((n) => SERVICE_ID_PATTERN.test(n) && fs.existsSync(this.deps.paths.outputLog(n)))
        .map((n) => {
          const recorded = this.recs.get(n)?.start ?? readStartRecord(this.deps.paths, n);
          return this.output.enforceCap(n, recorded?.output ?? null);
        }),
    );
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.capTimer) clearInterval(this.capTimer);
    this.capTimer = undefined;
    this.notifier.dispose();
    this.output.closeAll();
  }
}
