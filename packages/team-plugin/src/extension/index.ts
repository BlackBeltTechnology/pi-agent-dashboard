/**
 * Team guard — companion pi extension loaded into every team session.
 *  - `tool_call`: deny-first name gate + path confinement (see guard.ts).
 *  - `before_agent_start`: filters `systemPromptOptions.skills` in place to the effective set (D10).
 *  - `input`: refuses ungranted `/skill:` commands and out-of-root skill envelopes (D10) — returns
 *    `{action:"handled"}` and never calls `ctx.ui.notify` (the bridge owns the user-facing refusal, D12).
 *  - `session_start`: announces `team_guard_ready` to the plugin server so a
 *    session without a working guard is aborted instead of running ungated.
 * See change: add-team-plugin, add-team-skill-access (D9/D10).
 */
import { decideToolCall, grantedSkillFilter, isRefusedInput, policyFromEnv, type TeamPolicy } from "./guard.js";

export const TEAM_PLUGIN_ID = "team";
export const GUARD_READY_MESSAGE = "team_guard_ready";

interface PiLike {
  on(event: string, handler: (event: unknown, ctx: unknown) => unknown): void;
  events?: { emit: (name: string, payload: unknown) => void };
}

export function createToolCallHandler(policy: TeamPolicy | null) {
  return (event: { toolName?: unknown; input?: unknown }): { block: true; reason: string } | undefined => {
    const d = decideToolCall(event?.toolName, event?.input, policy);
    return d.allow ? undefined : { block: true, reason: `team: ${d.reason}` };
  };
}

/** D10: splice `systemPromptOptions.skills` in place; never return a `systemPrompt` string. */
export function createBeforeAgentStartHandler(policy: TeamPolicy | null) {
  return (event: { systemPromptOptions?: { skills?: unknown } }): undefined => {
    const skills = event?.systemPromptOptions?.skills;
    if (!Array.isArray(skills)) return;
    // The filter's grant slots are single-use: build it per agent start so a second
    // `before_agent_start` on the same session keeps the granted skill (audit F3).
    skills.splice(0, skills.length, ...skills.filter(grantedSkillFilter(policy)));
    return;
  };
}

/** D10: `{action:"handled"}` drops the text before any skill expansion; `{action:"continue"}` otherwise. */
export function createInputHandler(policy: TeamPolicy | null) {
  // `_ctx` is pi's handler context — intentionally unused: `ctx.ui.notify` is the bridge's job (D12).
  return (event: { text?: unknown }, _ctx?: unknown): { action: "handled" } | { action: "continue" } =>
    isRefusedInput(event?.text, policy) ? { action: "handled" } : { action: "continue" };
}

export default function teamGuard(pi: PiLike, options?: { policy?: TeamPolicy | null }): void {
  const policy = options?.policy !== undefined ? options.policy : policyFromEnv();
  const onToolCall = createToolCallHandler(policy);
  const onBeforeAgentStart = createBeforeAgentStartHandler(policy);
  const onInput = createInputHandler(policy);
  pi.on("tool_call", (event) => onToolCall((event ?? {}) as { toolName?: unknown; input?: unknown }));
  pi.on("before_agent_start", (event) => onBeforeAgentStart((event ?? {}) as { systemPromptOptions?: { skills?: unknown } }));
  pi.on("input", (event) => onInput((event ?? {}) as { text?: unknown }));

  const announce = () =>
    pi.events?.emit("dashboard:plugin-message", {
      pluginId: TEAM_PLUGIN_ID,
      messageType: GUARD_READY_MESSAGE,
      // The spawn's runId: readiness is per RUN, so a resumed session can never be credited with an old signal.
      payload: { runId: process.env.PI_EXT_TEAM_RUN_ID },
    });
  pi.on("session_start", () => {
    // Only a session with a usable policy claims readiness.
    if (!policy) return;
    announce();
    // The bridge socket may not be up yet at session_start: repeat briefly (idempotent server-side).
    for (const ms of [1_000, 3_000, 8_000]) setTimeout(announce, ms).unref?.();
  });
}
