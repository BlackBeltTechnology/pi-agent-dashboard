/**
 * Server-started lead (design D4b): the REST / dashboard start creates a lead-less `starting` team, persists
 * the lead spawn token and the bind deadline, spawns the lead through core's session-driver lead spawn and
 * finishes the start when core binds it (`lead_bound`). A timer at the deadline closes a team that is still
 * `starting` (`teamDelete` actor `server`, force, `closeReason:"lead_spawn_failed"`) and aborts the spawn by
 * token; the same check is re-armed (or applied) at server start. Exactly ONE outcome per team: bind and
 * deadline both look at `status === "starting"` synchronously, so whichever runs first wins and the other is
 * a no-op (never an active team with an aborted lead, never a closed team with a live bound lead).
 * See change: add-agent-teams-templates-hooks.
 */
import { randomUUID } from "node:crypto";
import type { OpResult, TeamStartResult } from "../shared/protocol.js";
import type { Team } from "../shared/types.js";
import type { StartPhase } from "./start-phase.js";
import type { PreparedStart } from "./start-prepare.js";
import type { TemplatesHooksDeps } from "./templates-hooks.js";

export interface ServerLeads {
  /** Create the `starting` team, arm the deadline and spawn the lead (not awaited: failures close the team). */
  start(prepared: PreparedStart, opts: { owner?: string }): OpResult<TeamStartResult>;
  /** Server start: re-arm the deadline of every `starting` team with a lead token, or close it when past. */
  reconcile(): void;
  dispose(): void;
}

export function createServerLeads(deps: TemplatesHooksDeps, phase: StartPhase, onCreated: (team: Team) => void): ServerLeads {
  const { ops, store, clock, logger, leads } = deps;
  const timers = new Map<string, unknown>();
  const aborted = new Set<string>();

  const clearTimer = (teamId: string): void => {
    const t = timers.get(teamId);
    if (t !== undefined) clock.clearTimeout(t);
    timers.delete(teamId);
  };

  function abortToken(token: string | undefined): void {
    if (token === undefined || aborted.has(token)) return;
    aborted.add(token);
    leads.abort(token);
  }

  /** The lead did not bind in time (or its spawn failed): close the team iff it is still `starting`. */
  function failLead(teamId: string, why: string): void {
    clearTimer(teamId);
    const team = store.get(teamId);
    if (team?.status !== "starting") return; // bound (or closed) first: the other outcome already happened
    logger.warn(`agent-teams: lead of team ${teamId} did not bind (${why}); closing it`);
    ops.teamDelete(team, { actor: "server", force: true, closeReason: "lead_spawn_failed" });
    abortToken(team.leadSpawnToken);
  }

  function arm(team: Team): void {
    clearTimer(team.id);
    const remaining = Math.max(0, (team.leadBindDeadline ?? clock.now()) - clock.now());
    timers.set(
      team.id,
      clock.setTimeout(() => {
        timers.delete(team.id);
        failLead(team.id, "deadline");
      }, remaining),
    );
  }

  const offBound = store.on("lead_bound", ({ team }) => {
    clearTimer(team.id);
    if (team.template) void phase.run(team.id);
  });
  const offClosed = store.on("team_closed", ({ team }) => {
    clearTimer(team.id);
    // Closed (user stop, deadline) before any lead bound: the lead spawn in flight must not outlive the team.
    if (team.leadSpawnToken !== undefined && team.leadSessionId === undefined) abortToken(team.leadSpawnToken);
  });

  return {
    start(prepared, opts) {
      const cfg = deps.config();
      const token = `at-${randomUUID()}`;
      const created = ops.createTeam({
        ...prepared.teamInput,
        starting: true,
        ...(opts.owner ? { owner: opts.owner } : {}),
        leadSpawnToken: token,
        leadBindDeadline: clock.now() + cfg.spawnTimeoutMs,
      });
      if (!created.ok) return created;
      const team = created.data;
      onCreated(team);
      arm(team);
      const model = prepared.snapshot.lead?.model;
      leads
        .spawn(team, { ...(model ? { model } : {}), ...(opts.owner ? { principalOwner: opts.owner } : {}), cwd: team.leadCwd, spawnToken: token })
        .then(
          (out) => {
            if (!out.ok) failLead(team.id, out.message);
            else if (store.get(team.id)?.status === "closed") abortToken(token); // resolved after the team was closed
          },
          (err: unknown) => failLead(team.id, (err as Error).message),
        );
      return {
        ok: true,
        data: { teamId: team.id, name: team.name, role: "lead", limits: { maxTeammates: Math.min(team.maxTeammates, cfg.maxTeammates), maxTasks: cfg.maxTasks } },
      };
    },
    reconcile() {
      for (const team of store.list()) {
        if (team.status !== "starting" || team.leadSpawnToken === undefined) continue;
        if (team.leadBindDeadline === undefined || team.leadBindDeadline <= clock.now()) failLead(team.id, "deadline passed while the server was down");
        else arm(team);
      }
    },
    dispose() {
      offBound();
      offClosed();
      for (const t of timers.values()) clock.clearTimeout(t);
      timers.clear();
    },
  };
}
