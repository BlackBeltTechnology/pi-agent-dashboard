/**
 * REST routes of the templates-hooks change, mounted inside core's scope through `ext.registerRoutes`
 * (same limiter, error handler, visibility and control rules). Tiers live in `shared/route-tiers.ts`:
 *   GET    templates?cwd=                            observe  (cwd admitted)
 *   GET    teams/:id/plans                           observe  (core visibility)
 *   POST   teams/start {template, goal, cwd, trustHooks?}   operate (cwd admitted; owner = request principal)
 *   POST   teams/:id/members/:name/plan-decision     operate  (visible AND controllable, else the unknown-team 404)
 *   POST   hook-trust {cwd, hash}                    operate  (cwd admitted)
 *   DELETE hook-trust?cwd=&hash=                     operate  (query string: proxies strip DELETE bodies)
 * Failure body: `{ok:false, error, message?, details?}` (`details` carries `hooks_untrusted` hash + commands).
 * See change: add-agent-teams-templates-hooks.
 */
import { admitRouteCwdParam, sendRouteCwdRefusal } from "@blackbelt-technology/pi-dashboard-shared/plugin-route-cwd.js";
import type { FastifyReply } from "fastify";
import type { OpResult } from "../shared/protocol.js";
import { isRecord } from "./args.js";
import { getHookTrustStore, revokeHookTrust, trustHook } from "./hook-trust.js";
import { decidePlan, listPlans } from "./plans.js";
import type { StartApi } from "./start.js";
import { listTemplates, loadTemplate, templateCache } from "./templates.js";
import type { TemplatesHooksDeps } from "./templates-hooks.js";

const STATUS: Readonly<Record<string, number>> = {
  invalid_args: 400,
  cwd_required: 400,
  invalid_cwd: 400,
  message_too_long: 400,
  project_untrusted: 403,
  template_not_found: 404,
  unknown_plan: 404,
  not_found: 404,
  hooks_untrusted: 409,
  hash_mismatch: 409,
  team_cap_reached: 409,
  already_decided: 409,
  team_closed: 409,
  playbook_too_long: 422,
  template_invalid: 422,
  mode_unavailable: 422,
};

/** Answer an op result: data on success, `{ok:false, error, …}` with the mapped status otherwise. */
function answer<T>(reply: FastifyReply, res: OpResult<T>): unknown {
  if (res.ok) return res.data;
  reply.code(STATUS[res.error] ?? 400);
  return { ok: false, error: res.error, ...(res.message !== undefined ? { message: res.message } : {}), ...(res.details ? { details: res.details } : {}) };
}

/** Hashes the server currently computes for the trusted PROJECT templates of `cwd` (what a confirmation may name). */
function currentProjectHookHashes(deps: TemplatesHooksDeps, cwd: string): string[] {
  templateCache.invalidate();
  const out: string[] = [];
  for (const t of listTemplates({ cwd, deps }).templates) {
    if (t.source !== "project" || !t.valid || !t.hasHooks) continue;
    const loaded = loadTemplate(t.name, cwd, deps);
    if (loaded.ok && loaded.template.source === "project" && loaded.template.hooksHash !== undefined) out.push(loaded.template.hooksHash);
  }
  return out;
}

export function registerTemplatesRoutes(deps: TemplatesHooksDeps, start: StartApi): void {
  const { store } = deps;
  const admit = (raw: unknown) => admitRouteCwdParam(raw, { required: true, knownCwds: deps.host.knownFolderCwds });

  deps.ext.registerRoutes((scope, helpers) => {
    const p = helpers.prefix;

    scope.get<{ Querystring: { cwd?: unknown } }>(`${p}/templates`, async (req, reply) => {
      const adm = await admit(req.query.cwd);
      if (!adm.ok) return sendRouteCwdRefusal(reply, adm);
      try {
        const listing = listTemplates({ cwd: adm.cwd as string, deps });
        deps.logger.info(`agent-teams: templates listed count=${listing.templates.length} invalid=${listing.templates.filter((t) => !t.valid).length} untrusted=${listing.templates.filter((t) => !t.trusted).length}`);
        return listing;
      } finally {
        adm.release();
      }
    });

    scope.post<{ Body: unknown }>(`${p}/teams/start`, { config: helpers.writeLimit }, async (req, reply) => {
      const body = isRecord(req.body) ? req.body : {};
      const adm = await admit(body.cwd);
      if (!adm.ok) return sendRouteCwdRefusal(reply, adm);
      try {
        const owner = helpers.ownerOf(req);
        return answer(reply, await start.startFromRest({ template: body.template, goal: body.goal, cwd: adm.cwd as string, trustHooks: body.trustHooks, ...(owner ? { owner } : {}) }));
      } finally {
        adm.release();
      }
    });

    scope.post<{ Body: unknown }>(`${p}/hook-trust`, { config: helpers.writeLimit }, async (req, reply) => {
      const body = isRecord(req.body) ? req.body : {};
      const adm = await admit(body.cwd);
      if (!adm.ok) return sendRouteCwdRefusal(reply, adm);
      try {
        if (typeof body.hash !== "string" || body.hash === "" || body.hash.length > 200) return answer(reply, { ok: false, error: "invalid_args", message: "hash is required" });
        const cwd = adm.cwd as string;
        const current = currentProjectHookHashes(deps, cwd).find((h) => h === body.hash);
        const res = await trustHook(getHookTrustStore(deps), { cwd, hash: body.hash, currentHash: current });
        return res.ok ? { ok: true } : answer(reply, { ok: false, error: "hash_mismatch", message: "that hash is not the current hook set of a project template here" });
      } finally {
        adm.release();
      }
    });

    scope.delete<{ Querystring: { cwd?: unknown; hash?: unknown } }>(`${p}/hook-trust`, { config: helpers.writeLimit }, async (req, reply) => {
      const adm = await admit(req.query.cwd);
      if (!adm.ok) return sendRouteCwdRefusal(reply, adm);
      try {
        const { hash } = req.query;
        if (hash !== undefined && (typeof hash !== "string" || hash === "" || hash.length > 200)) return answer(reply, { ok: false, error: "invalid_args", message: "hash must be a single string" });
        return await revokeHookTrust(getHookTrustStore(deps), { cwd: adm.cwd as string, ...(hash !== undefined ? { hash } : {}) });
      } finally {
        adm.release();
      }
    });

    scope.get<{ Params: { id: string } }>(`${p}/teams/:id/plans`, async (req, reply) => {
      const team = store.get(req.params.id);
      if (!team || !(await helpers.visible(team, req))) return reply.code(404).send(helpers.notFound);
      return { plans: listPlans(deps, team) };
    });

    scope.post<{ Params: { id: string; name: string }; Body: unknown }>(`${p}/teams/:id/members/:name/plan-decision`, { config: helpers.writeLimit }, async (req, reply) => {
      const team = await helpers.reachable(store.get(req.params.id), req);
      if (!team) return reply.code(404).send(helpers.notFound);
      const body = isRecord(req.body) ? req.body : {};
      const principal = helpers.ownerOf(req);
      return answer(
        reply,
        decidePlan(deps, { team, member: req.params.name, planId: body.planId, approve: body.approve, feedback: body.feedback, actor: { kind: "user", ...(principal ? { principal } : {}) } }),
      );
    });
  });
}
