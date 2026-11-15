/**
 * Device-key proof plumbing for the server (Node crypto): the single-use
 * challenge nonce store, the per-peer device-status limiter, the Ed25519
 * verifier and the throttled `revoked_answer` log line.
 *
 * Verify-before-lookup: a signature is checked against the key the CALLER
 * presents, and only a verified key is ever looked up in the registry, so the
 * reply discloses nothing about keys the caller cannot sign for.
 *
 * See change: device-key-mutual-check (D1, D2, D10).
 */
import crypto from "node:crypto";
import {
  DEVICE_NONCE_TTL_MS,
  isDeviceNonce,
  isDevicePub,
  isDeviceSig,
  rawEd25519PubToSpki,
} from "@blackbelt-technology/pi-dashboard-shared/device-key-proof.js";
import { auditLine } from "./audit-log.js";

/** Bound on unused nonces; the oldest is evicted first. */
export const DEVICE_NONCE_MAX = 10_000;
/** Device-status requests allowed per peer inside {@link DEVICE_STATUS_WINDOW_MS}. */
const DEVICE_STATUS_LIMIT = 60;
const DEVICE_STATUS_WINDOW_MS = 60_000;
/** Tracked peers; the oldest is evicted first (same bound as the knock limiter). */
export const DEVICE_STATUS_MAX_PEERS = 1024;
/** At most one `revoked_answer` line per key id inside this window. */
const REVOKED_ANSWER_LOG_MS = 10 * 60_000;
const REVOKED_ANSWER_MAX_KEYS = 1024;

/**
 * Single-use server nonces for the device check. 32 random bytes, base64url
 * (43 chars). A nonce is consumed on FIRST presentation whether or not the
 * proof that carries it is valid, so a captured proof cannot be replayed.
 * In-memory only; carries no secret.
 */
export class DeviceNonceStore {
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly max: number;
  /** Insertion-ordered: the first key is the oldest unused nonce. */
  private readonly nonces = new Map<string, number>();

  constructor(opts: { now?: () => number; ttlMs?: number; max?: number } = {}) {
    this.now = opts.now ?? Date.now;
    this.ttlMs = opts.ttlMs ?? DEVICE_NONCE_TTL_MS;
    this.max = opts.max ?? DEVICE_NONCE_MAX;
  }

  size(): number {
    return this.nonces.size;
  }

  issue(): string {
    const nonce = crypto.randomBytes(32).toString("base64url");
    this.nonces.set(nonce, this.now() + this.ttlMs);
    while (this.nonces.size > this.max) {
      const oldest = this.nonces.keys().next().value;
      if (oldest === undefined) break;
      this.nonces.delete(oldest);
    }
    return nonce;
  }

  /** True only for a known, unexpired, never-presented nonce. Always deletes it. */
  consume(nonce: unknown): boolean {
    if (typeof nonce !== "string") return false;
    const expiresAt = this.nonces.get(nonce);
    this.nonces.delete(nonce);
    return expiresAt !== undefined && expiresAt >= this.now();
  }
}

/**
 * Sliding-window limiter for `POST /api/pair/device-status`: 60 per minute per
 * peer address. EVERY request counts (valid or not). Blocked requests do not
 * extend the window, so the peer recovers one window after its first request.
 * The peer map is bounded; the identity challenge never consults this.
 * Logs one line per peer when it trips (not once per blocked request).
 */
export class DeviceStatusLimiter {
  private readonly now: () => number;
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly maxPeers: number;
  private readonly onTrip: (peer: string) => void;
  private readonly peers = new Map<string, { hits: number[]; tripped: boolean }>();

  constructor(
    opts: { now?: () => number; limit?: number; windowMs?: number; maxPeers?: number; onTrip?: (peer: string) => void } = {},
  ) {
    this.now = opts.now ?? Date.now;
    this.limit = opts.limit ?? DEVICE_STATUS_LIMIT;
    this.windowMs = opts.windowMs ?? DEVICE_STATUS_WINDOW_MS;
    this.maxPeers = opts.maxPeers ?? DEVICE_STATUS_MAX_PEERS;
    this.onTrip = opts.onTrip ?? ((peer) => auditLine("pairing", "device_status_limited", { ip: peer }));
  }

  /** Number of tracked peers (bounded by `maxPeers`). */
  size(): number {
    return this.peers.size;
  }

  /** Record one request from `peer`; true when it is within the budget. */
  allow(peer: string): boolean {
    const t = this.now();
    const state = this.peers.get(peer) ?? { hits: [], tripped: false };
    // Re-insert so Map order is least-recently-used first.
    this.peers.delete(peer);
    this.peers.set(peer, state);
    while (this.peers.size > this.maxPeers) {
      const oldest = this.peers.keys().next().value;
      if (oldest === undefined) break;
      this.peers.delete(oldest);
    }
    state.hits = state.hits.filter((h) => h > t - this.windowMs);
    if (state.hits.length >= this.limit) {
      if (!state.tripped) {
        state.tripped = true;
        try {
          this.onTrip(peer);
        } catch {
          // A broken log sink must not change the answer.
        }
      }
      return false;
    }
    state.tripped = false;
    state.hits.push(t);
    return true;
  }
}

/** Ed25519 verify of `message` (UTF-8) by the RAW 32-byte key `pub`; any malformed input is `false`. */
export function verifyDeviceSignature(pub: string, message: string, sig: string): boolean {
  if (!isDevicePub(pub) || !isDeviceSig(sig)) return false;
  try {
    const key = crypto.createPublicKey({
      key: Buffer.from(rawEd25519PubToSpki(Buffer.from(pub, "base64url"))),
      format: "der",
      type: "spki",
    });
    return crypto.verify(null, Buffer.from(message, "utf8"), key, Buffer.from(sig, "base64url"));
  } catch {
    return false;
  }
}

/**
 * Consume the proof's nonce, then verify its signature over `message(nonce)`.
 * The nonce is spent on first presentation even when the signature is bad.
 * `fields` are untrusted request values; any wrong shape is simply `false`.
 */
export function verifyNonceProof(
  store: DeviceNonceStore,
  fields: { deviceNonce?: unknown; pub?: unknown; sig?: unknown },
  messageFor: (deviceNonce: string) => string,
): fields is { deviceNonce: string; pub: string; sig: string } {
  const nonceOk = isDeviceNonce(fields.deviceNonce) && store.consume(fields.deviceNonce);
  if (!nonceOk || !isDevicePub(fields.pub) || !isDeviceSig(fields.sig)) return false;
  return verifyDeviceSignature(fields.pub, messageFor(fields.deviceNonce as string), fields.sig);
}

/**
 * Throttled, transition-only `[pairing] revoked_answer key=dk:<12>` line: the
 * first `revoked` answer for a key id after a different answer, at most once per
 * key id per 10 minutes. Other answers (paired, expired, unknown) never log.
 * Takes the short key id only — never a key, signature or nonce.
 */
export class RevokedAnswerLog {
  private readonly now: () => number;
  private readonly emit: (keyId: string) => void;
  private readonly last = new Map<string, { status: string; loggedAt?: number }>();

  constructor(opts: { now?: () => number; emit?: (keyId: string) => void } = {}) {
    this.now = opts.now ?? Date.now;
    this.emit = opts.emit ?? ((keyId) => auditLine("pairing", "revoked_answer", { key: keyId }));
  }

  note(keyId: string, status: string): void {
    const t = this.now();
    const prev = this.last.get(keyId);
    this.last.delete(keyId);
    const next = { status, loggedAt: prev?.loggedAt };
    this.last.set(keyId, next);
    while (this.last.size > REVOKED_ANSWER_MAX_KEYS) {
      const oldest = this.last.keys().next().value;
      if (oldest === undefined) break;
      this.last.delete(oldest);
    }
    if (status !== "revoked" || prev?.status === "revoked") return;
    if (next.loggedAt !== undefined && t - next.loggedAt < REVOKED_ANSWER_LOG_MS) return;
    next.loggedAt = t;
    try {
      this.emit(keyId);
    } catch {
      // Fail-open, like every audit line.
    }
  }
}
