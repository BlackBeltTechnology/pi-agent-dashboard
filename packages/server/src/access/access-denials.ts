/**
 * Path-denial registry — what makes D15's "a grant may only name a subject a
 * recorded denial actually named" testable.
 *
 * The only other ledger is `tunnel/tunnel-block-events.ts`'s `BlockEventBuffer`,
 * which is keyed by **IP** and carries no path or subject, so it cannot supply a
 * denial binding for a filesystem grant. This registry is separate on purpose:
 *
 *   - Keyed by grantable **subject** (the containing directory), not by IP.
 *   - Each entry carries an opaque `denialId`, the subject, the site that
 *     refused, the originating session, and a timestamp.
 *   - Entries **expire** (short TTL) and the registry is **bounded** with
 *     oldest-evicted, following the ledger's cap-and-evict precedent. An expired
 *     or unknown `denialId` makes a grant request fail.
 *   - It is written **only by the containment denial path** — never by an
 *     inbound request. That is the same invariant the network ledger holds, and
 *     a route-inventory test asserts no endpoint creates an entry (task 9a.31).
 *
 * See change: add-access-grants-and-review.
 */
import { randomUUID } from "node:crypto";

/** One recorded containment refusal. */
export interface PathDenial {
  denialId: string;
  /** The grantable subject the denial named — a directory. */
  subject: string;
  /** Where the refusal happened, e.g. `file-routes:661`. */
  site: string;
  /** Session that made the refused request. */
  session: string;
  /** Epoch ms. */
  at: number;
  /** Offered-ancestor ladder, already filtered (task 7b.1a). */
  ancestors?: string[];
}

/** Entries older than this are treated as absent. */
export const DENIAL_TTL_MS = 10 * 60 * 1000;

const CAP = 200;

let entries: PathDenial[] = [];

/** Test seam. */
export function __resetPathDenials(): void {
  entries = [];
}

function evictExpired(now: number): void {
  entries = entries.filter((e) => now - e.at < DENIAL_TTL_MS);
}

/**
 * Record a containment refusal and return its entry. Bounded + TTL-expired, so
 * a flood cannot pin a stale binding open.
 */
export function recordPathDenial(input: {
  subject: string;
  site: string;
  session?: string;
  ancestors?: string[];
  now?: number;
}): PathDenial {
  const now = input.now ?? Date.now();
  evictExpired(now);
  const entry: PathDenial = {
    denialId: randomUUID(),
    subject: input.subject,
    site: input.site,
    session: input.session ?? "unknown",
    at: now,
  };
  if (input.ancestors && input.ancestors.length > 0) entry.ancestors = input.ancestors;
  entries.push(entry);
  if (entries.length > CAP) entries.splice(0, entries.length - CAP);
  return entry;
}

/** Look up a live entry by id. Unknown or expired → undefined. */
export function getPathDenial(denialId: string, now: number = Date.now()): PathDenial | undefined {
  const hit = entries.find((e) => e.denialId === denialId);
  if (!hit) return undefined;
  if (now - hit.at >= DENIAL_TTL_MS) return undefined;
  return hit;
}

/** Live entries, newest first. */
export function listPathDenials(now: number = Date.now()): PathDenial[] {
  return entries.filter((e) => now - e.at < DENIAL_TTL_MS).slice().reverse();
}
