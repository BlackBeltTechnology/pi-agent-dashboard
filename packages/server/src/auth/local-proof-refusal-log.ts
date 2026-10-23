/**
 * Rate-limited, single-line log for REST refusals whose only fault is missing
 * local proof (`local_proof_required`), so an operator can see which local
 * caller needs migrating and a container probing the host is visible.
 *
 * Line: `[local-proof] refused peer=<addr> host=<sanitized> method=<M> route=<pattern>[ suppressed=<n>]`.
 *
 * The limiter key is (route pattern, reason) — NEVER the caller-chosen Host — so a
 * flood of random Host values cannot grow state. At most one line per key per
 * window; the first line after a window carries the suppressed count. State is
 * capped at `maxKeys`: once full, a new key folds into one shared overflow bucket
 * (`route=<other>`) instead of evicting, so a key never re-emits inside its window.
 * `host` is length-capped and every non-printable or whitespace byte is replaced,
 * so a line is always exactly one line.
 *
 * One instance per server. See change: close-container-loopback-impersonation (D6).
 */
interface LocalProofRefusal {
  peer: string | undefined;
  host: string | undefined;
  method: string;
  /** Fastify route pattern (`/api/paired-devices/:id`), never the raw URL. */
  route: string | undefined;
  reason: string;
}

export interface LocalProofRefusalLoggerOptions {
  windowMs?: number;
  maxKeys?: number;
  now?: () => number;
  log?: (line: string) => void;
}

export interface LocalProofRefusalLogger {
  log(refusal: LocalProofRefusal): void;
  /** Rate-limit keys currently tracked (bounded by `maxKeys`). */
  trackedKeys(): number;
}

const MAX_HOST_CHARS = 64;
const OVERFLOW_KEY = "<other>|overflow";

/** One-line, bounded rendering of a caller-chosen header or token. */
export function sanitizeForLog(value: string | undefined, max = MAX_HOST_CHARS): string {
  if (!value) return "-";
  const clipped = value.length > max ? `${value.slice(0, max)}...` : value;
  return clipped.replace(/[^\x21-\x7e]/g, "?");
}

export function createLocalProofRefusalLogger(opts: LocalProofRefusalLoggerOptions = {}): LocalProofRefusalLogger {
  const windowMs = opts.windowMs ?? 60_000;
  const maxKeys = opts.maxKeys ?? 256;
  const now = opts.now ?? Date.now;
  const emit = opts.log ?? ((line: string) => console.warn(line));
  const state = new Map<string, { windowStart: number; suppressed: number }>();

  function prune(t: number): void {
    for (const [k, v] of state) if (t - v.windowStart >= windowMs) state.delete(k);
  }

  return {
    log(r) {
      const t = now();
      const route = sanitizeForLog(r.route ?? "<unmatched>", 96);
      let key = `${route}|${r.reason}`;
      let shownRoute = route;
      if (!state.has(key) && state.size >= maxKeys) {
        prune(t);
        if (state.size >= maxKeys) {
          key = OVERFLOW_KEY;
          shownRoute = "<other>";
        }
      }
      const entry = state.get(key);
      if (entry && t - entry.windowStart < windowMs) {
        entry.suppressed++;
        return;
      }
      const suppressed = entry?.suppressed ?? 0;
      state.set(key, { windowStart: t, suppressed: 0 });
      emit(
        `[local-proof] refused peer=${sanitizeForLog(r.peer, 45)} host=${sanitizeForLog(r.host)}` +
          ` method=${sanitizeForLog(r.method, 12)} route=${shownRoute}` +
          (suppressed > 0 ? ` suppressed=${suppressed}` : ""),
      );
    },
    trackedKeys: () => state.size,
  };
}
