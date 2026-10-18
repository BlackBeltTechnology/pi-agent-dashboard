/**
 * `browser/await-state` — the server's signal that a `browser_await_human` is
 * pending for an instance (change: add-dedicated-agent-browser, D8).
 *
 * The bridge tool sends `{instanceId, pending: true}` right before it blocks on the
 * confirm prompt and `{pending: false}` in a `finally`. While any session has a
 * pending await for an instance the idle sweep holds it. The caller's session comes
 * ONLY from the request lane's `meta` (never the payload), as `browser/open` does.
 *
 * Bounded: an entry older than `maxHoldMs` stops counting (a bridge that crashed
 * between the two messages must not pin an instance forever) and the table is
 * capped; `forget` drops an instance's entries when it closes.
 */
export const AWAIT_MAX_HOLD_MS = 2 * 60 * 60_000;
const MAX_ENTRIES = 256;
const MAX_INSTANCE_ID = 128;

export interface AwaitTrackerOptions {
  now?: () => number;
  maxHoldMs?: number;
}

export class AwaitTracker {
  /** `${sessionId}\0${instanceId}` → time the await started. */
  private readonly entries = new Map<string, number>();
  private readonly now: () => number;
  private readonly maxHoldMs: number;

  constructor(opts: AwaitTrackerOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
    this.maxHoldMs = opts.maxHoldMs ?? AWAIT_MAX_HOLD_MS;
  }

  get size(): number {
    return this.entries.size;
  }

  /** Lane handler. Throws an `Error` naming the cause for a malformed payload. */
  handle = (payload: unknown, meta: { sessionId: string }): { ok: true } => {
    const p = (typeof payload === "object" && payload !== null ? payload : {}) as { instanceId?: unknown; pending?: unknown };
    if (typeof p.instanceId !== "string" || p.instanceId === "" || p.instanceId.length > MAX_INSTANCE_ID) throw new Error("invalid-instance");
    if (typeof p.pending !== "boolean") throw new Error("invalid-pending");
    const key = `${meta.sessionId}\0${p.instanceId}`;
    if (!p.pending) {
      this.entries.delete(key);
      return { ok: true };
    }
    this.prune();
    if (!this.entries.has(key) && this.entries.size >= MAX_ENTRIES) throw new Error("too-many-pending");
    this.entries.set(key, this.now());
    return { ok: true };
  };

  /** True while any session's await for `instanceId` is pending (and not older than the hold cap). */
  pending(instanceId: string): boolean {
    this.prune();
    for (const key of this.entries.keys()) if (key.endsWith(`\0${instanceId}`)) return true;
    return false;
  }

  /** Drop every entry of a closed instance. */
  forget(instanceId: string): void {
    for (const key of [...this.entries.keys()]) if (key.endsWith(`\0${instanceId}`)) this.entries.delete(key);
  }

  private prune(): void {
    const t = this.now();
    for (const [key, startedAt] of this.entries) if (t - startedAt > this.maxHoldMs) this.entries.delete(key);
  }
}
