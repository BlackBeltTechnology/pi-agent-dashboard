/**
 * Spawn resolver + prompt-file contributor (design D5, D6, D8; tasks 4.3–4.8, 6.2). Registers ONE sync
 * resolver on the core seam (runs for the `TeammateSpawn` tool AND the eager `ops.spawnTeammate` path):
 * template `maxTeammates` cap, agent definition lookup (`agent_*` refusals before anything is created), then
 * `resolveSpawnFields` (precedence, ceilings, plan floor, explicit plan tool list). A spawn contributor writes
 * the agent / member prompt files (sync, atomic) and appends them after the protocol file; a write failure
 * fails THAT member's spawn (`SpawnContributorError`), never half-writes a file. At registration it prunes
 * `<dataDir>/prompts/<teamId>/` of teams that closed-team retention already dropped.
 * See change: add-agent-teams-templates-hooks.
 */
import fs from "node:fs";
import path from "node:path";
import { PromptWriteError, prunePromptDirs, writePromptFile } from "./agent-prompts.js";
import { resolveAgent } from "./agents.js";
import { SpawnContributorError, type SpawnResolveInput } from "./extension-points.js";
import { fail, isLive } from "./op-util.js";
import { resolveSpawnFields, templateMemberOf } from "./spawn-precedence.js";
import type { TemplatesHooksDeps } from "./templates-hooks.js";


export function registerSpawnResolve(deps: TemplatesHooksDeps): void {
  const { ext, store, logger, dataDir } = deps;

  // Closed-team retention prunes at load; drop the matching prompt dirs (never a team still on disk, e.g. quarantined).
  try {
    const onDisk = (id: string): boolean => fs.existsSync(path.join(dataDir, "teams", `${id}.json`));
    // (the prune itself is a no-op when `<dataDir>/prompts` does not exist)
    prunePromptDirs(dataDir, (id) => store.get(id) !== undefined || onDisk(id));
  } catch (err) {
    logger.warn(`agent-teams: prompt dir prune failed: ${(err as Error).message}`);
  }

  const agentDeps = { host: deps.host, logger };

  ext.setSpawnResolver((input: SpawnResolveInput) => {
    const { team, leadCwd, args } = input;
    const resume = args.resume === true;
    const existing = resume && team ? store.member(team, args.name) : undefined;

    // Template `maxTeammates` caps roster + lead-spawned members (core's own cap still applies on top).
    const cap = team?.template?.maxTeammates;
    const nameTaken = !resume && team?.members.some((m) => m.name === args.name && isLive(m)) === true; // core answers name_taken
    if (team && cap !== undefined && !nameTaken) {
      const live = team.members.filter((m) => isLive(m) && !(resume && m.name === args.name)).length;
      if (live >= cap) return fail("team_full", `at most ${cap} teammates (template limit)`);
    }

    const declared = args.agent ?? templateMemberOf(team, args.name)?.agent;
    const agentName = declared ?? (resume ? existing?.agent : undefined);
    let agent;
    if (agentName !== undefined) {
      const r = resolveAgent(agentName, leadCwd, agentDeps);
      if (r.ok) {
        agent = r.agent;
        for (const w of r.agent.warnings) logger.warn(`agent-teams: agent "${agentName}": ${w}`);
      } else if (declared !== undefined) return fail(r.code, r.message);
      else logger.warn(`agent-teams: resumed member ${args.name} lost its agent definition: ${r.message}`);
    }
    return resolveSpawnFields({ team, args, ...(agent ? { agent } : {}), ...(existing ? { existing } : {}), cfg: deps.config() });
  });

  // Prompt files, appended after the core protocol file in the order agent, member.
  ext.registerSpawnContributor(({ team, member }) => {
    const memberPrompt = templateMemberOf(team, member.name)?.prompt;
    let agentPrompt: string | undefined;
    if (member.agent !== undefined) {
      const r = resolveAgent(member.agent, team.leadCwd, agentDeps);
      if (!r.ok) throw new SpawnContributorError(r.code, r.message);
      agentPrompt = r.agent.prompt;
    }
    const wantMember = memberPrompt !== undefined && memberPrompt.trim() !== "";
    if (agentPrompt === undefined && !wantMember) return undefined;
    try {
      const promptFiles: string[] = [];
      if (agentPrompt !== undefined) promptFiles.push(writePromptFile(dataDir, team.id, member.name, "agent", agentPrompt));
      if (wantMember) promptFiles.push(writePromptFile(dataDir, team.id, member.name, "member", memberPrompt));
      return { promptFiles };
    } catch (err) {
      if (err instanceof PromptWriteError) throw new SpawnContributorError("prompt_file_unwritable", err.message);
      throw err;
    }
  });
}
