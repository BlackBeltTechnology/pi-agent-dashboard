/**
 * Always-visible chip on the session card showing the current jj
 * workspace name. Predicate-gated by `isInJjWorkspace` so it renders
 * nothing when the session is outside a jj repo.
 *
 * See change: add-jj-workspace-plugin.
 */
import React from "react";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export function JjWorkspaceBadge({
  session,
}: {
  session: DashboardSession;
}): React.ReactElement | null {
  const name = session.jjState?.workspaceName;
  if (!name) return null;

  const colocated = session.jjState?.isColocated;
  const tooltip = colocated
    ? `jj workspace: ${name} (colocated with git)`
    : `jj workspace: ${name}`;

  return (
    <span
      data-testid="jj-workspace-badge"
      title={tooltip}
      className="inline-flex items-center px-1.5 py-[1px] rounded font-mono text-[10px]"
      style={{
        background: "rgba(99, 102, 241, 0.15)",
        color: "rgb(165, 180, 252)",
      }}
    >
      jj:{name}
    </span>
  );
}
