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
  defaultTierForSource,
  isTier,
  TIERS,
  type Tier,
} from "@blackbelt-technology/pi-dashboard-shared/tiers.js";
import { readJsonFile, writeJsonFile } from "../persistence/json-store.js";

const REGISTRY_FILENAME = "paired-devices.json";
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
}

/** Outcome of resolving a presented bearer against the in-memory registry. */
export type BearerVerdict =
  | { status: "ok"; id: string; tier: Tier; superseded: boolean }
  | { status: "expired"; id: string }
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
        | "persist_failed";
      /** Device id when the bearer resolved to a row (for audit). */
      id?: string;
      retryAfterS?: number;
    };

/** Finite number > 0 (the only valid shape for `expiresAt` / `pairedAt`). */
function isValidMs(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/** Public view of a device (no token material) for Settings / listing. */
export interface PairedDeviceView {
  id: string;
  label: string;
  createdAt: string;
  lastSeen: string | null;
  source: "pairing" | "manual";
  tier: Tier;
}

export function defaultRegistryPath(): string {
  return path.join(os.homedir(), ".pi", "dashboard", REGISTRY_FILENAME);
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
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

  constructor(filePath = defaultRegistryPath()) {
    this.filePath = filePath;
    // Loader default, not a migration script (D4): a row written before
    // `source`/`tier` existed reads as `"pairing"` / `"operate"`, and the next
    // write back normalises it in place.
    this.devices = readJsonFile<PairedDevice[]>(filePath, []).map((d) => ({
      ...d,
      source: d.source === "manual" ? "manual" : "pairing",
      tier: isTier(d.tier) ? d.tier : "operate",
    }));
  }

  private persist(): void {
    writeJsonFile(this.filePath, this.devices);
    // Enforce 0600 (json-store writes with default umask).
    try {
      fs.chmodSync(this.filePath, 0o600);
    } catch {
      /* best-effort; chmod is a no-op / may throw on some FS (e.g. Windows) */
    }
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
  ): { device: PairedDeviceView; token: string; expiresAt?: number } {
    if (tier !== undefined && !isTier(tier)) {
      throw new Error(`invalid tier: ${String(tier)} (expected one of ${TIERS.join(", ")})`);
    }
    const resolvedTier: Tier = tier ?? defaultTierForSource(source);
    const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
    const device: PairedDevice = {
      id: crypto.randomUUID(),
      label: label.trim() || "device",
      tokenHash: hashToken(token),
      createdAt: new Date().toISOString(),
      lastSeen: null,
      source,
      tier: resolvedTier,
    };
    if (holder === "browser") {
      const now = Date.now();
      device.pairedAt = now;
      device.expiresAt = now + BROWSER_BEARER_TTL_MS;
    }
    this.devices.push(device);
    this.persist();
    return {
      device: this.toView(device),
      token,
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
  private resolve(token: string, now: number): (BearerVerdict & { row?: PairedDevice }) {
    const presented = hashToken(token);
    for (const d of this.devices) {
      if (timingSafeEqualHex(presented, d.tokenHash)) {
        return this.currentVerdict(d, now);
      }
      if (typeof d.previousHash === "string" && timingSafeEqualHex(presented, d.previousHash)) {
        if (isValidMs(d.previousExpiresAt) && now < d.previousExpiresAt) {
          return { status: "ok", id: d.id, tier: d.tier, superseded: true, row: d };
        }
        return { status: "invalid" };
      }
    }
    return { status: "invalid" };
  }

  private currentVerdict(d: PairedDevice, now: number): BearerVerdict & { row?: PairedDevice } {
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
  verifyDetailed(token: string | undefined | null): BearerVerdict {
    if (!token) return { status: "invalid" };
    const now = Date.now();
    const v = this.resolve(token, now);
    if (v.status !== "ok") return v.status === "expired" ? { status: "expired", id: v.id } : v;
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
  verify(token: string | undefined | null): { id: string; tier: Tier } | null {
    const v = this.verifyDetailed(token);
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
  rotate(token: string, declaredBrowser: boolean): RotateResult {
    const now = Date.now();
    const v = this.resolve(token, now);
    if (v.status === "invalid") return { ok: false, reason: "invalid" };
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
    const newToken = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
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
    return { ok: true, id: row.id, token: newToken, expiresAt };
  }

  /** Delete a device by id. Returns true if a row was removed. */
  revoke(id: string): boolean {
    const before = this.devices.length;
    this.devices = this.devices.filter((d) => d.id !== id);
    if (this.devices.length === before) return false;
    this.rotations.delete(id);
    this.persist();
    return true;
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
    };
  }
}
