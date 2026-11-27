/**
 * Plan mode, bridge side (design D8): a member whose spawn env carries `PI_EXT_AGENT_TEAMS_PLAN_MODE` (or whose
 * `hello` reply says `planMode.active`) is narrowed to `(getAllTools ∩ planModeTools) ∪ team tools ∪ PlanSubmit`
 * with `pi.setActiveTools` at `session_start`, and a `tool_call` backstop refuses every other tool while plan mode
 * is on — independent of whether narrowing worked. On a `plan_decision` mail the bridge re-sends `hello`; once the
 * reply reports `active:false` it restores the SERVER-provided `restoreTools` ∪ the registered team tools, never a
 * local snapshot. The env is read once (a later tamper cannot re-widen); the reply is authoritative.
 * See change: add-agent-teams-templates-hooks.
 */
import { MAIL_KIND_PLAN_DECISION } from "../shared/approval-mail.js";
import { ENV_OPENSPEC_PROFILE } from "../shared/openspec-profile.js";
import { ENV_PLAN_MODE_TOOLS, PLAN_SUBMIT_TOOL, parsePlanToolsEnv, planModeEnvHint, unionTools } from "../shared/plan-mode.js";
import { ENV_PLAN_MODE } from "../shared/policy.js";
import { memberTools, TEAM_TOOLS_BY_ROLE } from "../shared/protocol.js";
import type { BridgeContext } from "./context.js";

/** `(getAllTools ∩ planModeTools) ∪ team tools ∪ PlanSubmit`; without `getAllTools` the (read-only) config list is used as is. */
export function computePlanTools(allToolNames: readonly string[] | undefined, planModeTools: readonly string[], teamTools: readonly string[]): string[] {
  const readOnly = allToolNames ? planModeTools.filter((t) => allToolNames.includes(t)) : [...planModeTools];
  return unionTools(readOnly, teamTools, [PLAN_SUBMIT_TOOL]);
}

/** Exact-name allowlist of the backstop: the configured plan tools plus the member team tools (lead-only tools are not in it). */
export function planAllowedTools(planModeTools: readonly string[]): ReadonlySet<string> {
  return new Set([...planModeTools, ...TEAM_TOOLS_BY_ROLE.member, PLAN_SUBMIT_TOOL]);
}

const planBlockReason = (tool: string): string =>
  `agent-teams: plan_mode: ${tool} is not available until your plan is approved. You may only read and explore, then call PlanSubmit. If your plan was just approved, retry in a moment.`;

export function registerPlanMode(ctx: BridgeContext): void {
  const { pi, log } = ctx;
  const { tools: planModeTools, dropped } = parsePlanToolsEnv(ctx.env[ENV_PLAN_MODE_TOOLS]);
  if (dropped.length > 0) log(`agent-teams: plan mode ignores non-read-only tool entries: ${dropped.join(", ")}`);
  const allowed = planAllowedTools(planModeTools);
  /** Plan mode is on: latched from the env hint at registration, then set/cleared by the hello reply. */
  let active = planModeEnvHint(ctx.env[ENV_PLAN_MODE]);
  /** `setActiveTools` narrowed the session (false when unavailable or it threw). */
  let narrowed = false;

  const teamTools = (): string[] => ctx.tools.registered().map(String);

  function setActive(names: string[]): boolean {
    if (typeof pi.setActiveTools !== "function") return false;
    try {
      pi.setActiveTools(names);
      return true;
    } catch (err) {
      log(`agent-teams: plan mode: setActiveTools failed: ${(err as Error).message}`);
      return false;
    }
  }

  function narrow(): void {
    let all: string[] | undefined;
    try {
      all = pi.getAllTools?.().map((t) => t.name);
    } catch {
      all = undefined;
    }
    narrowed = setActive(computePlanTools(all, planModeTools, teamTools()));
    if (!narrowed) log("agent-teams: plan mode: cannot narrow the active tools; the tool_call block still applies");
  }

  function restore(restoreTools: readonly string[]): void {
    setActive(unionTools(restoreTools, teamTools()));
    narrowed = false;
  }

  /** The tools pi reports active now; `undefined` when it cannot say (the registration record is used instead). */
  function activeNow(): string[] | undefined {
    try {
      return pi.getActiveTools?.();
    } catch {
      return undefined;
    }
  }

  const planSubmitActive = (): boolean => (activeNow() ?? teamTools()).includes(PLAN_SUBMIT_TOOL);

  /**
   * Hello fields of a plan-mode member. `planToolsActive` says narrowing worked AND `PlanSubmit` is active. When
   * `PlanSubmit` alone is missing, `toolsActive` is reported true so the server marks the member
   * `plan_tools_unavailable` (the specific reason) rather than the generic `team_tools_unavailable`.
   */
  function planHelloFields(): { planToolsActive: boolean; toolsActive?: boolean } {
    const submitOk = planSubmitActive();
    const planToolsActive = narrowed && submitOk;
    const now = activeNow();
    const othersActive = now !== undefined && memberTools((ctx.env[ENV_OPENSPEC_PROFILE] ?? "") !== "").filter((t) => t !== PLAN_SUBMIT_TOOL).every((t) => now.includes(t));
    return { planToolsActive, ...(!submitOk && othersActive ? { toolsActive: true } : {}) };
  }

  pi.on?.("session_start", () => {
    if (active) narrow();
  });

  /**
   * The backstop is attached only once plan mode is (or may be) on: eagerly from the env hint, otherwise on the first
   * `hello` reply that says active — a session that never plans carries no extra `tool_call` handler. (A plan member is
   * always a hinted teammate, whose core guard already keeps pi's tool-call hook installed.)
   */
  let backstopAttached = false;
  function attachBackstop(): void {
    if (backstopAttached) return;
    backstopAttached = true;
    try {
      pi.on?.("tool_call", (event: { toolName?: unknown } | undefined) => {
        if (!active) return undefined;
        const name = event?.toolName;
        if (typeof name === "string" && allowed.has(name)) return undefined;
        return { block: true, reason: planBlockReason(typeof name === "string" ? name : "this tool") };
      });
    } catch (err) {
      log(`agent-teams: plan mode: cannot attach the tool_call block: ${(err as Error).message}`);
    }
  }
  if (active) attachBackstop();

  ctx.hello.addPayload(() => (active ? planHelloFields() : {}));

  ctx.hello.onReply((reply) => {
    const state = reply.planMode;
    if (!state) return; // not a plan member on the server: the env hint (fail-safe) stands
    if (state.active) {
      active = true;
      attachBackstop();
      narrow(); // idempotent: re-applied after a reload and after a rejection
      return;
    }
    if (active || narrowed) restore(state.restoreTools);
    active = false;
  });

  // One hello per batch of mails: every plan_decision of a batch is already committed when it arrives.
  let helloQueued = false;
  ctx.onMail((mail) => {
    if (mail.kind !== MAIL_KIND_PLAN_DECISION || helloQueued) return;
    helloQueued = true;
    queueMicrotask(() => {
      helloQueued = false;
      void ctx.hello.send().catch((err: Error) => log(`agent-teams: plan mode hello failed: ${err.message}`));
    });
  });
}
