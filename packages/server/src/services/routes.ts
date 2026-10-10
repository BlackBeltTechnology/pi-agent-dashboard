/**
 * REST surface of the service layer (`/api/services/*`).
 *
 *   GET    /api/services                      list (+ updateAvailable / diff)
 *   GET    /api/services/offers               discovered `pi.services` offers
 *   GET    /api/services/runtimes             runtime detection report
 *   GET    /api/services/:id                  status (re-probes a running instance)
 *   POST   /api/services                      add { offer | definition, dryRun?, update? }
 *   DELETE /api/services/:id?purgeData=true   remove
 *   POST   /api/services/:id/ensure           { holder? } → ensure payload (+ lease)
 *   POST   /api/services/:id/heartbeat        { leaseId } → 404 lease-unknown
 *   POST   /api/services/:id/release          { leaseId } → 404 lease-unknown
 *   POST   /api/services/:id/{start,stop,retry,pin,unpin,prefetch}
 *   PUT    /api/services/:id/secrets/:name    { value } → { configured } (never echoed)
 *
 * Reads sit behind the network guard. EVERY mutation additionally needs an
 * `operate`-tier device bearer, an authenticated operator session, or a
 * locally trusted caller (`isLocallyTrusted`, strict-mode aware). A
 * trusted-network or `observe`/`control` caller is refused: a user-origin
 * attached entry carries argv, so creating one is executing code.
 * See change: add-service-registry-core (D8).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { LocalTrustContext } from "../auth/local-proof.js";
import { isLocallyTrusted } from "../auth/localhost-guard.js";
import type { NetworkGuard } from "../routes/route-deps.js";
import { ServiceError, type ServiceManager } from "./service-manager.js";

export interface ServiceRoutesDeps {
  manager: ServiceManager;
  networkGuard: NetworkGuard;
  /** Strict local-proof context (`requireLocalProof`). */
  localTrust?: LocalTrustContext;
}

/** May this request mutate services? (Stricter than the network guard.) */
export function canMutateServices(request: FastifyRequest, localTrust?: LocalTrustContext): boolean {
  const via = (request as { authVia?: string }).authVia;
  if (via === "device") return (request as { principalTier?: string }).principalTier === "operate";
  if (via === "session" || via === "principal") return true;
  return isLocallyTrusted({ ip: request.ip, headers: request.headers as Record<string, unknown> }, localTrust);
}

/** The request shape every handler reads (params / body / query are all optional). */
type Req = FastifyRequest & {
  params: { id: string; name: string };
  body?: Record<string, unknown> | null;
  query: Record<string, string | undefined>;
};

function sendError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof ServiceError) {
    return reply.code(err.status).send({ success: false, error: err.code, message: err.message });
  }
  return reply.code(500).send({ success: false, error: "internal", message: (err as Error)?.message ?? "error" });
}

export function registerServiceRoutes(fastify: FastifyInstance, deps: ServiceRoutesDeps): void {
  const { manager, networkGuard } = deps;
  const mutationGuard = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!canMutateServices(request, deps.localTrust)) {
      await reply.code(403).send({
        success: false,
        error: "operate_required",
        message: "service mutations need an operate-tier credential or a locally trusted caller",
      });
    }
  };
  const read = { preHandler: networkGuard };
  const write = { preHandler: [networkGuard, mutationGuard] };

  const wrap =
    (fn: (req: Req) => Promise<unknown>) =>
    async (request: FastifyRequest, reply: FastifyReply) => {
      const req = request as unknown as Req;
      try {
        return { success: true, data: await fn(req) };
      } catch (err) {
        return sendError(reply, err);
      }
    };

  fastify.get("/api/services", read, wrap(() => manager.list()));
  fastify.get("/api/services/offers", read, wrap(async () => manager.listOffers()));
  fastify.get("/api/services/runtimes", read, wrap(() => manager.runtimes()));
  fastify.get("/api/services/:id", read, wrap((req) => manager.status(req.params.id)));

  fastify.post("/api/services", write, wrap(async (req) => {
    const body = req.body ?? {};
    if (typeof body.offer === "string") {
      return manager.add({ offer: body.offer, dryRun: body.dryRun === true, update: body.update === true });
    }
    if (body.definition !== undefined) return manager.add({ definition: body.definition, dryRun: body.dryRun === true });
    throw new ServiceError(400, "bad-request", "body needs { offer } or { definition }");
  }));

  fastify.delete("/api/services/:id", write, wrap((req) =>
    manager.remove(req.params.id, { purgeData: req.query.purgeData === "true" || req.query.purgeData === "1" }),
  ));

  fastify.post("/api/services/:id/ensure", write, wrap((req) => {
    const holder = typeof req.body?.holder === "string" ? req.body.holder.slice(0, 200) : undefined;
    return manager.ensure(req.params.id, { holder });
  }));

  for (const verb of ["heartbeat", "release"] as const) {
    fastify.post(`/api/services/:id/${verb}`, write, async (request, reply) => {
      const req = request as unknown as Req;
      const leaseId = typeof req.body?.leaseId === "string" ? req.body.leaseId : "";
      const r = verb === "heartbeat" ? manager.heartbeat(req.params.id, leaseId) : manager.release(req.params.id, leaseId);
      if (!r.ok) return reply.code(404).send({ success: false, error: "lease-unknown" });
      return { success: true, data: r };
    });
  }

  fastify.post("/api/services/:id/start", write, wrap((req) => manager.start(req.params.id)));
  fastify.post("/api/services/:id/retry", write, wrap((req) => manager.retry(req.params.id)));
  fastify.post("/api/services/:id/stop", write, wrap((req) =>
    manager.stop(req.params.id, { force: req.body?.force === true }),
  ));
  fastify.post("/api/services/:id/pin", write, wrap((req) => manager.pin(req.params.id, true)));
  fastify.post("/api/services/:id/unpin", write, wrap((req) => manager.pin(req.params.id, false)));
  fastify.post("/api/services/:id/prefetch", write, wrap((req) => manager.prefetch(req.params.id)));

  fastify.put(
    "/api/services/:id/secrets/:name",
    write,
    wrap((req) => manager.setSecret(req.params.id, req.params.name, req.body?.value)),
  );
}
