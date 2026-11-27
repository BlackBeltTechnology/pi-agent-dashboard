/**
 * Starting a team from a template (design D3, D4, D4b, D10): the `team.templates` and `team.start` lane ops
 * (bridge callers; NOT agent tools), the REST routes (`templates-routes.ts`), the server-started lead
 * (`start-lead.ts`) and the post-bind eager start (`start-phase.ts`). `registerStart` is wired ONLY from
 * `templates-hooks.ts` and runs once before the registries seal.
 *
 * Command path: the calling plain session becomes the lead through core `createTeam` (leadSessionId = the
 * session, cwd from the host record — a payload cwd is never read), the reply carries the rendered playbook
 * (the bridge delivers it) and the eager roster starts right away. REST path: `start-lead.ts`.
 * `registerStartProfile` (start-profiles.ts) is re-exported here for later changes.
 * See change: add-agent-teams-templates-hooks.
 */
import type { OpResult, TeamStartResult, TeamTemplatesResult } from "../shared/protocol.js";
import type { Team, TeamTemplateSnapshot } from "../shared/types.js";
import { isRecord, own } from "./args.js";
import { fail } from "./op-util.js";
import { createServerLeads } from "./start-lead.js";
import { createStartPhase, needsStartPhase } from "./start-phase.js";
import { prepareStart } from "./start-prepare.js";
import { listTemplates } from "./templates.js";
import type { TemplatesHooksDeps } from "./templates-hooks.js";
import { registerTemplatesRoutes } from "./templates-routes.js";

/** @public the start-profile API later changes register against */
export { registerStartProfile, type StartProfile, type StartRefusal } from "./start-profiles.js";

/** What the REST routes need from the start module. */
export interface StartApi {
  startFromRest(input: { template: unknown; goal: unknown; cwd: string; trustHooks?: unknown; owner?: string }): Promise<OpResult<TeamStartResult>>;
}

/** The live caller must still be a plain, unconfined session (`already_in_team` / `nested_team_forbidden` / `lead_confined`). */
function callerRefusal(ops: TemplatesHooksDeps["ops"], sessionId: string): OpResult<never> | undefined {
  const now = ops.resolveCaller({ sessionId });
  if (now.role !== "plain") return fail(now.role === "member" ? "nested_team_forbidden" : "already_in_team");
  return ops.isConfined(sessionId) ? fail("lead_confined") : undefined;
}

/** The command-path reply: the bridge registers the lead tools, delivers `playbook` and reports an ignored `lead.model` once. */
function startReply(team: Team, snapshot: TeamTemplateSnapshot, cfg: ReturnType<TemplatesHooksDeps["config"]>): TeamStartResult {
  return {
    teamId: team.id,
    name: team.name,
    role: "lead",
    playbook: snapshot.playbook,
    ...(snapshot.lead?.model ? { leadModelIgnored: snapshot.lead.model } : {}),
    limits: { maxTeammates: Math.min(team.maxTeammates, cfg.maxTeammates), maxTasks: cfg.maxTasks },
  };
}

export function registerStart(deps: TemplatesHooksDeps): void {
  const { ops, store, logger, counters } = deps;
  const phase = createStartPhase(deps);
  /** Teams whose start is known to be complete or in hand in this process (hydrated ones are checked once on lead reconnect). */
  const checked = new Set<string>();

  const noteStart = (team: Team, path: "command" | "rest"): void => {
    checked.add(team.id);
    counters.inc("templateStarts", team.id);
    logger.info(`agent-teams: start path=${path} team=${team.id} template=${team.template?.name ?? "-"} source=${team.template?.source ?? "-"} members=${team.template?.members.length ?? 0} hooks=${team.hooks ? Object.keys(team.hooks).length : 0}`);
  };
  const serverLeads = createServerLeads(deps, phase, (team) => noteStart(team, "rest"));

  // A restart after a bind but before the start finished (members missing, playbook unsent): finish it on lead reconnect.
  const offChange = store.on("change", ({ team }) => {
    if (!team.template || checked.has(team.id) || team.status !== "active" || !team.leadConnected) return;
    checked.add(team.id);
    if (needsStartPhase(deps, team)) void phase.run(team.id);
  });
  deps.onDispose(() => {
    offChange();
    serverLeads.dispose();
  });

  // ── lane ops (bridge callers) ───────────────────────────────────────────────

  ops.registerStartOp(
    "team.templates",
    (_args, caller): OpResult<TeamTemplatesResult> => {
      const cwd = caller.team?.leadCwd ?? ops.hostSession(caller.sessionId)?.cwd;
      if (!cwd) return fail("invalid_args", "caller working directory unknown");
      const listing = listTemplates({ cwd, deps, caller: { sessionId: caller.sessionId } });
      logger.info(`agent-teams: templates listed count=${listing.templates.length} invalid=${listing.templates.filter((t) => !t.valid).length} untrusted=${listing.templates.filter((t) => !t.trusted).length}`);
      return { ok: true, data: listing };
    },
    { roles: ["plain", "lead"], refuseConfined: false },
  );

  ops.registerStartOp("team.start", async (raw, caller): Promise<OpResult<TeamStartResult>> => {
    const args = isRecord(raw) ? raw : undefined;
    if (!args) return fail("invalid_args", "args must be an object");
    const host = ops.hostSession(caller.sessionId);
    if (!host?.cwd) return fail("invalid_args", "caller working directory unknown"); // a payload `cwd` is never read
    const prepared = await prepareStart(deps, { template: own(args, "template"), goal: own(args, "goal"), cwd: host.cwd, trustHooks: own(args, "trustHooks"), callerSessionId: caller.sessionId });
    if (!prepared.ok) return prepared;
    // The awaits above may have let another start from this session win: decide on the live binding, synchronously.
    const refused = callerRefusal(ops, caller.sessionId);
    if (refused) return refused;
    const created = ops.createTeam({
      ...prepared.data.teamInput,
      leadSessionId: caller.sessionId,
      callerSessionId: caller.sessionId,
      ...(host.principalOwner ? { owner: host.principalOwner } : {}),
    });
    if (!created.ok) return created;
    noteStart(created.data, "command");
    void phase.run(created.data.id); // seed + eager roster; failures notify the lead, never this reply
    return { ok: true, data: startReply(created.data, prepared.data.snapshot, deps.config()) };
  });

  // ── REST ────────────────────────────────────────────────────────────────────

  const api: StartApi = {
    async startFromRest(input) {
      const prepared = await prepareStart(deps, { template: input.template, goal: input.goal, cwd: input.cwd, trustHooks: input.trustHooks });
      if (!prepared.ok) return prepared;
      return serverLeads.start(prepared.data, input.owner ? { owner: input.owner } : {});
    },
  };
  registerTemplatesRoutes(deps, api);

  // A `starting` team survives a restart: re-arm its bind deadline or close it (it never holds a team slot).
  serverLeads.reconcile();
}
