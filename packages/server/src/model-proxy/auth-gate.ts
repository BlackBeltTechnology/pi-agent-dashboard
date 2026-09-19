/**
 * Fastify onRequest hook for /v1/* proxy routes.
 *
 * Uniform API-key auth — no JWT, no bypass inheritance.
 * See design.md Decision 2.
 *
 * See change: add-dashboard-model-proxy.
 */
import type { FastifyRequest, FastifyReply } from "fastify";
import type { ModelProxyConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { findApiKey, keyHasScope, recordKeyUsage, type ProxyScope } from "./api-key-store.js";
import { FailedAuthBackoff } from "./failed-auth-backoff.js";

export interface AuthGateDeps {
  getConfig: () => ModelProxyConfig;
  persistKeyUsage?: (apiKeys: import("@blackbelt-technology/pi-dashboard-shared/config.js").ProxyApiKey[]) => void;
}

const PROXY_KEY_PREFIX = "pi-proxy-";

function scopeForPath(url: string): ProxyScope {
  if (url.startsWith("/v1/models")) return "models:list";
  if (url.startsWith("/v1/messages")) return "messages";
  return "chat"; // /v1/chat/completions and fallback
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createModelProxyAuthGate(deps: AuthGateDeps) {
  const backoff = new FailedAuthBackoff();

  return async function modelProxyAuthGate(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const url = request.url;
    if (!url.startsWith("/v1/")) return; // not a proxy route

    const authHeader = request.headers.authorization;

    // Apply backoff delay before verification
    const ip = request.ip;
    const delay = backoff.getDelayMs(ip);
    if (delay > 0) await sleep(delay);

    // Missing authorization
    if (!authHeader) {
      backoff.record(ip);
      return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Authorization header required" });
    }

    // Extract bearer token
    if (!authHeader.startsWith("Bearer ")) {
      backoff.record(ip);
      return reply.code(401).send({ code: "AUTH_MALFORMED", message: "Authorization must be Bearer token" });
    }

    const token = authHeader.slice(7);
    if (!token) {
      backoff.record(ip);
      return reply.code(401).send({ code: "AUTH_MALFORMED", message: "Empty bearer token" });
    }

    // Reject non-proxy-key tokens (JWT or arbitrary)
    if (!token.startsWith(PROXY_KEY_PREFIX)) {
      backoff.record(ip);
      return reply.code(401).send({
        code: "PROXY_KEY_REQUIRED",
        message: "Only proxy API keys (pi-proxy-*) are accepted for /v1/* routes",
      });
    }

    // Look up the key
    const config = deps.getConfig();
    const result = findApiKey(token, config);

    switch (result.kind) {
      case "revoked":
        backoff.record(ip);
        return reply.code(401).send({ code: "AUTH_REVOKED", message: "API key has been revoked" });
      case "expired":
        backoff.record(ip);
        return reply.code(401).send({ code: "AUTH_EXPIRED", message: "API key has expired" });
      case "miss":
        backoff.record(ip);
        return reply.code(401).send({ code: "AUTH_REQUIRED", message: "Invalid API key" });
      case "valid": {
        // Scope check
        const requiredScope = scopeForPath(url);
        if (!keyHasScope(result.entry, requiredScope)) {
          return reply.code(403).send({
            code: "SCOPE_INSUFFICIENT",
            required: requiredScope,
            granted: result.entry.scopes ?? ["all"],
          });
        }

        // Success — reset backoff + record usage
        backoff.reset(ip);

        // Record usage (debounced, fire-and-forget)
        if (deps.persistKeyUsage) {
          const { updated, apiKeys } = recordKeyUsage(result.entry.id, config.apiKeys);
          if (updated) deps.persistKeyUsage(apiKeys);
        }

        // Attach key info to request for downstream handlers
        (request as any).proxyApiKeyId = result.entry.id;
        (request as any).proxyApiKeyLabel = result.entry.label;
        // Mark the request authenticated so the universal network guard (an
        // `onRequest` hook registered AFTER this one) admits it via the normal
        // `isAuthenticated` pass condition. Without this a valid `pi-proxy-*`
        // key would still be network-denied. There is deliberately no public
        // `/v1` allowlist entry: with modelProxy disabled such an entry would
        // be a hole. See change: add-universal-network-guard.
        (request as any).isAuthenticated = true;
        return;
      }
    }
  };
}
