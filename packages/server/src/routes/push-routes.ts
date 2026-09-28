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

type TokenCheck = { ok: true; deviceToken: string } | { ok: false; error: string };

const WEB_PUSH_ERROR = "deviceToken must be a PushSubscription JSON with an https endpoint and keys.p256dh + keys.auth";

function parseJson(raw: unknown): unknown {
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isHttpsUrl(v: unknown): boolean {
  if (!isNonEmptyString(v)) return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

/** web-push: PushSubscription JSON, https endpoint, both keys; stored canonically so re-subscribing stays idempotent. */
function checkWebPushToken(raw: unknown): TokenCheck {
  const sub = parseJson(raw) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  if (!sub || !isHttpsUrl(sub.endpoint) || !isNonEmptyString(sub.keys?.p256dh) || !isNonEmptyString(sub.keys?.auth)) {
    return { ok: false, error: WEB_PUSH_ERROR };
  }
  return { ok: true, deviceToken: JSON.stringify({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }) };
}

function checkDeviceToken(transport: PushTransportKind, raw: unknown): TokenCheck {
  if (transport === "web-push") return checkWebPushToken(raw);
  if (transport === "fcm") return isNonEmptyString(raw) ? { ok: true, deviceToken: raw } : { ok: false, error: "deviceToken must be a non-empty string" };
  const v = validateWebhookUrl(raw);
  return v.ok ? { ok: true, deviceToken: v.url.href } : { ok: false, error: v.error };
}

function checkLabel(raw: unknown): { ok: true; label?: string } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true };
  if (typeof raw !== "string" || raw.length > MAX_LABEL) return { ok: false, error: `label must be a string of at most ${MAX_LABEL} characters` };
  return { ok: true, label: raw.length > 0 ? raw : undefined };
}

function checkSessionFilter(raw: unknown): { ok: true; sessionFilter?: string[] } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true };
  if (!Array.isArray(raw) || raw.length > MAX_SESSION_FILTER || !raw.every(isNonEmptyString)) {
    return { ok: false, error: `sessionFilter must be an array of at most ${MAX_SESSION_FILTER} non-empty strings` };
  }
  return { ok: true, sessionFilter: raw as string[] };
}

/** The outbound URL a token makes the server call: webhook URL or Web Push endpoint. */
function destinationOf(transport: PushTransportKind, deviceToken: string): URL | null {
  if (transport === "webhook") return new URL(deviceToken);
  if (transport === "web-push") return new URL((JSON.parse(deviceToken) as { endpoint: string }).endpoint);
  return null;
}

/** Shape checks; the SSRF vet (async) runs after this. */
function validateBody(body: unknown): Validated {
  const b = (body ?? {}) as Record<string, unknown>;
  const transport = b.transport as PushTransportKind;
  if (typeof transport !== "string" || !PUSH_TRANSPORT_KINDS.includes(transport)) {
    return { ok: false, error: `transport must be one of ${PUSH_TRANSPORT_KINDS.join(", ")}` };
  }
  const label = checkLabel(b.label);
  if (!label.ok) return label;
  const filter = checkSessionFilter(b.sessionFilter);
  if (!filter.ok) return filter;
  const token = checkDeviceToken(transport, b.deviceToken);
  if (!token.ok) return token;
  return { ok: true, transport, deviceToken: token.deviceToken, label: label.label, sessionFilter: filter.sessionFilter };
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
    // Both caller-supplied URLs get the SSRF policy (the delivery re-checks).
    const destination = destinationOf(v.transport, v.deviceToken);
    if (destination) {
      const vet = await push.vetDestination(destination);
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
