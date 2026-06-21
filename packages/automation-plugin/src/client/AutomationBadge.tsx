/**
 * Session-card badge marking an automation run. Predicate-gated by
 * `isAutomationRun` in the manifest, so it only renders for `kind="automation"`
 * sessions; the body double-checks defensively.
 *
 * See change: add-automation-plugin.
 */
import React from "react";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export function AutomationBadge({
  session,
}: {
  session: DashboardSession;
}): React.ReactElement | null {
  if (session.kind !== "automation") return null;
  const name = session.automationRun?.name;
  return (
    <span
      data-testid="automation-badge"
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-[var(--accent-soft,rgba(99,102,241,0.15))] text-[var(--accent,#6366f1)]"
      title={name ? `Automation run: ${name}` : "Automation run"}
    >
      ⏱ {name ?? "automation"}
    </span>
  );
}
