/**
 * Plan-mode constants and pure helpers shared by the server (spawn env, hello contributor) and the
 * bridge (narrowing, backstop). The env is only a HINT: the `hello` reply is authoritative.
 * See change: add-agent-teams-templates-hooks.
 */

/** `extensionConfig["agent-teams"]` keys; the host maps them to `PI_EXT_AGENT_TEAMS_PLAN_MODE[_TOOLS]`. */
export const EXT_KEY_PLAN_MODE = "planMode";
export const EXT_KEY_PLAN_MODE_TOOLS = "planModeTools";
/** JSON array string of the effective `planModeTools` (`[]` is a valid, empty set). */
export const ENV_PLAN_MODE_TOOLS = "PI_EXT_AGENT_TEAMS_PLAN_MODE_TOOLS";

/** Built-in tools plan mode may keep; `bash`, `edit`, `write` and unknown names are never read-only. Mirrors `server/config.ts`. */
export const PLAN_READONLY_TOOLS: readonly string[] = ["read", "grep", "find", "ls"];
/** pi's default active tools: what an unrestricted member has before plan mode narrows it. */
export const PI_DEFAULT_TOOLS: readonly string[] = ["read", "bash", "edit", "write"];
/** The plan submission tool: always allowed in plan mode. */
export const PLAN_SUBMIT_TOOL = "PlanSubmit";
/** Value of `Member.hold` while a plan is outstanding (`planning`/`pending`). */
export const PLAN_HOLD = "plan_approval";

/** Keep only read-only built-ins (deduplicated, order kept); `dropped` names every other entry. */
export function sanitizePlanTools(raw: readonly unknown[]): { tools: string[]; dropped: string[] } {
  const tools: string[] = [];
  const dropped: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string" && PLAN_READONLY_TOOLS.includes(entry)) {
      if (!tools.includes(entry)) tools.push(entry);
    } else dropped.push(typeof entry === "string" ? entry : JSON.stringify(entry));
  }
  return { tools, dropped };
}

/** Env projection of the effective plan tools (stable, parseable by `parsePlanToolsEnv`). */
export function serializePlanTools(tools: readonly string[]): string {
  return JSON.stringify(tools);
}

/** Parse `ENV_PLAN_MODE_TOOLS`; unset or malformed ⇒ the default read-only set. Never widens past `PLAN_READONLY_TOOLS`. */
export function parsePlanToolsEnv(raw: string | undefined): { tools: string[]; dropped: string[] } {
  if (typeof raw === "string" && raw !== "") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return sanitizePlanTools(parsed);
    } catch {
      // fall through to the default
    }
  }
  return { tools: [...PLAN_READONLY_TOOLS], dropped: [] };
}

/** Fail-safe reading of the env hint: only unset, empty, `0` and `false` mean "not in plan mode". */
export function planModeEnvHint(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const v = raw.trim().toLowerCase();
  return !(v === "" || v === "0" || v === "false");
}

/** `unique(a ∪ b …)` keeping first-seen order. */
export function unionTools(...lists: ReadonlyArray<readonly string[]>): string[] {
  return [...new Set(lists.flat())];
}
