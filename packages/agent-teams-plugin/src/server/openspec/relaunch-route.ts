/**
 * `POST /api/plugins/agent-teams/openspec-relaunch {teamId, change}` (design D3 "Relaunch"): the only recovery
 * path of a failed or lost launch, because no lead tool names a change. Tier `operate` (`ROUTE_TIERS`), the
 * owner rule of the Team routes (`helpers.reachable`: visible AND controllable, else the ONE not-found body),
 * stricter write limiter. The launcher decides; a state that is not clearable answers `not_relaunchable`
 * (also for apply / plain teams) and nothing changes.
 *   200 {ok:true, change}   400 invalid_args   404 not_found   409 not_relaunchable   503 sidecar_write_failed
 * See change: add-agent-teams-openspec.
 */
import { isRecord } from "../args.js";
import { isChangeName } from "./inputs.js";
import type { Launcher } from "./launcher.js";
import type { OpenspecApi } from "./profiles.js";

const TEAM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const STATUS: Readonly<Record<string, number>> = { invalid_args: 400, not_found: 404, not_relaunchable: 409, sidecar_write_failed: 503 };

/** `current` resolves the live module handle and its launcher at request time (see `registerShippedGate`). */
export function registerRelaunchRoute(current: () => { api: OpenspecApi; launcher: Launcher | undefined }): void {
  current().api.deps.ext.registerRoutes((scope, helpers) => {
    scope.post<{ Body: unknown }>(`${helpers.prefix}/openspec-relaunch`, { config: helpers.writeLimit }, async (req, reply) => {
      const body = isRecord(req.body) ? req.body : {};
      const { teamId, change } = body;
      if (typeof teamId !== "string" || !TEAM_ID_RE.test(teamId) || !isChangeName(change) || change === "archive") {
        return reply.code(STATUS.invalid_args as number).send({ ok: false, error: "invalid_args", message: "teamId and change are required" });
      }
      const { api, launcher } = current();
      const team = await helpers.reachable(api.deps.store.get(teamId), req);
      if (!team || !launcher) return reply.code(404).send(helpers.notFound);
      const res = launcher.relaunch(team, change);
      if (!res.ok) return reply.code(STATUS[res.error] as number).send({ ok: false, error: res.error, message: res.message });
      return { ok: true, change: res.change };
    });
  });
}
