/**
 * Team guard — companion pi extension loaded into every team session.
 *  - `tool_call`: deny-first name gate + path confinement (see guard.ts).
 *  - `session_start`: announces `team_guard_ready` to the plugin server so a
 *    session without a working guard is aborted instead of running ungated.
 * See change: add-team-plugin (D7).
 */
import { decideToolCall, policyFromEnv, type TeamPolicy } from "./guard.js";

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

export default function teamGuard(pi: PiLike, options?: { policy?: TeamPolicy | null }): void {
  const policy = options?.policy !== undefined ? options.policy : policyFromEnv();
  const onToolCall = createToolCallHandler(policy);
  pi.on("tool_call", (event) => onToolCall((event ?? {}) as { toolName?: unknown; input?: unknown }));

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
