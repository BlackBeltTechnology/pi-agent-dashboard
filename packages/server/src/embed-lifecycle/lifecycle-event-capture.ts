/**
 * Pure capture of the lifecycle run-boundary timestamps from a forwarded event.
 *
 * The quiescence gate reads `lastSettledAt` / `lastRunStartedAt` (D3) rather
 * than an inferred `status`. `agent_settled` is bridge-normalized — native on
 * pi ≥ 0.80.4, synthesized after `agent_end` on the floor — so this capture is
 * version-agnostic by construction: it keys on the event NAME only, with no
 * `piVersion` branch (E23).
 *
 * See OpenSpec change: add-embed-session-lifecycle.
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export type LifecycleTimestampUpdate = Partial<
  Pick<DashboardSession, "lastRunStartedAt" | "lastSettledAt">
>;

/**
 * Map a forwarded event type to a lifecycle-timestamp update, or `null` when
 * the event is not a run boundary. `agent_start` marks a run in flight;
 * `agent_settled` marks it at rest.
 */
export function captureLifecycleTimestamp(
  eventType: string,
  now: number,
): LifecycleTimestampUpdate | null {
  if (eventType === "agent_start") return { lastRunStartedAt: now };
  if (eventType === "agent_settled") return { lastSettledAt: now };
  return null;
}
