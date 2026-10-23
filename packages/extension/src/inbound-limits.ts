/**
 * Bounds on what the dashboard server (or anything holding a bridge socket)
 * can make this bridge do per unit time:
 *
 *  - concurrent shell commands per session (`!`, `!!`, exec slash templates);
 *  - the rate of turn-starting inbound commands per bridge process (token bucket).
 *
 * The bash bound limits concurrent EXECUTIONS the bridge awaits (backpressure);
 * it is not a sandbox — `cmd &` returns at once. Anyone who can send `!` can already exec.
 *
 * Both are env-configurable; an invalid value falls back to the default and is
 * logged exactly once per variable per limiter (one limiter per bridge process,
 * so never per message). `0` is NOT "unlimited" — it is invalid.
 *
 * The bucket is keyed by an object the CALLER chooses: the bridge passes its
 * process-global state, so neither a WebSocket reconnect nor a `/reload` (new
 * manager, same process) refills it, while two keys are independent. Buckets
 * are weakly held: a retired key leaks nothing.
 *
 * No module-level mutable state — the bridge holds the single instance in its
 * process-global `BridgeState`, so `/reload` keeps the allowance.
 *
 * See change: harden-bridge-inbound-and-discovery (D17).
 */

/** Concurrent bash commands in flight per session. */
export const DEFAULT_MAX_BASH = 4;
/** Prompt bucket: burst capacity. */
export const DEFAULT_PROMPT_BURST = 30;
/** Prompt bucket: tokens refilled per second. */
export const DEFAULT_PROMPT_REFILL_PER_SEC = 10;

const MAX_BASH_ENV = "PI_DASHBOARD_BRIDGE_MAX_BASH";
const PROMPT_RATE_ENV = "PI_DASHBOARD_BRIDGE_PROMPT_RATE";

const POSITIVE_INT = /^[1-9]\d*$/;
const RATE = /^([1-9]\d*)\/([1-9]\d*)$/;

export interface InboundLimitsOptions {
  env?: NodeJS.ProcessEnv;
  /** Clock in ms; fractional ok. Defaults to `Date.now`. */
  now?: () => number;
  /** Sink for the once-per-variable "invalid value" line. Defaults to `console.warn`. */
  log?: (line: string) => void;
}

export interface InboundLimits {
  readonly maxBash: number;
  readonly promptBurst: number;
  readonly promptRefillPerSec: number;
  /**
   * Take one slot for a shell command in `sessionId`. Returns the release
   * function (idempotent), or `undefined` when the session is at its limit.
   */
  tryAcquireBash(sessionId: string): (() => void) | undefined;
  /** Spend one token of `key`'s bucket. `false` = refused. */
  takePrompt(key: object): boolean;
  /** In-flight shell commands for a session (tests / diagnostics). */
  bashInFlight(sessionId: string): number;
}

function parseMaxBash(raw: string | undefined, warn: (name: string, detail: string) => void): number {
  if (raw === undefined) return DEFAULT_MAX_BASH;
  if (POSITIVE_INT.test(raw)) return Number(raw);
  warn(MAX_BASH_ENV, `expected a positive integer, got ${JSON.stringify(raw)}; using ${DEFAULT_MAX_BASH}`);
  return DEFAULT_MAX_BASH;
}

function parsePromptRate(
  raw: string | undefined,
  warn: (name: string, detail: string) => void,
): { burst: number; refill: number } {
  const fallback = { burst: DEFAULT_PROMPT_BURST, refill: DEFAULT_PROMPT_REFILL_PER_SEC };
  if (raw === undefined) return fallback;
  const m = RATE.exec(raw);
  if (m) return { burst: Number(m[1]), refill: Number(m[2]) };
  warn(
    PROMPT_RATE_ENV,
    `expected "<burst>/<refillPerSec>" (positive integers), got ${JSON.stringify(raw)}; using ${DEFAULT_PROMPT_BURST}/${DEFAULT_PROMPT_REFILL_PER_SEC}`,
  );
  return fallback;
}

export function createInboundLimits(opts: InboundLimitsOptions = {}): InboundLimits {
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((line: string) => console.warn(line));
  const warned = new Set<string>();
  const warn = (name: string, detail: string): void => {
    if (warned.has(name)) return;
    warned.add(name);
    log(`[dashboard] ${name}: ${detail}`);
  };

  const maxBash = parseMaxBash(env[MAX_BASH_ENV], warn);
  const rate = parsePromptRate(env[PROMPT_RATE_ENV], warn);

  const bash = new Map<string, number>();
  const buckets = new WeakMap<object, { tokens: number; at: number }>();

  return {
    maxBash,
    promptBurst: rate.burst,
    promptRefillPerSec: rate.refill,

    tryAcquireBash(sessionId) {
      const n = bash.get(sessionId) ?? 0;
      if (n >= maxBash) return undefined;
      bash.set(sessionId, n + 1);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const cur = (bash.get(sessionId) ?? 1) - 1;
        if (cur <= 0) bash.delete(sessionId);
        else bash.set(sessionId, cur);
      };
    },

    takePrompt(key) {
      const t = now();
      let b = buckets.get(key);
      if (!b) {
        b = { tokens: rate.burst, at: t };
        buckets.set(key, b);
      } else {
        const elapsed = Math.max(0, t - b.at);
        b.tokens = Math.min(rate.burst, b.tokens + (elapsed * rate.refill) / 1000);
        b.at = t;
      }
      if (b.tokens < 1) return false;
      b.tokens -= 1;
      return true;
    },

    bashInFlight: (sessionId) => bash.get(sessionId) ?? 0,
  };
}
