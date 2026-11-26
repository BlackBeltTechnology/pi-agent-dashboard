/**
 * Plan-approval policy helpers (design D8): policy ordering, the explicit tool list of a plan-mode
 * member, the spawn contribution (extras + env hint) the spawn resolver and contributor use, and the
 * `hello` plan-mode state. Pure: no store access, no I/O.
 * See change: add-agent-teams-templates-hooks.
 */
import {
  EXT_KEY_PLAN_MODE,
  EXT_KEY_PLAN_MODE_TOOLS,
  PI_DEFAULT_TOOLS,
  PLAN_HOLD,
  serializePlanTools,
  unionTools,
} from "../shared/plan-mode.js";
import type { PlanModeState } from "../shared/protocol.js";
import type { Member, PlanApprovalPolicy, Team } from "../shared/types.js";
import type { TeamsConfig } from "./config.js";
import type { MemberSpawnExtras } from "./extension-points.js";

export { PLAN_HOLD };

/** Env name of the plan-mode hint a spawn contributor sets (`PI_EXT_AGENT_TEAMS_PLAN_MODE=1`). */
export const PLAN_MODE_ENV_KEY = EXT_KEY_PLAN_MODE;

const RANK = (p: PlanApprovalPolicy | undefined): number => (p === "user" ? 2 : p === true ? 1 : 0);

/** The stronger of two policies (`false < true < "user"`); `undefined` counts as `false`. */
export function strongerPolicy(a: PlanApprovalPolicy | undefined, b: PlanApprovalPolicy | undefined): PlanApprovalPolicy {
  const r = Math.max(RANK(a), RANK(b));
  return r === 2 ? "user" : r === 1;
}

/** Whether a policy puts the member in plan mode. */
export const isPlanPolicy = (p: PlanApprovalPolicy | undefined): p is true | "user" => p === true || p === "user";

/** The member's resolved policy (`false` when none was recorded). */
export const planPolicyFor = (member: Pick<Member, "requirePlanApproval"> | undefined): PlanApprovalPolicy => member?.requirePlanApproval ?? false;

/** A member with a submitted, undecided plan: no idle hook, no lead idle notice. */
export const isPendingPlan = (member: Pick<Member, "planApproval">): boolean => member.planApproval === "pending";

/** A member held from auto-claim by an outstanding plan (`planning` or `pending`). */
export const isHeldByPlan = (member: Pick<Member, "planApproval">): boolean => member.planApproval === "planning" || member.planApproval === "pending";

/**
 * The explicit tool list of a plan-mode member: (its resolved list, or pi's default four when unrestricted)
 * ∪ `planModeTools` ∪ the team tools — so everything the member may use after approval is registered
 * from the start and nothing depends on re-enabling a tool excluded at spawn.
 */
export function buildPlanMemberToolList(resolvedTools: readonly string[] | undefined, cfg: Pick<TeamsConfig, "planModeTools">, teamTools: readonly string[]): string[] {
  return unionTools(resolvedTools ?? PI_DEFAULT_TOOLS, cfg.planModeTools, teamTools);
}

/** The env projection the spawn contributor adds for a plan-mode member (extension keys, not env names). */
export function planSpawnEnv(cfg: Pick<TeamsConfig, "planModeTools">): Record<string, string> {
  return { [EXT_KEY_PLAN_MODE]: "1", [EXT_KEY_PLAN_MODE_TOOLS]: serializePlanTools(cfg.planModeTools) };
}

export interface PlanSpawnInput {
  /** The member's resolved policy (after precedence and the template floor). */
  requirePlanApproval?: PlanApprovalPolicy;
  /** The member's resolved tool list; absent = unrestricted. */
  tools?: string[];
}

/** What the spawn resolver applies for a plan-mode member. */
export interface PlanSpawnContribution {
  /** The explicit tool list for the spawn (`SpawnResolution.args.tools`). */
  tools: string[];
  /** Persisted on the `Member` (`planApproval:"planning"` + `hold`). */
  member: MemberSpawnExtras;
  /** Env hint (`PI_EXT_AGENT_TEAMS_PLAN_MODE=1`); the spawn contributor adds it again idempotently. */
  env: Record<string, string>;
}

/**
 * Plan-mode spawn contribution for a member, or `undefined` when its policy is not `true`/`"user"`.
 * `teamTools` is the member tool set of the one role table (`TEAM_TOOLS_BY_ROLE.member`).
 */
export function planSpawnContribution(
  _team: Team | undefined,
  _memberName: string,
  resolved: PlanSpawnInput,
  cfg: Pick<TeamsConfig, "planModeTools">,
  teamTools: readonly string[],
): PlanSpawnContribution | undefined {
  if (!isPlanPolicy(resolved.requirePlanApproval)) return undefined;
  return {
    tools: buildPlanMemberToolList(resolved.tools, cfg, teamTools),
    member: { requirePlanApproval: resolved.requirePlanApproval, planApproval: "planning", hold: PLAN_HOLD },
    env: planSpawnEnv(cfg),
  };
}

/** The authoritative `hello` plan-mode state of a member, or `undefined` when its plan approval is not in play. */
export function planModeState(member: Member, cfg: Pick<TeamsConfig, "planModeTools">): PlanModeState | undefined {
  if (member.planApproval === undefined) return undefined;
  const restoreTools = unionTools(member.tools ?? unionTools(PI_DEFAULT_TOOLS, cfg.planModeTools));
  return { active: member.planApproval !== "approved", restoreTools };
}
