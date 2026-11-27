/**
 * Plan approval (design D8): `PlanSubmit` (teammate) / `PlanDecision` (lead) ops, the decision function the
 * REST route shares, and the seams that keep a plan-mode member read-only until approved — dispatch
 * eligibility, idle-notice filter, `hello` plan mode, the spawn env hint, cancel on session end and the
 * post-restart reconcile. Every state change is a synchronous store write, so submit/decide races resolve
 * to exactly one winner. Decisions are recorded by the server from the verified caller, never from text.
 * See change: add-agent-teams-templates-hooks.
 */

import { MAIL_KIND_PLAN_DECISION, MAIL_KIND_PLAN_REQUEST } from "../shared/approval-mail.js";
import { LEAD_ADDRESS } from "../shared/constants.js";
import { PLAN_HOLD } from "../shared/plan-mode.js";
import type { OpResult, PlanDecisionResult, PlanSubmitResult } from "../shared/protocol.js";
import type { Member, PlanRequest, Team } from "../shared/types.js";
import { fail } from "./op-util.js";
import type { Caller } from "./ops.js";
import { isHeldByPlan, isPendingPlan, planModeState, planSpawnEnv } from "./plan-policy.js";
import { appendPlan, boundedText, nextPlanId, patchPlan, planBounds } from "./plan-store.js";
import type { TemplatesHooksDeps } from "./templates-hooks.js";

export { buildPlanMemberToolList, isPendingPlan, planPolicyFor, planSpawnContribution } from "./plan-policy.js";

/** What plan logic needs from the composition root. */
export type PlansDeps = Pick<TemplatesHooksDeps, "ops" | "store" | "config" | "logger" | "clock" | "counters">;

/** Who decides: the lead's tool call or the user's REST post (`principal` = the verified request principal, when known). */
type PlanActor = { kind: "lead" } | { kind: "user"; principal?: string };

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const header = (planId: string, teamId: string, member: string): string => `plan ${planId} · team ${teamId} · member ${member}`;

function logPlan(deps: PlansDeps, event: string, team: Team, fields: Record<string, string>): void {
  const kv = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(" ");
  deps.logger.info(`agent-teams: plan ${event} team=${team.id} ${kv}`);
}

/** Stored plan requests of a team, oldest first (a copy). */
export function listPlans(_deps: PlansDeps, team: Team): PlanRequest[] {
  return (team.plans ?? []).map((p) => ({ ...p }));
}

function savePlans(deps: PlansDeps, team: Team, plans: PlanRequest[]): void {
  deps.store.patchTeam(team.id, { plans }, { writeThrough: true });
}

/** `PlanSubmit {plan}`: store a pending plan, supersede the member's previous pending one, wake the lead. */
function submitPlan(deps: PlansDeps, caller: Caller, args: unknown): OpResult<PlanSubmitResult> {
  const team = caller.team;
  const member = team && caller.role === "member" ? deps.store.member(team, caller.name) : undefined;
  if (!team || !member || member.planApproval === undefined || member.planApproval === "approved") return fail("plan_not_required", "plan approval is not in play for you");
  const text = boundedText(isRecord(args) ? args.plan : undefined, planBounds(deps.config()), { what: "plan" });
  if (!text.ok) return text;
  const now = deps.clock.now();
  const id = nextPlanId(team.plans ?? []);
  const plan: PlanRequest = { id, member: member.name, plan: text.data, status: "pending", createdAt: now };
  savePlans(deps, team, appendPlan(team.plans ?? [], plan, now));
  deps.store.patchMember(team.id, member.name, { planApproval: "pending", hold: PLAN_HOLD }, { writeThrough: true });
  const sent = deps.ops.sendServerMail(team, LEAD_ADDRESS, {
    kind: MAIL_KIND_PLAN_REQUEST,
    text: `${header(id, team.id, member.name)}\n\n${text.data}`,
    wake: true,
    details: { planId: id, member: member.name },
  });
  if (!sent.ok) deps.logger.warn(`agent-teams: plan_request for ${id} was not queued: ${sent.error}`);
  deps.counters.inc("plansSubmitted", team.id);
  logPlan(deps, "submitted", team, { plan: id, member: member.name, chars: String(text.data.length) });
  return { ok: true, data: { planId: id, status: "pending" } };
}

export interface PlanDecisionInput {
  team: Team;
  member: unknown;
  planId: unknown;
  approve: unknown;
  feedback?: unknown;
  actor: PlanActor;
}

function decisionMail(plan: PlanRequest, team: Team, approved: boolean, by: string, feedback: string): string {
  const outcome = approved
    ? `Plan ${plan.id} approved by ${by}. You may now use all your tools; start the work.`
    : `Plan ${plan.id} rejected by ${by}. You stay read-only: revise the plan and call PlanSubmit again.`;
  return `${header(plan.id, team.id, plan.member)}\n${outcome}${feedback === "" ? "" : `\n\n${feedback}`}`;
}

/** Resolve the member and the pending plan a decision names (`unknown_plan` / `user_decision_required` / `already_decided`). */
function locateDecision(deps: PlansDeps, input: PlanDecisionInput): OpResult<{ member: Member; plan: PlanRequest }> {
  const { team, actor } = input;
  if (typeof input.member !== "string" || typeof input.planId !== "string" || typeof input.approve !== "boolean") return fail("invalid_args", "member, planId and approve are required");
  const member = deps.store.member(team, input.member);
  if (!member || member.planApproval === undefined) return fail("unknown_plan", input.planId);
  if (actor.kind === "lead" && member.requirePlanApproval === "user") return fail("user_decision_required", "only the user may decide this member's plan");
  const plan = (team.plans ?? []).find((p) => p.id === input.planId && p.member === member.name);
  if (!plan) return fail("unknown_plan", input.planId);
  if (plan.status !== "pending") return fail("already_decided", `plan ${plan.id} is ${plan.status}`);
  return { ok: true, data: { member, plan } };
}

/**
 * Decide plan `planId` of `member`. A decision binds to the named plan only: unknown member/plan ⇒ `unknown_plan`,
 * a plan that is not pending ⇒ `already_decided` (the member's current plan is untouched). The lead cannot decide
 * for a `"user"` member. Approve sets `approved` and clears the hold BEFORE the waking `plan_decision` mail is queued.
 */
export function decidePlan(deps: PlansDeps, input: PlanDecisionInput): OpResult<PlanDecisionResult> {
  const { team, actor } = input;
  const target = locateDecision(deps, input);
  if (!target.ok) return target;
  const { member, plan } = target.data;
  const approve = input.approve === true;
  const feedback = input.feedback === undefined ? { ok: true as const, data: "" } : boundedText(input.feedback, planBounds(deps.config()), { allowEmpty: true, what: "feedback" });
  if (!feedback.ok) return feedback;
  const by = actor.kind === "lead" ? "lead" : actor.principal ? `user:${actor.principal}` : "user";
  const status = approve ? "approved" : "rejected";
  savePlans(deps, team, patchPlan(team.plans ?? [], plan.id, { status, decidedAt: deps.clock.now(), decidedBy: by, ...(feedback.data !== "" ? { feedback: feedback.data } : {}) }));
  // Approve: state and hold first, THEN the mail — a dispatcher tick in between can never hand a read-only member work.
  deps.store.patchMember(team.id, member.name, approve ? { planApproval: "approved", hold: undefined } : { planApproval: "planning", hold: PLAN_HOLD }, { writeThrough: true });
  const sent = deps.ops.sendServerMail(team, member.name, {
    kind: MAIL_KIND_PLAN_DECISION,
    text: decisionMail(plan, team, approve, actor.kind === "lead" ? "the lead" : "the user", feedback.data),
    wake: true,
    details: { planId: plan.id, approve },
  });
  if (!sent.ok) deps.logger.warn(`agent-teams: plan_decision for ${plan.id} was not queued: ${sent.error}`);
  deps.counters.inc(approve ? "plansApproved" : "plansRejected", team.id);
  logPlan(deps, status, team, { plan: plan.id, member: member.name, by: actor.kind });
  return { ok: true, data: { planId: plan.id, member: member.name, status } };
}

/** Mark a member's pending plans `cancelled` (its session ended or it never re-registered). */
function cancelPendingPlans(deps: PlansDeps, team: Team, memberName: string, reason: string): number {
  const pending = (team.plans ?? []).filter((p) => p.member === memberName && p.status === "pending");
  if (pending.length === 0) return 0;
  const now = deps.clock.now();
  let plans = team.plans ?? [];
  for (const p of pending) plans = patchPlan(plans, p.id, { status: "cancelled", decidedAt: now });
  savePlans(deps, team, plans);
  deps.counters.inc("plansCancelled", team.id, pending.length);
  for (const p of pending) logPlan(deps, "cancelled", team, { plan: p.id, member: memberName, reason });
  return pending.length;
}

/** After a server restart: cancel the pending plan of every member that did not re-register within `spawnTimeoutMs`. */
function reconcileAfterRestart(deps: PlansDeps, onDispose: (fn: () => void) => void): void {
  const waiting = deps.store.list().filter((t) => t.status !== "closed" && (t.plans ?? []).some((p) => p.status === "pending"));
  if (waiting.length === 0) return;
  const timer = deps.clock.setTimeout(() => {
    for (const w of waiting) {
      const team = deps.store.get(w.id);
      if (!team || team.status === "closed") continue;
      for (const m of team.members) if (m.status === "disconnected") cancelPendingPlans(deps, team, m.name, "not re-registered after restart");
    }
  }, deps.config().spawnTimeoutMs);
  onDispose(() => deps.clock.clearTimeout(timer));
}

/** Wire plan approval into the core seams (runs once before the registries seal). */
export function registerPlans(deps: TemplatesHooksDeps): void {
  const { ops, ext, store } = deps;
  ops.registerOp("PlanSubmit", (args, caller) => submitPlan(deps, caller, args));
  ops.registerOp("PlanDecision", (args, caller) => {
    if (!caller.team) return fail("not_in_team");
    const a = isRecord(args) ? args : {};
    return decidePlan(deps, { team: caller.team, member: a.member, planId: a.planId, approve: a.approve, feedback: a.feedback, actor: { kind: "lead" } });
  });
  ext.registerDispatchEligibility((_team: Team, member: Member) => !isHeldByPlan(member));
  ext.registerIdleNoticeFilter((_team, member) => isPendingPlan(member));
  ext.registerHelloContributor(({ member, role, payload }) => {
    const planMode = role === "member" && member ? planModeState(member, deps.config()) : undefined;
    if (!planMode) return undefined;
    return { reply: { planMode }, ...(planMode.active && payload.planToolsActive === false ? { degraded: "plan_tools_unavailable" as const } : {}) };
  });
  ext.registerSpawnContributor(({ member }) => (member.planApproval === "planning" ? { env: planSpawnEnv(deps.config()) } : undefined));
  store.on("member_status", ({ team, member, to }) => {
    if (to === "gone" || to === "failed") cancelPendingPlans(deps, team, member.name, `member ${to}`);
  });
  reconcileAfterRestart(deps, deps.onDispose);
}
