/**
 * `GET /api/events/stream` — Server-Sent Events feed of agent transitions
 * (observe tier), for an external controller that must react to pi sessions
 * instead of polling them (the Claude Code plugin's `pi-dashboard-watch`).
 *
 * Query: `session=<id>[,<id>…]` (full ids) and `types=<type>[,<type>…]`
 * (see `AGENT_EVENT_TYPES`; unknown type → 400). Frames:
 *   event: ready            data: {sessions?, types?}     (first, once)
 *   id: N / event: <type>   data: AgentEvent              (open questions first, then live)
 *   : ping                                                (heartbeat)
 * Visibility = the session-list predicate (`canAccessSession`), evaluated per
 * event with the requester's principal. The reply is hijacked (no compression,
 * no buffering); a client that stops reading past `MAX_BUFFERED_BYTES` is
 * dropped. Streams end on disconnect and on server close.
 * See change: add-agent-event-stream.
 */
import type { ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import { AGENT_EVENT_TYPES, type AgentEvent, type AgentEventHub, type AgentEventType } from "../agent-events/agent-event-hub.js";
import { canAccessSession, sessionPrincipalOf } from "../identity/session-access.js";
import type { NetworkGuard } from "./route-deps.js";

export const EVENT_STREAM_HEARTBEAT_MS = 20_000;
const MAX_BUFFERED_BYTES = 1024 * 1024;

export interface AgentEventStreamRouteDeps {
  networkGuard: NetworkGuard;
  hub: Pick<AgentEventHub, "subscribe" | "openQuestions" | "ownerOf">;
  /** Ownership resolver active? (inert → every session is visible). */
  isResolverActive: () => boolean;
  heartbeatMs?: number;
}

type ListParam = string | string[] | undefined;

/** Comma list; a repeated parameter (`?types=a&types=b`, parsed as an array) joins the same way. */
const listOf = (raw: ListParam): string[] | undefined => {
  const items = (Array.isArray(raw) ? raw.join(",") : raw)
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items && items.length > 0 ? items : undefined;
};

type Owner = { iss: string; sub: string };
type Filter = { sessions?: string[]; types?: string[] };

/** Parsed `session` / `types` query, or the 400 message for an unknown type. */
function parseFilter(query: { session?: ListParam; types?: ListParam }): Filter | { error: string } {
  const sessions = listOf(query.session);
  const types = listOf(query.types);
  const unknown = types?.filter((t) => !AGENT_EVENT_TYPES.includes(t as AgentEventType)) ?? [];
  if (unknown.length > 0) return { error: `unknown event type(s): ${unknown.join(",")}` };
  return { ...(sessions ? { sessions } : {}), ...(types ? { types } : {}) };
}

/** Per-request predicate: query filter + session-list visibility for this principal. */
function wantedBy(filter: Filter, principal: Owner | null, isResolverActive: () => boolean) {
  const sessionSet = filter.sessions ? new Set(filter.sessions) : undefined;
  const typeSet = filter.types ? new Set<string>(filter.types) : undefined;
  return (event: AgentEvent, owner: Owner | undefined) =>
    (!sessionSet || sessionSet.has(event.sessionId)) &&
    (!typeSet || typeSet.has(event.type)) &&
    canAccessSession({ active: isResolverActive(), principal, owner });
}

/** Write the SSE head + ready frame, replay open questions, then follow the hub. Returns the closer. */
function startStream(
  res: ServerResponse,
  filter: Filter,
  wanted: (event: AgentEvent, owner: Owner | undefined) => boolean,
  deps: AgentEventStreamRouteDeps,
  onClosed: () => void,
): () => void {
  let closed = false;
  let seq = 0;
  const write = (chunk: string) => {
    if (closed) return;
    res.write(chunk);
    if (res.writableLength > MAX_BUFFERED_BYTES) close();
  };
  const send = (event: AgentEvent) => write(`id: ${++seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);

  write(`retry: 3000\nevent: ready\ndata: ${JSON.stringify(filter)}\n\n`);
  for (const event of deps.hub.openQuestions()) if (wanted(event, deps.hub.ownerOf(event.sessionId))) send(event);
  const unsubscribe = deps.hub.subscribe((event, owner) => {
    if (wanted(event, owner)) send(event);
  });
  const heartbeat = setInterval(() => write(": ping\n\n"), deps.heartbeatMs ?? EVENT_STREAM_HEARTBEAT_MS);
  heartbeat.unref();

  function close(): void {
    if (closed) return;
    closed = true;
    unsubscribe();
    clearInterval(heartbeat);
    res.end();
    onClosed();
  }
  // The RESPONSE's close (client gone); the request's fires once its body is read.
  res.on("close", close);
  return close;
}

export function registerAgentEventStreamRoutes(fastify: FastifyInstance, deps: AgentEventStreamRouteDeps): void {
  const open = new Set<() => void>();
  // preClose: `server.close()` waits for these never-ending responses, so end them first.
  fastify.addHook("preClose", async () => {
    for (const close of [...open]) close();
  });

  fastify.get<{ Querystring: { session?: ListParam; types?: ListParam } }>(
    "/api/events/stream",
    { preHandler: deps.networkGuard },
    async (request, reply) => {
      const filter = parseFilter(request.query);
      if ("error" in filter) {
        reply.code(400);
        return { success: false, error: filter.error };
      }
      const wanted = wantedBy(filter, sessionPrincipalOf(request), deps.isResolverActive);

      reply.hijack();
      if (typeof request.raw.setTimeout === "function") request.raw.setTimeout(0);
      // Keep headers other hooks already set (CORS); hijack skips onSend.
      reply.raw.writeHead(200, {
        ...(reply.getHeaders() as Record<string, string | number | string[]>),
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      const close = startStream(reply.raw, filter, wanted, deps, () => open.delete(close));
      open.add(close);
    },
  );
}
