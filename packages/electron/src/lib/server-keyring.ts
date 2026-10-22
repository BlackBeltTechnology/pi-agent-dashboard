/**
 * Server keyring — paired dashboards keyed by fingerprint, persisted in
 * `server-keyring.json` in the shell's managed directory (`MANAGED_DIR`, next to
 * `dashboard-settings.json`).
 *
 * - Bearer stored ONLY encrypted (`safeStorage`, injected as `CryptoPort`).
 *   When encryption is unavailable (or Linux backend `basic_text`) the bearer
 *   lives in memory for this run only; the entry is written with
 *   `bearer: null, remembered: false`.
 * - Atomic write: temp file (`wx`, mode 0600) → fsync → rename. POSIX load
 *   tightens a broader mode to 0600.
 * - Unknown version / unparseable file → renamed `server-keyring.corrupt-<ts>.json`,
 *   keyring starts empty, one log line. Never throws on load.
 * - A bearer that cannot be decrypted is dropped; the entry keeps pin/label/hosts
 *   and is marked `needsPairing`.
 * - `lastHosts` is an MRU capped at 5; a discovered http host never replaces or
 *   precedes an https host. Each host may record its `source` (`saved|mdns|pairing`);
 *   a host written by an earlier version has none and is read as unknown.
 *   At most {@link MAX_DELIVERED_STORED} delivered (`pairing`) hosts are stored per
 *   pairing result (`addDeliveredHosts`), then the 5-host cap applies.
 * - No method here returns a bearer to anything but main-process callers
 *   (`bearerFor`); `list()` is renderer-safe (no bearer).
 *
 * Imports nothing from electron — unit-tested in `__tests__/server-keyring.test.ts`.
 *
 * See change: add-electron-server-windows (D4), group-servers-by-identity (D7).
 */
import fs from "node:fs";
import path from "node:path";
import { ROUTE_SOURCES, type RouteSource } from "@blackbelt-technology/pi-dashboard-shared/server-routes.js";
import { type HostRef, shortFingerprint } from "./server-discovery.js";

const KEYRING_FILE = "server-keyring.json";
const KEYRING_VERSION = 1;
const LAST_HOSTS_CAP = 5;
/** Delivered routes kept per pairing result (before the host cap applies). */
export const MAX_DELIVERED_STORED = 3;

/** A last-known host, with how it was learned (absent ⇒ unknown, e.g. written by an earlier version). */
export interface StoredHost extends HostRef {
  source?: RouteSource;
}

/** Electron `safeStorage` shape, injected so the keyring stays testable. */
export interface CryptoPort {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(blob: Buffer): string;
  /** Linux only: `basic_text` means "encrypted" with a hard-coded key — treated as unavailable. */
  getSelectedStorageBackend?(): string;
}

/** Filesystem seam (default: node:fs). */
export interface FsPort {
  readFile(file: string): string | null;
  /** Create `file` exclusively (`wx`) with `mode`, write `data`, fsync, close. */
  writeExclusive(file: string, data: string, mode: number): void;
  rename(from: string, to: string): void;
  chmod(file: string, mode: number): void;
  /** Permission bits of `file`, or null when absent. */
  mode(file: string): number | null;
  unlink(file: string): void;
  mkdirp(dir: string): void;
}

export const nodeFsPort: FsPort = {
  readFile(file) {
    try {
      return fs.readFileSync(file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  },
  writeExclusive(file, data, mode) {
    const fd = fs.openSync(file, "wx", mode);
    try {
      fs.writeSync(fd, data);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  },
  rename: (from, to) => fs.renameSync(from, to),
  chmod: (file, mode) => fs.chmodSync(file, mode),
  mode(file) {
    try {
      return fs.statSync(file).mode & 0o777;
    } catch {
      return null;
    }
  },
  unlink(file) {
    try {
      fs.unlinkSync(file);
    } catch {
      /* best effort */
    }
  },
  mkdirp: (dir) => void fs.mkdirSync(dir, { recursive: true }),
};

export interface KeyringEntry {
  fingerprint: string;
  label: string;
  /** base64url SPKI of the pinned key (informational; identity is checked by fingerprint). */
  pinnedPubkey?: string;
  lastHosts: StoredHost[];
  /** Decrypted bearer (main-process memory only). */
  bearer: string | null;
  /** True when the bearer was written (encrypted) to disk — i.e. the window partition may persist. */
  remembered: boolean;
  needsPairing: boolean;
  pairedAt: string;
}

/** Renderer-safe projection (no bearer). */
export type KeyringEntryView = Omit<KeyringEntry, "bearer">;

interface DiskEntry {
  label: string;
  pinnedPubkey?: string;
  lastHosts: StoredHost[];
  bearer: { enc: "safeStorage"; data: string } | null;
  remembered: boolean;
  needsPairing: boolean;
  pairedAt: string;
}

interface DiskFile {
  version: number;
  servers: Record<string, DiskEntry>;
}

export interface KeyringOptions {
  /** Directory holding the keyring (the managed dir). */
  dir: string;
  crypto: CryptoPort;
  fs?: FsPort;
  /** Log sink for `[server-windows]` lines (short fingerprints only — never secrets). */
  log?: (line: string) => void;
  now?: () => number;
  platform?: NodeJS.Platform;
}

function isHostRef(v: unknown): v is StoredHost {
  const o = v as HostRef | null;
  return (
    !!o &&
    (o.scheme === "http" || o.scheme === "https") &&
    typeof o.host === "string" &&
    o.host.length > 0 &&
    Number.isInteger(o.port) &&
    o.port > 0 &&
    o.port < 65536
  );
}

export class ServerKeyring {
  private readonly entries = new Map<string, KeyringEntry>();
  private readonly listeners = new Set<() => void>();
  private readonly fsp: FsPort;
  private readonly log: (line: string) => void;
  private readonly now: () => number;
  private readonly file: string;
  private readonly opts: KeyringOptions;

  constructor(opts: KeyringOptions) {
    this.opts = opts;
    this.fsp = opts.fs ?? nodeFsPort;
    this.log = opts.log ?? ((l) => console.log(l));
    this.now = opts.now ?? Date.now;
    this.file = path.join(opts.dir, KEYRING_FILE);
  }

  /** True when the bearer may be written to disk (OS encryption present and not Linux `basic_text`). */
  canPersistBearer(): boolean {
    try {
      if (!this.opts.crypto.isEncryptionAvailable()) return false;
      return this.opts.crypto.getSelectedStorageBackend?.() !== "basic_text";
    } catch {
      return false;
    }
  }

  // ── load ────────────────────────────────────────────────────────────────────

  /** Read the file; never throws. Call once at startup. */
  load(): void {
    this.entries.clear();
    let raw: string | null;
    try {
      raw = this.fsp.readFile(this.file);
    } catch (e) {
      this.setAside(`unreadable (${(e as Error).message})`);
      return;
    }
    if (raw === null) return;
    this.tightenMode();
    const parsed = this.parse(raw);
    if (!parsed) return;
    for (const [fp, e] of Object.entries(parsed.servers)) {
      const entry = this.decodeEntry(fp, e);
      if (entry) this.entries.set(fp, entry);
    }
  }

  /** Tighten a broader mode (POSIX only; Windows relies on the profile ACL). */
  private tightenMode(): void {
    if ((this.opts.platform ?? process.platform) === "win32") return;
    const mode = this.fsp.mode(this.file);
    if (mode === null || (mode & 0o077) === 0) return;
    try {
      this.fsp.chmod(this.file, 0o600);
    } catch {
      /* best effort */
    }
  }

  /** Parse + version-check; sets the file aside (and returns null) when it is not usable. */
  private parse(raw: string): DiskFile | null {
    let parsed: DiskFile;
    try {
      parsed = JSON.parse(raw) as DiskFile;
    } catch {
      this.setAside("not valid JSON");
      return null;
    }
    if (!parsed || parsed.version !== KEYRING_VERSION || typeof parsed.servers !== "object" || parsed.servers === null) {
      this.setAside(`unsupported version ${String((parsed as { version?: unknown } | null)?.version)}`);
      return null;
    }
    return parsed;
  }

  /** Decrypt the stored bearer; an undecryptable or absent one leaves the entry needing pairing. */
  private decodeBearer(fp: string, e: DiskEntry): { bearer: string | null; needsPairing: boolean } {
    if (!(e.bearer && e.bearer.enc === "safeStorage" && typeof e.bearer.data === "string")) {
      // Not remembered (no OS encryption at pairing time): nothing to restore.
      return { bearer: null, needsPairing: true };
    }
    try {
      return { bearer: this.opts.crypto.decryptString(Buffer.from(e.bearer.data, "base64")), needsPairing: e.needsPairing === true };
    } catch {
      this.log(`[server-windows] keyring: bearer undecryptable fp=${shortFingerprint(fp)} — needs pairing`);
      return { bearer: null, needsPairing: true };
    }
  }

  private decodeEntry(fp: string, e: DiskEntry): KeyringEntry | null {
    if (!e || typeof e.label !== "string" || !Array.isArray(e.lastHosts)) return null;
    const { bearer, needsPairing } = this.decodeBearer(fp, e);
    return {
      fingerprint: fp,
      label: e.label,
      ...(typeof e.pinnedPubkey === "string" ? { pinnedPubkey: e.pinnedPubkey } : {}),
      lastHosts: e.lastHosts.filter(isHostRef).map(readHost).slice(0, LAST_HOSTS_CAP),
      bearer,
      remembered: e.remembered === true && bearer !== null,
      needsPairing,
      pairedAt: typeof e.pairedAt === "string" ? e.pairedAt : new Date(this.now()).toISOString(),
    };
  }

  private setAside(reason: string): void {
    const aside = path.join(this.opts.dir, `server-keyring.corrupt-${this.now()}.json`);
    try {
      this.fsp.rename(this.file, aside);
    } catch {
      /* nothing more we can do; start empty */
    }
    this.entries.clear();
    this.log(`[server-windows] keyring set aside: ${reason}; kept as ${path.basename(aside)}`);
  }

  // ── reads ───────────────────────────────────────────────────────────────────

  has(fp: string): boolean {
    return this.entries.has(fp);
  }

  get(fp: string): KeyringEntryView | undefined {
    const e = this.entries.get(fp);
    return e ? view(e) : undefined;
  }

  /** Main-process only. */
  bearerFor(fp: string): string | null {
    return this.entries.get(fp)?.bearer ?? null;
  }

  /** Renderer-safe list, sorted by label. */
  list(): KeyringEntryView[] {
    return Array.from(this.entries.values())
      .map(view)
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  /** Fingerprint of an entry that lists this host (for known-host checks). */
  findByHost(host: string, port: number): KeyringEntryView | undefined {
    for (const e of this.entries.values()) {
      if (e.lastHosts.some((h) => h.host === host && h.port === port)) return view(e);
    }
    return undefined;
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // ── writes ──────────────────────────────────────────────────────────────────

  /** Pairing approved: create/replace the entry. The pin is only set here (TOFU) or kept. */
  savePaired(input: {
    fingerprint: string;
    label: string;
    pinnedPubkey?: string;
    host: StoredHost;
    bearer: string;
  }): KeyringEntryView {
    const remembered = this.canPersistBearer();
    const existing = this.entries.get(input.fingerprint);
    const entry: KeyringEntry = {
      fingerprint: input.fingerprint,
      label: input.label,
      ...((input.pinnedPubkey ?? existing?.pinnedPubkey) ? { pinnedPubkey: input.pinnedPubkey ?? existing?.pinnedPubkey } : {}),
      lastHosts: mergeHost(existing?.lastHosts ?? [], input.host),
      bearer: input.bearer,
      remembered,
      needsPairing: false,
      pairedAt: new Date(this.now()).toISOString(),
    };
    this.entries.set(entry.fingerprint, entry);
    this.save();
    return view(entry);
  }

  /** Record a host proven to belong to `fp` (heal). Returns whether the list changed. */
  heal(fp: string, host: StoredHost): boolean {
    const e = this.entries.get(fp);
    if (!e) return false;
    const next = mergeHost(e.lastHosts, host);
    if (JSON.stringify(next) === JSON.stringify(e.lastHosts)) return false;
    e.lastHosts = next;
    this.log(`[server-windows] keyring heal fp=${shortFingerprint(fp)} host=${host.host}:${host.port}`);
    this.saveBestEffort();
    return true;
  }

  /**
   * Record routes delivered with a pairing result, already validated and proven to belong to
   * `fp` by the caller. Only `https` hosts, at most {@link MAX_DELIVERED_STORED}, kept in
   * delivery order (first delivered leads), source `pairing`; the 5-host cap then applies
   * (https first, most recent first). Returns how many were stored.
   */
  addDeliveredHosts(fp: string, hosts: HostRef[]): number {
    const e = this.entries.get(fp);
    if (!e) return 0;
    const kept = hosts.filter((h) => h.scheme === "https").slice(0, MAX_DELIVERED_STORED);
    // Reverse insertion: each lands at the front, so the first delivered ends up first.
    let next = e.lastHosts;
    for (const h of [...kept].reverse()) next = mergeHost(next, { scheme: h.scheme, host: h.host, port: h.port, source: "pairing" });
    e.lastHosts = next;
    if (kept.length > 0) this.saveBestEffort();
    return kept.length;
  }

  /** Credential refused/undecryptable: drop the bearer, keep pin/label/hosts. */
  markNeedsPairing(fp: string): void {
    const e = this.entries.get(fp);
    if (!e) return;
    e.bearer = null;
    e.needsPairing = true;
    e.remembered = false;
    this.saveBestEffort();
  }

  remove(fp: string): boolean {
    if (!this.entries.delete(fp)) return false;
    this.saveBestEffort();
    return true;
  }

  // ── persistence ─────────────────────────────────────────────────────────────

  /** Persist; a failure (read-only/full disk) is logged and the in-memory state stays authoritative for this run. */
  private saveBestEffort(): void {
    try {
      this.save();
    } catch (e) {
      this.log(`[server-windows] keyring write failed: ${(e as Error).message}`);
      for (const cb of this.listeners) cb();
    }
  }

  private save(): void {
    const servers: Record<string, DiskEntry> = {};
    for (const e of this.entries.values()) {
      let bearer: DiskEntry["bearer"] = null;
      if (e.bearer && e.remembered && this.canPersistBearer()) {
        bearer = { enc: "safeStorage", data: this.opts.crypto.encryptString(e.bearer).toString("base64") };
      }
      servers[e.fingerprint] = {
        label: e.label,
        ...(e.pinnedPubkey ? { pinnedPubkey: e.pinnedPubkey } : {}),
        lastHosts: e.lastHosts,
        bearer,
        remembered: bearer !== null,
        needsPairing: e.needsPairing,
        pairedAt: e.pairedAt,
      };
    }
    const body: DiskFile = { version: KEYRING_VERSION, servers };
    this.fsp.mkdirp(this.opts.dir);
    const tmp = `${this.file}.${process.pid}.${this.now()}.tmp`;
    try {
      this.fsp.writeExclusive(tmp, `${JSON.stringify(body, null, 2)}\n`, 0o600);
      this.fsp.rename(tmp, this.file);
    } catch (e) {
      this.fsp.unlink(tmp);
      throw e;
    }
    for (const cb of this.listeners) cb();
  }
}

function view(e: KeyringEntry): KeyringEntryView {
  const { bearer: _bearer, ...rest } = e;
  return { ...rest, lastHosts: e.lastHosts.map((h) => ({ ...h })) };
}

const sameRef = (a: HostRef, b: HostRef): boolean => a.scheme === b.scheme && a.host === b.host && a.port === b.port;

/** A host as read from disk: scheme/host/port, plus `source` only when it is a known value. */
function readHost(h: StoredHost): StoredHost {
  const source = ROUTE_SOURCES.includes(h.source as RouteSource) ? (h.source as RouteSource) : undefined;
  return { scheme: h.scheme, host: h.host, port: h.port, ...(source ? { source } : {}) };
}

/**
 * MRU merge: `host` becomes most recent, but never precedes an https host
 * (https hosts keep the front); capped at {@link LAST_HOSTS_CAP}. A host already
 * stored keeps its recorded source (re-learning it does not rewrite how it was learned).
 */
function mergeHost(existing: StoredHost[], host: StoredHost): StoredHost[] {
  const prev = existing.find((h) => sameRef(h, host));
  const entry = prev ?? host;
  const rest = existing.filter((h) => !sameRef(h, host));
  if (entry.scheme === "https") return [entry, ...rest].slice(0, LAST_HOSTS_CAP);
  const httpsLead = rest.findIndex((h) => h.scheme !== "https");
  const at = httpsLead === -1 ? rest.length : httpsLead;
  return [...rest.slice(0, at), entry, ...rest.slice(at)].slice(0, LAST_HOSTS_CAP);
}

/** Load a keyring (never throws). */
export function loadKeyring(opts: KeyringOptions): ServerKeyring {
  const k = new ServerKeyring(opts);
  k.load();
  return k;
}
