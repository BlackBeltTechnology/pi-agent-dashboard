/**
 * Claude subscription compat — shared in-process probe contract.
 *
 * The dashboard extension answers a synchronous probe on `pi.events`: the
 * caller emits a mutable object and the extension fills
 * `claudeSubscriptionCompat` with the current switch value. The flows-plugin
 * bridge probes on every `before_agent_start`, so it always reads the live
 * value; an unanswered probe means "off".
 *
 * See change: retire-anthropic-messages-bridge (design D4).
 */

/** In-process `pi.events` channel answered by the dashboard extension. */
export const CLAUDE_COMPAT_PROBE_CHANNEL = "dashboard:preferences:get";

/** Mutable probe object; the extension sets the field when it answers. */
export interface ClaudeCompatProbe {
  claudeSubscriptionCompat?: boolean;
}
