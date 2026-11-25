/**
 * Preview admission observability (D13): `refuse h=<hash8> reason=…` (one line per `h` per 60 s window, tracked hosts bounded
 * to {@link MAX_TRACKED}) and `admit h=<hash8> tier=<n>` (first admit per entry only). `h` is the first 8 hex of
 * sha256(label|pid) — never the label, the origin, a path or a URL (D2). Counting is independent of log suppression, and a
 * refusal is never added to the host gate's `recent` set.
 * See change: serve-live-previews-on-capability-origin (D13).
 */
import { type LiveLogSink, liveLog } from "./live-log.js";

export const REFUSE_WINDOW_MS = 60_000;
export const MAX_TRACKED = 256;

export interface PreviewObserver {
  refused(reason: string, h?: string): void;
  admitted(h: string, tier: number | string): void;
  /** The entry is gone: its next admit is a "first admit" again (bounded state, no leak across churn). */
  forget(h: string): void;
  /** Introspection for the bounds tests. */
  size(): { refuse: number; admit: number };
}

export function createPreviewObserver(opts: { sink?: LiveLogSink; now?: () => number } = {}): PreviewObserver {
  const now = opts.now ?? Date.now;
  const refuseSeen = new Map<string, number>();
  const admitSeen = new Set<string>();
  const evictOldest = <K>(m: Map<K, unknown> | Set<K>, cap: number): void => {
    while (m.size >= cap) {
      const first = m.keys().next();
      if (first.done) return;
      m.delete(first.value);
    }
  };
  return {
    refused(reason, h) {
      const key = h ?? `-${reason}`;
      const t = now();
      const last = refuseSeen.get(key);
      if (last !== undefined && t - last < REFUSE_WINDOW_MS) return;
      refuseSeen.delete(key);
      evictOldest(refuseSeen, MAX_TRACKED);
      refuseSeen.set(key, t);
      liveLog(opts.sink, "refuse", { ...(h ? { h } : {}), reason });
    },
    admitted(h, tier) {
      if (admitSeen.has(h)) return;
      evictOldest(admitSeen, MAX_TRACKED * 4);
      admitSeen.add(h);
      liveLog(opts.sink, "admit", { h, tier });
    },
    forget: (h) => void admitSeen.delete(h),
    size: () => ({ refuse: refuseSeen.size, admit: admitSeen.size }),
  };
}
