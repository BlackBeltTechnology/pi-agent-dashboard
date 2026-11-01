/**
 * `composer-context-group` claim: the FLOWS chip in the composer dock's
 * Context lane. Renders only when the session's flow catalog lists at least
 * one flow (unknown / empty → nothing, no label, no container).
 *
 * Shows the open or last flow's name and a text status pill (running d/t,
 * failed · N steps, done, aborted, not started), then Run flow… / Open flow…
 * / Edit… icon buttons. Run and Open are disabled with "A flow is running"
 * while any flow in the session runs; the chip is never disabled for an agent
 * turn. As the viewed session's surface it re-asks for an unknown catalog.
 *
 * See change: flows-dock-chip-and-panel-actions (D5–D7, D9).
 */
import { ComposerContextGroup, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { DashboardSession, FlowState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiEyeOutline, mdiPlay } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useState } from "react";
import { FLOW_ICON_BUTTON_CLASS, FlowEditMenu } from "./FlowEditMenu.js";
import { useFlowsSessionState } from "./FlowsSessionStateContext.js";
import { useFlowAttachment } from "./flow-attach-store.js";
import { type FlowAttachment, isAttachmentConsumed } from "./flow-idle-state.js";
import { FlowActionDialogs, useFlowActions } from "./useFlowActions.js";

export type ChipStatus =
  | { kind: "running"; done: number; total: number }
  | { kind: "failed"; steps: number }
  | { kind: "done" }
  | { kind: "aborted" }
  | { kind: "not-started" };

export interface ChipFlow {
  name: string;
  status: ChipStatus;
}

function stepCounts(s: FlowState): { done: number; total: number } {
  const agents = Array.from(s.agents.values());
  const done = agents.filter((a) => a.status === "complete" || a.status === "error" || a.status === "blocked").length;
  return { done, total: agents.length };
}

/**
 * The flow the chip names: a running flow wins (slot priority), then an
 * attached not-yet-started flow, then the last completed flow; none → null.
 */
export function deriveChipFlow(input: {
  flowState: FlowState | null;
  flowStates: ReadonlyMap<string, FlowState>;
  attachment: FlowAttachment | null;
  lastFlowStartedAt?: unknown;
}): ChipFlow | null {
  const { flowState, flowStates, attachment, lastFlowStartedAt } = input;
  let running: FlowState | null = flowState?.status === "running" ? flowState : null;
  if (!running) for (const s of flowStates.values()) if (s.status === "running") running = s;
  if (running) return { name: running.flowName, status: { kind: "running", ...stepCounts(running) } };
  if (attachment && !isAttachmentConsumed(attachment.baselineStartedAt, lastFlowStartedAt)) {
    return { name: attachment.name, status: { kind: "not-started" } };
  }
  if (!flowState) return null;
  if (flowState.status === "error") return { name: flowState.flowName, status: { kind: "failed", steps: stepCounts(flowState).total } };
  if (flowState.status === "aborted") return { name: flowState.flowName, status: { kind: "aborted" } };
  return { name: flowState.flowName, status: { kind: "done" } };
}

function useStatusText(): (s: ChipStatus) => string {
  const t = useT();
  return (s) => {
    switch (s.kind) {
      case "running":
        return t("chipRunning", { done: s.done, total: s.total }, `running ${s.done}/${s.total}`);
      case "failed":
        return t("chipFailed", { steps: s.steps }, `failed · ${s.steps} steps`);
      case "done":
        return t("chipDone", undefined, "done");
      case "aborted":
        return t("chipAborted", undefined, "aborted");
      default:
        return t("flowNotStarted", undefined, "not started");
    }
  };
}

const PILL_TONE: Record<ChipStatus["kind"], string> = {
  running: "text-[var(--status-info,#60a5fa)] border-[var(--status-info,#60a5fa)]/40",
  failed: "text-[var(--status-error)] border-[var(--status-error)]/40",
  done: "text-[var(--status-success,#34d399)] border-[var(--status-success,#34d399)]/40",
  aborted: "text-[var(--status-warning,#fbbf24)] border-[var(--status-warning,#fbbf24)]/40",
  "not-started": "text-[var(--text-secondary)] border-[var(--border-subtle)]",
};

export function FlowsContextGroup({ session }: { session: DashboardSession }) {
  const t = useT();
  const statusText = useStatusText();
  const [editOpen, setEditOpen] = useState(false);
  const actions = useFlowActions(session.id, { editModeWhen: "has-flows", menuOpen: editOpen, autoAskCatalog: true });
  const { flowState, flowStates, lastFlowStartedAt } = useFlowsSessionState(session.id);
  const attachment = useFlowAttachment(session.id);

  if (!actions.catalogKnown || !actions.hasFlows) return null;

  const chipFlow = deriveChipFlow({ flowState, flowStates, attachment, lastFlowStartedAt });
  const runningReason = t("openFlowDisabledRunning", undefined, "A flow is running");
  const runLabel = t("runFlowButton", undefined, "Run flow…");
  const openLabel = t("openFlowButton", undefined, "Open flow…");

  return (
    <>
      <ComposerContextGroup label={t("flowsChipLabel", undefined, "FLOWS")} testId="flows-context-group">
        {chipFlow && (
          <span className="inline-flex items-center gap-1.5 min-w-0 text-xs" data-testid="flows-chip-flow">
            <span className="truncate max-w-[12rem] text-[var(--text-primary)]" data-testid="flows-chip-name" title={chipFlow.name}>
              {chipFlow.name}
            </span>
            <span
              data-testid="flows-chip-status"
              data-status={chipFlow.status.kind}
              className={`whitespace-nowrap rounded border px-1 text-[11px] leading-4 ${PILL_TONE[chipFlow.status.kind]}`}
            >
              {statusText(chipFlow.status)}
            </span>
          </span>
        )}
        <button
          type="button"
          data-testid="flows-chip-run"
          aria-label={runLabel}
          title={actions.anyRunning ? runningReason : runLabel}
          disabled={actions.anyRunning}
          onClick={actions.run}
          className={FLOW_ICON_BUTTON_CLASS}
        >
          <Icon path={mdiPlay} size={0.6} aria-hidden="true" />
        </button>
        <button
          type="button"
          data-testid="flows-chip-open"
          aria-label={openLabel}
          title={actions.anyRunning ? runningReason : openLabel}
          disabled={actions.anyRunning}
          onClick={actions.open}
          className={FLOW_ICON_BUTTON_CLASS}
        >
          <Icon path={mdiEyeOutline} size={0.6} aria-hidden="true" />
        </button>
        <FlowEditMenu actions={actions} open={editOpen} onOpenChange={setEditOpen} testIdPrefix="flows-chip-edit" />
      </ComposerContextGroup>
      <FlowActionDialogs actions={actions} />
    </>
  );
}
