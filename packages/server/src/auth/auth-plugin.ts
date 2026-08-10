/**
 * Fastify plugin that registers OAuth auth routes and the onRequest hook.
 * Only registered when auth is configured.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import cookie from "@fastify/cookie";
import crypto from "node:crypto";
import type { AuthConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import {
  type ResolvedProvider,
  type TokenPayload,
  buildProviderRegistry,
  ensureAuthSecret,
  signToken,
  verifyToken,
  parseAuthCookie,
  isUserAllowed,
  buildRedirectUri,
  buildAuthorizeUrl,
  exchangeCode,
  fetchUserInfo,
  COOKIE_NAME,
} from "./auth.js";
import { isBypassedHost, isGenuinelyLocal } from "./localhost-guard.js";
import { verifyLocalToken } from "./local-token.js";
import { PUBLIC_PAIRING_PREFIXES } from "../routes/pairing-routes.js";
import type { WsRouteScope } from "./ws-ticket.js";

/**
 * Returns true if the request URL matches any of the configured bypass prefixes.
 * Exported for unit testing.
 */
export function isBypassed(url: string, bypassUrls: string[]): boolean {
  return bypassUrls.some((prefix) => url.startsWith(prefix));
}



/** Escape HTML special characters to prevent XSS in server-rendered pages. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface AuthPluginOptions {
  authConfig: AuthConfig;
  port: number;
  /** Merged trusted networks (top-level + auth.bypassHosts) */
  resolvedTrustedNetworks?: string[];
  /** Local-IPC allowlist token granting genuine-local trust (D10). */
  localToken?: string;
}

/**
 * State parameter encoding: encodes the return URL + CSRF nonce.
 */
function encodeState(returnUrl: string): string {
  const nonce = crypto.randomBytes(8).toString("hex");
  return Buffer.from(JSON.stringify({ returnUrl, nonce })).toString("base64url");
}

function decodeState(state: string): { returnUrl: string } {
  try {
    const parsed = JSON.parse(Buffer.from(state, "base64url").toString());
    return { returnUrl: parsed.returnUrl || "/" };
  } catch {
    return { returnUrl: "/" };
  }
}

/**
 * Simple login page HTML with provider links.
 */
function renderLoginPage(providers: ResolvedProvider[], error?: string): string {
  const providerLinks = providers
    .map((p) => `<a href="/auth/start/${p.key}" style="display:block;margin:10px 0;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;text-align:center;font-size:16px;">Sign in with ${p.name}</a>`)
    .join("\n");

  const errorHtml = error
    ? `<div style="color:#ef4444;margin-bottom:16px;">${error}</div>`
    : "";

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PI Dashboard — Sign In</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f172a;color:#e2e8f0;}
.card{background:#1e293b;padding:40px;border-radius:12px;max-width:400px;width:100%;text-align:center;}
h1{margin:0 0 24px;font-size:24px;}</style>
</head><body><div class="card"><h1>🔐 PI Dashboard</h1>${errorHtml}${providerLinks}</div></body></html>`;
}

/**
 * Access denied page HTML.
 */
function renderDeniedPage(email: string): string {
  const safeEmail = escapeHtml(email);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PI Dashboard — Access Denied</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f172a;color:#e2e8f0;}
.card{background:#1e293b;padding:40px;border-radius:12px;max-width:400px;width:100%;text-align:center;}
h1{margin:0 0 16px;font-size:24px;color:#ef4444;}</style>
</head><body><div class="card"><h1>Access Denied</h1><p>The email <strong>${safeEmail}</strong> is not authorized to access this dashboard.</p>
<a href="/auth/login" style="color:#60a5fa;">Try a different account</a></div></body></html>`;
}

export async function registerAuthPlugin(
  fastify: FastifyInstance,
  options: AuthPluginOptions,
): Promise<void> {
  const { authConfig, port, resolvedTrustedNetworks, localToken } = options;

  // Mutable auth state — can be rebuilt at runtime via reloadAuth()
  const authState = {
    secret: ensureAuthSecret(authConfig),
    providerRegistry: await buildProviderRegistry(authConfig.providers),
    allowedUsers: authConfig.allowedUsers,
    bypassUrls: authConfig.bypassUrls ?? [],
    bypassHosts: resolvedTrustedNetworks ?? authConfig.bypassHosts ?? [],
  };

  if (authState.providerRegistry.size === 0) {
    console.warn("Auth configured but no providers resolved — auth disabled");
    return;
  }

  // Expose reload function on the fastify instance for runtime config updates
  (fastify as any)._reloadAuth = async (newConfig: AuthConfig) => {
    authState.secret = ensureAuthSecret(newConfig);
    authState.providerRegistry = await buildProviderRegistry(newConfig.providers);
    authState.allowedUsers = newConfig.allowedUsers;
    authState.bypassUrls = newConfig.bypassUrls ?? [];
    authState.bypassHosts = newConfig.bypassHosts ?? [];
    const names = Array.from(authState.providerRegistry.values()).map((p) => p.name);
    console.log(`🔐 Auth reloaded with providers: ${names.join(", ")}`);
  };

  // Tag requests with authentication status (read by createNetworkGuard).
  // May already be decorated by the bearer branch registered earlier.
  if (!fastify.hasRequestDecorator?.("isAuthenticated")) {
    fastify.decorateRequest("isAuthenticated", false);
  }

  // Register cookie plugin
  await fastify.register(cookie);

  // ─── Auth Routes ────────────────────────────────────────────────────────

  // GET /auth/login — provider picker or auto-redirect
  fastify.get("/auth/login", async (request, reply) => {
    const providers = Array.from(authState.providerRegistry.values());
    const error = (request.query as any)?.error;

    if (providers.length === 1 && !error) {
      // Auto-redirect to single provider
      const p = providers[0];
      const redirectUri = buildRedirectUri(p.key, port);
      const returnUrl = (request.query as any)?.return || "/";
      const state = encodeState(returnUrl);
      const url = buildAuthorizeUrl(p, redirectUri, state);
      return reply.redirect(url);
    }

    return reply.type("text/html").send(renderLoginPage(providers, error));
  });

  // GET /auth/start/:provider — redirect to provider's authorize URL
  fastify.get("/auth/start/:provider", async (request, reply) => {
    const providerKey = (request.params as any).provider;
    const provider = authState.providerRegistry.get(providerKey);
    if (!provider) {
      return reply.code(404).send({ error: "Unknown provider" });
    }
    const redirectUri = buildRedirectUri(providerKey, port);
    const returnUrl = (request.query as any)?.return || "/";
    const state = encodeState(returnUrl);
    const url = buildAuthorizeUrl(provider, redirectUri, state);
    return reply.redirect(url);
  });

  // GET /auth/callback/:provider — OAuth callback
  fastify.get("/auth/callback/:provider", async (request, reply) => {
    const providerKey = (request.params as any).provider;
    const provider = authState.providerRegistry.get(providerKey);
    if (!provider) {
      return reply.code(404).send({ error: "Unknown provider" });
    }

    const query = request.query as any;
    const code = query.code;
    const stateParam = query.state || "";

    if (!code) {
      return reply.redirect("/auth/login?error=Missing+authorization+code");
    }

    const redirectUri = buildRedirectUri(providerKey, port);
    const accessToken = await exchangeCode(provider, code, redirectUri);
    if (!accessToken) {
      return reply.redirect("/auth/login?error=Token+exchange+failed");
    }

    const userInfo = await fetchUserInfo(provider, accessToken);
    if (!userInfo) {
      return reply.redirect("/auth/login?error=Failed+to+fetch+user+info");
    }

    if (!isUserAllowed(userInfo.email, userInfo.username, authState.allowedUsers)) {
      return reply.code(403).type("text/html").send(renderDeniedPage(userInfo.email));
    }

    const token = signToken(
      { sub: userInfo.email, name: userInfo.name, username: userInfo.username, provider: providerKey },
      authState.secret,
    );

    const { returnUrl } = decodeState(stateParam);

    reply.setCookie(COOKIE_NAME, token, {
      path: "/",
      httpOnly: true,
      secure: request.protocol === "https",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
    });

    return reply.redirect(returnUrl);
  });

  // POST /auth/logout
  fastify.post("/auth/logout", async (_request, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return reply.redirect("/auth/login");
  });

  // GET /auth/status — no auth required
  fastify.get("/auth/status", async (request, reply) => {
    const cookieToken = (request.cookies as any)?.[COOKIE_NAME];
    if (cookieToken) {
      const payload = verifyToken(cookieToken, authState.secret);
      if (payload) {
        return { authenticated: true, user: { name: payload.name, email: payload.sub, provider: payload.provider } };
      }
    }
    return { authenticated: false };
  });

  // ─── onRequest Hook ─────────────────────────────────────────────────────

  fastify.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    // Already authenticated by a prior branch (e.g. the bearer device-auth
    // hook registered before this plugin). One OR branch — D7.
    if ((request as any).isAuthenticated) return;

    // Genuine same-host bypass: loopback AND no proxy-forwarding header, or a
    // valid local-IPC token. A tunnel arriving as 127.0.0.1 (with a forwarding
    // header) is NOT exempted (D10, narrowed).
    if (isGenuinelyLocal(request.ip, request.headers as Record<string, unknown>)) return;
    if (localToken && verifyLocalToken(request.headers as Record<string, unknown>, localToken)) return;

    // Skip auth routes
    if (request.url.startsWith("/auth/")) return;

    // Skip PUBLIC device-facing pairing routes (a pairing device has no
    // credential yet; these are gated by the one-time code + approval).
    if (PUBLIC_PAIRING_PREFIXES.some((p) => request.url.startsWith(p))) return;

    // Skip health endpoint
    if (request.url === "/api/health") return;

    // Skip /v1/* — proxy auth gate handles those
    if (request.url.startsWith("/v1/")) return;

    // Skip configured bypass URL prefixes
    if (isBypassed(request.url, authState.bypassUrls)) return;

    // Skip configured bypass hosts (trusted source IPs)
    if (isBypassedHost(request.ip, authState.bypassHosts)) return;

    // Validate JWT cookie
    const cookieToken = (request.cookies as any)?.[COOKIE_NAME];
    if (cookieToken) {
      const payload = verifyToken(cookieToken, authState.secret);
      if (payload) {
        (request as any).isAuthenticated = true;
        return;
      }
      // Invalid/expired — clear cookie
      reply.clearCookie(COOKIE_NAME, { path: "/" });
    }

    // Not authenticated — redirect or 401
    const accept = request.headers.accept || "";
    if (accept.includes("text/html")) {
      const returnUrl = encodeURIComponent(request.url);
      return reply.redirect(`/auth/login?return=${returnUrl}`);
    }
    return reply.code(401).send({ error: "Authentication required" });
  });

  const providerNames = Array.from(authState.providerRegistry.values()).map((p) => p.name);
  console.log(`🔐 Auth enabled with providers: ${providerNames.join(", ")}`);
}

/**
 * Validate auth for a WebSocket upgrade request.
 * Returns true if the request is allowed, false if it should be rejected.
 */
export function validateWsUpgrade(
  cookieHeader: string | undefined,
  remoteAddress: string,
  secret: string,
  trustedNetworks: string[] = [],
  opts?: {
    /** Ephemeral single-use ticket (D11); the durable bearer never rides WS. */
    ticket?: string | null;
    scope?: WsRouteScope | null;
    consumeTicket?: (ticket: string, scope: WsRouteScope) => boolean;
    /** Upgrade request headers (for proxy-hop detection + local token). */
    headers?: Record<string, unknown>;
    /** Local-IPC allowlist token. */
    localToken?: string;
  },
): boolean {
  // Genuine same-host origin, or a valid local-IPC token. A tunnel presenting
  // as loopback (with a forwarding header) is NOT trusted here (D10, narrowed).
  if (isGenuinelyLocal(remoteAddress, opts?.headers)) return true;
  if (opts?.localToken && verifyLocalToken(opts.headers, opts.localToken)) return true;
  if (trustedNetworks.length > 0 && isBypassedHost(remoteAddress, trustedNetworks)) return true;
  // Cross-origin device auth: a valid single-use ticket minted from an
  // authenticated REST call. The upgrade is refused unless it validates, so no
  // authenticated socket exists before auth (no TOCTOU). F6: only the ephemeral
  // ticket — never the durable bearer — may ride the WS.
  if (opts?.consumeTicket && opts.scope) {
    if (opts.ticket && opts.consumeTicket(opts.ticket, opts.scope)) return true;
  }
  const token = parseAuthCookie(cookieHeader);
  if (!token) return false;
  return verifyToken(token, secret) !== null;
}
