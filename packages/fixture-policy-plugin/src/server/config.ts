/**
 * Fixture policy config parsing (TEST ONLY). Never throws on malformed input —
 * a bad entry is dropped, keeping the plugin fail-closed (default-deny).
 */

/** One allow-list entry: a principal + the host actions it may perform. */
export interface AllowEntry {
  /** Optional issuer to match; omitted ⇒ any issuer for this sub. */
  iss?: string;
  /** Subject (identity join key) granted by this entry. */
  sub: string;
  /** Granted actions; `["*"]` or omitted ⇒ all actions. */
  actions?: string[];
}

export interface FixturePolicyConfig {
  enabled: boolean;
  allow: AllowEntry[];
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function parseEntry(raw: unknown): AllowEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const sub = str(r.sub);
  if (!sub) return null; // sub is the join key; an entry without it is meaningless
  const actions = Array.isArray(r.actions)
    ? r.actions.filter((a): a is string => typeof a === "string")
    : undefined;
  return { sub, ...(str(r.iss) ? { iss: str(r.iss) } : {}), ...(actions ? { actions } : {}) };
}

/** Parse raw plugin config into a normalized shape (never throws). */
export function parseFixturePolicyConfig(
  raw: Record<string, unknown> | undefined | null,
): FixturePolicyConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const allow = Array.isArray(r.allow)
    ? r.allow.map(parseEntry).filter((e): e is AllowEntry => e !== null)
    : [];
  return { enabled: r.enabled !== false, allow };
}
