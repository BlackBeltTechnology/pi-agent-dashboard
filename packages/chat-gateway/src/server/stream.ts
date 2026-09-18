/**
 * chat-gateway streaming helpers: the edit throttle (C8/P1) and the
 * mid-stream steer-prefix rules (C7/X6).
 *
 * The throttle emits AT MOST ONE edit per `minIntervalMs` and always converges
 * on the LATEST content — an intermediate burst value is never emitted after a
 * newer one arrived. Clock and timers are injected so tests need no real
 * timers.
 *
 * See change: add-chat-gateway.
 */

export interface EditThrottleDeps {
  minIntervalMs: number;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
  /**
   * Optional sink for a fire that happens on the SCHEDULED path (the trailing
   * edge). The synchronous paths (`request`/`flush`) return the content to the
   * caller instead.
   */
  onFire?: (content: string) => void;
}

export interface EditThrottle {
  /** Returns the content to write NOW, or null when it was coalesced. */
  request(content: string): { fire: string } | null;
  /** Emit the pending latest immediately (end of turn), cancelling the timer. */
  flush(): { fire: string } | null;
  /** Latest coalesced content not yet emitted. */
  pending(): string | null;
  /** Cancel any scheduled fire and drop pending content. */
  dispose(): void;
}

export function createEditThrottle(deps: EditThrottleDeps): EditThrottle {
  const minIntervalMs = Number.isFinite(deps.minIntervalMs)
    ? Math.max(0, deps.minIntervalMs)
    : 0;
  const now = deps.now ?? Date.now;
  const schedule =
    deps.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms) as unknown);
  const cancel =
    deps.cancel ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let lastFireAt = Number.NEGATIVE_INFINITY;
  let pendingContent: string | null = null;
  let handle: unknown = null;

  function clearTimer(): void {
    if (handle !== null) {
      cancel(handle);
      handle = null;
    }
  }

  return {
    request(content: string) {
      const t = now();
      if (handle === null && t - lastFireAt >= minIntervalMs) {
        lastFireAt = t;
        pendingContent = null;
        return { fire: content };
      }
      // Coalesce: the newest content wins, the older one is discarded.
      pendingContent = content;
      if (handle === null) {
        const wait = Math.max(0, minIntervalMs - (t - lastFireAt));
        handle = schedule(() => {
          handle = null;
          const latest = pendingContent;
          pendingContent = null;
          if (latest !== null) {
            lastFireAt = now();
            deps.onFire?.(latest);
          }
        }, wait);
      }
      return null;
    },

    flush() {
      const latest = pendingContent;
      pendingContent = null;
      clearTimer();
      if (latest === null) return null;
      lastFireAt = now();
      return { fire: latest };
    },

    pending() {
      return pendingContent;
    },

    dispose() {
      clearTimer();
      pendingContent = null;
    },
  };
}

/** C7: a message steers only when it STARTS WITH a non-empty prefix. */
export function shouldSteer(text: string, steerPrefix: string): boolean {
  if (typeof text !== "string" || typeof steerPrefix !== "string") return false;
  if (steerPrefix === "") return false;
  return text.startsWith(steerPrefix);
}

/** Removes exactly ONE leading prefix occurrence plus a single following space. */
export function stripSteerPrefix(text: string, steerPrefix: string): string {
  if (!shouldSteer(text, steerPrefix)) return text;
  const rest = text.slice(steerPrefix.length);
  return rest.startsWith(" ") ? rest.slice(1) : rest;
}
