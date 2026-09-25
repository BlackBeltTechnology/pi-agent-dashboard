/**
 * The Keycloak principal resolver (openspec §5.3–§5.6 / design D7).
 *
 * Ownership disambiguation (§5.3):
 *   - a non-JWT / opaque bearer → `null` (not ours);
 *   - a JWT whose UNVERIFIED `iss` differs from the configured issuer → `null`
 *     (leave it for another trusted resolver);
 *   - a JWT claiming the configured issuer → OWNED: from here every failure is
 *     `reject`, never `null` (§5.6) — the chain must stop fail-closed.
 *
 * Owned-token validation (§5.4, RFC 9068): RS256 only, signature against the
 * issuer JWKS, exact `iss`, required `aud`, optional `azp`, `exp`, `sub`.
 * `email` only when it is a string and `email_verified === true`.
 *
 * DPoP (§5.5): validated only when `cnf.jkt` is present; an unbound token
 * validates as a plain bearer.
 *
 * Every crypto/JWKS/DPoP fault on an owned token is caught here and converted
 * to `reject` — the resolver NEVER throws (§5.6), so core's throw→null safety
 * net is never the path an owned-invalid token travels.
 */

import type { AuthContext, ResolverOutcome } from "@blackbelt-technology/pi-dashboard-shared/identity.js";
import { decodeJwt, decodeProtectedHeader, jwtVerify } from "jose";
import type { ActiveKeycloakResolverConfig } from "../shared/config.js";
import { type JtiReplayCache, validateDpopProof } from "./dpop.js";
import type { JwksSource } from "./jwks.js";

const REJECT = (reason: string): ResolverOutcome => ({ reject: true, reason });

/** Extract a `Bearer` token from an Authorization header, or null. */
function bearerToken(authorization: string | undefined): string | null {
  if (!authorization) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return m ? m[1].trim() : null;
}

/** Does this look like a compact JWS (three base64url segments)? */
function looksLikeJwt(token: string): boolean {
  return token.split(".").length === 3;
}

export interface KeycloakResolverDeps {
  config: ActiveKeycloakResolverConfig;
  jwks: Pick<JwksSource, "getKeyFn">;
  replayCache: JtiReplayCache;
}

/**
 * Build the resolver function bound to a config + key source. The returned
 * function is what the plugin hands to `registerPrincipalResolver`.
 */
export function createKeycloakResolver(deps: KeycloakResolverDeps) {
  const { config } = deps;

  return async function resolve(ctx: AuthContext): Promise<ResolverOutcome> {
    const token = bearerToken(ctx.authorization);
    if (!token || !looksLikeJwt(token)) return null; // not a JWT → not ours

    // Cheap unverified issuer peek for ownership. A malformed JWT that claims
    // nothing we can read is not ours.
    let unverifiedIss: string | undefined;
    try {
      unverifiedIss = decodeJwt(token).iss;
    } catch {
      return null;
    }
    if (unverifiedIss !== config.issuer) return null; // foreign issuer → fall through

    // OWNED from here: every failure is `reject`, wrapped so nothing throws.
    try {
      return await validateOwnedToken(token, ctx, deps);
    } catch (err) {
      return REJECT(`owned-token validation fault: ${err instanceof Error ? err.message : "unknown"}`);
    }
  };
}

async function validateOwnedToken(
  token: string,
  ctx: AuthContext,
  deps: KeycloakResolverDeps,
): Promise<ResolverOutcome> {
  const { config } = deps;

  // Reject a non-RS256 / `none` alg before any key work (algorithm confusion).
  const header = decodeProtectedHeader(token);
  if (header.alg !== "RS256") return REJECT(`unsupported alg '${header.alg ?? "none"}'`);

  const getKey = await deps.jwks.getKeyFn();
  const { payload } = await jwtVerify(token, getKey, {
    algorithms: ["RS256"],
    issuer: config.issuer,
    audience: config.audience,
    clockTolerance: config.clockSkewSeconds,
  });

  if (config.authorizedParty && payload.azp !== config.authorizedParty) {
    return REJECT("azp mismatch");
  }
  if (typeof payload.sub !== "string" || payload.sub.length === 0) return REJECT("missing sub");
  if (typeof payload.exp !== "number") return REJECT("missing exp");

  const dpopReject = await enforceDpop(token, ctx, payload, deps);
  if (dpopReject) return dpopReject;

  const email =
    typeof payload.email === "string" && payload.email_verified === true ? payload.email : undefined;

  // Display only (D22 user line), never an identity key.
  const name = [payload.name, payload.preferred_username].find((v): v is string => typeof v === "string" && v.length > 0);

  return {
    principal: { iss: config.issuer, sub: payload.sub, ...(email ? { email } : {}), ...(name ? { name } : {}) },
    expiresAt: payload.exp * 1000,
  };
}

/**
 * Enforce conditional DPoP: a `cnf.jkt` sender-constraint requires a valid
 * proof; an unbound token skips DPoP. Returns a `reject` outcome to short-
 * circuit, or `null` to continue. Throws only on an internal DPoP fault, which
 * the caller converts to reject.
 */
async function enforceDpop(
  token: string,
  ctx: AuthContext,
  payload: Record<string, unknown>,
  deps: KeycloakResolverDeps,
): Promise<ResolverOutcome | null> {
  const jkt = (payload.cnf as { jkt?: unknown } | undefined)?.jkt;
  if (jkt === undefined) return null; // unbound token → plain bearer
  if (typeof jkt !== "string" || jkt.length === 0) return REJECT("malformed cnf.jkt");
  if (!ctx.dpop) return REJECT("sender-constrained token requires a DPoP proof");
  await validateDpopProof({
    proof: ctx.dpop,
    method: ctx.method,
    url: ctx.url,
    accessToken: token,
    expectedThumbprint: jkt,
    replayCache: deps.replayCache,
  });
  return null;
}
