/**
 * In-memory per-session sudo password cache (D3). The password is a `Buffer`
 * zeroed on clear (best-effort: the WS JSON parse and relay already made
 * immutable string copies we cannot reach). The expiry is a fixed window from the
 * operator entry; a cache read never extends it. Nothing here logs, persists or
 * throws a value.
 *
 * Also owns the per-sudo-pid helper-invocation counters: sudo re-invokes the
 * helper for the same pid when it rejected the previous password (up to 3 tries,
 * a cache hit counts as an invocation), so the counter tells a retry from a
 * fresh sudo and spots the final, not-to-be-cached invocation.
 *
 * See change: add-sudo-credential-prompt (D3).
 */

/** Hard bound on tracked pids; the oldest is evicted first (G8). */
export const MAX_PID_COUNTERS = 1000;

export interface PasswordCacheDeps {
  now?: () => number;
  /** Called after the cached entry changed: new expiry, or null when cleared. */
  onChange?: (expiresAt: number | null) => void;
}

export interface PasswordCache {
  /** Replace the entry; the buffer is owned (and zeroed) by the cache. */
  set(password: Buffer, ttlMs: number): void;
  /** The fresh entry, or undefined when none / expired (expiry clears it). Never extends the window. */
  get(): Buffer | undefined;
  expiresAt(): number | null;
  clear(): void;
  /** Test seam: the live buffer without freshness checks. */
  peek(): Buffer | undefined;
}

export function createPasswordCache(deps: PasswordCacheDeps = {}): PasswordCache {
  const now = deps.now ?? (() => Date.now());
  let entry: { buf: Buffer; expiresAt: number; timer: ReturnType<typeof setTimeout> } | undefined;

  const clear = (): void => {
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.buf.fill(0);
    entry = undefined;
    deps.onChange?.(null);
  };

  return {
    set(password, ttlMs) {
      if (entry) {
        clearTimeout(entry.timer);
        entry.buf.fill(0);
      }
      const timer = setTimeout(clear, ttlMs);
      timer.unref?.();
      entry = { buf: password, expiresAt: now() + ttlMs, timer };
      deps.onChange?.(entry.expiresAt);
    },
    get() {
      if (!entry) return undefined;
      if (now() >= entry.expiresAt) {
        clear();
        return undefined;
      }
      return entry.buf;
    },
    expiresAt: () => entry?.expiresAt ?? null,
    clear,
    peek: () => entry?.buf,
  };
}

export interface InvocationCounters {
  /** Count this invocation for `pid` and return its 1-based ordinal. A non-integer pid is never tracked (always 1). */
  bump(pid: unknown, windowMs: number): number;
  size(): number;
  clear(): void;
}

/** Counters evicted `windowMs` after their pid's last invocation, via one sweep timer. */
export function createInvocationCounters(now: () => number = () => Date.now()): InvocationCounters {
  const seen = new Map<number, { n: number; expires: number }>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const sweep = (): void => {
    timer = undefined;
    const t = now();
    for (const [pid, rec] of seen) if (rec.expires <= t) seen.delete(pid);
    schedule();
  };
  const schedule = (): void => {
    if (timer || seen.size === 0) return;
    let next = Infinity;
    for (const rec of seen.values()) next = Math.min(next, rec.expires);
    timer = setTimeout(sweep, Math.max(0, next - now()));
    timer.unref?.();
  };

  return {
    bump(pid, windowMs) {
      if (typeof pid !== "number" || !Number.isInteger(pid)) return 1;
      const t = now();
      const prev = seen.get(pid);
      const live = prev && prev.expires > t ? prev.n : 0;
      seen.delete(pid); // re-insert last = most recent
      seen.set(pid, { n: live + 1, expires: t + windowMs });
      if (seen.size > MAX_PID_COUNTERS) seen.delete(seen.keys().next().value as number);
      schedule();
      return live + 1;
    },
    size: () => seen.size,
    clear() {
      if (timer) clearTimeout(timer);
      timer = undefined;
      seen.clear();
    },
  };
}
