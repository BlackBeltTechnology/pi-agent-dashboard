/**
 * Read-only REST surface under `/api/plugins/agent-teams` (D15): team summaries
 * and one bounded snapshot, in an encapsulated scope with the shared limiter.
 * Every team passes the `routeVisibility` hook (default allow-all); a hook that
 * throws or does not answer in time fails CLOSED — the team is omitted from the
 * list and answers 404 by id, never 403, so existence does not leak. No mutating
 * route exists in this change; later ones register under the same prefix, each
 * with its own `ROUTE_TIERS` row (see `packages/shared/src/route-tiers.ts`).
 * See change: add-agent-teams-core.
 */
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { REST_READ_RATE, ROUTE_VISIBILITY_TIMEOUT_MS } from "../shared/constants.js";
import type { Team } from "../shared/types.js";
import type { ExtensionPoints } from "./extension-points.js";
import { listOf, snapshotOf } from "./snapshot.js";
import type { TeamStore } from "./store.js";
import type { Telemetry } from "./telemetry.js";
import type { Logger } from "./types.js";

export const API_PREFIX = "/api/plugins/agent-teams";

export interface RouteDeps {
  store: TeamStore;
  telemetry: Telemetry;
  ext: ExtensionPoints;
  logger: Logger;
  /** Identity seam: the host-resolved principal keys the limiter (absent ⇒ client address). */
  principalOf?: (request: unknown) => { iss?: string; sub?: string } | null;
  /** Override of `ROUTE_VISIBILITY_TIMEOUT_MS` (tests). */
  visibilityTimeoutMs?: number;
}

const CLIENT_ERRORS: Readonly<Record<number, string>> = { 404: "not_found", 429: "rate_limited" };

/** The 4xx status an error carries (rate limiter, bad request), else undefined. */
function clientErrorStatus(err: unknown): number | undefined {
  const status = (err as { statusCode?: number }).statusCode;
  return typeof status === "number" && status >= 400 && status < 500 ? status : undefined;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`route visibility hook did not answer within ${ms} ms`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export async function mountTeamsRoutes(fastify: FastifyInstance, deps: RouteDeps): Promise<void> {
  const { store, ext, logger } = deps;
  const timeoutMs = deps.visibilityTimeoutMs ?? ROUTE_VISIBILITY_TIMEOUT_MS;

  /** Fail closed: only an explicit `true` (or no hook) shows the team. */
  async function visible(team: Team, req: FastifyRequest): Promise<boolean> {
    const hook = ext.routeVisibility;
    if (!hook) return true;
    try {
      return (await withTimeout(Promise.resolve().then(() => hook(team, req)), timeoutMs)) === true;
    } catch (err) {
      logger.error(`agent-teams: route visibility for team ${team.id} failed closed: ${(err as Error).message}`);
      return false;
    }
  }

  const clientKey = (req: FastifyRequest): string => {
    const p = deps.principalOf?.(req);
    return p?.iss !== undefined && p.sub !== undefined ? `principal:${p.iss}\u0000${p.sub}` : req.ip;
  };

  await fastify.register(async (scope) => {
    // Sustained `perSecond`, bursts up to `burst` (window = burst / perSecond).
    await scope.register(rateLimit, {
      global: true,
      max: REST_READ_RATE.burst,
      timeWindow: Math.round((REST_READ_RATE.burst / REST_READ_RATE.perSecond) * 1000),
      keyGenerator: clientKey,
    });

    // Encapsulated: never replaces the dashboard's own error handler.
    scope.setErrorHandler((err: unknown, _req, reply) => {
      const status = clientErrorStatus(err);
      if (status !== undefined) return reply.code(status).send({ error: CLIENT_ERRORS[status] ?? "bad_request" });
      logger.error(`agent-teams: route error ${err instanceof Error ? err.message : String(err)}`);
      return reply.code(500).send({ error: "internal_error" });
    });

    scope.get(`${API_PREFIX}/teams`, async (req) => {
      const all = store.list();
      const flags = await Promise.all(all.map((t) => visible(t, req)));
      return listOf(
        store,
        all.filter((_, i) => flags[i]),
      );
    });

    scope.get<{ Params: { id: string } }>(`${API_PREFIX}/teams/:id`, async (req, reply) => {
      const team = store.get(req.params.id);
      if (!team || !(await visible(team, req))) return reply.code(404).send({ error: "not_found" });
      return snapshotOf(store, deps.telemetry, team);
    });
  });
}
