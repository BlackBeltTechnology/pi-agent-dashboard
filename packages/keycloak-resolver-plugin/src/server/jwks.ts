/**
 * OIDC discovery + JWKS key source for the Keycloak resolver (openspec §5.2 /
 * design D7).
 *
 * `jose`'s `createRemoteJWKSet` already provides the exact caching semantics
 * the spec demands: it caches the fetched JWKS, coalesces concurrent misses
 * into a single fetch, and — on an unknown `kid` — triggers at most one refresh
 * per cooldown window. We wrap it with:
 *   - our own OIDC discovery (jose ships no discovery in v6, and the host's
 *     `fetchOIDCDiscovery` omits `jwks_uri`, D7), bounded by `networkTimeoutMs`;
 *   - lazy, memoized construction so discovery runs at most once per key source.
 *
 * A discovery/JWKS outage surfaces as a THROW from the returned key getter, so
 * the caller (resolver) converts it to `reject` for an owned token — never an
 * unverified acceptance (D7: "discovery outage denies rather than accepts").
 */

import { createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import { isAllowedProviderUrl } from "../shared/config.js";

export interface JwksSourceConfig {
  issuer: string;
  jwksUri?: string;
  networkTimeoutMs: number;
  allowInsecureHttp?: boolean;
}

/** Fetch `${issuer}/.well-known/openid-configuration` and read `jwks_uri`. */
async function discoverJwksUri(
  issuer: string,
  timeoutMs: number,
  allowInsecureHttp: boolean,
): Promise<string> {
  const url = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "error" });
    if (!res.ok) throw new Error(`OIDC discovery failed for ${issuer}: ${res.status}`);
    const body = (await res.json()) as { issuer?: unknown; jwks_uri?: unknown };
    if (body.issuer !== issuer) throw new Error(`OIDC discovery issuer does not match configured issuer`);
    if (typeof body.jwks_uri !== "string" || body.jwks_uri.length === 0) {
      throw new Error(`OIDC discovery for ${issuer} did not return a jwks_uri`);
    }
    if (!isAllowedProviderUrl(body.jwks_uri, allowInsecureHttp)) {
      throw new Error(`OIDC discovery returned a disallowed jwks_uri scheme`);
    }
    return body.jwks_uri;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A lazily-initialized JWKS key source. `getKey` matches jose's
 * `JWTVerifyGetKey` so it plugs straight into `jwtVerify`. Discovery is
 * performed once on first use (or skipped when `jwksUri` is configured).
 */
export class JwksSource {
  private jwks?: JWTVerifyGetKey;
  private initializing?: Promise<JWTVerifyGetKey>;

  constructor(private readonly config: JwksSourceConfig) {}

  private async init(): Promise<JWTVerifyGetKey> {
    const uri =
      this.config.jwksUri ??
      (await discoverJwksUri(
        this.config.issuer,
        this.config.networkTimeoutMs,
        this.config.allowInsecureHttp === true,
      ));
    return createRemoteJWKSet(new URL(uri), {
      timeoutDuration: this.config.networkTimeoutMs,
    });
  }

  /** The jose key getter; constructs (and memoizes) the remote set on demand. */
  async getKeyFn(): Promise<JWTVerifyGetKey> {
    if (this.jwks) return this.jwks;
    if (!this.initializing) {
      this.initializing = this.init().then((fn) => {
        this.jwks = fn;
        return fn;
      });
      // On failure, clear the memo so a later request may retry discovery.
      this.initializing.catch(() => {
        this.initializing = undefined;
      });
    }
    return this.initializing;
  }
}
