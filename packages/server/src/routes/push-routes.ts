/**
 * `/api/push/*` — register / list / unregister / test push tokens and serve
 * the VAPID public key.
 *
 * Always registered (keeps the route-tier completeness test static) behind the
 * existing auth chain, which runs first — so an unauthenticated remote caller
 * gets 401 and cannot probe whether push is enabled. Each handler answers 404
 * while push is disabled (Decision 6). Tiers: vapid-public-key `observe`, the
 * rest `operate` (Decision 12). Not exposed over MCP.
 *
 * Secrets: webhook URLs, Web Push endpoints and FCM tokens are never echoed —
 * listings use `displayPushToken`, test results are opaque `{tokenId, ok, gone?}`.
 * See change: add-server-push-notifications.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import type { PushService } from "../push/push-service.js";
import { displayPushToken } from "../push/push-token-display.js";
import { PUSH_TRANSPORT_KINDS, type PushTransportKind } from "../push/push-transports/types.js";
import { validateWebhookUrl } from "../push/push-transports/webhook-url.js";

const MAX_LABEL = 64;
const MAX_SESSION_FILTER = 100;

export interface PushRouteDeps {
  /** The live push service, or null while `push.enabled` is false. */
  getPush: () => PushService | null;
}

type Validated =
  | { ok: true; transport: PushTransportKind; deviceToken: string; label?: string; sessionFilter?: string[] }
  | { ok: false; error: string };

function notEnabled(reply: FastifyReply) {
  return reply.code(404).send({ error: "push notifications are not enabled on this server" });
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

/** Shape checks; the webhook SSRF vet (async) runs after this. */
function validateBody(body: unknown): Validated {
  const b = (body ?? {}) as Record<string, unknown>;
  const transport = b.transport;
  if (typeof transport !== "string" || !PUSH_TRANSPORT_KINDS.includes(transport as PushTransportKind)) {
    return { ok: false, error: `transport must be one of ${PUSH_TRANSPORT_KINDS.join(", ")}` };
  }
  let label: string | undefined;
  if (b.label !== undefined) {
    if (typeof b.label !== "string" || b.label.length > MAX_LABEL) return { ok: false, error: `label must be a string of at most ${MAX_LABEL} characters` };
    label = b.label.length > 0 ? b.label : undefined;
  }
  let sessionFilter: string[] | undefined;
  if (b.sessionFilter !== undefined) {
    if (!Array.isArray(b.sessionFilter) || b.sessionFilter.length > MAX_SESSION_FILTER || !b.sessionFilter.every(isNonEmptyString)) {
      return { ok: false, error: `sessionFilter must be an array of at most ${MAX_SESSION_FILTER} non-empty strings` };
    }
    sessionFilter = b.sessionFilter as string[];
  }
  const raw = b.deviceToken;
  let deviceToken: string;
  switch (transport as PushTransportKind) {
    case "web-push": {
      let sub: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null = null;
      try {
        sub = typeof raw === "string" ? JSON.parse(raw) : null;
      } catch {
        sub = null;
      }
      let endpointOk = false;
      try {
        endpointOk = isNonEmptyString(sub?.endpoint) && new URL(sub.endpoint as string).protocol === "https:";
      } catch {
        endpointOk = false;
      }
      if (!sub || !endpointOk || !isNonEmptyString(sub.keys?.p256dh) || !isNonEmptyString(sub.keys?.auth)) {
        return { ok: false, error: "deviceToken must be a PushSubscription JSON with an https endpoint and keys.p256dh + keys.auth" };
      }
      // Canonical form so re-subscribing the same browser stays idempotent.
      deviceToken = JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh: sub.keys?.p256dh, auth: sub.keys?.auth } });
      break;
    }
    case "fcm":
      if (!isNonEmptyString(raw)) return { ok: false, error: "deviceToken must be a non-empty string" };
      deviceToken = raw;
      break;
    case "webhook": {
      const v = validateWebhookUrl(raw);
      if (!v.ok) return { ok: false, error: v.error };
      deviceToken = v.url.href;
      break;
    }
  }
  return { ok: true, transport: transport as PushTransportKind, deviceToken, label, sessionFilter };
}

export function registerPushRoutes(fastify: FastifyInstance, deps: PushRouteDeps): void {
  fastify.get("/api/push/vapid-public-key", async (_request, reply) => {
    const push = deps.getPush();
    if (!push) return notEnabled(reply);
    return { publicKey: push.vapidPublicKey };
  });

  fastify.post("/api/push/register", async (request, reply) => {
    const push = deps.getPush();
    if (!push) return notEnabled(reply);
    const v = validateBody(request.body);
    if (!v.ok) return reply.code(400).send({ error: v.error });
    if (v.transport === "webhook") {
      const vet = await push.vetWebhook(new URL(v.deviceToken));
      if (!vet.ok) return reply.code(400).send({ error: vet.error });
    }
    const res = push.registry.add({
      deviceToken: v.deviceToken,
      transport: v.transport,
      ...(v.label !== undefined ? { label: v.label } : {}),
      ...(v.sessionFilter !== undefined ? { sessionFilter: v.sessionFilter } : {}),
    });
    if (!res.ok) return reply.code(409).send({ error: "push token limit reached (50); remove a token first" });
    return { tokenId: res.token.id };
  });

  fastify.get("/api/push/register", async (_request, reply) => {
    const push = deps.getPush();
    if (!push) return notEnabled(reply);
    return {
      tokens: push.registry.list().map((t) => ({
        tokenId: t.id,
        transport: t.transport,
        display: displayPushToken(t),
        registeredAt: t.registeredAt,
        lastUsedAt: t.lastUsedAt,
        consecutiveFailures: push.registry.consecutiveFailures(t.id),
      })),
    };
  });

  fastify.delete<{ Params: { tokenId: string } }>("/api/push/register/:tokenId", async (request, reply) => {
    const push = deps.getPush();
    if (!push) return notEnabled(reply);
    if (!push.registry.remove(request.params.tokenId)) return reply.code(404).send({ error: "unknown token" });
    return reply.code(204).send();
  });

  fastify.post("/api/push/test", async (request, reply) => {
    const push = deps.getPush();
    if (!push) return notEnabled(reply);
    const tokenId = (request.body as { tokenId?: unknown } | null | undefined)?.tokenId;
    if (tokenId !== undefined) {
      if (typeof tokenId !== "string" || !push.registry.get(tokenId)) return reply.code(404).send({ error: "unknown token" });
      return { results: await push.dispatcher.test(tokenId) };
    }
    return { results: await push.dispatcher.test() };
  });
}
