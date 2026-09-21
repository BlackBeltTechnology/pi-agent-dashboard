/**
 * Parsed, validated configuration for the Keycloak resolver plugin, plus the
 * activation predicate. All values are config-seeded (getPluginConfig()); the
 * plugin hardcodes NO issuer/realm/host/port/client/audience/key.
 *
 * Activation rule (openspec add-multi-user-identity-plane, D1/D7): the resolver
 * is ACTIVE only when it is enabled AND has both `issuer` and `audience` AND —
 * for an `http:` issuer — `allowInsecureHttp` is true. Otherwise it is INERT
 * and resolves every request to `null`, so the dashboard behaves as before.
 */

export interface KeycloakResolverConfig {
  enabled: boolean;
  issuer?: string;
  audience?: string;
  authorizedParty?: string;
  jwksUri?: string;
  /** Public PKCE client id advertised to the BROWSER login gate (D16). Distinct
   * from `authorizedParty` (which only pins `azp` in token validation). The
   * browser login gate is offered only when this is set. */
  browserClientId?: string;
  /** Browser-reachable OIDC discovery/authorize base for the login gate (D16).
   * For tunneled/dockerized topologies where `issuer` (the JWT `iss` pin) is an
   * internal URL. Falls back to `issuer` when unset. */
  browserIssuer?: string;
  clockSkewSeconds: number;
  networkTimeoutMs: number;
  allowInsecureHttp: boolean;
}

/** Config that is enabled AND fully seeded to actually validate tokens. */
export interface ActiveKeycloakResolverConfig extends KeycloakResolverConfig {
  enabled: true;
  issuer: string;
  audience: string;
}

const DEFAULT_CLOCK_SKEW_SECONDS = 30;
const DEFAULT_NETWORK_TIMEOUT_MS = 2000;

function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** Parse raw plugin config into a normalized shape (never throws). */
export function parseKeycloakResolverConfig(
  raw: Record<string, unknown> | undefined | null,
): KeycloakResolverConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    enabled: r.enabled !== false, // default-enabled
    ...(str(r.issuer) ? { issuer: str(r.issuer) } : {}),
    ...(str(r.audience) ? { audience: str(r.audience) } : {}),
    ...(str(r.authorizedParty) ? { authorizedParty: str(r.authorizedParty) } : {}),
    ...(str(r.jwksUri) ? { jwksUri: str(r.jwksUri) } : {}),
    ...(str(r.browserClientId) ? { browserClientId: str(r.browserClientId) } : {}),
    ...(str(r.browserIssuer) ? { browserIssuer: str(r.browserIssuer) } : {}),
    clockSkewSeconds: boundedNumber(r.clockSkewSeconds, DEFAULT_CLOCK_SKEW_SECONDS, 0, 300),
    networkTimeoutMs: boundedNumber(r.networkTimeoutMs, DEFAULT_NETWORK_TIMEOUT_MS, 100, 5000),
    allowInsecureHttp: r.allowInsecureHttp === true,
  };
}

/** Accept only https, or explicitly opted-in http, URLs. */
export function isAllowedProviderUrl(url: string, allowInsecureHttp: boolean): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "https:" || (allowInsecureHttp && protocol === "http:");
  } catch {
    return false;
  }
}

/**
 * The activation predicate. Returns the narrowed active config when the
 * resolver should validate tokens, or `null` when it must stay inert.
 */
export function activeConfig(
  config: KeycloakResolverConfig,
): ActiveKeycloakResolverConfig | null {
  if (!config.enabled) return null;
  if (!config.issuer || !config.audience) return null;
  if (!isAllowedProviderUrl(config.issuer, config.allowInsecureHttp)) return null;
  if (config.jwksUri && !isAllowedProviderUrl(config.jwksUri, config.allowInsecureHttp)) return null;
  return config as ActiveKeycloakResolverConfig;
}

/** Convenience: is the resolver active under this config? */
export function isActive(config: KeycloakResolverConfig): boolean {
  return activeConfig(config) !== null;
}
