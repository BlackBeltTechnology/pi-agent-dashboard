/**
 * Permission levels, operations and Google scopes (design D4). Pure data +
 * functions shared by server (lease), bridge (defence-in-depth tier check)
 * and client (level help text). See change: add-gmail-plugin.
 */

export type Tier = "readonly" | "draft" | "send";
export type Op = "read" | "draft" | "send" | "modify" | "trash" | "filters_read" | "filters_write";

export const TIERS: readonly Tier[] = ["readonly", "draft", "send"];

const SCOPE_BASE = "https://www.googleapis.com/auth/";
export const SCOPE = {
  readonly: `${SCOPE_BASE}gmail.readonly`,
  compose: `${SCOPE_BASE}gmail.compose`,
  modify: `${SCOPE_BASE}gmail.modify`,
  settingsBasic: `${SCOPE_BASE}gmail.settings.basic`,
} as const;

/** Requested Gmail scopes per tier (full set — no incremental auth for installed apps). */
export const TIER_SCOPES: Record<Tier, readonly string[]> = {
  readonly: [SCOPE.readonly],
  draft: [SCOPE.readonly, SCOPE.compose],
  send: [SCOPE.modify],
};

const TIER_RANK: Record<Tier, number> = { readonly: 0, draft: 1, send: 2 };

/** Minimum tier each operation requires. */
const OP_TIER: Record<Op, Tier> = {
  read: "readonly",
  draft: "draft",
  send: "send",
  modify: "send",
  trash: "send",
  filters_read: "readonly",
  filters_write: "send",
};

/** Scope(s) that cover an op — any one suffices. */
const OP_SCOPE: Record<Op, string> = {
  read: SCOPE.readonly,
  draft: SCOPE.compose,
  send: SCOPE.modify,
  modify: SCOPE.modify,
  trash: SCOPE.modify,
  filters_read: SCOPE.settingsBasic,
  filters_write: SCOPE.settingsBasic,
};

/** Implication table: a granted scope also covers these. `modify ⇒ readonly, compose`. */
const IMPLIES: Record<string, readonly string[]> = {
  [SCOPE.modify]: [SCOPE.readonly, SCOPE.compose],
};

export function isTier(v: unknown): v is Tier {
  return v === "readonly" || v === "draft" || v === "send";
}

/** True for the filter ops (gated by the per-account filters option). */
export function isFilterOp(op: Op): boolean {
  return op === "filters_read" || op === "filters_write";
}

export function isOp(v: unknown): v is Op {
  return v === "read" || v === "draft" || v === "send" || v === "modify" || v === "trash" || v === "filters_read" || v === "filters_write";
}

/** True when `tier` is high enough for `op`. */
export function tierAllows(tier: Tier, op: Op): boolean {
  return TIER_RANK[tier] >= TIER_RANK[OP_TIER[op]];
}

/** Expand granted scopes through the implication table. */
function effectiveScopes(granted: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const s of granted) {
    out.add(s);
    for (const implied of IMPLIES[s] ?? []) out.add(implied);
  }
  return out;
}

/** True when the granted scopes cover `op`. */
export function scopesCover(granted: readonly string[], op: Op): boolean {
  return effectiveScopes(granted).has(OP_SCOPE[op]);
}

/** True when the granted scopes cover every op of `tier` (no re-consent needed). */
export function scopesCoverTier(granted: readonly string[], tier: Tier): boolean {
  const eff = effectiveScopes(granted);
  return TIER_SCOPES[tier].every((s) => eff.has(s));
}

/** True when the granted scopes cover the filter ops (`gmail.settings.basic`; `modify` does not imply it). */
export function scopesCoverFilters(granted: readonly string[]): boolean {
  return effectiveScopes(granted).has(SCOPE.settingsBasic);
}

/** Space-separated `scope` parameter for an authorization request. */
export function authScopeParam(tier: Tier, opts?: { filters?: boolean }): string {
  const filters = opts?.filters ? [SCOPE.settingsBasic] : [];
  return ["openid", "email", ...TIER_SCOPES[tier], ...filters].join(" ");
}
