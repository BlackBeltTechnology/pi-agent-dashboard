/**
 * Everything `team.start` does BEFORE a team exists (shared by the command and REST paths): goal check,
 * template load (cache dropped first, so the hash is that of the bytes snapshotted), playbook render and cap,
 * hook trust (`hooks_untrusted` / `hash_mismatch`) and the registered start profile's `preflight`. A refusal
 * here leaves no team, lead or member behind. The result also carries the `createTeam` input and the snapshot.
 * See change: add-agent-teams-templates-hooks.
 */
import type { ErrorCode, OpResult } from "../shared/protocol.js";
import type { TeamHooks, TeamOverrides, TeamTemplateSnapshot } from "../shared/types.js";
import { effectiveHookTimeoutMs } from "./config.js";
import { decideHookTrust, describeHooks, getHookTrustStore } from "./hook-trust.js";
import { fail } from "./op-util.js";
import type { CreateTeamInput } from "./ops.js";
import { getStartProfile } from "./start-profiles.js";
import { loadTemplate, normalizeGoal, type ParsedTemplate, type RenderResult, renderPlaybook, templateCache } from "./templates.js";
import type { TemplatesHooksDeps } from "./templates-hooks.js";

export interface PreparedStart {
  template: ParsedTemplate;
  goal: string;
  snapshot: TeamTemplateSnapshot;
  hooks?: TeamHooks;
  /** `createTeam` fields shared by both paths (caller adds `leadSessionId` / `starting` / owner / token). */
  teamInput: Pick<CreateTeamInput, "name" | "leadCwd" | "mode" | "maxTeammates" | "defaultTools" | "defaultSkills" | "overrides" | "template" | "hooks">;
}

export interface PrepareInput {
  template: unknown;
  goal: unknown;
  cwd: string;
  trustHooks?: unknown;
  callerSessionId?: string;
}

type Refusal = ReturnType<typeof fail>;
type Rendered = Extract<RenderResult, { ok: true }>;

const hasHooks = (hooks: TeamHooks | undefined): hooks is TeamHooks => hooks !== undefined && Object.values(hooks).some((list) => (list?.length ?? 0) > 0);

/** Shape of the caller's `trustHooks`: absent, or the hash string a `hooks_untrusted` answer carried. */
const badTrustHooks = (v: unknown): boolean => v !== undefined && (typeof v !== "string" || v === "" || v.length > 200);

/** `hooks_untrusted` / `hash_mismatch` for a project hook set that has no matching confirmation (a user/bundled set is trusted). */
async function hookTrustRefusal(deps: TemplatesHooksDeps, template: ParsedTemplate, hooks: TeamHooks, input: PrepareInput): Promise<Refusal | undefined> {
  const defaultTimeoutMs = effectiveHookTimeoutMs(deps.config());
  let decision: Awaited<ReturnType<typeof decideHookTrust>>;
  try {
    decision = await decideHookTrust(getHookTrustStore(deps), { cwd: input.cwd, source: template.source, hooks, defaultTimeoutMs, trustHooks: input.trustHooks as string | undefined });
  } catch (err) {
    deps.logger.error(`agent-teams: recording the hook confirmation failed: ${(err as Error).message}`);
    return fail("hooks_untrusted", "the hook confirmation could not be stored; nothing was started", { ...describeHooks(hooks, defaultTimeoutMs) });
  }
  if (decision.ok) return undefined;
  if (decision.error === "hash_mismatch") return fail("hash_mismatch", "the hooks changed since they were shown; review them again", { hash: decision.hash });
  return fail("hooks_untrusted", "this project template runs shell hooks; confirm the exact commands to start it", { hash: decision.hash, commands: decision.commands });
}

/** The registered start profile's `preflight` (a throw is a refusal, never a crash). */
async function preflightRefusal(deps: TemplatesHooksDeps, name: string, goal: string, cwd: string): Promise<Refusal | undefined> {
  const profile = getStartProfile(name);
  if (!profile) return undefined;
  try {
    const verdict = await profile.preflight(goal, cwd);
    return verdict.ok ? undefined : fail(verdict.error as ErrorCode, verdict.message, verdict.details);
  } catch (err) {
    deps.logger.error(`agent-teams: start preflight of ${name} threw: ${(err as Error).message}`);
    return fail("invalid_args", "the start preflight failed");
  }
}

function snapshotOf(template: ParsedTemplate, goal: string, rendered: Rendered): TeamTemplateSnapshot {
  return {
    name: template.name,
    source: template.source,
    hash: template.hash,
    goal,
    playbook: rendered.playbook,
    members: rendered.members.map((m) => ({ ...m, ...(m.tools ? { tools: [...m.tools] } : {}), ...(m.skills ? { skills: [...m.skills] } : {}) })),
    spawn: template.spawn,
    ...(template.requirePlanApproval !== undefined ? { requirePlanApproval: template.requirePlanApproval } : {}),
    ...(template.defaultModel !== undefined ? { defaultModel: template.defaultModel } : {}),
    ...(template.defaultTools ? { defaultTools: [...template.defaultTools] } : {}),
    ...(template.defaultSkills ? { defaultSkills: [...template.defaultSkills] } : {}),
    ...(template.lead ? { lead: { ...template.lead } } : {}),
    ...(template.maxTeammates !== undefined ? { maxTeammates: template.maxTeammates } : {}),
  };
}

function teamInputOf(template: ParsedTemplate, cwd: string, snapshot: TeamTemplateSnapshot, hooks: TeamHooks | undefined): PreparedStart["teamInput"] {
  const overrides: TeamOverrides = {
    ...(template.autoDispatch !== undefined ? { autoDispatch: template.autoDispatch } : {}),
    ...(template.notifyCoalesceMs !== undefined ? { notifyCoalesceMs: template.notifyCoalesceMs } : {}),
  };
  return {
    name: template.name,
    leadCwd: cwd,
    mode: template.mode,
    ...(template.maxTeammates !== undefined ? { maxTeammates: template.maxTeammates } : {}),
    ...(template.defaultTools ? { defaultTools: [...template.defaultTools] } : {}),
    ...(template.defaultSkills ? { defaultSkills: [...template.defaultSkills] } : {}),
    ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
    template: snapshot,
    ...(hooks ? { hooks: structuredClone(hooks) } : {}),
  };
}

function argRefusal(input: PrepareInput): Refusal | undefined {
  if (typeof input.template !== "string" || input.template === "") return fail("invalid_args", "template must be a name");
  return badTrustHooks(input.trustHooks) ? fail("invalid_args", "trustHooks must be the hash shown by hooks_untrusted") : undefined;
}

export async function prepareStart(deps: TemplatesHooksDeps, input: PrepareInput): Promise<OpResult<PreparedStart>> {
  const badArgs = argRefusal(input);
  if (badArgs) return badArgs;
  const goal = normalizeGoal(input.goal);
  if (!goal.ok) return fail("invalid_args", goal.message);

  // A listing may have cached an older parse of the same size and mtime: a start always re-reads.
  templateCache.invalidate();
  const loaded = loadTemplate(input.template as string, input.cwd, deps, input.callerSessionId ? { caller: { sessionId: input.callerSessionId } } : {});
  if (!loaded.ok) return fail(loaded.code, loaded.message, loaded.issues.length > 0 ? { issues: loaded.issues } : undefined);
  const template = loaded.template;

  const rendered = renderPlaybook({ template, goal: goal.goal, cwd: input.cwd, maxMessageChars: deps.config().maxMessageChars });
  if (!rendered.ok) return rendered.code === "playbook_too_long" ? fail("playbook_too_long", rendered.message, { chars: rendered.chars, lines: rendered.lines }) : fail("invalid_args", rendered.message);

  const hooks = hasHooks(template.hooks) ? template.hooks : undefined;
  const refused = (hooks ? await hookTrustRefusal(deps, template, hooks, input) : undefined) ?? (await preflightRefusal(deps, template.name, goal.goal, input.cwd));
  if (refused) return refused;

  const snapshot = snapshotOf(template, goal.goal, rendered);
  return { ok: true, data: { template, goal: goal.goal, snapshot, ...(hooks ? { hooks } : {}), teamInput: teamInputOf(template, input.cwd, snapshot, hooks) } };
}
