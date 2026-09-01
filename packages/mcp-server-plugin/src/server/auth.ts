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
import type { McpCaller } from "./tokens.js";
import type { McpTokenRegistry } from "./tokens.js";

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

  const deviceId = deps.verifyDeviceToken(token);
  return deviceId ? { kind: "device", deviceId } : null;
}
