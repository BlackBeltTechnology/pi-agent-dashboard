/**
 * Spawn precedence (design D6), pure: per field the first defined of spawn argument, template member,
 * agent definition, team default wins; a template-declared `tools`/`skills` list is a CEILING a lead-supplied
 * list is intersected with; the template `requirePlanApproval` is a FLOOR a spawn argument may only
 * strengthen; a plan-mode member gets its explicit tool list from `planSpawnContribution`. Model is neither
 * ceiling nor floor. Everything the caller must read (agent file, config) is passed in.
 * See change: add-agent-teams-templates-hooks.
 */
import { type OpResult, TEAM_TOOLS_BY_ROLE, type TeammateSpawnArgs } from "../shared/protocol.js";
import type { Member, PlanApprovalPolicy, Team, TemplateMember } from "../shared/types.js";
import type { ResolvedAgent } from "./agents.js";
import type { TeamsConfig } from "./config.js";
import type { MemberSpawnExtras, SpawnResolution } from "./extension-points.js";
import { fail } from "./op-util.js";
import { planSpawnContribution, strongerPolicy } from "./plan-policy.js";

const MEMBER_TOOLS: readonly string[] = TEAM_TOOLS_BY_ROLE.member;

const unique = (xs: readonly string[]): string[] => [...new Set(xs)];

export interface PrecedenceInput {
  team: Team | undefined;
  args: TeammateSpawnArgs;
  /** The resolved agent definition of `args.agent` / the template member's `agent` / a resumed member's agent. */
  agent?: ResolvedAgent;
  /** The existing member record on `resume:true`. */
  existing?: Member;
  cfg: Pick<TeamsConfig, "planModeTools">;
}

/** The template member (post-expansion) a spawn `name` belongs to, when the team has a template snapshot. */
export const templateMemberOf = (team: Team | undefined, name: string): TemplateMember | undefined => team?.template?.members.find((m) => m.name === name);

/**
 * A lead-supplied list against a declared ceiling. An entry outside the ceiling, or an empty list against a
 * non-empty ceiling (the intersection would be empty), is refused; team tools are always allowed. A declared
 * `[]` allows nothing optional. `undefined` on either side ⇒ nothing to check.
 */
function ceilingFailure(kind: "tools" | "skills", supplied: readonly string[] | undefined, ceiling: readonly string[] | undefined) {
  if (supplied === undefined || ceiling === undefined) return undefined;
  const always = kind === "tools" ? MEMBER_TOOLS : [];
  const outside = supplied.filter((x) => !ceiling.includes(x) && !always.includes(x));
  if (outside.length === 0 && !(supplied.length === 0 && ceiling.length > 0)) return undefined;
  const code = kind === "tools" ? "tools_outside_template" : "skills_outside_template";
  const what = outside.length > 0 ? `${outside.join(", ")} not allowed` : `an empty ${kind} list leaves nothing of the template's`;
  return fail(code, `${kind}: ${what} (template allows: ${ceiling.length > 0 ? ceiling.join(", ") : "none beyond the team tools"})`, { [kind]: outside });
}

/** The effective spawn for one member: refusals (`*_outside_template`) or `{args, thinkingLevel?, member?}`. */
export function resolveSpawnFields(input: PrecedenceInput): OpResult<SpawnResolution> {
  const { team, args, agent, existing, cfg } = input;
  const tpl = team?.template;
  const tm = templateMemberOf(team, args.name);
  const resume = args.resume === true;

  const toolsCeiling = tm?.tools ?? tpl?.defaultTools;
  const skillsCeiling = tm?.skills ?? tpl?.defaultSkills;
  const refused = ceilingFailure("tools", args.tools, toolsCeiling) ?? ceilingFailure("skills", args.skills, skillsCeiling);
  if (refused) return refused;

  const model = args.model ?? tm?.model ?? agent?.model ?? tpl?.defaultModel;
  const role = args.role ?? tm?.role ?? agent?.role;
  let tools = args.tools ?? tm?.tools ?? agent?.tools ?? tpl?.defaultTools;
  const skills = args.skills ?? tm?.skills ?? tpl?.defaultSkills;
  const cwd = args.cwd ?? tm?.cwd;

  const approved = resume && existing?.planApproval === "approved";
  const templatePolicy: PlanApprovalPolicy | undefined = tm?.requirePlanApproval ?? tpl?.requirePlanApproval;
  const defined = [templatePolicy, args.requirePlanApproval, resume ? existing?.requirePlanApproval : undefined].filter((p): p is PlanApprovalPolicy => p !== undefined);
  const policy = defined.length > 0 ? defined.reduce<PlanApprovalPolicy>((acc, p) => strongerPolicy(acc, p), false) : undefined;

  const extras: MemberSpawnExtras = {};
  if (agent) extras.agent = agent.name;
  if (policy !== undefined) extras.requirePlanApproval = policy;
  const plan = approved ? undefined : planSpawnContribution(team, args.name, { ...(policy !== undefined ? { requirePlanApproval: policy } : {}), ...(tools ? { tools } : {}) }, cfg, MEMBER_TOOLS);
  if (plan) {
    tools = plan.tools;
    Object.assign(extras, plan.member);
  } else {
    // Team tools survive a template/agent allowlist (core appends them again when it builds the spawn spec).
    if (tools && (tpl || agent)) tools = unique([...tools, ...MEMBER_TOOLS]);
    if (approved) extras.planApproval = "approved";
  }

  const out: TeammateSpawnArgs = {
    ...args,
    ...(model !== undefined ? { model } : {}),
    ...(role !== undefined ? { role } : {}),
    ...(tools !== undefined ? { tools } : {}),
    ...(skills !== undefined ? { skills } : {}),
    ...(cwd !== undefined ? { cwd } : {}),
  };
  return {
    ok: true,
    data: {
      args: out,
      ...(agent?.thinking ? { thinkingLevel: agent.thinking } : {}),
      ...(Object.keys(extras).length > 0 ? { member: extras } : {}),
    },
  };
}
