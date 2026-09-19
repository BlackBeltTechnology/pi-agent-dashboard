/**
 * Bounded ring buffer of network-guard denials. ONE ledger, two roles:
 *   - the "this device was refused — Trust this network?" banner, and
 *   - the pending-access-request queue behind request→accept: the 403 IS the
 *     request, so the untrusted peer sends nothing additional (design D5).
 *
 * Generalizing past tunnel-only denials did not change the record shape or the
 * anti-poisoning properties below — it generalized WHICH guarded namespace may
 * fill the ledger (the universal `onRequest` hook records every guarded plane).
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
 *     bury it. Under the queue role an evicted pending request degrades to
 *     today's terminal 403; the peer's retry re-records it.
 *   - Recording is advisory only; it never mutates `trustedNetworks`. Acceptance
 *     writes trust through the existing config path
 *     (`PUT /api/config` → `writeConfigPartial`), never from this module.
 *
 * See changes: add-tunnel-providers, add-access-grants-and-review.
 */
import { isLoopback } from "../auth/loopback.js";

/** A coalesced denial the UI can offer to trust (or not). */
export interface BlockEvent {
  ip: string;
  firstSeen: number;
  lastSeen: number;
  count: number;
  /** False for loopback/proxy-terminated peers — the UI suppresses "Trust" for these. */
  trustable: boolean;
  /**
   * The denied request's `Origin` header, when it carried one. Recorded
   * additively so a CORS-refused origin is observable in the ledger; the entry
   * is STILL keyed and deduped by socket-peer IP. Bounded + control-character
   * stripped at record time — it is attacker-controlled AND served to clients.
   */
  origin?: string;
}

export interface RecordOpts {
  /** The request carried a proxy-forwarding header (terminated at a proxy/tunnel). */
  proxied: boolean;
  /** The denied request's `Origin` header, if any — additive, never a dedupe key. */
  origin?: string;
  now?: number;
}

/** Hard bound on a stored `Origin`; the value is attacker-supplied. */
const MAX_ORIGIN_LEN = 256;

/**
 * Strip control characters (a decoded header could carry CR/LF) and cap the
 * length. Applied at the SINK so every caller gets a safe value.
 */
function sanitizeOrigin(origin: string | undefined): string | undefined {
  if (typeof origin !== "string") return undefined;
  const cleaned = origin.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return cleaned.length > 0 ? cleaned.slice(0, MAX_ORIGIN_LEN) : undefined;
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
    const origin = sanitizeOrigin(opts.origin);
    const existing = this.byIp.get(ip);
    if (existing) {
      existing.lastSeen = now;
      existing.count += 1;
      // A later genuine (non-proxied) hit can upgrade trustability; a proxied
      // hit never grants it.
      existing.trustable = existing.trustable || trustable;
      // Capture the refused origin additively, WITHOUT changing the dedupe key:
      // once captured it is KEPT, so a later origin-less retry cannot erase it.
      if (origin && !existing.origin) existing.origin = origin;
      // Re-insert to keep Map insertion order ~ recency for eviction.
      this.byIp.delete(ip);
      this.byIp.set(ip, existing);
      return existing;
    }
    const ev: BlockEvent = { ip, firstSeen: now, lastSeen: now, count: 1, trustable };
    if (origin) ev.origin = origin;
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

/**
 * The trusted-network value an accept action may write for this pending entry,
 * or `null` when acceptance is SUPPRESSED.
 *
 * A `trustable: false` entry (loopback or proxy-terminated) names the
 * tunnel/reverse-proxy socket peer, not the remote client — adding it would
 * trust the ENTIRE tunnel, so no accept action is offered for it (design D5,
 * task 4.7). This only DECIDES; any write goes through the existing config path
 * (`PUT /api/config` → `writeConfigPartial`) and never through the ledger.
 */
export function acceptTargetFor(event: BlockEvent): string | null {
  return event.trustable ? event.ip : null;
}

/** Process-wide singleton the network guard records into. */
export const blockEvents = new BlockEventBuffer();
