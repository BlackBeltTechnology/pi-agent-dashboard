/**
 * REST surface under `/api/plugins/agent-teams` (D15): team summaries and one
 * bounded snapshot, in an encapsulated scope with the shared limiter.
 * Every team passes the `routeVisibility` hook (default allow-all); a hook that
 * throws or does not answer in time fails CLOSED — the team is omitted from the
 * list and answers 404 by id, never 403, so existence does not leak.
 *
 * add-agent-teams-ui adds, all additive: the `?sessionId=` lookup on the list
 * (one summary, live over closed, most recently changed), `epoch` +
 * `viewerCanControl` + a strong ETag with an exact-match 304 on the snapshot,
 * and the two `control`-tier POST routes (stop a member, shut the team down),
 * which sit in the same scope under the stricter write limiter and re-check
 * `canControlTeam` on every call (forged or invisible ⇒ the same 404 body).
 * Each POST has its own `ROUTE_TIERS` row (`packages/shared/src/route-tiers.ts`).
 * See change: add-agent-teams-core, add-agent-teams-ui.
 */
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { MEMBER_NAME_REGEXP, REST_READ_RATE, REST_WRITE_RATE, ROUTE_VISIBILITY_TIMEOUT_MS } from "../shared/constants.js";
import type { Team } from "../shared/types.js";
import { SESSION_ID_MAX_LENGTH, snapshotEtag, type TeamUiSnapshot } from "../shared/ui-protocol.js";
import type { TeamAccess } from "./access.js";
import { PROCESS_EPOCH } from "./epoch.js";
import type { ExtensionPoints } from "./extension-points.js";
import { listOf, snapshotOf } from "./snapshot.js";
import type { TeamStore } from "./store.js";
import type { Telemetry } from "./telemetry.js";
import type { Logger } from "./types.js";
import type { UiCounters } from "./ui-counters.js";
import type { UserActions } from "./user-actions.js";

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
  /** Random id minted at server start (default: one per process). */
  epoch?: string;
  /** Owner rule for `viewerCanControl` and the POST routes (absent ⇒ everyone may control). */
  access?: Pick<TeamAccess, "canControlTeam">;
  /** The two user controls; their POST routes are mounted only when given. */
  userActions?: UserActions;
  counters?: Pick<UiCounters, "count">;
  /** Limiter overrides (tests); defaults are core's `REST_READ_RATE` / `REST_WRITE_RATE`. */
  rateLimits?: { read: { perSecond: number; burst: number }; write: { perSecond: number; burst: number } };
}

const CLIENT_ERRORS: Readonly<Record<number, string>> = { 404: "not_found", 429: "rate_limited" };
/** The one body of an unknown, invisible or not-controllable team/member. */
const NOT_FOUND = { error: "not_found" } as const;

/**
 * The `sessionId` lookup value: `undefined` = absent, `"invalid"` = repeated,
 * array-form, empty, NUL-containing or over `SESSION_ID_MAX_LENGTH`. Read from the
 * raw query string so `sessionId[]=x` and repeats cannot slip through the parser.
 */
function sessionLookup(url: string): string | undefined | "invalid" {
  const q = url.indexOf("?");
  if (q < 0) return undefined;
  const params = new URLSearchParams(url.slice(q + 1));
  if ([...params.keys()].some((k) => k.startsWith("sessionId["))) return "invalid";
  const values = params.getAll("sessionId");
  if (values.length === 0) return undefined;
  const v = values[0] as string;
  if (values.length > 1 || v === "" || v.length > SESSION_ID_MAX_LENGTH || v.includes("\u0000")) return "invalid";
  return v;
}

const isLive = (t: Team): boolean => t.status !== "closed";

/** Latest activity of a team: its creation, any task timestamp, its newest mail. */
function lastChange(store: TeamStore, team: Team): number {
  let at = team.createdAt;
  for (const t of team.tasks) at = Math.max(at, t.createdAt, t.claimedAt ?? 0, t.completedAt ?? 0);
  const newest = store.mailLog(team.id).at(-1);
  return newest ? Math.max(at, newest.createdAt) : at;
}

/** Live over closed, then most recently changed, then the smaller id. */
function pickForSession(store: TeamStore, candidates: readonly Team[]): Team | undefined {
  return [...candidates].sort((a, b) => Number(isLive(b)) - Number(isLive(a)) || lastChange(store, b) - lastChange(store, a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
}

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
  const { store, ext, logger, counters, userActions } = deps;
  const timeoutMs = deps.visibilityTimeoutMs ?? ROUTE_VISIBILITY_TIMEOUT_MS;
  const epoch = deps.epoch ?? PROCESS_EPOCH;
  const read = deps.rateLimits?.read ?? REST_READ_RATE;
  const write = deps.rateLimits?.write ?? REST_WRITE_RATE;

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

  /** The owner rule for control; a throwing check refuses (and is logged once with the team id). */
  function controllable(team: Team, req: FastifyRequest): boolean {
    if (!deps.access) return true;
    try {
      return deps.access.canControlTeam(team, req) === true;
    } catch (err) {
      logger.error(`agent-teams: control check for team ${team.id} failed closed: ${(err as Error).message}`);
      return false;
    }
  }

  /** A control route's gate: visible AND controllable, else the caller gets the unknown-team 404 (counted when the team exists). */
  async function reachable(team: Team | undefined, req: FastifyRequest): Promise<Team | undefined> {
    if (!team) return undefined;
    if ((await visible(team, req)) && controllable(team, req)) return team;
    counters?.count("owner_filtered_404");
    return undefined;
  }

  const clientKey = (req: FastifyRequest): string => {
    const p = deps.principalOf?.(req);
    return p?.iss !== undefined && p.sub !== undefined ? `principal:${p.iss}\u0000${p.sub}` : req.ip;
  };

  const windowMsOf = (r: { perSecond: number; burst: number }): number => Math.round((r.burst / r.perSecond) * 1000);

  await fastify.register(async (scope) => {
    // Sustained `perSecond`, bursts up to `burst` (window = burst / perSecond).
    await scope.register(rateLimit, {
      global: true,
      max: read.burst,
      timeWindow: windowMsOf(read),
      keyGenerator: clientKey,
    });

    // Encapsulated: never replaces the dashboard's own error handler.
    scope.setErrorHandler((err: unknown, _req, reply) => {
      const status = clientErrorStatus(err);
      if (status !== undefined) return reply.code(status).send({ error: CLIENT_ERRORS[status] ?? "bad_request" });
      logger.error(`agent-teams: route error ${err instanceof Error ? err.message : String(err)}`);
      return reply.code(500).send({ error: "internal_error" });
    });

    scope.get(`${API_PREFIX}/teams`, async (req, reply) => {
      const lookup = sessionLookup(req.url);
      if (lookup === "invalid") return reply.code(400).send({ error: "bad_session_id" });
      if (lookup === undefined) {
        const all = store.list();
        const flags = await Promise.all(all.map((t) => visible(t, req)));
        return listOf(
          store,
          all.filter((_, i) => flags[i]),
        );
      }
      // Scan the teams (the session index forgets closed teams), then owner-filter only the matches.
      const matches = store.list().filter((t) => t.leadSessionId === lookup || t.members.some((m) => m.sessionId === lookup));
      const flags = await Promise.all(matches.map((t) => visible(t, req)));
      const best = pickForSession(
        store,
        matches.filter((_, i) => flags[i]),
      );
      return listOf(store, best ? [best] : []);
    });

    scope.get<{ Params: { id: string } }>(`${API_PREFIX}/teams/:id`, async (req, reply) => {
      counters?.count("snapshot_requests");
      const team = store.get(req.params.id);
      if (!team || !(await visible(team, req))) {
        if (team) counters?.count("owner_filtered_404");
        return reply.code(404).send(NOT_FOUND);
      }
      // No await from here to the body: ETag and snapshot describe the same revision.
      const viewerCanControl = controllable(team, req);
      const etag = snapshotEtag(epoch, store.rev(team.id));
      reply.header("etag", etag).header("cache-control", "private, no-cache");
      if (req.headers["if-none-match"] === etag) {
        counters?.count("snapshot_304");
        return reply.code(304).send();
      }
      const view: TeamUiSnapshot = { ...snapshotOf(store, deps.telemetry, team), epoch, viewerCanControl };
      return view;
    });

    if (userActions) {
      const writeLimit = { rateLimit: { max: write.burst, timeWindow: windowMsOf(write) } };

      scope.post<{ Params: { id: string; name: string } }>(`${API_PREFIX}/teams/:id/members/:name/stop`, { config: writeLimit }, async (req, reply) => {
        const team = await reachable(store.get(req.params.id), req);
        if (!team) return reply.code(404).send(NOT_FOUND);
        const { name } = req.params;
        // Only a name in core's grammar that exists is ever logged (the URL is untrusted).
        const known = MEMBER_NAME_REGEXP.test(name) && store.member(team, name) !== undefined;
        const res = known ? userActions.stopMember(team, name) : ({ status: 404, body: NOT_FOUND, outcome: "not_found" } as const);
        deps.telemetry.log("user_stop", team.id, { member: known ? name : "-", outcome: res.outcome });
        counters?.count(`stop_${res.outcome}`);
        return reply.code(res.status).send(res.body);
      });

      scope.post<{ Params: { id: string } }>(`${API_PREFIX}/teams/:id/shutdown`, { config: writeLimit }, async (req, reply) => {
        const team = await reachable(store.get(req.params.id), req);
        if (!team) return reply.code(404).send(NOT_FOUND);
        const res = await userActions.shutdownTeam(team);
        deps.telemetry.log("user_shutdown", team.id, { outcome: res.outcome });
        counters?.count(`shutdown_${res.outcome}`);
        return reply.code(res.status).send(res.body);
      });
    }
  });
}
