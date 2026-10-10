/**
 * OAuth2 authentication module for the dashboard server.
 * Supports GitHub, Google, Keycloak, and generic OIDC providers.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import type { AuthConfig, AuthProviderConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { CONFIG_FILE, writeConfigFileSecure } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { isTier, rank, type Tier } from "@blackbelt-technology/pi-dashboard-shared/tiers.js";
import jwt from "jsonwebtoken";
import { getTunnelUrl } from "../tunnel/tunnel.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ResolvedProvider {
  key: string;
  name: string;
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string;
  clientId: string;
  clientSecret: string;
}

export interface AuthUser {
  sub: string; // email (OAuth) or directory user id (passkey)
  name: string;
  username: string;
  provider: string;
  /**
   * Session tier. Optional: a JWT issued before this claim existed has none
   * and is treated as `operate` on validation.
   * See change: add-passkey-user-auth (D4).
   */
  tier?: Tier;
}

export interface TokenPayload extends AuthUser {
  exp: number;
}

// ─── Built-in provider endpoints ─────────────────────────────────────────────

const GITHUB_ENDPOINTS = {
  authorizeUrl: "https://github.com/login/oauth/authorize",
  tokenUrl: "https://github.com/login/oauth/access_token",
  userInfoUrl: "https://api.github.com/user",
  scopes: "user:email",
};

const GOOGLE_ISSUER = "https://accounts.google.com";

// ─── OIDC Discovery ─────────────────────────────────────────────────────────

interface OIDCDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
}

export async function fetchOIDCDiscovery(issuerUrl: string): Promise<OIDCDiscovery> {
  const url = `${issuerUrl.replace(/\/$/, "")}/.well-known/openid-configuration`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`OIDC discovery failed for ${issuerUrl}: ${res.status}`);
  }
  const data = await res.json();
  return {
    authorization_endpoint: data.authorization_endpoint,
    token_endpoint: data.token_endpoint,
    userinfo_endpoint: data.userinfo_endpoint,
  };
}

// ─── Provider Registry ──────────────────────────────────────────────────────

export async function buildProviderRegistry(
  providers: Record<string, AuthProviderConfig>,
): Promise<Map<string, ResolvedProvider>> {
  const registry = new Map<string, ResolvedProvider>();

  for (const [key, config] of Object.entries(providers)) {
    try {
      const resolved = await resolveProvider(key, config);
      if (resolved) registry.set(key, resolved);
    } catch (err: any) {
      console.warn(`Failed to resolve OAuth provider "${key}": ${err.message}`);
    }
  }

  return registry;
}

async function resolveProvider(
  key: string,
  config: AuthProviderConfig,
): Promise<ResolvedProvider | null> {
  const base = { key, clientId: config.clientId, clientSecret: config.clientSecret };

  if (key === "github") {
    return {
      ...base,
      name: config.name ?? "GitHub",
      ...GITHUB_ENDPOINTS,
    };
  }

  // Google, Keycloak, or generic OIDC — all use OIDC discovery
  const issuerUrl = key === "google" ? GOOGLE_ISSUER : config.issuerUrl;
  if (!issuerUrl) {
    console.warn(`OAuth provider "${key}" requires issuerUrl`);
    return null;
  }

  const discovery = await fetchOIDCDiscovery(issuerUrl);
  const defaultNames: Record<string, string> = {
    google: "Google",
    keycloak: "Keycloak",
    oidc: "OIDC",
  };

  return {
    ...base,
    name: config.name ?? defaultNames[key] ?? key,
    authorizeUrl: discovery.authorization_endpoint,
    tokenUrl: discovery.token_endpoint,
    userInfoUrl: discovery.userinfo_endpoint,
    scopes: "openid email profile",
  };
}

// ─── Auth Secret Management ─────────────────────────────────────────────────

/**
 * Ensure the auth config has a secret. If missing, generate one and persist.
 * Returns the secret string.
 */
export function ensureAuthSecret(authConfig: AuthConfig): string {
  if (authConfig.secret) return authConfig.secret;

  const secret = crypto.randomBytes(16).toString("hex"); // 32-char hex
  authConfig.secret = secret;

  // Persist back to config file
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed.auth) {
      parsed.auth.secret = secret;
    }
    writeConfigFileSecure(CONFIG_FILE, JSON.stringify(parsed, null, 2) + "\n");
  } catch (err: any) {
    console.warn(`Failed to persist auth secret: ${err.message}`);
  }

  return secret;
}

// ─── JWT Token Helpers ──────────────────────────────────────────────────────

const TOKEN_EXPIRY = "7d";
export const COOKIE_NAME = "pi_dash_token";

export function signToken(user: AuthUser, secret: string): string {
  return jwt.sign(
    {
      sub: user.sub,
      name: user.name,
      username: user.username,
      provider: user.provider,
      ...(user.tier ? { tier: user.tier } : {}),
    },
    secret,
    { expiresIn: TOKEN_EXPIRY },
  );
}

export function verifyToken(token: string, secret: string): TokenPayload | null {
  try {
    const payload = jwt.verify(token, secret) as TokenPayload;
    // A present-but-unknown tier is never widened to `operate`: reject the
    // token outright (fail closed). See change: add-passkey-user-auth (D4).
    if (payload.tier !== undefined && !isTier(payload.tier)) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * `groups` claim of an OIDC `id_token`, or undefined.
 *
 * The token comes straight from the provider's token endpoint over the
 * back-channel (TLS), so per OIDC Core §3.1.3.7 its signature need not be
 * re-validated here; the `aud` claim must still name this client, so a token
 * minted for another relying party is never trusted. Only `groups` is read.
 * Non-string entries are dropped. See change: add-passkey-user-auth (D4).
 */
export function idTokenGroups(idToken: string | undefined, clientId: string): string[] | undefined {
  if (!idToken) return undefined;
  const part = idToken.split(".")[1];
  if (!part) return undefined;
  let claims: { aud?: unknown; groups?: unknown };
  try {
    claims = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId)) return undefined;
  if (!Array.isArray(claims.groups)) return undefined;
  return (claims.groups as unknown[]).filter((g): g is string => typeof g === "string");
}

/**
 * Map an OIDC `groups` claim to a session tier (D4).
 *
 * - `groupTiers` unconfigured/empty → `operate` (legacy behaviour).
 * - configured → the HIGHEST tier among matching groups; no match → `null`
 *   (login refused — fail closed).
 */
export function resolveGroupTier(
  groups: readonly string[] | undefined,
  groupTiers: Record<string, Tier> | undefined,
): Tier | null {
  if (!groupTiers || Object.keys(groupTiers).length === 0) return "operate";
  let best: Tier | null = null;
  for (const g of groups ?? []) {
    const t = Object.hasOwn(groupTiers, g) ? groupTiers[g] : undefined;
    if (t && (best === null || rank(t) > rank(best))) best = t;
  }
  return best;
}

// ─── Cookie Parsing ─────────────────────────────────────────────────────────

/**
 * Parse the auth token from a raw cookie header string.
 */
export function parseAuthCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]*)`));
  return match ? match[1] : null;
}

// ─── Email Allowlist ────────────────────────────────────────────────────────

/**
 * Check if an email is allowed by the allowedEmails list.
 * Supports exact matches and domain wildcards (*@domain.com).
 * Returns true if no allowedEmails is configured (allow all).
 */
/**
 * Check if a user is allowed by the allowedUsers list.
 * Matches against email, username, or domain wildcards (*@domain.com).
 * Returns true if no allowedUsers is configured (allow all).
 */
export function isUserAllowed(email: string, username: string, allowedUsers?: string[]): boolean {
  if (!allowedUsers || allowedUsers.length === 0) return true;
  const lowerEmail = email.toLowerCase();
  const lowerUsername = username.toLowerCase();
  return allowedUsers.some((pattern) => {
    const p = pattern.toLowerCase();
    if (p.startsWith("*@")) {
      const domain = p.slice(1); // "@domain.com"
      return lowerEmail.endsWith(domain);
    }
    // Match against email or username
    return lowerEmail === p || lowerUsername === p;
  });
}

// ─── Redirect URI Builder ───────────────────────────────────────────────────

/**
 * Build the OAuth redirect URI for a provider.
 *
 * Base precedence (highest first): explicit `baseOverride` (from config file
 * `auth.redirectBaseUrl`) → active tunnel URL → `http://localhost:<port>`.
 */
/**
 * Report a `auth.redirectBaseUrl` that is not an absolute `http(s)` origin.
 *
 * The value is deliberately still USED by `buildRedirectUri` — dropping it
 * would turn a typo into a silent no-op ("my setting does nothing"), which is
 * harder to diagnose than a redirect the provider visibly rejects. Warning and
 * proceeding keeps the operator in control while making the misconfiguration
 * observable in the server log. See change: config-override-oauth-redirect-base
 * (design D4).
 *
 * Returns true when the base is valid (or absent), false when it warned.
 */
/**
 * Strip anything secret-bearing from a configured URL before it is logged.
 *
 * A misconfigured base is echoed back so the operator can spot their typo, but
 * the raw string can carry a password (`user:pw@host`) or a token in the query
 * (`?token=...`) / fragment. Redaction MUST live here rather than in any single
 * validation branch: a value with both userinfo and a query trips whichever
 * check runs first, so a per-branch guard would simply not run.
 *
 * Operates on the RAW string rather than rebuilding from a parsed `URL`, for two
 * reasons: the values that most need diagnosing are the ones that do NOT parse
 * (`pi.example.com`, `//evil.example.com`), and rebuilding mangles exotic-but-
 * informative values (`javascript:alert(1)`). Only the secret-bearing parts are
 * replaced — scheme, host, path, and query KEYS survive, so the warning still
 * shows the operator which value is at fault.
 */
function redactUrlForLog(raw: string): string {
  return (
    raw
      // password in userinfo → keep the username, mask the secret
      .replace(/\/\/([^/@\s:]*):([^/@\s]*)@/, "//$1:***@")
      // query VALUES → keys are diagnostic, values can be tokens
      .replace(/([?&][^=&#\s]+)=[^&#\s]*/g, "$1=<redacted>")
      // fragment payload → can carry an implicit-flow access_token
      .replace(/#(.+)$/, "#<redacted>")
  );
}

export function warnOnInvalidRedirectBase(base: string | null | undefined): boolean {
  if (!base) return true;

  const complain = (reason: string) =>
    console.warn(
      `⚠️  auth.redirectBaseUrl ${reason}: "${redactUrlForLog(base)}" — OAuth redirect URIs built from it will be rejected by the provider`,
    );

  let parsed: URL;
  try {
    parsed = new URL(base);
  } catch {
    complain("is not an absolute URL (missing scheme?)");
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    complain(`must use http or https, got "${parsed.protocol}"`);
    return false;
  }
  // Test the RAW string, not the parsed fields: `new URL("https://h?").search`
  // is the empty string, so a `parsed.search || parsed.hash` check passes a bare
  // delimiter — and the delimiter still survives into the built URI, yielding
  // `https://h?/auth/callback/github`. Reported by CodeRabbit on PR #409.
  if (parsed.search || parsed.hash || /[?#]/.test(base)) {
    complain("must not carry a query string or fragment");
    return false;
  }
  // Userinfo passes every check above (right protocol, no query, no fragment) yet
  // travels in the authorize URL's `redirect_uri` parameter — landing the
  // credentials in the provider's request logs and the user's browser history.
  // The warning names the leak rather than saying "invalid URL", because the
  // hazard is not obvious from the value alone.
  // See change: config-override-oauth-redirect-base (design D4 amendment).
  if (parsed.username || parsed.password) {
    console.warn(
      `⚠️  auth.redirectBaseUrl embeds credentials ("${redactUrlForLog(base)}") — ` +
        "they would leak into the authorize URL, the provider's logs and the browser history; " +
        "remove the user:password@ prefix",
    );
    return false;
  }
  return true;
}

/** Which tier of the precedence chain produced the redirect base. */
export type RedirectBaseSource = "auth.redirectBaseUrl" | "tunnel" | "localhost";

/**
 * Resolve the redirect base AND report which tier won.
 *
 * `buildRedirectUri` only returns the finished URI, which is not enough for two
 * callers: the session cookie needs to know whether the public origin is https
 * (design D14), and the diagnostics surface needs to tell an operator which
 * setting actually took effect (design D10). Both derive from this one function
 * so they can never disagree with the URI the provider is sent.
 *
 * See change: config-override-oauth-redirect-base.
 */
export function resolveRedirectBase(
  port: number,
  baseOverride?: string | null,
): { base: string; source: RedirectBaseSource } {
  // `||` not `??` — an empty string means "absent" here exactly as it does in
  // buildRedirectUri (design D1); the two MUST agree or the cookie flag and the
  // minted URI could describe different origins.
  const tunnel = getTunnelUrl();
  const raw = baseOverride || tunnel || `http://localhost:${port}`;
  const source: RedirectBaseSource = baseOverride
    ? "auth.redirectBaseUrl"
    : tunnel
      ? "tunnel"
      : "localhost";
  return { base: raw.replace(/\/+$/, ""), source };
}

export function buildRedirectUri(
  provider: string,
  port: number,
  baseOverride?: string | null,
): string {
  return `${resolveRedirectBase(port, baseOverride).base}/auth/callback/${provider}`;
}

// ─── OAuth Flow Helpers ─────────────────────────────────────────────────────

/**
 * Build the authorize URL to redirect the user to.
 */
export function buildAuthorizeUrl(
  provider: ResolvedProvider,
  redirectUri: string,
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: provider.clientId,
    redirect_uri: redirectUri,
    scope: provider.scopes,
    state,
    response_type: "code",
  });
  return `${provider.authorizeUrl}?${params.toString()}`;
}

/**
 * Exchange an authorization code for tokens: the access token plus, for OIDC
 * providers, the `id_token` (read for its `groups` claim — see
 * `idTokenGroups`). See change: add-passkey-user-auth (D4).
 */
export async function exchangeCode(
  provider: ResolvedProvider,
  code: string,
  redirectUri: string,
): Promise<{ accessToken: string; idToken?: string } | null> {
  try {
    const body = new URLSearchParams({
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };
    // GitHub needs Accept header to get JSON response
    if (provider.key === "github") {
      headers["Accept"] = "application/json";
    }

    const res = await fetch(provider.tokenUrl, {
      method: "POST",
      headers,
      body: body.toString(),
    });

    if (!res.ok) return null;

    const data = await res.json();
    if (typeof data.access_token !== "string" || !data.access_token) return null;
    return {
      accessToken: data.access_token,
      ...(typeof data.id_token === "string" ? { idToken: data.id_token } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Fetch user info from the provider using an access token.
 * Returns { email, name } or null on failure.
 */
export async function fetchUserInfo(
  provider: ResolvedProvider,
  accessToken: string,
): Promise<{ email: string; name: string; username: string; groups?: string[] } | null> {
  try {
    const res = await fetch(provider.userInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;

    const data = await res.json();

    if (provider.key === "github") {
      // GitHub: name may be null, email may be null (private)
      const name = data.name || data.login || "Unknown";
      let email = data.email;
      if (!email) {
        // Fetch email from /user/emails endpoint
        const emailRes = await fetch("https://api.github.com/user/emails", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (emailRes.ok) {
          const emails = await emailRes.json();
          const primary = emails.find((e: any) => e.primary) ?? emails[0];
          email = primary?.email;
        }
      }
      const username = data.login || "";
      return email ? { email, name, username } : null;
    }

    // OIDC providers: standard claims
    const email = data.email;
    const name = data.name || data.preferred_username || data.sub || "Unknown";
    const username = data.preferred_username || data.sub || "";
    // `groups` (userinfo) feeds `auth.groupTiers`. Non-string entries dropped.
    const groups = Array.isArray(data.groups)
      ? (data.groups as unknown[]).filter((g): g is string => typeof g === "string")
      : undefined;
    return email ? { email, name, username, ...(groups ? { groups } : {}) } : null;
  } catch {
    return null;
  }
}
