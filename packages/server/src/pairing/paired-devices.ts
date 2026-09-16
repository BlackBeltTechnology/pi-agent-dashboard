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
  type Tier,
  TIERS,
} from "@blackbelt-technology/pi-dashboard-shared/tiers.js";
import { readJsonFile, writeJsonFile } from "../persistence/json-store.js";

const REGISTRY_FILENAME = "paired-devices.json";
const TOKEN_BYTES = 32; // 256-bit opaque bearer.
// Throttle last-seen persistence: every authenticated request would otherwise
// rewrite the registry file (write amplification). Coarse last-seen is fine.
const LAST_SEEN_PERSIST_INTERVAL_MS = 60_000;

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
   */
  add(
    label: string,
    source: "pairing" | "manual" = "pairing",
    tier?: Tier,
  ): { device: PairedDeviceView; token: string } {
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
    this.devices.push(device);
    this.persist();
    return { device: this.toView(device), token };
  }

  /**
   * Verify a presented bearer token. On success updates last-seen and returns
   * the device id AND its tier; on failure returns null. Constant-time hash
   * comparison. The tier is read from the row on EVERY call (no caching), so a
   * tier change takes effect on the next request.
   */
  verify(token: string | undefined | null): { id: string; tier: Tier } | null {
    if (!token) return null;
    const presented = hashToken(token);
    const now = Date.now();
    for (const d of this.devices) {
      if (timingSafeEqualHex(presented, d.tokenHash)) {
        // Update last-seen in memory always; persist to disk at most once per
        // interval. Compare against the last DISK-WRITE time (not the previous
        // request time), else an always-active device would never re-persist.
        d.lastSeen = new Date(now).toISOString();
        const lastWrite = this.lastPersistedAt.get(d.id) ?? 0;
        if (now - lastWrite >= LAST_SEEN_PERSIST_INTERVAL_MS) {
          this.lastPersistedAt.set(d.id, now);
          this.persist();
        }
        return { id: d.id, tier: d.tier };
      }
    }
    return null;
  }

  /** Delete a device by id. Returns true if a row was removed. */
  revoke(id: string): boolean {
    const before = this.devices.length;
    this.devices = this.devices.filter((d) => d.id !== id);
    if (this.devices.length === before) return false;
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
