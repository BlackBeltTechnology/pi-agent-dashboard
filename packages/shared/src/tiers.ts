/**
 * Tier primitives for paired-device credentials (see change:
 * expand-mcp-tiered-surface, design D1/D1b).
 *
 * A tier is an ORDERED capability level attached to a bearer credential:
 * `observe < control < operate`. It is a property of the credential (decided at
 * mint, shown in the Paired Devices list), never of a request or a session —
 * which is why these helpers are pure and the only state lives on the registry
 * row.
 *
 * Lives in `shared` because two independent surfaces must agree on the order:
 * the server's REST route-tier gate and the MCP plugin's tool-surface filter.
 * One definition, one ranking.
 */

/** Ordered, weakest → strongest. `rank` is the index into this array. */
export const TIERS = ["observe", "control", "operate"] as const;

/** A capability tier carried by a paired-device token. */
export type Tier = (typeof TIERS)[number];

/** Narrow an untrusted value (config / request body / JSON row) to a `Tier`. */
export function isTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value);
}

/** Numeric rank of a tier; higher = more capable. Unlisted tiers must be
 * narrowed first (`isTier`) so this stays total over `Tier`. */
export function rank(tier: Tier): number {
  return TIERS.indexOf(tier);
}

/** The weaker of two tiers (same tier returns that tier). */
export function minTier(a: Tier, b: Tier): Tier {
  return rank(a) <= rank(b) ? a : b;
}

/**
 * Per-source default tier at mint time (D1/D8):
 *  - `pairing` — the QR ceremony pairs a phone browser that drives the whole
 *    dashboard, so it defaults to `operate`.
 *  - `manual` — direct mint for an MCP client (Settings + CLI), which should
 *    start read-only, so it defaults to `observe`.
 */
export function defaultTierForSource(source: "pairing" | "manual"): Tier {
  return source === "pairing" ? "operate" : "observe";
}
