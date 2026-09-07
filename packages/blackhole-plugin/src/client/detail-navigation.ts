/**
 * Explicit-navigation state for the `content-view` detail drill-in (spec:
 * "The detail view does not displace the chat view unbidden").
 *
 * The claim's predicate returns `false` until the user explicitly opens the
 * detail view from the session's own subcard affordance; closing resets it.
 * Module-scoped like flows' preview predicate — one dashboard client, one
 * active detail at a time. See change: add-blackhole-session-pipeline.
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { bumpSlotClaimsVersion } from "@blackbelt-technology/dashboard-plugin-runtime";

let activeForSessionId: string | null = null;

/** Open the detail view for a session (explicit navigation only). */
export function openPipelineDetail(sessionId: string): void {
  activeForSessionId = sessionId;
  // Re-evaluate the one-active content-view gate (F8).
  bumpSlotClaimsVersion();
}

/** Close the detail view and restore the chat view (the return path). */
export function closePipelineDetail(): void {
  activeForSessionId = null;
  bumpSlotClaimsVersion();
}

/** Manifest-level predicate string: `isPipelineDetailActive`. */
export function isPipelineDetailActive(
  session?: DashboardSession | null,
): boolean {
  if (!activeForSessionId) return false;
  return !!session && session.id === activeForSessionId;
}

/** Test-only reset. */
export function __resetDetailNavigationForTests(): void {
  activeForSessionId = null;
}
