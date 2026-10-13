/**
 * DriverChip — "ACP · <agent>" chip on a session card / header (icon + text, never
 * colour alone; WCAG 1.4.1). Renders nothing for a pi session.
 *
 * See change: add-acp-session-driver (mockup S2).
 */

import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiRobotOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useAcpAgents } from "../../hooks/useAcpAgents.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { isAcpSession } from "../../lib/session/session-origin-view.js";

export function DriverChip({ session }: { session: Pick<DashboardSession, "driver" | "acpAgentId"> }) {
  const agents = useAcpAgents();
  if (!isAcpSession(session)) return null;
  const name = agents.find((a) => a.id === session.acpAgentId)?.name ?? session.acpAgentId ?? "agent";
  return (
    <span
      data-testid="session-driver-chip"
      className="inline-flex items-center gap-1 rounded-md border border-[var(--severity-info-border)] bg-[var(--severity-info-bg)] px-1.5 text-[11px] font-semibold text-[var(--severity-info-fg)]"
    >
      <Icon path={mdiRobotOutline} size={0.5} className="shrink-0" />
      {i18nT("acp.driverChip", { agent: name }, "ACP · {agent}")}
    </span>
  );
}
