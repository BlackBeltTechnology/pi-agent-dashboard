/**
 * Certificate lifecycle: per `(source, name)` load → obtain when missing / due /
 * settings-changed, single-flight, gate-before-obtain, attempt deadline,
 * persisted exponential backoff, prune, name ownership, hot swap into the
 * `TlsCertStore`. Sources only return PEM strings; ONLY this class writes files.
 *
 * Timing: scheduled retries use one timer per name (precise at the backoff
 * boundary); renewal windows are evaluated by `tick()` every 12 h.
 *
 * See change: add-tailscale-cert-tls (design D3).
 */
import type { TlsCertStatus, TlsGate, TlsSourceStatus } from "@blackbelt-technology/pi-dashboard-shared/tls-status.js";
import { type CertFiles, type CertMeta, certValidity, isSafeCertName, pairMatches } from "./cert-files.js";
import { type StoreEntry, TlsCertStore } from "./cert-store.js";
import { type CertSource, RetryAfterError, type SourceReadiness } from "./types.js";

const TICK_INTERVAL_MS = 12 * 60 * 60_000;
const BACKOFF_BASE_MS = 5 * 60_000;
const BACKOFF_CAP_MS = 6 * 60 * 60_000;
const GATE_RECHECK_MS = 15 * 60_000;
const DEFAULT_ATTEMPT_TIMEOUT_MS = 10 * 60_000;
const LAST_ERROR_MAX = 500;

export interface ManagerLogger {
  info(msg: string): void;
  warn(msg: string): void;
}

export interface InvalidSourceEntry {
  index: number;
  message: string;
  /** Resolved id when the entry carried one; unresolved ids disable orphan-directory cleanup. */
  id?: string;
}

export interface AttemptOutcome {
  ok: boolean;
  /** Prevented by an unmet gate (not counted as a failure). */
  skipped?: boolean;
  error?: string;
}

export type StatusGate = TlsGate;
export type CertStatusRow = TlsCertStatus;
export interface ManagerStatus {
  gates: TlsGate[];
  sources: TlsSourceStatus[];
  certs: TlsCertStatus[];
}

interface Started {
  done: Promise<AttemptOutcome>;
}

interface Inflight {
  id: number;
  done: Promise<AttemptOutcome>;
  resolve: (o: AttemptOutcome) => void;
}

interface NameState {
  sourceId: string;
  name: string;
  held: boolean;
  meta: CertMeta;
  timer?: ReturnType<typeof setTimeout>;
  /** Next timer-driven evaluation must re-read readiness (gate re-check). */
  forceReadiness?: boolean;
  inflight?: Inflight;
}

interface SourceState {
  source: CertSource;
  order: number;
  /** `undefined` = not asked yet, `null` = source cannot tell. */
  lastNames?: string[] | null;
  readiness?: SourceReadiness;
  owned: Set<string>;
  conflicts: string[];
  loaded: boolean;
}

export interface CertManagerOptions {
  files: CertFiles;
  store: TlsCertStore;
  now?: () => number;
  log?: ManagerLogger;
  /** Called after the set of held names or certificates changed. */
  onChange?: () => void;
}

const key = (sourceId: string, name: string): string => `${sourceId}\u0000${name}`;
const trunc = (s: string): string => (s.length > LAST_ERROR_MAX ? s.slice(0, LAST_ERROR_MAX) : s);
const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function backoffDelayMs(failures: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1), BACKOFF_CAP_MS);
}

export class CertManager {
  private readonly files: CertFiles;
  private readonly store: TlsCertStore;
  private readonly now: () => number;
  private readonly log: ManagerLogger;
  private readonly onChange: () => void;

  private sources = new Map<string, SourceState>();
  private names = new Map<string, NameState>();
  private invalid: InvalidSourceEntry[] = [];
  private attemptSeq = 0;
  private readonly pendingWrites = new Set<Promise<void>>();
  private chain: Promise<unknown> = Promise.resolve();
  private interval?: ReturnType<typeof setInterval>;
  private stopped = false;

  constructor(opts: CertManagerOptions) {
    this.files = opts.files;
    this.store = opts.store;
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? {
      info: (m) => console.log(`[tls] ${m}`),
      warn: (m) => console.warn(`[tls] ${m}`),
    };
    this.onChange = opts.onChange ?? (() => undefined);
  }

  // ── lifecycle ────────────────────────────────────────────────────────

  /** Start the 12 h renewal tick. Idempotent. */
  start(): void {
    this.stopped = false;
    if (this.interval) return;
    this.interval = setInterval(() => void this.tick(), TICK_INTERVAL_MS);
    this.interval.unref?.();
  }

  /** Clear every timer and abandon running attempts. Certificates stay on disk. */
  suspend(): void {
    this.stopped = true;
    if (this.interval) clearInterval(this.interval);
    this.interval = undefined;
    for (const ns of this.names.values()) {
      if (ns.timer) clearTimeout(ns.timer);
      ns.timer = undefined;
      if (ns.inflight) {
        ns.inflight.resolve({ ok: false, error: "suspended" });
        ns.inflight = undefined;
      }
    }
    for (const entry of this.store.all()) this.store.delete(entry.name);
    for (const ns of this.names.values()) ns.held = false;
    this.sources.clear();
    this.names.clear();
    this.onChange();
  }

  /** Resolves when every running attempt has finished (test + shutdown helper). */
  async settle(): Promise<void> {
    for (;;) {
      const running: Promise<unknown>[] = [
        ...[...this.names.values()].flatMap((n) => (n.inflight ? [n.inflight.done] : [])),
        ...this.pendingWrites,
      ];
      if (running.length === 0) return;
      await Promise.all(running);
    }
  }

  // ── reconcile ────────────────────────────────────────────────────────

  /**
   * Apply a (re)built source list. Serialised: concurrent calls queue.
   * Resolves once names are listed, pruned and due attempts STARTED (not finished).
   */
  reconcile(sources: CertSource[], invalid: InvalidSourceEntry[] = []): Promise<void> {
    const run = this.chain.then(() => this.doReconcile(sources, invalid));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async doReconcile(list: CertSource[], invalid: InvalidSourceEntry[]): Promise<void> {
    this.stopped = false;
    this.invalid = invalid;
    const next = new Map<string, SourceState>();
    list.forEach((source, order) => {
      const prev = this.sources.get(source.id);
      next.set(source.id, {
        source,
        order,
        owned: new Set(),
        conflicts: [],
        loaded: prev?.loaded ?? false,
        lastNames: prev?.lastNames,
        readiness: prev?.readiness,
      });
    });

    // Removed sources: delete their files, give the source a chance to clean up.
    for (const [id, prev] of this.sources) {
      if (next.has(id)) continue;
      await this.dropSource(id, prev);
    }
    await this.removeOrphanDirs(next, invalid);
    this.sources = next;

    // First sight of a source: serve whatever is on disk right away.
    for (const [id, ss] of this.sources) {
      if (ss.loaded) continue;
      ss.loaded = true;
      await this.loadFromDisk(id);
    }

    // Fresh readiness + names per source (sources cache; `force` re-checks now).
    for (const ss of this.sources.values()) {
      ss.readiness = await this.safeReadiness(ss.source, true);
      try {
        ss.lastNames = await ss.source.names();
      } catch (err) {
        this.log.warn(`names() failed source=${ss.source.id}: ${errMessage(err)}`);
        ss.lastNames = null;
      }
    }

    this.computeOwnership();
    await this.prune();

    const starts: Promise<Started | null>[] = [];
    for (const ss of this.sources.values()) {
      for (const name of ss.owned) {
        const ns = this.nameState(ss.source.id, name);
        starts.push(this.beginAttempt(ns, "scheduled"));
      }
    }
    await Promise.all(starts);

    for (const ss of this.sources.values()) {
      try {
        await ss.source.onReconciled?.();
      } catch (err) {
        this.log.warn(`onReconciled failed source=${ss.source.id}: ${errMessage(err)}`);
      }
    }
    this.onChange();
  }

  private async dropSource(id: string, ss: SourceState): Promise<void> {
    for (const [k, ns] of [...this.names]) {
      if (ns.sourceId !== id) continue;
      if (ns.timer) clearTimeout(ns.timer);
      ns.inflight?.resolve({ ok: false, error: "source removed" });
      this.store.delete(ns.name);
      this.names.delete(k);
    }
    await this.files.removeSource(id).catch(() => undefined);
    try {
      await ss.source.onRemoved?.();
    } catch (err) {
      this.log.warn(`onRemoved failed source=${id}: ${errMessage(err)}`);
    }
    this.log.info(`source removed source=${id}`);
  }

  /** `tls/<id>/` directories nobody configures any more (source removed while the server was off). */
  private async removeOrphanDirs(next: Map<string, SourceState>, invalid: InvalidSourceEntry[]): Promise<void> {
    if (invalid.some((i) => !i.id)) return; // an entry we cannot name might own any directory
    const keep = new Set<string>([...next.keys(), ...invalid.flatMap((i) => (i.id ? [i.id] : []))]);
    for (const id of await this.files.listSourceDirs()) {
      if (keep.has(id)) continue;
      await this.files.removeSource(id).catch(() => undefined);
      this.log.info(`orphan source directory removed source=${id}`);
    }
  }

  private async loadFromDisk(sourceId: string): Promise<void> {
    for (const name of await this.files.listNames(sourceId)) {
      const { loaded, reason } = await this.files.load(sourceId, name);
      const ns = this.nameState(sourceId, name);
      if (loaded) {
        ns.meta = { ...loaded.meta, stage: "idle", source: sourceId };
        ns.held = true;
        this.store.set({
          name,
          sourceId,
          ctx: TlsCertStore.createContext(loaded.certPem, loaded.keyPem),
          notBefore: loaded.notBefore,
          notAfter: loaded.notAfter,
          advertise: loaded.meta.advertise,
          kind: loaded.meta.kind,
        });
        continue;
      }
      const meta = await this.files.readMeta(sourceId, name);
      if (meta) ns.meta = { ...meta, stage: "idle", source: sourceId };
      if (reason) {
        this.log.warn(`not serving stored certificate source=${sourceId} name=${name}: ${reason}`);
        await this.files.removePair(sourceId, name).catch(() => undefined);
      }
    }
  }

  private computeOwnership(): void {
    const owners = new Map<string, string>();
    const ordered = [...this.sources.values()].sort((a, b) => a.order - b.order);
    for (const ss of ordered) {
      ss.owned = new Set();
      ss.conflicts = [];
      for (const raw of ss.lastNames ?? []) {
        const name = raw.trim().toLowerCase();
        if (!isSafeCertName(name)) {
          this.log.warn(`ignoring unusable name source=${ss.source.id} name=${JSON.stringify(raw)}`);
          continue;
        }
        const owner = owners.get(name);
        if (owner === undefined) {
          owners.set(name, ss.source.id);
          ss.owned.add(name);
        } else if (owner !== ss.source.id) {
          ss.conflicts.push(name);
        }
      }
    }
  }

  /** Drop held names a source no longer produces — only when it returned a LIST. */
  private async prune(): Promise<void> {
    for (const ss of this.sources.values()) {
      if (ss.lastNames === null || ss.lastNames === undefined) continue;
      const stale = [...this.names].filter(([, ns]) => ns.sourceId === ss.source.id && !ss.owned.has(ns.name));
      for (const [k, ns] of stale) await this.dropName(k, ns);
    }
  }

  private async dropName(k: string, ns: NameState): Promise<void> {
    if (ns.timer) clearTimeout(ns.timer);
    ns.inflight?.resolve({ ok: false, error: "name removed" });
    ns.inflight = undefined;
    if (this.store.get(ns.name)?.sourceId === ns.sourceId) this.store.delete(ns.name);
    this.names.delete(k);
    await this.files.removeName(ns.sourceId, ns.name).catch(() => undefined);
    this.log.info(`pruned source=${ns.sourceId} name=${ns.name}`);
  }

  // ── attempts ─────────────────────────────────────────────────────────

  /** Evaluate every owned name now (the 12 h tick; renewal windows). */
  async tick(): Promise<void> {
    if (this.stopped) return;
    const starts: Promise<Started | null>[] = [];
    for (const ss of this.sources.values()) {
      for (const name of ss.owned) starts.push(this.beginAttempt(this.nameState(ss.source.id, name), "scheduled"));
    }
    await Promise.all(starts);
  }

  /**
   * Operator "issue now". Bypasses backoff, re-checks the source's gates, joins
   * a running attempt. With a `name` it always (re)issues that name; without,
   * only names that are missing, failed, settings-changed or inside the renewal
   * window — a valid current certificate is never re-issued. Resolves when the
   * attempts finish. `unknown-source` when the id is not configured.
   */
  async trigger(sourceId: string, name?: string): Promise<"unknown-source" | AttemptOutcome[]> {
    const ss = this.sources.get(sourceId);
    if (!ss) return "unknown-source";
    ss.readiness = await this.safeReadiness(ss.source, true);
    const targets = name ? [name.toLowerCase()] : [...ss.owned];
    const mode = name ? "explicit" : "all";
    const started = await Promise.all(targets.map((n) => this.beginAttempt(this.nameState(sourceId, n), mode)));
    return Promise.all(started.flatMap((s) => (s ? [s.done] : [])));
  }

  private nameState(sourceId: string, name: string): NameState {
    const k = key(sourceId, name);
    let ns = this.names.get(k);
    if (!ns) {
      ns = {
        sourceId,
        name,
        held: false,
        meta: { source: sourceId, fingerprint: "", advertise: false, kind: "magicdns", stage: "idle", failures: 0 },
      };
      this.names.set(k, ns);
    }
    return ns;
  }

  private renewalDue(ns: NameState): boolean {
    const entry = this.store.get(ns.name);
    if (!ns.held || !entry || entry.sourceId !== ns.sourceId) return true;
    const remaining = entry.notAfter - this.now();
    return remaining < (entry.notAfter - entry.notBefore) / 3;
  }

  private needsCert(ns: NameState, ss: SourceState): boolean {
    return !ns.held || ns.meta.fingerprint !== ss.source.configFingerprint(ns.name) || this.renewalDue(ns);
  }

  private async safeReadiness(source: CertSource, force: boolean): Promise<SourceReadiness> {
    try {
      return await source.readiness({ force });
    } catch (err) {
      return { gates: [{ id: "source-error", ok: false, hint: errMessage(err) }] };
    }
  }

  /**
   * Decide and, when due, START an attempt. Resolves once the attempt has
   * started (or was skipped) with the promise of its outcome (`done`) — `null` when
   * nothing needed doing. The single-flight slot is taken synchronously, so two
   * concurrent callers can never start two attempts for one name.
   */
  private async beginAttempt(
    ns: NameState,
    mode: "scheduled" | "all" | "explicit",
  ): Promise<Started | null> {
    if (this.stopped) return null;
    if (ns.inflight) return { done: ns.inflight.done };
    const ss = this.sources.get(ns.sourceId);
    if (!ss) return null;
    if (ns.timer) clearTimeout(ns.timer);
    ns.timer = undefined;

    const wait = this.decide(ns, ss, mode);
    if (wait !== "go") {
      if (typeof wait === "number") this.arm(ns, wait);
      return null;
    }

    const id = ++this.attemptSeq;
    let resolve!: (o: AttemptOutcome) => void;
    const done = new Promise<AttemptOutcome>((r) => {
      resolve = r;
    });
    const slot: Inflight = { id, done, resolve };
    ns.inflight = slot;
    const force = ns.forceReadiness === true;
    ns.forceReadiness = false;

    // Gate-before-obtain: an unmet source-wide or name-scoped gate skips the attempt
    // without counting a failure; the name is re-checked later.
    const readiness = await this.safeReadiness(ss.source, force);
    ss.readiness = readiness;
    if (ns.inflight !== slot) return { done }; // suspended / pruned / abandoned while we awaited
    const blocked = readiness.gates.find((g) => !g.ok && (g.name === undefined || g.name === ns.name));
    if (blocked) {
      ns.inflight = undefined;
      ns.meta.stage = "idle";
      ns.forceReadiness = true;
      this.arm(ns, GATE_RECHECK_MS);
      resolve({ ok: false, skipped: true, error: `gate ${blocked.id} unmet` });
      return { done };
    }

    void this.runAttempt(ns, ss, slot);
    return { done };
  }

  /**
   * Should an attempt start now? `"go"`, `"skip"` (nothing to do), or a number of
   * ms to wait (a scheduled retry is not due yet). Operator triggers bypass backoff.
   */
  private decide(ns: NameState, ss: SourceState, mode: "scheduled" | "all" | "explicit"): "go" | "skip" | number {
    if (mode === "explicit") return "go";
    if (mode === "scheduled") {
      const due = ns.meta.nextAttemptAt;
      if (due && due > this.now()) return due - this.now();
      return this.needsCert(ns, ss) ? "go" : "skip";
    }
    const failed = ns.meta.failures > 0 || !!ns.meta.lastError;
    return this.needsCert(ns, ss) || failed ? "go" : "skip";
  }

  private arm(ns: NameState, delayMs: number): void {
    if (ns.timer) clearTimeout(ns.timer);
    ns.timer = setTimeout(
      () => {
        ns.timer = undefined;
        void this.beginAttempt(ns, "scheduled");
      },
      Math.max(0, Math.min(delayMs, 2 ** 31 - 1)),
    );
    ns.timer.unref?.();
  }

  private async runAttempt(ns: NameState, ss: SourceState, slot: Inflight): Promise<void> {
    const isCurrent = (): boolean => ns.inflight === slot;
    const limit = ss.source.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
    ns.meta.stage = "requesting";
    this.onChange();
    this.log.info(`obtain start source=${ns.sourceId} name=${ns.name} attempt=${slot.id}`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timed out")), limit);
        timer.unref?.();
      });
      const obtain = ss.source.obtain(ns.name, (stage) => {
        if (isCurrent()) ns.meta.stage = stage || "requesting";
      });
      // A late result of an abandoned attempt is discarded: never written, never served.
      obtain.catch(() => undefined);
      const obtained = await Promise.race([obtain, timeout]);
      if (!isCurrent()) return;
      if (typeof obtained?.certPem !== "string" || typeof obtained?.keyPem !== "string") {
        throw new Error("source returned no certificate");
      }
      let validity: { notBefore: number; notAfter: number };
      try {
        validity = certValidity(obtained.certPem);
      } catch {
        throw new Error("source returned a certificate that does not parse");
      }
      if (!pairMatches(obtained.certPem, obtained.keyPem)) {
        throw new Error("source returned a certificate and key that do not match");
      }
      const meta: CertMeta = {
        source: ns.sourceId,
        fingerprint: ss.source.configFingerprint(ns.name),
        advertise: obtained.advertise,
        kind: obtained.kind,
        ...(obtained.details ? { details: obtained.details } : {}),
        notBefore: validity.notBefore,
        notAfter: validity.notAfter,
        stage: "idle",
        failures: 0,
      };
      await this.files.writePair(ns.sourceId, ns.name, slot.id, obtained.certPem, obtained.keyPem, meta);
      if (!isCurrent()) return;
      const entry: StoreEntry = {
        name: ns.name,
        sourceId: ns.sourceId,
        ctx: TlsCertStore.createContext(obtained.certPem, obtained.keyPem),
        notBefore: validity.notBefore,
        notAfter: validity.notAfter,
        advertise: obtained.advertise,
        kind: obtained.kind,
      };
      this.store.set(entry);
      ns.held = true;
      ns.meta = meta;
      ns.inflight = undefined;
      this.log.info(
        `obtain ok source=${ns.sourceId} name=${ns.name} notAfter=${new Date(validity.notAfter).toISOString()}`,
      );
      this.onChange();
      slot.resolve({ ok: true });
    } catch (err) {
      if (!isCurrent()) return;
      // Persist before the outcome resolves: a restart right after cannot lose the backoff.
      await this.recordFailure(ns, err);
      slot.resolve({ ok: false, error: errMessage(err) });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Records the failure, frees the single-flight slot, schedules the retry and persists the backoff. */
  private recordFailure(ns: NameState, err: unknown): Promise<void> {
    ns.inflight = undefined;
    const msg = trunc(errMessage(err));
    ns.meta.failures += 1;
    ns.meta.lastError = msg;
    ns.meta.stage = "idle";
    let delay = backoffDelayMs(ns.meta.failures);
    if (err instanceof RetryAfterError) delay = Math.max(delay, err.retryAfterMs);
    ns.meta.nextAttemptAt = this.now() + delay;
    this.arm(ns, delay);
    this.log.warn(
      `obtain failed source=${ns.sourceId} name=${ns.name} failures=${ns.meta.failures} retryInMs=${delay}: ${msg}`,
    );
    this.onChange();
    return this.persist(ns);
  }

  /** Persist `meta.json`, tracked so `settle()` (and tests) can await it. */
  private persist(ns: NameState): Promise<void> {
    const p = this.files.writeMeta(ns.sourceId, ns.name, ns.meta).catch(() => undefined);
    this.pendingWrites.add(p);
    void p.finally(() => this.pendingWrites.delete(p));
    return p;
  }

  // ── read side ────────────────────────────────────────────────────────

  /** Exact (non-wildcard) names of held certificates. */
  heldExactNames(): string[] {
    return this.store.exactNames();
  }

  hasSource(id: string): boolean {
    return this.sources.has(id);
  }

  /** The source's last name list; `undefined`/`null` when not known (route accepts then). */
  knownNames(sourceId: string): string[] | null | undefined {
    const ss = this.sources.get(sourceId);
    return ss ? (ss.lastNames === undefined ? undefined : ss.lastNames === null ? null : [...ss.owned]) : undefined;
  }

  sourceCount(): number {
    return this.sources.size;
  }

  /** Never calls out: reads what reconcile / attempts cached. */
  status(): ManagerStatus {
    const gates: StatusGate[] = [];
    if (this.sources.size === 0 && this.invalid.length === 0) {
      gates.push({ id: "no-sources", ok: false, hint: "Add a certificate source (for example Tailscale) to serve HTTPS." });
    }
    for (const inv of this.invalid) {
      gates.push({ id: "invalid-source", ok: false, hint: `tls.sources[${inv.index}]: ${inv.message}` });
    }
    const sources: ManagerStatus["sources"] = [];
    const certs: CertStatusRow[] = [];
    for (const ss of [...this.sources.values()].sort((a, b) => a.order - b.order)) {
      const id = ss.source.id;
      sources.push({ id, type: ss.source.type, ...(ss.readiness?.details ? { details: ss.readiness.details } : {}) });
      gates.push(...this.sourceGates(ss));
      certs.push(...this.sourceRows(ss));
    }
    return { gates, sources, certs };
  }

  /** Unmet gates of one source (its own readiness + name conflicts), tagged with its id. */
  private sourceGates(ss: SourceState): StatusGate[] {
    const id = ss.source.id;
    const unmet: StatusGate[] = (ss.readiness?.gates ?? []).filter((g) => !g.ok).map((g) => ({ ...g, sourceId: id }));
    for (const name of ss.conflicts) {
      unmet.push({ id: "name-conflict", ok: false, name, sourceId: id, hint: "Another source already provides this name." });
    }
    return unmet;
  }

  /** One status row per name the source produces (held, waiting on a gate, or being issued) plus held names. */
  private sourceRows(ss: SourceState): CertStatusRow[] {
    const id = ss.source.id;
    const names = new Set<string>(ss.owned);
    for (const ns of this.names.values()) if (ns.sourceId === id) names.add(ns.name);
    return [...names].sort().map((name) => this.statusRow(ss, name));
  }

  private statusRow(ss: SourceState, name: string): CertStatusRow {
    const id = ss.source.id;
    const ns = this.names.get(key(id, name));
    const entry = this.store.get(name);
    const held = !!ns?.held && entry?.sourceId === id;
    const meta = ns?.meta;
    return {
      name,
      sourceId: id,
      sourceType: ss.source.type,
      kind: meta?.kind ?? "magicdns",
      held,
      ...(held && entry ? { notAfter: entry.notAfter } : {}),
      advertise: held ? (entry?.advertise ?? false) : false,
      stage: ns?.inflight ? meta?.stage || "requesting" : "idle",
      ...(meta?.lastError ? { lastError: trunc(meta.lastError) } : {}),
      ...(meta?.nextAttemptAt && meta.nextAttemptAt > this.now() ? { nextAttemptAt: meta.nextAttemptAt } : {}),
      ...(meta?.details ? { details: meta.details } : {}),
    };
  }

  /** Held, unexpired, advertisable, non-wildcard entries (the endpoint source). */
  advertisable(): Array<{ name: string; kind: "magicdns" | "domain" }> {
    const now = this.now();
    return this.store
      .all()
      .filter((e) => e.advertise && !e.name.startsWith("*.") && e.notAfter > now)
      .map((e) => ({ name: e.name, kind: e.kind }));
  }
}
