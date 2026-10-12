/**
 * AcpEndedCallout — shown above the composer when the selected session is an
 * ENDED ACP session. ACP sessions cannot be resumed, so the callout says what
 * happened and offers the one fix: start a new session with the same agent.
 *
 * Info severity (icon + text, not colour alone). See change: add-acp-session-driver
 * (D15, mockup S3).
 */

import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiInformationOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useAcpAgents } from "../../hooks/useAcpAgents.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { isAcpSession } from "../../lib/session/session-origin-view.js";

interface Props {
  session: DashboardSession;
  /** Start a new session in the session's folder with the same agent. */
  onNewSession: () => void;
}

export function AcpEndedCallout({ session, onNewSession }: Props) {
  const agents = useAcpAgents();
  if (!isAcpSession(session) || session.status !== "ended") return null;
  const agent = agents.find((a) => a.id === session.acpAgentId)?.name ?? session.acpAgentId ?? "agent";
  return (
    <div
      role="status"
      data-testid="acp-ended-callout"
      className="mx-3 my-2 flex items-start gap-2 rounded-lg border border-[var(--severity-info-border)] bg-[var(--severity-info-bg)] p-3 text-[13px] text-[var(--severity-info-fg)]"
    >
      <Icon path={mdiInformationOutline} size={0.8} className="mt-0.5 shrink-0" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-semibold">{i18nT("acp.endedTitle", { agent }, "This {agent} session has ended")}</p>
        <p>{i18nT("acp.endedBody", { agent }, "ACP sessions can't be resumed. Start a new {agent} session in this folder to continue.")}</p>
        <button
          type="button"
          onClick={onNewSession}
          data-testid="acp-ended-new-session"
          className="focus-ring mt-1 self-start rounded-md border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-3 min-h-[44px] sm:min-h-0 sm:py-1 text-[13px] font-semibold text-[var(--text-primary)]"
        >
          {i18nT("acp.newAgentSession", { agent }, "New {agent} session")}
        </button>
      </div>
    </div>
  );
}
