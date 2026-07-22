/**
 * Provenance accessor for the embed-session-lifecycle layer.
 *
 * The `lifecyclePolicy` marker is optional on the wire and on disk; an ABSENT
 * value means `"durable"` (D1: legacy bridges + pre-change `.meta.json` load
 * unchanged and are never reaped). Every downstream gate — the idle reaper, the
 * quiescence predicate, the active-session caps — MUST read the policy through
 * these accessors rather than comparing `session.lifecyclePolicy` raw, so the
 * absent-⇒-durable default is enforced in exactly one place.
 *
 * See OpenSpec change: add-embed-session-lifecycle.
 */
import type { LifecyclePolicy } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/** Minimal shape the accessors read — any object carrying the marker. */
export interface HasLifecyclePolicy {
  lifecyclePolicy?: LifecyclePolicy;
}

/** Resolve the effective policy, defaulting an absent marker to `"durable"`. */
export function effectiveLifecyclePolicy(session: HasLifecyclePolicy): LifecyclePolicy {
  return session.lifecyclePolicy === "ephemeral" ? "ephemeral" : "durable";
}

/**
 * True only for sessions the lifecycle layer may govern (reap / cap). A session
 * with no marker is durable and therefore never ephemeral.
 */
export function isEphemeral(session: HasLifecyclePolicy): boolean {
  return effectiveLifecyclePolicy(session) === "ephemeral";
}
