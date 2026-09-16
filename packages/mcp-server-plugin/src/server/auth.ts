/**
 * Credential verification for `/mcp` (spec Req 4, design.md "Auth boundary").
 *
 * `createNetworkGuard` is applied PER-ROUTE, so `/mcp` does not "opt out of" a
 * global guard — it simply sits outside it and must therefore **self-guard**
 * (task 2.3). That is why this module exists at all.
 *
 * Two properties are structural rather than merely tested, which is the point:
 *
 *  - **No loopback carve-out (A3).** `authenticate` takes no address, no
 *    `isGenuinelyLocal` flag, and no request object. There is no parameter
 *    through which "the caller is local" could influence the outcome, so the
 *    loopback allowance cannot leak in by a later edit.
 *
 *  - **No trust in adjacent auth state (A4).** It reads the `Authorization`
 *    header value and nothing else — never `request.isAuthenticated`, which the
 *    global hooks in `auth-plugin.ts` and `bearer-auth.ts` set for cookies and
 *    device tokens alike. A cookie-authenticated browser therefore cannot reach
 *    this endpoint, because the cookie never enters this function.
 *
 * Being a pure function of one header value also gives A7 for free: the
 * credential is per-request, because there is nowhere to cache it per
 * connection.
 */
import crypto from "node:crypto";
import type { Tier } from "@blackbelt-technology/pi-dashboard-shared/tiers.js";
import type { McpCaller, McpTokenRegistry } from "./tokens.js";

const BEARER_PREFIX = "bearer ";

export interface AuthDeps {
  /** Session-scoped tokens (Decision 6/7). */
  tokens: Pick<McpTokenRegistry, "resolve">;
  /**
   * Paired-device bearer verification, returning a device id or null. Wired to
   * `PairedDeviceRegistry.verify` in the plugin entry. A device caller has NO
   * originating session (M5), which is what keeps external clients outside the
   * self-target guard.
   */
  verifyDeviceToken(token: string): string | null;
  /**
   * Tier-aware paired-device verification (change: expand-mcp-tiered-surface,
   * D1). Preferred over `verifyDeviceToken` when present. Absent against an old
   * host (service-board skew), in which case every device token resolves to
   * `operate` — the access an old host grants.
   */
  verifyDeviceTokenTier?(token: string): { id: string; tier: Tier } | null;
}

/**
 * Extract the bearer credential from an `Authorization` header.
 *
 * Returns `null` for every malformed shape rather than throwing (A9): a header
 * arrives on unauthenticated requests, so this parser is itself an attack
 * surface. The scheme match is case-insensitive per RFC 7235; the token is not
 * trimmed beyond the single delimiting space, so a token with stray whitespace
 * simply fails to match a stored hash rather than being silently repaired.
 */
export function parseBearer(header: string | string[] | undefined): string | null {
  // A repeated Authorization header is ambiguous — refuse rather than pick.
  if (typeof header !== "string") return null;
  if (header.length < BEARER_PREFIX.length) return null;
  if (!header.slice(0, BEARER_PREFIX.length).toLowerCase().startsWith(BEARER_PREFIX)) return null;
  const token = header.slice(BEARER_PREFIX.length);
  return token.length > 0 ? token : null;
}

/**
 * SHA-256 fingerprint of the PRESENTED credential — the throttle key's second
 * dimension (design.md D7). Computed over the raw presented value, valid or
 * not: a brute-forcer rotating guesses still creates one bucket per distinct
 * guess, and the per-ip ceiling catches the rotation.
 *
 * The digest is never logged (X6) — it exists only to key the throttle maps.
 * A headerless request fingerprints the empty string: all such requests from
 * one ip share a bucket, and the per-ip ceiling still bounds them.
 */
export function credentialFingerprint(header: string | string[] | undefined): string {
  const token = parseBearer(header);
  return crypto.createHash("sha256").update(token ?? "").digest("hex");
}

/**
 * Resolve an `Authorization` header to a caller, or `null` when it
 * authenticates nothing.
 *
 * Session tokens are checked first: a value that is a valid session token can
 * never also be a valid device token, so the order is not security-relevant —
 * but checking the narrower, session-bound credential first keeps the resolved
 * identity as specific as possible.
 */
export function authenticate(
  header: string | string[] | undefined,
  deps: AuthDeps,
): McpCaller | null {
  const token = parseBearer(header);
  if (token === null) return null;

  const sessionCaller = deps.tokens.resolve(token);
  if (sessionCaller) return sessionCaller;

  // Prefer the tier-aware service; fall back to the id-only one with full
  // access (an old host has no tiers). See change: expand-mcp-tiered-surface D1.
  if (deps.verifyDeviceTokenTier) {
    const verified = deps.verifyDeviceTokenTier(token);
    return verified ? { kind: "device", deviceId: verified.id, tier: verified.tier } : null;
  }
  const deviceId = deps.verifyDeviceToken(token);
  return deviceId ? { kind: "device", deviceId, tier: "operate" } : null;
}
