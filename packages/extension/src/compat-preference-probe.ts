/**
 * Answers the Claude subscription compat probe on `pi.events`.
 *
 * Plugin bridges (the flows-plugin rewrite) emit `CLAUDE_COMPAT_PROBE_CHANNEL`
 * with a mutable object; this listener fills `claudeSubscriptionCompat` from
 * the value the server relayed via `preferences_update`. `isActive` lets a
 * stale `/reload` generation opt out so only the live instance answers.
 *
 * See change: retire-anthropic-messages-bridge (design D4).
 */
import {
  CLAUDE_COMPAT_PROBE_CHANNEL,
  type ClaudeCompatProbe,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/claude-compat.js";

interface EventsLike {
  on(channel: string, handler: (data: unknown) => void): unknown;
}

export function registerCompatPreferenceProbe(
  pi: { events?: EventsLike },
  getValue: () => boolean,
  isActive: () => boolean,
): void {
  if (!pi.events || typeof pi.events.on !== "function") return;
  pi.events.on(CLAUDE_COMPAT_PROBE_CHANNEL, (data: unknown) => {
    if (!isActive()) return;
    if (!data || typeof data !== "object") return;
    (data as ClaudeCompatProbe).claudeSubscriptionCompat = getValue();
  });
}
