/**
 * In-memory telemetry of NETWORK-ONLY admissions: requests / WebSocket upgrades
 * admitted solely because the socket peer matched the trusted list (legacy
 * trust mode), with no other pass condition holding. It tells the operator who
 * still depends on network trust before they move to `pair`.
 *
 * Bounded by construction: peers live in a recency-ordered `Map` capped at
 * {@link MAX_PEERS} (least recently seen evicted, a repeat refreshes), the
 * admission count is bucketed per hour over the {@link WINDOW_MS} window, and
 * the per-peer log line is throttled to once per {@link LOG_THROTTLE_MS}.
 * Nothing is persisted; the window is "7 days or since the last restart",
 * whichever is shorter. Peer addresses are never exposed by `snapshot` — only
 * counts — so `/api/health` cannot leak them.
 *
 * A request is counted at most once: the per-route guard and the universal hook
 * both evaluate it, so a per-request marker (`networkOnlyCounted`) dedupes.
 *
 * See change: retire-trusted-networks-bypass (design D4).
 */

export const MAX_PEERS = 256;
export const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const LOG_THROTTLE_MS = 60 * 60 * 1000;
const BUCKET_MS = 60 * 60 * 1000;

export interface NetworkOnlySnapshot {
  /** Network-only admissions inside the window. */
  admissions: number;
  /** Distinct peer addresses inside the window (never listed). */
  distinctPeers: number;
  /** Epoch ms of the most recent admission, or `null` when none. */
  lastAt: number | null;
}

/** Anything with a socket peer; the marker dedupes a request seen by two guards. */
export interface NetworkOnlySource {
  ip: string;
  networkOnlyCounted?: boolean;
}

export interface NetworkTrustTelemetry {
  note(source: NetworkOnlySource, now?: number): void;
  snapshot(now?: number): NetworkOnlySnapshot;
  reset(): void;
}

export function createNetworkTrustTelemetry(
  log: (line: string) => void = (line) => console.warn(line),
): NetworkTrustTelemetry {
  /** ip → lastSeen; delete-then-set keeps insertion order == recency order. */
  const peers = new Map<string, number>();
  const lastLogged = new Map<string, number>();
  /** hour bucket index → admissions in it. */
  const buckets = new Map<number, number>();
  let lastAt: number | null = null;

  const prune = (now: number): void => {
    for (const [ip, seen] of peers) {
      if (now - seen > WINDOW_MS) {
        peers.delete(ip);
        lastLogged.delete(ip);
      } else {
        break; // recency order: everything after is newer
      }
    }
    const oldestBucket = Math.floor((now - WINDOW_MS) / BUCKET_MS);
    for (const idx of buckets.keys()) if (idx < oldestBucket) buckets.delete(idx);
  };

  return {
    note(source, now = Date.now()) {
      if (source.networkOnlyCounted) return;
      source.networkOnlyCounted = true;
      prune(now);
      const ip = source.ip;
      peers.delete(ip);
      peers.set(ip, now);
      while (peers.size > MAX_PEERS) {
        const oldest = peers.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        peers.delete(oldest);
        lastLogged.delete(oldest);
      }
      const bucket = Math.floor(now / BUCKET_MS);
      buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
      lastAt = now;
      const logged = lastLogged.get(ip);
      if (logged === undefined || now - logged >= LOG_THROTTLE_MS) {
        lastLogged.set(ip, now);
        log(
          `[trusted-networks] ${ip} reaches this dashboard by network trust only (no sign-in, no paired device) — pair it, or move to "pair" mode`,
        );
      }
    },
    snapshot(now = Date.now()) {
      prune(now);
      let admissions = 0;
      for (const n of buckets.values()) admissions += n;
      return { admissions, distinctPeers: peers.size, lastAt: admissions > 0 ? lastAt : null };
    },
    reset() {
      peers.clear();
      lastLogged.clear();
      buckets.clear();
      lastAt = null;
    },
  };
}

/** The process-wide instance every admission site reports to. */
const telemetry = createNetworkTrustTelemetry();

/** Record a network-only admission (idempotent per request). */
export function noteNetworkOnlyAdmission(source: NetworkOnlySource, now?: number): void {
  telemetry.note(source, now);
}

/** Counters for `/api/health` `trustPosture.networkOnly`. */
export function networkOnlySnapshot(now?: number): NetworkOnlySnapshot {
  return telemetry.snapshot(now);
}

/** Test seam. */
export function resetNetworkTrustTelemetryForTests(): void {
  telemetry.reset();
}
