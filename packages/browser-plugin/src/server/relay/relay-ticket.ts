/**
 * Single-use relay tickets: the credential a relay WebSocket dial carries.
 *
 * Under the strict `requireLocalProof` default a bare-loopback upgrade is refused, but the relay's
 * clients (Playwright `connectOverCDP`, `agent-browser connect`, the pinned Chrome extension) can send
 * neither headers nor cookies, so they can never present the dashboard's local proof. The plugin
 * therefore authenticates the peer itself: every URL it issues (`cdpUrl`, the extension's
 * `mcpRelayUrl`) carries a ticket that is
 *
 *  - 32 random bytes, base64url, minted per issued URL (`POST /api/browser/connect` is non-observe, so
 *    only a caller the dashboard already admitted can obtain one);
 *  - bound to (guid, role): a `cdp` ticket never opens the extension scope and vice versa;
 *  - valid for 60 s and consumed by the FIRST attempt that presents the right value (a wrong value
 *    never burns a legitimate ticket, so a guesser cannot lock the real client out);
 *  - kept in memory only, stored as a SHA-256 digest, compared in constant time, never logged.
 *
 * A reconnecting client needs a fresh URL from `connect` (the existing contract: one CDP client per
 * instance, a dropped one is not re-adopted).
 *
 * See change: close-container-loopback-impersonation (D10).
 */
import crypto from "node:crypto";

export type RelayTicketRole = "ext" | "cdp";

/** A ticket is good for this long after it was minted. */
export const RELAY_TICKET_TTL_MS = 60_000;
const TICKET_BYTES = 32;

export interface RelayTicketStoreOptions {
  now?: () => number;
  ttlMs?: number;
  /** Injectable for tests (default: `crypto.randomBytes`). */
  randomBytes?: (n: number) => Buffer;
}

interface Entry {
  digest: Buffer;
  expiresAt: number;
}

const sha256 = (value: string): Buffer => crypto.createHash("sha256").update(value).digest();

export class RelayTicketStore {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly randomBytes: (n: number) => Buffer;

  constructor(opts: RelayTicketStoreOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.ttlMs = opts.ttlMs ?? RELAY_TICKET_TTL_MS;
    this.randomBytes = opts.randomBytes ?? crypto.randomBytes;
  }

  private static key(guid: string, role: RelayTicketRole): string {
    return `${role}:${guid}`;
  }

  /** Mint a ticket for (guid, role), replacing any earlier unconsumed one for the same pair. */
  mint(guid: string, role: RelayTicketRole): string {
    this.sweep();
    const ticket = this.randomBytes(TICKET_BYTES).toString("base64url");
    this.entries.set(RelayTicketStore.key(guid, role), { digest: sha256(ticket), expiresAt: this.now() + this.ttlMs });
    return ticket;
  }

  /**
   * True exactly once per live ticket, for the right (guid, role). A wrong, missing, expired or already
   * consumed value is false and does not disturb a still-valid ticket.
   */
  consume(guid: string, role: RelayTicketRole, presented: string | null | undefined): boolean {
    if (typeof presented !== "string" || presented.length === 0 || presented.length > 256) return false;
    const key = RelayTicketStore.key(guid, role);
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return false;
    }
    const given = sha256(presented);
    if (!crypto.timingSafeEqual(given, entry.digest)) return false;
    this.entries.delete(key);
    return true;
  }

  /** Forget every ticket for a guid (its instance ended). */
  revoke(guid: string): void {
    this.entries.delete(RelayTicketStore.key(guid, "ext"));
    this.entries.delete(RelayTicketStore.key(guid, "cdp"));
  }

  /** Number of live entries (test observability). */
  size(): number {
    this.sweep();
    return this.entries.size;
  }

  private sweep(): void {
    const t = this.now();
    for (const [k, v] of this.entries) if (v.expiresAt <= t) this.entries.delete(k);
  }
}
