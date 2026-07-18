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
}

/** Public view of a device (no token material) for Settings / listing. */
export interface PairedDeviceView {
  id: string;
  label: string;
  createdAt: string;
  lastSeen: string | null;
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
    this.devices = readJsonFile<PairedDevice[]>(filePath, []);
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
   */
  add(label: string): { device: PairedDeviceView; token: string } {
    const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
    const device: PairedDevice = {
      id: crypto.randomUUID(),
      label: label.trim() || "device",
      tokenHash: hashToken(token),
      createdAt: new Date().toISOString(),
      lastSeen: null,
    };
    this.devices.push(device);
    this.persist();
    return { device: this.toView(device), token };
  }

  /**
   * Verify a presented bearer token. On success updates last-seen and returns
   * the device id; on failure returns null. Constant-time hash comparison.
   */
  verify(token: string | undefined | null): string | null {
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
        return d.id;
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
    return { id: d.id, label: d.label, createdAt: d.createdAt, lastSeen: d.lastSeen };
  }
}
