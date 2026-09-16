/**
 * Host-pressure thresholds — ONE source of truth for both consumers.
 *
 * The server (`host-pressure-tracker.ts`) FIRES on these numbers; the card
 * (`SessionCard.tsx`) escalates degraded → unresponsive between transitions on
 * the same numbers. Two independent copies would drift and the card would
 * either escalate ahead of a verdict the server never sent, or sit on a
 * degraded pill the server had already escalated.
 * See change: fix-false-unresponsive-badge.
 */

/** Silence past this reads as degraded (≈2 missed 15 s bridge heartbeats). */
export const HOST_PRESSURE_DEGRADED_MS = 35_000;
/** Silence at/after this reads as unresponsive. */
export const HOST_PRESSURE_UNRESPONSIVE_MS = 60_000;

export type HostPressureState = "degraded" | "unresponsive";

/** The wire shape carried by `DashboardSession.hostPressure`. */
export interface HostPressure {
  state: HostPressureState;
  /** Server receipt time of the last frame — the anchor the pill counts from. */
  since: number;
}
