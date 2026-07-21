/**
 * Bounded ring buffer of network-guard denials, powering the "this device was
 * refused — Trust this network?" banner.
 *
 * THREAT MODEL: the one-click "Trust" action is the attack surface, so the
 * buffer is hardened against poisoning:
 *   - The recorded IP is the SOCKET PEER only (caller passes `request.ip`),
 *     NEVER an `X-Forwarded-For`/`Forwarded` header — an attacker cannot seed
 *     the buffer with an IP the operator is nudged to trust.
 *   - Loopback and proxy-terminated peers are marked `trustable: false`. A
 *     tunnel/reverse-proxy terminates at 127.0.0.1, so trusting that IP would
 *     trust the ENTIRE tunnel; the UI must suppress the trust action for them.
 *   - Entries are DEDUPED by IP (coalesced, last-seen bumped) and the buffer is
 *     CAPPED, so a flood of spoofed source IPs cannot evict a real denial or
 *     bury it.
 *   - Recording is advisory only; it never mutates `trustedNetworks`.
 *
 * See change: add-tunnel-providers.
 */
import { isLoopback } from "../auth/localhost-guard.js";

/** A coalesced denial the UI can offer to trust (or not). */
export interface BlockEvent {
  ip: string;
  firstSeen: number;
  lastSeen: number;
  count: number;
  /** False for loopback/proxy-terminated peers — the UI suppresses "Trust" for these. */
  trustable: boolean;
}

export interface RecordOpts {
  /** The request carried a proxy-forwarding header (terminated at a proxy/tunnel). */
  proxied: boolean;
  now?: number;
}

const DEFAULT_CAP = 50;

export class BlockEventBuffer {
  private readonly byIp = new Map<string, BlockEvent>();
  constructor(private readonly cap: number = DEFAULT_CAP) {}

  /**
   * Record a denial for a socket-peer IP. Dedupes by IP; evicts the oldest
   * distinct IP when over cap. Returns the (updated) event.
   */
  record(ip: string, opts: RecordOpts): BlockEvent {
    const now = opts.now ?? Date.now();
    const trustable = !isLoopback(ip) && !opts.proxied;
    const existing = this.byIp.get(ip);
    if (existing) {
      existing.lastSeen = now;
      existing.count += 1;
      // A later genuine (non-proxied) hit can upgrade trustability; a proxied
      // hit never grants it.
      existing.trustable = existing.trustable || trustable;
      // Re-insert to keep Map insertion order ~ recency for eviction.
      this.byIp.delete(ip);
      this.byIp.set(ip, existing);
      return existing;
    }
    const ev: BlockEvent = { ip, firstSeen: now, lastSeen: now, count: 1, trustable };
    this.byIp.set(ip, ev);
    if (this.byIp.size > this.cap) {
      const oldest = this.byIp.keys().next().value;
      if (oldest !== undefined) this.byIp.delete(oldest);
    }
    return ev;
  }

  /** Most-recent-first snapshot for the auth-gated read endpoint. */
  list(): BlockEvent[] {
    return Array.from(this.byIp.values()).sort((a, b) => b.lastSeen - a.lastSeen);
  }

  clear(): void {
    this.byIp.clear();
  }
}

/** Process-wide singleton the network guard records into. */
export const blockEvents = new BlockEventBuffer();
