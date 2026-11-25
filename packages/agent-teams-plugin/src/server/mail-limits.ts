/**
 * Mail abuse limits (tasks 6.1 / 6.7, design D13). Every mail wakes a full
 * ~50k-token turn, so two guards bound the cost: a per-sender TOKEN BUCKET
 * (`mailRatePerMin`, capacity = that value, continuous refill of one token per
 * `60000 / mailRatePerMin` ms, one token per `SendMessage` call — a broadcast
 * costs 1) and a per-PAIR loop breaker (`pairExchangeLimit` mails between the
 * same two members summed over both directions; any claim/complete/create/assign
 * in the team resets it). Both are synchronous, so concurrent calls cannot
 * under-count. State is memory only.
 * See change: add-agent-teams-core.
 */
import type { Clock } from "../shared/clock.js";

interface Bucket {
  /** Milliseconds of refill currently banked (one token = `refillMs`). */
  level: number;
  at: number;
}

interface Pair {
  count: number;
  tripped: boolean;
}

export type PairVerdict = "ok" | "limited" | "tripped";

export function createMailLimits(clock: Clock) {
  const buckets = new Map<string, Bucket>();
  const pairs = new Map<string, Map<string, Pair>>();

  /** Take one token from `sender`'s bucket; false when it is empty. Integer millisecond math: no float drift at the +10 s edge. */
  function takeToken(teamId: string, sender: string, perMinute: number): boolean {
    const rate = Math.max(1, Math.floor(perMinute));
    const refillMs = Math.floor(60_000 / rate);
    const capacity = rate * refillMs;
    const key = `${teamId}\u0000${sender}`;
    const now = clock.now();
    const b = buckets.get(key) ?? { level: capacity, at: now };
    b.level = Math.min(capacity, b.level + Math.max(0, now - b.at));
    b.at = now;
    buckets.set(key, b);
    if (b.level < refillMs) return false;
    b.level -= refillMs;
    return true;
  }

  /**
   * Is a further mail between `a` and `b` over the limit? `tripped` is returned
   * ONCE per pair since the last reset (the caller notifies the lead exactly once),
   * `limited` afterwards; the count itself only moves in `bumpPair`.
   */
  function checkPair(teamId: string, a: string, b: string, limit: number): PairVerdict {
    const pair = pairOf(teamId, a, b);
    if (pair.count < limit) return "ok";
    const first = !pair.tripped;
    pair.tripped = true;
    return first ? "tripped" : "limited";
  }

  /** Count one delivered mail between `a` and `b` (both directions share one counter). */
  function bumpPair(teamId: string, a: string, b: string): void {
    pairOf(teamId, a, b).count++;
  }

  function pairOf(teamId: string, a: string, b: string): Pair {
    const key = [a, b].sort().join("\u0000");
    const team = pairs.get(teamId) ?? new Map<string, Pair>();
    pairs.set(teamId, team);
    const pair = team.get(key) ?? { count: 0, tripped: false };
    team.set(key, pair);
    return pair;
  }

  /** A claim/complete/create/assign happened in the team: every pair starts over. */
  function resetPairs(teamId: string): void {
    pairs.delete(teamId);
  }

  function forgetTeam(teamId: string): void {
    pairs.delete(teamId);
    for (const key of [...buckets.keys()]) if (key.startsWith(`${teamId}\u0000`)) buckets.delete(key);
  }

  return { takeToken, checkPair, bumpPair, resetPairs, forgetTeam };
}

export type MailLimits = ReturnType<typeof createMailLimits>;
