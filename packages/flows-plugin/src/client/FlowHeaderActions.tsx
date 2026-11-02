/**
 * Flow panel header actions, rendered by `FlowDashboardClaim` into the live,
 * opened-not-started and completed headers (the panels take them as a
 * `headerActions` node so they stay host-context free):
 *
 *   - `summary` (completed): Run again (hidden when the catalog no longer lists
 *     the flow), Open flow… (hidden when the catalog is empty), Edit…;
 *   - `live` (running): Open flow… (disabled, "A flow is running"), Edit…;
 *   - `idle` (opened, not started): Open flow… (swap the opened flow), Edit….
 *
 * Run again / Open flow… are disabled with "A flow is running" while any flow
 * in the session runs; hidden wins over disabled. Visible while collapsed.
 *
 * See change: flows-dock-chip-and-panel-actions (D6, D9).
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import { mdiEyeOutline, mdiReplay } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useState } from "react";
import { FLOW_ICON_BUTTON_CLASS, FlowEditMenu } from "./FlowEditMenu.js";
import { FlowActionDialogs, useFlowActions } from "./useFlowActions.js";

export type FlowHeaderVariant = "summary" | "live" | "idle";

export function FlowHeaderActions({
  sessionId,
  flowName,
  variant,
}: {
  sessionId: string;
  flowName: string;
  variant: FlowHeaderVariant;
}) {
  const t = useT();
  const [editOpen, setEditOpen] = useState(false);
  const actions = useFlowActions(sessionId, { menuOpen: editOpen });
  const runningReason = t("openFlowDisabledRunning", undefined, "A flow is running");
  const openLabel = t("openFlowButton", undefined, "Open flow…");
  const runAgainLabel = t("runAgainButton", undefined, "Run again");

  const disabled = actions.anyRunning || variant === "live";
  const showRunAgain = variant === "summary" && actions.flows.some((f) => f.name === flowName);
  const showOpen = actions.hasFlows;

  return (
    <span className="inline-flex items-center gap-0.5" data-testid={`flow-header-actions-${variant}`} onClick={(e) => e.stopPropagation()}>
      {showRunAgain && (
        <button
          type="button"
          data-testid="flow-header-run-again"
          aria-label={runAgainLabel}
          title={disabled ? runningReason : runAgainLabel}
          disabled={disabled}
          onClick={() => actions.runFlow(flowName)}
          className={FLOW_ICON_BUTTON_CLASS}
        >
          <Icon path={mdiReplay} size={0.6} aria-hidden="true" />
        </button>
      )}
      {showOpen && (
        <button
          type="button"
          data-testid="flow-header-open"
          aria-label={openLabel}
          title={disabled ? runningReason : openLabel}
          disabled={disabled}
          onClick={actions.open}
          className={FLOW_ICON_BUTTON_CLASS}
        >
          <Icon path={mdiEyeOutline} size={0.6} aria-hidden="true" />
        </button>
      )}
      <FlowEditMenu actions={actions} open={editOpen} onOpenChange={setEditOpen} testIdPrefix="flow-header-edit" />
      <FlowActionDialogs actions={actions} />
    </span>
  );
}
