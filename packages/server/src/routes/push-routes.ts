/**
 * Push notification REST routes (6 endpoints, auth-gated, rate-limited).
 *
 * Endpoints:
 *   POST   /api/push/register         — register device token
 *   DELETE /api/push/register/:tokenId — unregister device
 *   GET    /api/push/tokens            — list safe device metadata
 *   POST   /api/push/test              — test push to a specific device
 *   POST   /api/push/send              — on-demand push to all devices
 *   GET    /api/push/vapid-public-key  — VAPID public key for browser subscribe
 *
 * See change: add-server-push-notifications.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { PushTokenRegistry } from "../push/push-token-registry.js";
import type { PushDispatcher } from "../push/push-dispatcher.js";
import type { PushPayload } from "../push/push-types.js";
import type { VapidKeys } from "../push/push-vapid.js";

// Simple in-memory rate limiter per endpoint
const rateLimiters = new Map<string, Map<string, number[]>>();

function checkRateLimit(endpoint: string, caller: string, maxPerMinute: number): boolean {
  let perCaller = rateLimiters.get(endpoint);
  if (!perCaller) {
    perCaller = new Map<string, number[]>();
    rateLimiters.set(endpoint, perCaller);
  }
  const now = Date.now();
  const window = now - 60_000;
  let entries = perCaller.get(caller);
  if (!entries) {
    entries = [];
    perCaller.set(caller, entries);
  }
  // Purge stale
  while (entries.length > 0 && entries[0] < window) entries.shift();
  if (entries.length >= maxPerMinute) return false;
  entries.push(now);
  return true;
}

function getCallerId(request: FastifyRequest): string {
  // Use the auth'd user if available, otherwise IP
  const user = (request as any).isAuthenticated
    ? ((request as any).user?.email || (request as any).user?.sub || "authenticated")
    : request.ip;
  return String(user);
}

function isValidSendUrl(url: string, origin: string): boolean {
  // Must start with exactly one "/", not "//"
  if (!url.startsWith("/") || url.startsWith("//")) return false;
  // Reject backslash hacks and encoded protocols
  if (url.includes("\\\\") || url.includes("%2F%2F")) return false;
  try {
    const parsed = new URL(url, origin);
    return parsed.origin === origin;
  } catch {
    return false;
  }
}

function validateKeyLength(p256dh: string, auth: string): string | null {
  // Decode base64url and check byte lengths
  try {
    const p256dhBytes = Buffer.from(p256dh, "base64url");
    if (p256dhBytes.length !== 65) return "keys.p256dh must decode to 65 bytes (uncompressed P-256 key)";
    const authBytes = Buffer.from(auth, "base64url");
    if (authBytes.length !== 16) return "keys.auth must decode to 16 bytes";
    return null;
  } catch {
    return "keys must be valid base64url strings";
  }
}

export interface PushRouteDeps {
  tokenRegistry: PushTokenRegistry;
  dispatcher: PushDispatcher;
  vapidKeys: VapidKeys;
}

export function registerPushRoutes(
  fastify: FastifyInstance,
  deps: PushRouteDeps,
): void {
  const { tokenRegistry, dispatcher, vapidKeys } = deps;

  // POST /api/push/register — 10/min
  fastify.post<{ Body: {
    deviceToken: { endpoint: string; keys: { p256dh: string; auth: string } };
    transport?: string;
  } }>(
    "/api/push/register",
    async (request, reply) => {
      const caller = getCallerId(request);
      if (!checkRateLimit("/api/push/register", caller, 10)) {
        return reply.code(429).send({ error: "rate_limited" });
      }

      const { deviceToken, transport } = request.body;

      // Validate transport
      if (transport !== undefined && transport !== "web-push") {
        return reply.code(400).send({ error: `unsupported transport: ${transport}` });
      }

      // Validate endpoint is HTTPS
      if (!deviceToken?.endpoint || typeof deviceToken.endpoint !== "string") {
        return reply.code(400).send({ error: "deviceToken.endpoint required" });
      }
      if (!deviceToken.endpoint.startsWith("https://")) {
        return reply.code(400).send({ error: "deviceToken.endpoint must be HTTPS" });
      }

      // Validate keys
      const keys = deviceToken.keys;
      if (!keys || typeof keys !== "object") {
        return reply.code(400).send({ error: "deviceToken.keys required" });
      }
      if (typeof keys.p256dh !== "string" || keys.p256dh.length === 0) {
        return reply.code(400).send({ error: "deviceToken.keys.p256dh must be non-empty" });
      }
      if (typeof keys.auth !== "string" || keys.auth.length === 0) {
        return reply.code(400).send({ error: "deviceToken.keys.auth must be non-empty" });
      }
      const keyError = validateKeyLength(keys.p256dh, keys.auth);
      if (keyError) {
        return reply.code(400).send({ error: keyError });
      }

      try {
        const tokenId = tokenRegistry.add({
          deviceToken,
          transport: transport || "web-push",
        });
        return { tokenId, registered: true };
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  // DELETE /api/push/register/:tokenId — 10/min
  fastify.delete<{ Params: { tokenId: string } }>(
    "/api/push/register/:tokenId",
    async (request, reply) => {
      const caller = getCallerId(request);
      if (!checkRateLimit("/api/push/delete", caller, 10)) {
        return reply.code(429).send({ error: "rate_limited" });
      }

      tokenRegistry.remove(request.params.tokenId);
      return reply.code(204).send();
    },
  );

  // GET /api/push/tokens — 30/min
  fastify.get("/api/push/tokens", async (request, reply) => {
    const caller = getCallerId(request);
    if (!checkRateLimit("/api/push/tokens", caller, 30)) {
      return reply.code(429).send({ error: "rate_limited" });
    }

    return { tokens: tokenRegistry.listMeta() };
  });

  // POST /api/push/test — 5/min
  fastify.post<{ Body: { tokenId?: string } }>(
    "/api/push/test",
    async (request, reply) => {
      const caller = getCallerId(request);
      if (!checkRateLimit("/api/push/test", caller, 5)) {
        return reply.code(429).send({ error: "rate_limited" });
      }

      const { tokenId } = request.body || {};
      const payload: PushPayload = {
        type: "session_attention",
        sessionId: "test",
        title: "Test Notification",
        body: "Push notifications are working!",
        url: "/",
      };

      const results = await dispatcher.sendNow(payload, {
        tokenIds: tokenId ? [tokenId] : undefined,
      });
      return { results };
    },
  );

  // POST /api/push/send — 2/min
  fastify.post<{ Body: { title: string; body: string; url?: string } }>(
    "/api/push/send",
    async (request, reply) => {
      const caller = getCallerId(request);
      if (!checkRateLimit("/api/push/send", caller, 2)) {
        return reply.code(429).send({ error: "rate_limited" });
      }

      const { title, body, url } = request.body || {};
      if (!title || typeof title !== "string" || title.length === 0) {
        return reply.code(400).send({ error: "title required (max 200 chars)" });
      }
      if (title.length > 200) {
        return reply.code(400).send({ error: "title exceeds 200 chars" });
      }
      if (!body || typeof body !== "string" || body.length === 0) {
        return reply.code(400).send({ error: "body required (max 500 chars)" });
      }
      if (body.length > 500) {
        return reply.code(400).send({ error: "body exceeds 500 chars" });
      }

      const resolvedUrl = url || "/";
      if (!isValidSendUrl(resolvedUrl, `${request.protocol}://${request.hostname}`)) {
        return reply.code(400).send({ error: "invalid url — must be a valid same-origin path starting with a single /" });
      }

      const payload: PushPayload = {
        type: "session_attention",
        sessionId: "__manual__",
        title,
        body,
        url: resolvedUrl,
      };

      const results = await dispatcher.sendNow(payload);

      // Audit-log every on-demand send
      console.log(`[push] On-demand send by ${caller}: title="${title}", results=${results.length} devices`);

      return { results };
    },
  );

  // GET /api/push/vapid-public-key — 30/min
  fastify.get("/api/push/vapid-public-key", async (request, reply) => {
    const caller = getCallerId(request);
    if (!checkRateLimit("/api/push/vapid-key", caller, 30)) {
      return reply.code(429).send({ error: "rate_limited" });
    }

    return { publicKey: vapidKeys.publicKey };
  });
}

/**
 * Register 503 middleware for push endpoints when push is misconfigured.
 * Every /api/push/* returns 503 with error details.
 */
export function registerPushMisconfiguredMiddleware(
  fastify: FastifyInstance,
  errors: string[],
): void {
  fastify.all("/api/push/*", async (_request, reply) => {
    return reply.code(503).send({
      error: "push_misconfigured",
      details: errors.join("; "),
    });
  });
}
