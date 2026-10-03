/**
 * Pure usage summing over pi session entries — the ONE source shared by the
 * bridge's `usageSeed`, the JSONL reader (`session-stats-reader.ts`) and the
 * replay arms (`state-replay.ts`), so the three always agree.
 *
 * Kinds (one source per kind, design D1):
 * - `turn`            — assistant message usage (only kind that drives the context gauge)
 * - `tool`            — usage on a `toolResult` message (codemode `models.classify()` …)
 * - `compaction`      — `usage` on a compaction entry
 * - `branch_summary`  — `usage` on a branch-summary entry
 * - `usage:<kind>`    — a `type:"usage"` entry (e.g. `usage:cache_warm`); unknown kinds count too
 *
 * See change: count-non-message-usage.
 */

/**
 * Version of the stats extraction rules (`extractSessionStats` over these
 * helpers). Bump whenever extraction starts counting something it did not
 * before, so cached sidecar totals of non-archived sessions re-extract on
 * discovery. v2: non-message usage (usage entries, compaction/branch-summary,
 * tool results).
 */
export const STATS_EXTRACTOR_VERSION = 2;

export interface UsageTotals {
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

/** Usage kind of a synthesized `stats_update`. Absent / `"turn"` = assistant turn. */
export type UsageKind = string;

export interface EntryUsage {
  kind: UsageKind;
  usage: Record<string, unknown>;
  provider?: string;
  model?: string;
}

/** Entry types the bridge drain forwards as `usage_recorded` (never message entries). */
export const DRAINABLE_ENTRY_TYPES: ReadonlySet<string> = new Set(["usage", "compaction", "branch_summary"]);

export function emptyUsageTotals(): UsageTotals {
  return { tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
}

/**
 * Finite, non-negative number or 0. Usage reaches the server from the bridge
 * socket (a trust boundary), so a negative or non-finite value must never
 * lower or poison a total; same rule as `normalizeUsageSeed`.
 */
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

function asUsage(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : undefined;
}

/** Normalize a pi `Usage` object to the five totals. */
export function usageToTotals(usage: Record<string, unknown>): UsageTotals {
  const cost = asUsage(usage.cost);
  return {
    tokensIn: num(usage.input),
    tokensOut: num(usage.output),
    cacheRead: num(usage.cacheRead),
    cacheWrite: num(usage.cacheWrite),
    cost: num(cost?.total),
  };
}

export function addUsageTotals(into: UsageTotals, add: UsageTotals): UsageTotals {
  into.tokensIn += add.tokensIn;
  into.tokensOut += add.tokensOut;
  into.cacheRead += add.cacheRead;
  into.cacheWrite += add.cacheWrite;
  into.cost += add.cost;
  return into;
}

/**
 * The usage an entry carries, with its kind, or `null` when it carries none.
 * Covers every kind, assistant included (`turn`).
 */
export function entryUsage(entry: any): EntryUsage | null {
  if (!entry || typeof entry !== "object") return null;
  if (entry.type === "message") {
    const msg = entry.message;
    const usage = asUsage(msg?.usage);
    if (!usage) return null;
    if (msg.role === "assistant") return { kind: "turn", usage };
    if (msg.role === "toolResult") return { kind: "tool", usage };
    return null;
  }
  return drainableEntryUsage(entry);
}

/**
 * The usage of an entry the bridge drain forwards (`usage`, `compaction`,
 * `branch_summary`), or `null`. Message entries are never drainable, so
 * tool-result usage cannot be counted twice (its live source is `message_end`).
 */
export function drainableEntryUsage(entry: any): EntryUsage | null {
  if (!entry || typeof entry !== "object" || !DRAINABLE_ENTRY_TYPES.has(entry.type)) return null;
  const usage = asUsage(entry.usage);
  if (!usage) return null;
  if (entry.type === "usage") {
    const out: EntryUsage = { kind: `usage:${typeof entry.kind === "string" ? entry.kind : "unknown"}`, usage };
    if (typeof entry.provider === "string") out.provider = entry.provider;
    if (typeof entry.model === "string") out.model = entry.model;
    return out;
  }
  return { kind: entry.type, usage };
}

/** Sum every kind of usage over a list of session entries. */
export function sumEntryUsage(entries: readonly unknown[]): UsageTotals {
  const totals = emptyUsageTotals();
  for (const entry of entries) {
    const u = entryUsage(entry);
    if (u) addUsageTotals(totals, usageToTotals(u.usage));
  }
  return totals;
}
