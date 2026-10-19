/**
 * `POST /api/tls/issue { sourceId, name? }` — operator "issue now" for the TLS
 * certificate manager (Renew now / Try again now / Check now). Authorized
 * exactly like `PUT /api/config` (`networkGuard`; tier row in `ROUTE_TIERS`).
 *
 * Synchronous checks only, then `202`: listener disabled → 409 (before 404);
 * unknown source id, or a name absent from the source's last name list (when it
 * produced one) → 404. After the reply the manager re-checks the source's
 * gates and starts issuance, bypassing backoff and joining a running attempt.
 *
 * See change: add-tailscale-cert-tls (design D10).
 */
import type { FastifyInstance } from "fastify";
import type { TlsListener } from "../tls/tls-listener.js";
import type { NetworkGuard } from "./route-deps.js";

type IssueListener = Pick<TlsListener, "manager" | "trigger" | "isEnabled">;

/** The synchronous checks of an issue request: `{status, error}` to refuse, `null` to accept. */
function refuseIssue(listener: IssueListener, sourceId: string, name: string | undefined): { status: number; error: string } | null {
  if (!listener.isEnabled) return { status: 409, error: "The TLS listener is disabled" };
  if (!listener.manager.hasSource(sourceId)) return { status: 404, error: `Unknown certificate source "${sourceId}"` };
  const known = name === undefined ? null : listener.manager.knownNames(sourceId);
  if (name !== undefined && Array.isArray(known) && !known.includes(name)) {
    return { status: 404, error: `Source "${sourceId}" does not produce "${name}"` };
  }
  return null;
}

export function registerTlsRoutes(fastify: FastifyInstance, deps: { networkGuard: NetworkGuard; listener: IssueListener }): void {
  fastify.post<{ Body: { sourceId?: unknown; name?: unknown } }>(
    "/api/tls/issue",
    { preHandler: deps.networkGuard },
    async (request, reply) => {
      const body = request.body ?? {};
      const sourceId = typeof body.sourceId === "string" ? body.sourceId : "";
      if (!sourceId) return reply.code(400).send({ success: false, error: "sourceId is required" });
      if (body.name !== undefined && body.name !== null && typeof body.name !== "string") {
        return reply.code(400).send({ success: false, error: "name must be a string" });
      }
      const name = typeof body.name === "string" && body.name ? body.name.trim().toLowerCase() : undefined;
      const refusal = refuseIssue(deps.listener, sourceId, name);
      if (refusal) return reply.code(refusal.status).send({ success: false, error: refusal.error });
      // After the reply: a forced readiness refresh + trigger (never awaited in the request).
      setImmediate(() => {
        deps.listener.trigger(sourceId, name).catch((err: unknown) => {
          console.warn(
            `[tls] issue trigger failed source=${sourceId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      });
      return reply.code(202).send({ success: true });
    },
  );
}
