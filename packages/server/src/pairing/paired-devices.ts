/**
 * Paired-devices registry (D5) — long-lived opaque bearer tokens in a
 * revocable, on-disk registry at `~/.pi/dashboard/paired-devices.json` (0600).
 *
 * The bearer token is opaque (random, not a JWT): revocation is a row delete,
 * no denylist. Only a SHA-256 hash of the token is persisted; the plaintext is
 * returned once at issuance and never stored, so a leaked registry file cannot
 * be replayed. Auth compares the presented token's hash in constant time.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type DeviceStatusReply,
  MAX_COMPANIONS,
  shortKeyIdFromDigest,
  storedCompanionOrigin,
} from "@blackbelt-technology/pi-dashboard-shared/device-key-proof.js";
import {
  defaultTierForSource,
  isTier,
  TIERS,
  type Tier,
} from "@blackbelt-technology/pi-dashboard-shared/tiers.js";
import { TLS_ONLY_TOKEN_PREFIX, isTlsOnlyToken } from "@blackbelt-technology/pi-dashboard-shared/tls-only-token.js";
import { auditLine, auditPrefix } from "../auth/audit-log.js";
import { type BearerChannel, isProvenChannel } from "../auth/proven-tls.js";
import { readJsonFile, writeJsonFile } from "../persistence/json-store.js";

const REGISTRY_FILENAME = "paired-devices.json";
const REVOKED_FILENAME = "revoked-devices.json";
/** A revoked record is deleted for good once its age reaches this (age >= 90 d). See change: device-key-mutual-check (D6). */
export const REVOKED_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const TOKEN_BYTES = 32; // 256-bit opaque bearer.
// Throttle last-seen persistence: every authenticated request would otherwise
// rewrite the registry file (write amplification). Coarse last-seen is fine.
const LAST_SEEN_PERSIST_INTERVAL_MS = 60_000;

/** Browser-held bearer lifetime from issuance (matches the session cookie). */
const BROWSER_BEARER_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** Absolute lifetime of a browser-held row from original pairing (theft ceiling). */
const BROWSER_BEARER_CEILING_MS = 30 * 24 * 60 * 60 * 1000;
/** How long the immediately-previous bearer stays valid after a rotation. */
const ROTATION_GRACE_MS = 60_000;
/** Rotations allowed per device inside the sliding window. */
const ROTATE_LIMIT = 10;
const ROTATE_WINDOW_MS = 60_000;

/** A status-only key held by a device for another dashboard origin (never authenticates). */
export interface DeviceCompanion {
  /** Short stable id: `dk:` + 12 chars of SHA-256 over the raw key. */
  id: string;
  /** Raw Ed25519 public key, unpadded base64url. */
  pub: string;
  /** Claimed origin of the dashboard that asked; stored via `storedCompanionOrigin` (plain text). */
  origin: string;
  /** ISO timestamp. */
  createdAt: string;
}

export interface PairedDevice {
  /** Stable per-device id. */
  id: string;
  /** Human label (display only — never used for a trust decision). */
  label: string;
  /** SHA-256 hex of the bearer token. */
  tokenHash: string;
  /** ISO timestamp of pairing. */
  createdAt: string;
  /** ISO timestamp of most recent authenticated request, or null. */
  lastSeen: string | null;
  /** How the token was issued: the QR pairing ceremony, or direct operator
   * issuance via `POST /api/paired-devices`. Rows written before the field
   * existed read as `"pairing"` (E15). */
  source: "pairing" | "manual";
  /** Capability tier decided at mint (see change: expand-mcp-tiered-surface,
   * D1). Rows written before the field existed read as `"operate"` — they
   * were minted with full access and keep it. */
  tier: Tier;
  /**
   * Browser-held bearer expiry, epoch ms. Absent / null = non-expiring (every
   * legacy row, keyring/CLI/manual). A present value that is not a finite
   * number > 0 is malformed and fails closed (treated as expired).
   * See change: harden-auth-credentials (D5).
   */
  expiresAt?: number | null;
  /** Original pairing (or browser-conversion) time, epoch ms; anchors the 30 d ceiling. */
  pairedAt?: number;
  /** SHA-256 hex of the immediately previous bearer, valid until `previousExpiresAt`. */
  previousHash?: string;
  /** End of the previous bearer's grace: `min(rotation + 60 s, its own expiresAt)`, epoch ms. */
  previousExpiresAt?: number;
  /**
   * Bearer exposure record. Absent on rows written before it existed
   * (`history-unknown`). `plaintextSeenAt` is the first time the bearer was
   * presented or handed out off a proven channel; it is permanent (never cleared).
   * See change: prove-vault-bridge-tls (D4).
   */
  exposure?: { trackedSince: string; plaintextSeenAt?: string };
  /** Primary device key (one per row); absent until bound. See change: device-key-mutual-check (D3). */
  keys?: { pub: string; createdAt: string };
  /** Status-only companion keys, at most `MAX_COMPANIONS`. */
  companions?: DeviceCompanion[];
}

/** A revoked device held apart from the active registry (D6): the whole row plus who/when. */
export interface RevokedDevice extends PairedDevice {
  /** Epoch ms of revocation (anchors the 90-day retention). */
  revokedAt: number;
  /** Display-only short actor string (`session:<sub8>` or `local`). */
  revokedBy: string;
}

/** What the vault trust gate may do with a device. See change: prove-vault-bridge-tls (D4). */
export type DeviceTrust = "eligible" | "inactive" | "exposed" | "history-unknown";

/** Why an `add` was refused (no row is created). */
export const BRIDGE_TOKEN_REQUIRES_HTTPS = "bridge_token_requires_https";

export interface AddOptions {
  /** Primary device key to bind to the new row; dropped silently when empty or already held anywhere. */
  key?: string;
  /** Companions to store with the new row; invalid/duplicate/over-cap ones are dropped silently. */
  companions?: { pub: string; origin: string }[];
  /** The channel that DELIVERS the token. Absent = no exposure decision (QR `approve()`, collected later by `markDelivered`). */
  channel?: BearerChannel;
  /** `"bridge"` mints a TLS-only `pi_tls_` token and requires a proven channel. */
  purpose?: "bridge";
}

/** Outcome of resolving a presented bearer against the in-memory registry. */
export type BearerVerdict =
  | { status: "ok"; id: string; tier: Tier; superseded: boolean }
  | { status: "expired"; id: string }
  /** A `pi_tls_` bearer presented off a proven channel: marked exposed, then refused. */
  | { status: "tls_only_refused"; id: string }
  | { status: "invalid" };

export type RotateResult =
  | { ok: true; id: string; token: string; expiresAt: number }
  | {
      ok: false;
      reason:
        | "invalid"
        | "expired"
        | "superseded"
        | "holder_declaration_required"
        | "rate_limited"
        | "persist_failed"
        | "tls_only_untrusted_channel";
      /** Device id when the bearer resolved to a row (for audit). */
      id?: string;
      retryAfterS?: number;
    };

/** Finite number > 0 (the only valid shape for `expiresAt` / `pairedAt`). */
function isValidMs(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/** True while a row's previous bearer (rotation grace) is still honoured. Shared by `resolve` and the device-key check. */
function previousGraceLive(d: PairedDevice, now: number): boolean {
  return typeof d.previousHash === "string" && isValidMs(d.previousExpiresAt) && now < d.previousExpiresAt;
}

function newCompanion(pub: string, origin: string, createdAt: string): DeviceCompanion {
  return { id: keyIdOf(pub), pub, origin: storedCompanionOrigin(origin), createdAt };
}

/** Minimum shape of a persisted revoked record; anything else sets the whole file aside. */
function isRevokedShape(v: unknown): v is RevokedDevice {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.tokenHash === "string" &&
    typeof o.createdAt === "string" &&
    isValidMs(o.revokedAt) &&
    typeof o.revokedBy === "string"
  );
}

/** Public view of a device (no token material) for Settings / listing. */
export interface PairedDeviceView {
  id: string;
  label: string;
  createdAt: string;
  lastSeen: string | null;
  source: "pairing" | "manual";
  tier: Tier;
  /** Short id of the primary key (`dk:` + 12), absent while no key is bound. */
  keyId?: string;
  /** Companions (id + origin + createdAt, never the key). Absent when none. */
  companions?: { id: string; origin: string; createdAt: string }[];
}

/** A revoked device for the operator list (no token material). */
export interface RevokedDeviceView extends PairedDeviceView {
  revokedAt: number;
  revokedBy: string;
}

export type BindKeyResult = "bound" | "replaced" | "held" | "no-device";
export type AddCompanionResult = "added" | "cap" | "held" | "no-device";
export type RestoreResult = "restored" | "not-found" | "active";
export type DeleteRevokedResult = "deleted" | "not-found" | "active";

/** Where a public key lives. Active rows are searched before revoked ones. */
export interface KeyLookup {
  device: PairedDevice;
  kind: "primary" | "companion";
  state: "active" | "revoked";
  companion?: DeviceCompanion;
}

export function defaultRegistryPath(): string {
  return path.join(os.homedir(), ".pi", "dashboard", REGISTRY_FILENAME);
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** Short key id `dk:` + 12 chars; sync twin of the client's `shortKeyId`. */
export function keyIdOf(pub: string): string {
  return shortKeyIdFromDigest(crypto.createHash("sha256").update(Buffer.from(pub, "base64url")).digest());
}

/** Constant-time compare of two equal-length hex digests. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export class PairedDeviceRegistry {
  private readonly filePath: string;
  private devices: PairedDevice[];
  /** Per-device epoch ms of the last last-seen DISK write (in-memory only). */
  private lastPersistedAt = new Map<string, number>();
  /** Per-device epoch ms of recent successful rotations (sliding limiter; in-memory only). */
  private rotations = new Map<string, number[]>();
  /** Device ids whose first-exposure mark has not reached the disk yet (in memory only). */
  private pendingExposure = new Set<string>();
  private listeners: Array<() => void> = [];
  private readonly revokedPath: string;
  private revoked: RevokedDevice[] = [];
  /** Set when the revoked file could not be read at start; surfaced by `listRevoked`. */
  private revokedUnreadable = false;
  private revokedListeners: Array<(id: string) => void> = [];

  constructor(filePath = defaultRegistryPath()) {
    this.filePath = filePath;
    this.revokedPath = path.join(path.dirname(filePath), REVOKED_FILENAME);
    // Loader default, not a migration script (D4): a row written before
    // `source`/`tier` existed reads as `"pairing"` / `"operate"`, and the next
    // write back normalises it in place.
    this.devices = readJsonFile<PairedDevice[]>(filePath, []).map((d) => ({
      ...d,
      source: d.source === "manual" ? "manual" : "pairing",
      tier: isTier(d.tier) ? d.tier : "operate",
    }));
    this.revoked = this.loadRevoked();
    // An id in both files: the revoked record is the truth (crash between the two revoke/restore writes).
    const held = new Set(this.revoked.map((r) => r.id));
    if (this.devices.some((d) => held.has(d.id))) {
      this.devices = this.devices.filter((d) => !held.has(d.id));
      try {
        this.persist();
      } catch (err) {
        console.error(`[pairing] registry rewrite after revoked-wins failed: ${(err as Error)?.name ?? "error"}`);
      }
    }
    this.purgeExpired();
  }

  /** Read the revoked store. Unparseable or wrong-shape → set aside, error logged, empty + warning. */
  private loadRevoked(): RevokedDevice[] {
    let raw: string;
    try {
      if (!fs.existsSync(this.revokedPath)) return [];
      raw = fs.readFileSync(this.revokedPath, "utf-8");
    } catch {
      return this.quarantineRevoked();
    }
    if (!raw.trim()) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed) || !parsed.every(isRevokedShape)) return this.quarantineRevoked();
      return parsed.map((d) => ({
        ...d,
        source: d.source === "manual" ? "manual" : "pairing",
        tier: isTier(d.tier) ? d.tier : "operate",
      }));
    } catch {
      return this.quarantineRevoked();
    }
  }

  private quarantineRevoked(): RevokedDevice[] {
    this.revokedUnreadable = true;
    const aside = path.join(path.dirname(this.revokedPath), `revoked-devices.corrupt-${Date.now()}.json`);
    try {
      fs.renameSync(this.revokedPath, aside);
    } catch {
      /* best-effort: the list starts empty either way */
    }
    console.error(`[pairing] revoked-devices store unreadable; set aside as ${path.basename(aside)}, starting with an empty revoked list`);
    return [];
  }

  private persistRevoked(list: RevokedDevice[] = this.revoked): void {
    writeJsonFile(this.revokedPath, list, { mode: 0o600 });
  }

  private persist(): void {
    writeJsonFile(this.filePath, this.devices);
    // Every row (incl. any pending exposure mark) is on disk now.
    this.pendingExposure.clear();
    // Enforce 0600 (json-store writes with default umask).
    try {
      fs.chmodSync(this.filePath, 0o600);
    } catch {
      /* best-effort; chmod is a no-op / may throw on some FS (e.g. Windows) */
    }
  }

  /** Subscribe to registry changes: add, revoke, rotation and a first exposure. Returns an unsubscribe. */
  onChange(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  /** Subscribe to revocations: fires with the device id after a successful `revoke`. Returns an unsubscribe. */
  onRevoked(listener: (id: string) => void): () => void {
    this.revokedListeners.push(listener);
    return () => {
      this.revokedListeners = this.revokedListeners.filter((l) => l !== listener);
    };
  }

  private emitRevoked(id: string): void {
    for (const l of [...this.revokedListeners]) {
      try {
        l(id);
      } catch {
        /* a listener fault never reaches the registry */
      }
    }
  }

  private emitChange(): void {
    for (const l of [...this.listeners]) {
      try {
        l();
      } catch {
        /* a listener fault never reaches the registry */
      }
    }
  }

  /** True while a first-exposure write has not reached the disk (the hub cannot prove its record is durable). */
  exposurePending(): boolean {
    return this.pendingExposure.size > 0;
  }

  /**
   * Record the first off-channel use of a tracked row's bearer. The in-memory mark is set BEFORE the
   * write and stays when the write fails (fail closed while running); the next successful persist
   * clears the pending state. Written once per row. Legacy rows (no `exposure`) are already
   * `history-unknown` and are left alone.
   */
  private markExposed(row: PairedDevice, channel: BearerChannel): void {
    if (isProvenChannel(channel) || !row.exposure || row.exposure.plaintextSeenAt) return;
    row.exposure.plaintextSeenAt = new Date().toISOString();
    this.pendingExposure.add(row.id);
    auditLine("pairing", "bearer-exposed", { id: auditPrefix(row.id), channel });
    try {
      this.persist();
    } catch (err) {
      console.error(`[pairing] exposure write failed id=${auditPrefix(row.id)}: ${(err as Error)?.name ?? "error"}`);
    }
    this.emitChange();
  }

  /** Mark a collected token's delivery channel (QR/knock `poll()`); no re-mint, holder and expiry unchanged. */
  markDelivered(id: string, channel: BearerChannel): void {
    const row = this.devices.find((d) => d.id === id);
    if (row) this.markExposed(row, channel);
  }

  /** Is `token` any bearer this registry knows (current, or previous within its grace)? No side effects. */
  isKnownBearer(token: string | undefined | null): boolean {
    return !!token && this.resolve(token, Date.now()).status !== "invalid";
  }

  /** Ids of devices that are not expired now (revoked rows are gone). Feeds the expiry sweep. */
  activeIds(): Set<string> {
    const now = Date.now();
    return new Set(this.devices.filter((d) => this.currentVerdict(d, now).status === "ok").map((d) => d.id));
  }

  /** The vault's view of a device: active + tracked + never off a proven channel → `eligible`. */
  deviceTrust(id: string | undefined): DeviceTrust {
    const row = id ? this.devices.find((d) => d.id === id) : undefined;
    if (!row || this.currentVerdict(row, Date.now()).status !== "ok") return "inactive";
    if (!row.exposure) return "history-unknown";
    return row.exposure.plaintextSeenAt ? "exposed" : "eligible";
  }

  /**
   * Register a new device, returning the plaintext bearer token (shown once).
   * The token is never persisted in plaintext.
   *
   * @param source issuance path: `"pairing"` (QR ceremony, the default so the
   *   existing caller needs no edit) or `"manual"` (direct operator mint).
   * @param tier capability tier. Defaults by source: `pairing` → `operate`,
   *   `manual` → `observe` (D1). An explicit value must be a valid `Tier`;
   *   `add` throws BEFORE minting or persisting otherwise, so a bad tier leaves
   *   the registry byte-identical (E3).
   * @param holder `"browser"` (the only declaration that counts) issues an
   *   expiring row: `expiresAt = now + 7 d`, `pairedAt = now`. Anything else
   *   leaves the row non-expiring, byte-identical to a pre-change row.
   */
  add(
    label: string,
    source: "pairing" | "manual" = "pairing",
    tier?: Tier,
    holder?: unknown,
    opts: AddOptions = {},
  ): { device: PairedDeviceView; token: string; expiresAt?: number; keyBound?: boolean; companionsAdded?: number } {
    if (tier !== undefined && !isTier(tier)) {
      throw new Error(`invalid tier: ${String(tier)} (expected one of ${TIERS.join(", ")})`);
    }
    const bridge = opts.purpose === "bridge";
    if (bridge && !(opts.channel && isProvenChannel(opts.channel))) throw new Error(BRIDGE_TOKEN_REQUIRES_HTTPS);
    const resolvedTier: Tier = bridge ? "operate" : (tier ?? defaultTierForSource(source));
    const token = (bridge ? TLS_ONLY_TOKEN_PREFIX : "") + crypto.randomBytes(TOKEN_BYTES).toString("base64url");
    const createdAt = new Date().toISOString();
    const device: PairedDevice = {
      id: crypto.randomUUID(),
      label: label.trim() || "device",
      tokenHash: hashToken(token),
      createdAt,
      lastSeen: null,
      source,
      tier: resolvedTier,
      exposure: { trackedSince: createdAt },
    };
    // Issued over a non-proven channel: the row is born exposed (the bearer travelled in the clear).
    if (opts.channel && !isProvenChannel(opts.channel)) {
      device.exposure = { trackedSince: createdAt, plaintextSeenAt: createdAt };
      auditLine("pairing", "bearer-exposed", { id: auditPrefix(device.id), channel: opts.channel });
    }
    if (holder === "browser") {
      const now = Date.now();
      device.pairedAt = now;
      device.expiresAt = now + BROWSER_BEARER_TTL_MS;
    }
    // Device key / companions (D3): a key held anywhere, or an invalid/over-cap companion, is dropped silently.
    const wantKey = typeof opts.key === "string" && opts.key !== "";
    if (wantKey && !this.keyOwner(opts.key as string)) device.keys = { pub: opts.key as string, createdAt };
    for (const c of opts.companions ?? []) {
      if ((device.companions?.length ?? 0) >= MAX_COMPANIONS) break;
      if (typeof c?.pub !== "string" || c.pub === "" || typeof c.origin !== "string") continue;
      if (this.keyOwner(c.pub) || device.keys?.pub === c.pub || device.companions?.some((x) => x.pub === c.pub)) continue;
      (device.companions ??= []).push(newCompanion(c.pub, c.origin, createdAt));
    }
    this.devices.push(device);
    this.persist();
    this.emitChange();
    return {
      device: this.toView(device),
      token,
      ...(wantKey ? { keyBound: !!device.keys } : {}),
      ...(opts.companions ? { companionsAdded: device.companions?.length ?? 0 } : {}),
      ...(device.expiresAt !== undefined ? { expiresAt: device.expiresAt as number } : {}),
    };
  }

  /**
   * Pairing-poll declaration: when `declared` and the row is not yet expiring,
   * convert it (the token has not been handed out yet, so only the expiry
   * changes). Returns the row's valid `expiresAt` for the poll response, or
   * undefined for a non-expiring / unknown row.
   */
  browserExpiryFor(id: string, declared: boolean): number | undefined {
    const d = this.devices.find((x) => x.id === id);
    if (!d) return undefined;
    if (declared && (d.expiresAt === undefined || d.expiresAt === null)) {
      const now = Date.now();
      d.pairedAt = now;
      d.expiresAt = now + BROWSER_BEARER_TTL_MS;
      try {
        this.persist();
      } catch {
        delete d.pairedAt;
        delete d.expiresAt;
        return undefined;
      }
    }
    return isValidMs(d.expiresAt) ? d.expiresAt : undefined;
  }

  /**
   * Judge a presented bearer against IN-MEMORY state only (no file IO). The
   * current hash is `ok` unless the row expires (`now >= min(expiresAt,
   * pairedAt + 30 d)`, malformed expiry fields fail closed as `expired`); the
   * immediately previous hash is `ok` + `superseded` until `previousExpiresAt`,
   * after which it is plain `invalid` (indistinguishable from a never-issued
   * bearer). Constant-time hash comparison.
   */
  private resolve(token: string, now: number): (Exclude<BearerVerdict, { status: "tls_only_refused" }> & { row?: PairedDevice }) {
    const presented = hashToken(token);
    for (const d of this.devices) {
      if (timingSafeEqualHex(presented, d.tokenHash)) {
        return this.currentVerdict(d, now);
      }
      if (typeof d.previousHash === "string" && timingSafeEqualHex(presented, d.previousHash)) {
        if (previousGraceLive(d, now)) {
          return { status: "ok", id: d.id, tier: d.tier, superseded: true, row: d };
        }
        return { status: "invalid" };
      }
    }
    return { status: "invalid" };
  }

  private currentVerdict(d: PairedDevice, now: number): Exclude<BearerVerdict, { status: "tls_only_refused" }> & { row?: PairedDevice } {
    if (d.expiresAt !== undefined && d.expiresAt !== null) {
      let ceiling: number;
      if (d.pairedAt !== undefined && d.pairedAt !== null) {
        if (!isValidMs(d.pairedAt)) return { status: "expired", id: d.id };
        ceiling = d.pairedAt + BROWSER_BEARER_CEILING_MS;
      } else {
        ceiling = Date.parse(d.createdAt) + BROWSER_BEARER_CEILING_MS;
      }
      if (!isValidMs(d.expiresAt) || Number.isNaN(ceiling) || now >= Math.min(d.expiresAt, ceiling)) {
        return { status: "expired", id: d.id };
      }
    }
    return { status: "ok", id: d.id, tier: d.tier, superseded: false, row: d };
  }

  /**
   * Verify a presented bearer token, distinguishing an expired browser bearer
   * from an unknown one. On success updates last-seen (current hash only) and
   * returns the verdict. The tier is read from the row on EVERY call (no
   * caching), so a tier change takes effect on the next request.
   */
  verifyDetailed(token: string | undefined | null, channel: BearerChannel): BearerVerdict {
    if (!token) return { status: "invalid" };
    const now = Date.now();
    const v = this.resolve(token, now);
    if (v.status === "invalid") return v;
    // Any resolving row (ok, superseded, expired) presented off a proven channel is marked exposed, in memory first.
    const row = this.devices.find((x) => x.id === v.id);
    if (row) this.markExposed(row, channel ?? "plain");
    // A TLS-only bearer is never honoured off a proven channel (the hub cannot tell a relayed request from a sniffed one).
    if (isTlsOnlyToken(token) && !isProvenChannel(channel ?? "plain")) return { status: "tls_only_refused", id: v.id };
    if (v.status !== "ok") return { status: "expired", id: v.id };
    const d = v.row as PairedDevice;
    if (!v.superseded) {
      // Update last-seen in memory always; persist to disk at most once per
      // interval. Compare against the last DISK-WRITE time (not the previous
      // request time), else an always-active device would never re-persist.
      d.lastSeen = new Date(now).toISOString();
      const lastWrite = this.lastPersistedAt.get(d.id) ?? 0;
      if (now - lastWrite >= LAST_SEEN_PERSIST_INTERVAL_MS) {
        this.lastPersistedAt.set(d.id, now);
        try {
          this.persist();
        } catch {
          /* last-seen is best-effort: a persist fault must never reject a valid bearer */
        }
      }
    }
    return { status: "ok", id: v.id, tier: v.tier, superseded: v.superseded };
  }

  /** `{id, tier}` for a valid bearer (expired / unknown → null). */
  verify(token: string | undefined | null, channel: BearerChannel): { id: string; tier: Tier } | null {
    const v = this.verifyDetailed(token, channel);
    return v.status === "ok" ? { id: v.id, tier: v.tier } : null;
  }

  /**
   * Rotate the bearer that `token` identifies (the bearer rotates ITS OWN row;
   * callers pass nothing else). Synchronous end to end, so two same-tick
   * rotations with one bearer serialise: the second sees a superseded bearer.
   *
   * New `expiresAt = min(now + 7 d, pairedAt + 30 d)`. A non-expiring row
   * converts only with `declaredBrowser` (30 d then counts from conversion).
   * Persist failure → in-memory state restored, `persist_failed`.
   */
  rotate(token: string, declaredBrowser: boolean, opts: { channel: BearerChannel } = { channel: "plain" }): RotateResult {
    const now = Date.now();
    const v = this.resolve(token, now);
    if (v.status === "invalid") return { ok: false, reason: "invalid" };
    // The exposure mark is persisted on its own, BEFORE the rotation mutates anything, and a failed
    // rotation never reverts it.
    const marked = this.devices.find((x) => x.id === v.id);
    if (marked) this.markExposed(marked, opts.channel);
    if (isTlsOnlyToken(token) && !isProvenChannel(opts.channel)) return { ok: false, reason: "tls_only_untrusted_channel", id: v.id };
    if (v.status === "expired") return { ok: false, reason: "expired", id: v.id };
    if (v.superseded) return { ok: false, reason: "superseded", id: v.id };
    const row = v.row as PairedDevice;
    const expiring = row.expiresAt !== undefined && row.expiresAt !== null;
    if (!expiring && !declaredBrowser) {
      return { ok: false, reason: "holder_declaration_required", id: row.id };
    }
    const recent = (this.rotations.get(row.id) ?? []).filter((t) => t > now - ROTATE_WINDOW_MS);
    if (recent.length >= ROTATE_LIMIT) {
      return {
        ok: false,
        reason: "rate_limited",
        id: row.id,
        retryAfterS: Math.max(1, Math.ceil((recent[0] + ROTATE_WINDOW_MS - now) / 1000)),
      };
    }
    const pairedAt = expiring ? (isValidMs(row.pairedAt) ? row.pairedAt : Date.parse(row.createdAt)) : now;
    const expiresAt = Math.min(now + BROWSER_BEARER_TTL_MS, pairedAt + BROWSER_BEARER_CEILING_MS);
    const before = { ...row };
    // The new token keeps the old token's form.
    const newToken = (isTlsOnlyToken(token) ? TLS_ONLY_TOKEN_PREFIX : "") + crypto.randomBytes(TOKEN_BYTES).toString("base64url");
    row.previousHash = row.tokenHash;
    row.previousExpiresAt = Math.min(now + ROTATION_GRACE_MS, isValidMs(row.expiresAt) ? row.expiresAt : Number.POSITIVE_INFINITY);
    row.tokenHash = hashToken(newToken);
    row.pairedAt = pairedAt;
    row.expiresAt = expiresAt;
    try {
      this.persist();
    } catch {
      const i = this.devices.indexOf(row);
      if (i >= 0) this.devices[i] = before;
      return { ok: false, reason: "persist_failed", id: row.id };
    }
    recent.push(now);
    this.rotations.set(row.id, recent);
    this.emitChange();
    return { ok: true, id: row.id, token: newToken, expiresAt };
  }

  /**
   * Revoke = hold (D6): write the whole row + `revokedAt`/`revokedBy` to `revoked-devices.json` FIRST,
   * then drop it from the active registry. Unknown or already-revoked id → false (route: 404), nothing
   * changes. A failed first write throws and the device stays active; a failed second write is logged
   * only (the revoked record wins at next start and in memory the row is already gone).
   */
  revoke(id: string, by = "local"): boolean {
    const row = this.devices.find((d) => d.id === id);
    if (!row) return false;
    const rec: RevokedDevice = { ...row, revokedAt: Date.now(), revokedBy: auditPrefix(by, 40) || "local" };
    const next = [...this.revoked.filter((r) => r.id !== id), rec];
    this.persistRevoked(next);
    this.revoked = next;
    this.devices = this.devices.filter((d) => d !== row);
    this.rotations.delete(id);
    this.pendingExposure.delete(id);
    try {
      this.persist();
    } catch (err) {
      console.error(`[pairing] registry rewrite after revoke failed id=${auditPrefix(id)}: ${(err as Error)?.name ?? "error"}`);
    }
    this.emitChange();
    this.emitRevoked(id);
    return true;
  }

  /**
   * Undo a revoke: active file first, then drop the revoked record. Returns the row exactly as held
   * (never extends expiry or restarts a grace window); `"active"` = id is currently active (409),
   * `"not-found"` = not in the revoked store (404).
   */
  restore(id: string): RestoreResult {
    this.purgeExpired();
    if (this.devices.some((d) => d.id === id)) return "active";
    const rec = this.revoked.find((r) => r.id === id);
    if (!rec) return "not-found";
    const row: Record<string, unknown> = { ...rec };
    delete row.revokedAt;
    delete row.revokedBy;
    this.devices.push({
      ...(row as unknown as PairedDevice),
      source: rec.source === "manual" ? "manual" : "pairing",
      tier: isTier(rec.tier) ? rec.tier : "operate",
    });
    try {
      this.persist();
    } catch (err) {
      this.devices.pop();
      throw err;
    }
    this.revoked = this.revoked.filter((r) => r.id !== id);
    try {
      this.persistRevoked();
    } catch (err) {
      // Both files now name the id; the revoked record wins at next start and the operator restores again.
      console.error(`[pairing] revoked store rewrite after restore failed id=${auditPrefix(id)}: ${(err as Error)?.name ?? "error"}`);
    }
    this.emitChange();
    return "restored";
  }

  /** Delete-now: drop a revoked record for good. Same codes as `restore`. */
  deleteRevoked(id: string): DeleteRevokedResult {
    this.purgeExpired();
    if (this.devices.some((d) => d.id === id)) return "active";
    if (!this.revoked.some((r) => r.id === id)) return "not-found";
    const next = this.revoked.filter((r) => r.id !== id);
    this.persistRevoked(next);
    this.revoked = next;
    return "deleted";
  }

  /** Revoked devices (after a purge pass) for the operator list, plus `warning` when the store was unreadable. */
  listRevoked(): { devices: RevokedDeviceView[]; warning?: "unreadable" } {
    this.purgeExpired();
    return {
      devices: this.revoked.map((r) => ({ ...this.toView(r), revokedAt: r.revokedAt, revokedBy: r.revokedBy })),
      ...(this.revokedUnreadable ? { warning: "unreadable" as const } : {}),
    };
  }

  /** Delete revoked records aged >= `REVOKED_RETENTION_MS`; one `purged` audit line each. Returns how many. */
  purgeExpired(): number {
    const now = Date.now();
    const gone = this.revoked.filter((r) => now - r.revokedAt >= REVOKED_RETENTION_MS);
    if (gone.length === 0) return 0;
    this.revoked = this.revoked.filter((r) => !gone.includes(r));
    try {
      this.persistRevoked();
    } catch (err) {
      console.error(`[pairing] revoked store rewrite after purge failed: ${(err as Error)?.name ?? "error"}`);
    }
    for (const r of gone) auditLine("pairing", "purged", { id: auditPrefix(r.id) });
    return gone.length;
  }

  // ── Device keys (D3, D5) ─────────────────────────────────────────

  /** Active rows first (primary, then companions), then revoked ones. Pure scan; no purge. */
  private scanKey(pub: string): KeyLookup | null {
    for (const [rows, state] of [[this.devices, "active"], [this.revoked, "revoked"]] as const) {
      for (const d of rows) {
        if (d.keys?.pub === pub) return { device: d, kind: "primary", state };
        const companion = (Array.isArray(d.companions) ? d.companions : []).find((c) => c.pub === pub);
        if (companion) return { device: d, kind: "companion", state, companion };
      }
    }
    return null;
  }

  private keyOwner(pub: string): KeyLookup | null {
    this.purgeExpired();
    return this.scanKey(pub);
  }

  /** Which device holds `pub`, as primary or companion, active before revoked. */
  lookupKey(pub: string): KeyLookup | null {
    return typeof pub === "string" && pub !== "" ? this.keyOwner(pub) : null;
  }

  /** Is `pub` held by any active or revoked row (primary or companion)? */
  isKeyHeld(pub: string): boolean {
    return this.lookupKey(pub) !== null;
  }

  /** Apply `fn` to an active row and persist; a failed write restores the row and rethrows. */
  private mutateRow(row: PairedDevice, fn: (r: PairedDevice) => void): void {
    const before = structuredClone(row);
    fn(row);
    try {
      this.persist();
    } catch (err) {
      const i = this.devices.indexOf(row);
      if (i >= 0) this.devices[i] = before;
      throw err;
    }
    this.emitChange();
  }

  /**
   * Bind (or replace) the primary key of an ACTIVE device. `held` = the key belongs to another row or
   * is a companion (active or revoked); re-binding the same key is an idempotent `bound`.
   */
  bindKey(deviceId: string, pub: string): BindKeyResult {
    const row = this.devices.find((d) => d.id === deviceId);
    if (!row) return "no-device";
    const owner = this.keyOwner(pub);
    if (owner && !(owner.device.id === deviceId && owner.kind === "primary")) return "held";
    if (row.keys?.pub === pub) return "bound";
    const replaced = !!row.keys;
    this.mutateRow(row, (r) => {
      r.keys = { pub, createdAt: new Date().toISOString() };
    });
    return replaced ? "replaced" : "bound";
  }

  /** Add a status-only companion to an active device (cap `MAX_COMPANIONS`, key unique everywhere). */
  addCompanion(deviceId: string, c: { pub: string; origin: string }): AddCompanionResult {
    const row = this.devices.find((d) => d.id === deviceId);
    if (!row) return "no-device";
    if (this.keyOwner(c.pub)) return "held";
    if ((row.companions?.length ?? 0) >= MAX_COMPANIONS) return "cap";
    this.mutateRow(row, (r) => {
      (r.companions ??= []).push(newCompanion(c.pub, c.origin, new Date().toISOString()));
    });
    return "added";
  }

  /** Remove one companion of an active device by id. True if one was removed. */
  removeCompanion(deviceId: string, companionId: string): boolean {
    const row = this.devices.find((d) => d.id === deviceId);
    if (!row?.companions?.some((c) => c.id === companionId)) return false;
    this.mutateRow(row, (r) => {
      r.companions = (r.companions ?? []).filter((c) => c.id !== companionId);
    });
    return true;
  }

  /**
   * Answer for a VERIFIED key (the caller checked the signature). `revoked` wins; `expired` uses the
   * same per-row judgement as `verifyDetailed` (`currentVerdict` + the previous-bearer grace), so the
   * check says `expired` exactly when the bearer is refused `bearer_expired`. Companions get
   * `status-only` with no tier; `expired`/`revoked`/`unknown` carry no tier or scope.
   */
  deviceKeyStatus(pub: string): DeviceStatusReply {
    const hit = this.lookupKey(pub);
    if (!hit) return { status: "unknown" };
    if (hit.state === "revoked") return { status: "revoked" };
    const now = Date.now();
    if (this.currentVerdict(hit.device, now).status !== "ok" && !previousGraceLive(hit.device, now)) {
      return { status: "expired" };
    }
    return hit.kind === "companion"
      ? { status: "paired", scope: "status-only" }
      : { status: "paired", scope: "full", tier: hit.device.tier };
  }

  list(): PairedDeviceView[] {
    return this.devices.map((d) => this.toView(d));
  }

  private toView(d: PairedDevice): PairedDeviceView {
    return {
      id: d.id,
      label: d.label,
      createdAt: d.createdAt,
      lastSeen: d.lastSeen,
      source: d.source,
      tier: d.tier,
      ...(d.keys?.pub ? { keyId: keyIdOf(d.keys.pub) } : {}),
      ...(Array.isArray(d.companions) && d.companions.length > 0
        ? { companions: d.companions.map((c) => ({ id: c.id, origin: c.origin, createdAt: c.createdAt })) }
        : {}),
    };
  }
}
