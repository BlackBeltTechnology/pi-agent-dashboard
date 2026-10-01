/**
 * DPoP proof validation (RFC 9449) for sender-constrained Keycloak tokens
 * (openspec §5.5 / design D7). Validated ONLY when the access token carries a
 * `cnf.jkt` confirmation; an unbound token skips DPoP entirely and validates as
 * a plain bearer.
 *
 * Validated elements (all required; any missing/mismatch throws → the resolver
 * converts to `reject`):
 *   - proof JWS `typ` is `dpop+jwt` and signature verifies under its embedded
 *     `jwk` (via jose `EmbeddedJWK`);
 *   - SHA-256 thumbprint of that `jwk` equals the token's `cnf.jkt`;
 *   - `htm` equals the request method;
 *   - `htu` equals the canonical request URL (query/fragment stripped upstream);
 *   - `ath` equals base64url(SHA-256(access token));
 *   - `iat` is within the freshness window;
 *   - `jti` is unreused within that window (single-instance LRU).
 */

import { createHash } from "node:crypto";
import { calculateJwkThumbprint, decodeProtectedHeader, EmbeddedJWK, jwtVerify } from "jose";

/** Default DPoP proof freshness window (seconds). */
export const DEFAULT_DPOP_WINDOW_SECONDS = 300;

/** base64url(SHA-256(input)) — used for the `ath` access-token hash. */
export function base64UrlSha256(input: string): string {
  return createHash("sha256").update(input).digest("base64url");
}

/**
 * Bounded LRU of seen `jti` values with TTL = the freshness window. Defends a
 * single dashboard instance (cross-instance replay is out of scope, D6).
 */
export class JtiReplayCache {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly windowSeconds: number = DEFAULT_DPOP_WINDOW_SECONDS,
    private readonly maxEntries = 10_000,
  ) {}

  /** Record a jti; returns false when it was already present (a replay). */
  checkAndRecord(jti: string, now: number = Date.now()): boolean {
    this.evict(now);
    if (this.seen.has(jti)) return false;
    this.seen.set(jti, now + this.windowSeconds * 1000);
    if (this.seen.size > this.maxEntries) {
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    return true;
  }

  private evict(now: number): void {
    for (const [jti, expiry] of this.seen) {
      if (expiry <= now) this.seen.delete(jti);
    }
  }
}

export interface DpopValidationInput {
  proof: string;
  method: string;
  /** Canonical request URL (D6a) — query/fragment already stripped. */
  url: string;
  accessToken: string;
  /** The `cnf.jkt` thumbprint from the access token. */
  expectedThumbprint: string;
  replayCache: JtiReplayCache;
  windowSeconds?: number;
  now?: number;
}

export class DpopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DpopError";
  }
}

const DPOP_ALGORITHMS = [
  "ES256", "ES384", "ES512", "RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "EdDSA",
];

/** Verify the proof JWS under a PUBLIC asymmetric embedded jwk (RFC 9449 §4.2). */
async function verifyProofJws(
  proof: string,
): Promise<{ payload: Record<string, unknown>; jwk: Parameters<typeof calculateJwkThumbprint>[0] }> {
  try {
    const peek = decodeProtectedHeader(proof) as { alg?: string; jwk?: Record<string, unknown> };
    if (!peek.alg || peek.alg === "none" || peek.jwk?.kty === "oct" || "d" in (peek.jwk ?? {})) {
      throw new Error("proof must use a public asymmetric key");
    }
    const result = await jwtVerify(proof, EmbeddedJWK, { typ: "dpop+jwt", algorithms: DPOP_ALGORITHMS });
    const jwk = (result.protectedHeader as { jwk?: unknown }).jwk;
    if (!jwk) throw new Error("proof missing embedded jwk");
    return { payload: result.payload as Record<string, unknown>, jwk: jwk as never };
  } catch (err) {
    throw new DpopError(`DPoP proof signature invalid: ${err instanceof Error ? err.message : "unknown"}`);
  }
}

/**
 * Validate a DPoP proof. Throws `DpopError` on any failure; returns normally on
 * success. The caller catches and converts a failure to `reject`.
 */
export async function validateDpopProof(input: DpopValidationInput): Promise<void> {
  const windowSeconds = input.windowSeconds ?? DEFAULT_DPOP_WINDOW_SECONDS;
  const now = input.now ?? Date.now();

  const { payload, jwk } = await verifyProofJws(input.proof);

  // Thumbprint of the embedded jwk must equal the token's cnf.jkt.
  if ((await calculateJwkThumbprint(jwk, "sha256")) !== input.expectedThumbprint) {
    throw new DpopError("DPoP proof key thumbprint does not match token cnf.jkt");
  }

  if (payload.htm !== input.method) throw new DpopError("DPoP htm mismatch");
  if (payload.htu !== input.url) throw new DpopError("DPoP htu mismatch");
  if (payload.ath !== base64UrlSha256(input.accessToken)) throw new DpopError("DPoP ath not bound to access token");

  const iat = payload.iat;
  if (typeof iat !== "number" || Math.abs(now / 1000 - iat) > windowSeconds) {
    throw new DpopError("DPoP proof iat outside freshness window");
  }

  const jti = payload.jti;
  if (typeof jti !== "string" || jti.length === 0 || jti.length > 1024) {
    throw new DpopError("DPoP proof missing or oversized jti");
  }
  if (!input.replayCache.checkAndRecord(jti, now)) throw new DpopError("DPoP proof jti replayed");
}
