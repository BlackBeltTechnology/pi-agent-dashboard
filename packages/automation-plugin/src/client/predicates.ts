/**
 * Slot-claim predicates for the automation-plugin.
 *
 * Pure functions — no React, easily unit-tested. See change:
 * add-automation-plugin.
 */
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

/** True iff the session is an automation run (stamped `kind="automation"`). */
export function isAutomationRun(session: DashboardSession | null | undefined): boolean {
  return session?.kind === "automation";
}
