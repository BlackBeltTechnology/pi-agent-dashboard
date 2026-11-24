/**
 * Validation of a `POST /api/live-server/:id/capability` response (change:
 * serve-live-previews-on-capability-origin, D7). The viewer frames ONLY a shape it recognises for the tier the
 * server named — never a URL the server merely names — and refuses a preview origin that equals the dashboard's own.
 *
 *   tier 1 | 2 | 4  → `origin` (http/https) + `path: "/"`
 *   tier 3          → `origin` + `path: "/?k=<secret>"`
 *   tier 5          → `path: "/preview/<pid>/"`, NO `origin`, NO `base`
 *   "legacy"        → `path: "/live/<id>/~c/<token>/"`, NO `origin`, NO `base`
 *   (no `tier`)     → an older server: the legacy shape
 */

export type CapabilityTier = 1 | 2 | 3 | 4 | 5 | "legacy";

export interface MintShape {
  tier: CapabilityTier;
  origin?: string;
  path: string;
  base?: string;
  expiresAt: number;
  tokenId?: string;
  /** Tier 5: a previous pid was superseded, the running site must restart under the new base. */
  restartRequired?: boolean;
  policy?: { egress: "open" | "restricted"; scripts: boolean };
}

const LEGACY_PATH = /^\/live\/[A-Za-z0-9_-]+\/~c\/[A-Za-z0-9_-]{22,}\/$/;
const TIER5_PATH = /^\/preview\/[A-Za-z0-9_-]{22,}\/$/;
const TIER3_PATH = /^\/\?k=[A-Za-z0-9_-]{16,}$/;
const BASE_PATH = /^\/preview\/[A-Za-z0-9_-]{22,}\/$/;

/** `new URL(o).origin` for an http(s) URL that is exactly an origin; otherwise `null`. */
export function canonicalOrigin(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 300) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== "")) return null;
    return u.origin;
  } catch {
    return null;
  }
}

function parsePolicy(v: unknown): MintShape["policy"] {
  if (!v || typeof v !== "object") return undefined;
  const { egress, scripts } = v as { egress?: unknown; scripts?: unknown };
  if ((egress !== "open" && egress !== "restricted") || typeof scripts !== "boolean") return undefined;
  return { egress, scripts };
}

/**
 * The validated shape, or `null` when the response is not acceptable. `ownOrigins` are the dashboard's own origins
 * (page origin, API-base origin): a preview origin equal to one of them would put the preview on the dashboard.
 */
export function validateMintResponse(json: Record<string, unknown>, ownOrigins: readonly string[]): MintShape | null {
  const { path, expiresAt } = json;
  if (typeof path !== "string" || typeof expiresAt !== "number") return null;
  const tier = json.tier === undefined ? "legacy" : json.tier;
  const common = {
    expiresAt,
    tokenId: typeof json.tokenId === "string" ? json.tokenId : undefined,
    policy: parsePolicy(json.policy),
  };
  if (tier === "legacy") {
    if (!LEGACY_PATH.test(path) || json.origin !== undefined || json.base !== undefined) return null;
    return { tier, path, ...common };
  }
  if (tier === 5) {
    if (!TIER5_PATH.test(path) || json.origin !== undefined || json.base !== undefined) return null;
    return { tier, path, ...common, ...(json.restartRequired === true ? { restartRequired: true } : {}) };
  }
  if (tier !== 1 && tier !== 2 && tier !== 3 && tier !== 4) return null;
  if (tier === 3 ? !TIER3_PATH.test(path) : path !== "/") return null;
  const origin = canonicalOrigin(json.origin);
  if (!origin) return null;
  const own = new Set(ownOrigins.map((o) => canonicalOrigin(o)).filter((o): o is string => o !== null));
  if (own.has(origin)) return null;
  let base: string | undefined;
  if (json.base !== undefined) {
    if (typeof json.base !== "string" || !BASE_PATH.test(json.base)) return null;
    base = json.base;
  }
  return { tier, origin, path, ...(base ? { base } : {}), ...common };
}
