/**
 * The post-bind half of a template start (design D4): once the lead is bound, run the registered start
 * profile's `seed` (once), queue the `playbook` mail (server-started lead only: the command path hands the
 * playbook to the bridge in the `team.start` reply) and spawn the eager roster through the SAME in-process
 * spawn path the agent tool takes (`ops.spawnTeammate`, `source:"server"`). Everything reads the persisted
 * snapshot only, and every step is idempotent so the same function finishes a start after a server restart:
 * existing members (live OR failed) are never spawned again, the playbook is never re-sent, a seed that ran
 * is remembered in the snapshot.
 * See change: add-agent-teams-templates-hooks.
 */
import { MAIL_KIND_PLAYBOOK } from "../shared/approval-mail.js";
import { LEAD_ADDRESS } from "../shared/constants.js";
import type { TeammateSpawnArgs } from "../shared/protocol.js";
import type { Member, Team, TeamTemplateSnapshot, TemplateMember } from "../shared/types.js";
import { fail } from "./op-util.js";
import { getStartProfile } from "./start-profiles.js";
import type { TemplatesHooksDeps } from "./templates-hooks.js";

const hasPlaybookMail = (deps: TemplatesHooksDeps, teamId: string): boolean => deps.store.mailLog(teamId).some((m) => m.kind === MAIL_KIND_PLAYBOOK);

/** Spawn arguments of one snapshot member: the goal as the core spawn prompt, the rest from the snapshot. */
function memberArgs(snap: TeamTemplateSnapshot, m: TemplateMember): TeammateSpawnArgs {
  const policy = m.requirePlanApproval ?? snap.requirePlanApproval;
  return {
    name: m.name,
    prompt: `Team goal: ${snap.goal}`,
    ...(m.role !== undefined ? { role: m.role } : {}),
    ...(m.model !== undefined ? { model: m.model } : {}),
    ...(m.tools !== undefined ? { tools: [...m.tools] } : {}),
    ...(m.skills !== undefined ? { skills: [...m.skills] } : {}),
    ...(m.cwd !== undefined ? { cwd: m.cwd } : {}),
    ...(m.agent !== undefined ? { agent: m.agent } : {}),
    ...(policy !== undefined ? { requirePlanApproval: policy } : {}),
  };
}

/** Whether a start still has work to do for this bound team (used to resume after a restart). */
export function needsStartPhase(deps: TemplatesHooksDeps, team: Team): boolean {
  const snap = team.template;
  if (!snap) return false;
  if (snap.spawn !== "lead" && snap.members.some((m) => deps.store.member(team, m.name) === undefined)) return true;
  if (team.leadSpawnToken !== undefined && !hasPlaybookMail(deps, team.id)) return true;
  return getStartProfile(snap.name) !== undefined && snap.seeded !== true;
}

export interface StartPhase {
  /** Run (or finish) the post-bind steps of `teamId`; concurrent calls for one team collapse into one. */
  run(teamId: string): Promise<void>;
}

export function createStartPhase(deps: TemplatesHooksDeps): StartPhase {
  const { ops, store, logger } = deps;
  const running = new Set<string>();
  const live = (teamId: string): Team | undefined => {
    const t = store.get(teamId);
    return t?.template && t.status === "active" ? t : undefined;
  };

  async function seed(team: Team): Promise<void> {
    const snap = team.template;
    const profile = snap ? getStartProfile(snap.name) : undefined;
    if (!snap || !profile || snap.seeded === true) return;
    // At most once: remembered BEFORE it runs, so a crash mid-seed never seeds twice.
    store.patchTeam(team.id, { template: { ...snap, seeded: true } }, { writeThrough: true });
    try {
      await profile.seed(team);
    } catch (err) {
      logger.error(`agent-teams: start profile seed of ${snap.name} failed: ${(err as Error).message}`);
      ops.enqueueLeadNotice(team, { text: `the start profile of ${snap.name} could not seed the team`, wake: true, coalesce: true });
    }
  }

  /** A refused eager spawn leaves a visible `failed` member (so a restart never retries it) and one coalesced notice. */
  function recordRefusal(team: Team, m: TemplateMember, code: string, message: string | undefined): void {
    const rec: Member = {
      name: m.name,
      ...(m.role !== undefined ? { role: m.role } : {}),
      ...(m.agent !== undefined ? { agent: m.agent } : {}),
      spawnToken: "refused",
      cwd: team.leadCwd,
      status: "failed",
      goneReason: `spawn failed: ${code}`,
      guardActive: false,
      noMcp: false,
      noContextFiles: false,
      lastSettleId: 0,
    };
    store.reserveMember(team.id, rec);
    const detail = message ? ` (${message.replace(/\s+/g, " ").slice(0, 160)})` : "";
    ops.enqueueLeadNotice(team, { text: `${m.name} could not be started: ${code}${detail}`, wake: true, coalesce: true });
    logger.warn(`agent-teams: eager spawn refused team=${team.id} member=${m.name} code=${code}`);
  }

  /** Spawn one snapshot member through the agent-tool path; a refusal or a throw leaves a `failed` member and a notice. */
  async function spawnOne(team: Team, snap: TeamTemplateSnapshot, m: TemplateMember): Promise<void> {
    let res: Awaited<ReturnType<typeof ops.spawnTeammate>>;
    try {
      res = await ops.spawnTeammate(team, memberArgs(snap, m), { trusted: {}, source: "server" });
    } catch (err) {
      res = fail("invalid_args", (err as Error).message);
    }
    if (!res.ok) recordRefusal(team, m, res.error, res.message);
  }

  async function spawnEager(teamId: string): Promise<void> {
    const snap = live(teamId)?.template;
    if (!snap || snap.spawn === "lead") return;
    for (const m of snap.members) {
      const team = live(teamId);
      if (!team) return; // closed or orphaned meanwhile: the next bind resumes
      if (!store.member(team, m.name)) await spawnOne(team, snap, m); // already spawned (or failed) before a restart: skip
    }
  }

  /** The playbook mail of a server-started lead, once (the command path hands it to the bridge in the reply). */
  function queuePlaybook(team: Team): void {
    if (team.leadSpawnToken === undefined || hasPlaybookMail(deps, team.id)) return;
    const sent = ops.sendServerMail(team, LEAD_ADDRESS, { kind: MAIL_KIND_PLAYBOOK, text: team.template?.playbook ?? "", wake: true });
    if (!sent.ok) logger.warn(`agent-teams: playbook mail for team ${team.id} was not queued: ${sent.error}`);
  }

  async function run(teamId: string): Promise<void> {
    if (running.has(teamId)) return;
    running.add(teamId);
    try {
      await Promise.resolve(); // leave the store event that triggered us
      const team = live(teamId);
      if (!team) return;
      await seed(team);
      const bound = live(teamId);
      if (!bound) return;
      queuePlaybook(bound);
      await spawnEager(teamId);
    } catch (err) {
      logger.error(`agent-teams: finishing the start of team ${teamId} failed: ${(err as Error).message}`);
    } finally {
      running.delete(teamId);
    }
  }

  return { run };
}
