/**
 * OAuth2 authentication module for the dashboard server.
 * Supports GitHub, Google, Keycloak, and generic OIDC providers.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import jwt from "jsonwebtoken";
import type { AuthConfig, AuthProviderConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { CONFIG_FILE } from "@blackbelt-technology/pi-dashboard-shared/config.js";
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
  sub: string; // email
  name: string;
  username: string;
  provider: string;
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
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(parsed, null, 2) + "\n");
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
    { sub: user.sub, name: user.name, username: user.username, provider: user.provider },
    secret,
    { expiresIn: TOKEN_EXPIRY },
  );
}

export function verifyToken(token: string, secret: string): TokenPayload | null {
  try {
    const payload = jwt.verify(token, secret) as TokenPayload;
    return payload;
  } catch {
    return null;
  }
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

export function buildRedirectUri(provider: string, port: number): string {
  const base = getTunnelUrl() ?? `http://localhost:${port}`;
  return `${base}/auth/callback/${provider}`;
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
 * Exchange an authorization code for an access token.
 */
export async function exchangeCode(
  provider: ResolvedProvider,
  code: string,
  redirectUri: string,
): Promise<string | null> {
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
    return data.access_token ?? null;
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
): Promise<{ email: string; name: string; username: string } | null> {
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
    return email ? { email, name, username } : null;
  } catch {
    return null;
  }
}
