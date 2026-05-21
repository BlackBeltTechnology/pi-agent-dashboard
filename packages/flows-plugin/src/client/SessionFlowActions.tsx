import React, { useState } from "react";
import { Icon } from "@mdi/react";
import { mdiPlay, mdiPlus } from "@mdi/js";
import type {
  CommandInfo,
  DashboardSession,
  FlowInfo,
  FlowState,
} from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { FlowLaunchDialog } from "./FlowLaunchDialog.js";
import { FlowActivityBadge } from "./FlowActivityBadge.js";
import { useFlowsSessionState } from "./FlowsSessionStateContext.js";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { UiSelectOption as SelectOption } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import {
  useUiPrimitive,
  usePluginSend,
  useSessionData,
} from "@blackbelt-technology/dashboard-plugin-runtime";

export function SessionFlowActions({
  flows,
  hasFlowsNew,
  hasFlowsEdit,
  hasFlowsDelete,
  onFlowAction,
  flowState,
  onAbortFlow,
}: {
  flows: FlowInfo[];
  hasFlowsNew: boolean;
  hasFlowsEdit?: boolean;
  hasFlowsDelete?: boolean;
  onFlowAction: (action: string, opts?: { flowName?: string; task?: string; description?: string }) => void;
  /** Current flow state for this session. Drives the status pill rendered above the action buttons. */
  flowState?: FlowState | null;
  /** Dispatch flow_control abort. Called by the running-flow pill's Abort button. */
  onAbortFlow?: () => void;
}) {
  const ConfirmDialog = useUiPrimitive(UI_PRIMITIVE_KEYS.confirmDialog);
  const SearchableSelectDialog = useUiPrimitive(UI_PRIMITIVE_KEYS.searchableSelectDialog);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editPickerOpen, setEditPickerOpen] = useState(false);
  const [editFlowName, setEditFlowName] = useState<string | null>(null);
  const [deletePickerOpen, setDeletePickerOpen] = useState(false);
  const [deleteFlowName, setDeleteFlowName] = useState<string | null>(null);
  const [selectedFlow, setSelectedFlow] = useState<FlowInfo | null>(null);
  const [newFlowOpen, setNewFlowOpen] = useState(false);

  // Compute running-flow badge inputs from flowState (when present).
  // See change: fix-flows-plugin-polish (A5 + A6).
  const badgeProps = flowState
    ? (() => {
        const agents = flowState.agents;
        const total = agents.size;
        const done = Array.from(agents.values()).filter(
          (a) => a.status === "complete" || a.status === "error" || a.status === "blocked",
        ).length;
        return {
          flowName: flowState.flowName,
          agentsDone: done,
          agentsTotal: total,
          status: flowState.status,
        };
      })()
    : null;

  if (flows.length === 0 && !hasFlowsNew && !badgeProps) return null;

  const flowOptions: SelectOption[] = flows.map((f) => ({
    value: f.name,
    label: f.name,
    description: f.description,
  }));

  return (
    <>
      <div className="flex flex-col gap-1.5">
        {badgeProps && (
          <FlowActivityBadge
            {...badgeProps}
            onAbort={badgeProps.status === "running" ? onAbortFlow : undefined}
          />
        )}
        <div className="flex items-center gap-1.5 flex-wrap">
          {flows.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setPickerOpen(true); }}
              className="text-[10px] px-1.5 py-0.5 rounded border border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
            >
              <Icon path={mdiPlay} size={0.4} className="inline mr-0.5" />Run Flow...
            </button>
          )}
          {hasFlowsNew && (
            <button
              onClick={(e) => { e.stopPropagation(); setNewFlowOpen(true); }}
              className="text-[10px] px-1.5 py-0.5 rounded border border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
            >
              <Icon path={mdiPlus} size={0.4} className="inline mr-0.5" />New Flow
            </button>
          )}
          {hasFlowsEdit && flows.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setEditPickerOpen(true); }}
              className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              &#x270E;&#xFE0E; Edit
            </button>
          )}
          {hasFlowsDelete && flows.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setDeletePickerOpen(true); }}
              className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              &#215; Delete
            </button>
          )}
        </div>
      </div>

      {/* Run: pick flow → task dialog */}
      {pickerOpen && (
        <SearchableSelectDialog
          title="Run Flow"
          options={flowOptions}
          placeholder="Search flows..."
          emptyMessage="No flows available"
          onSelect={(value) => {
            const flow = flows.find(f => f.name === value);
            if (flow) setSelectedFlow(flow);
            setPickerOpen(false);
          }}
          onCancel={() => setPickerOpen(false)}
        />
      )}

      {selectedFlow && (
        <FlowLaunchDialog
          flowName={selectedFlow.name}
          description={selectedFlow.description}
          onSubmit={(task) => {
            onFlowAction("run", { flowName: selectedFlow.name, task: task || undefined });
            setSelectedFlow(null);
          }}
          onCancel={() => setSelectedFlow(null)}
        />
      )}

      {/* Edit: pick flow → modification input dialog */}
      {editPickerOpen && (
        <SearchableSelectDialog
          title="Edit Flow"
          options={flowOptions}
          placeholder="Search flows..."
          emptyMessage="No flows available"
          onSelect={(value) => {
            setEditFlowName(value);
            setEditPickerOpen(false);
          }}
          onCancel={() => setEditPickerOpen(false)}
        />
      )}

      {editFlowName && (
        <FlowLaunchDialog
          flowName={editFlowName}
          description="Describe how this flow should be updated"
          onSubmit={(desc) => {
            if (desc.trim()) {
              onFlowAction("edit", { flowName: editFlowName, description: desc.trim() });
            }
            setEditFlowName(null);
          }}
          onCancel={() => setEditFlowName(null)}
        />
      )}

      {/* Delete: pick flow → confirm dialog */}
      {deletePickerOpen && (
        <SearchableSelectDialog
          title="Delete Flow"
          options={flowOptions}
          placeholder="Search flows..."
          emptyMessage="No flows available"
          onSelect={(value) => {
            setDeleteFlowName(value);
            setDeletePickerOpen(false);
          }}
          onCancel={() => setDeletePickerOpen(false)}
        />
      )}

      {deleteFlowName && (
        <ConfirmDialog
          message={`Delete flow "${deleteFlowName}"? This will remove the flow file and any associated agents.`}
          confirmLabel="Delete"
          onConfirm={() => {
            onFlowAction("delete", { flowName: deleteFlowName });
            setDeleteFlowName(null);
          }}
          onCancel={() => setDeleteFlowName(null)}
        />
      )}

      {/* New: description dialog */}
      {newFlowOpen && (
        <FlowLaunchDialog
          flowName="flows:new"
          description="Design a new flow with the Flow Architect"
          onSubmit={(task) => {
            if (task.trim()) {
              onFlowAction("new", { description: task.trim() });
            }
            setNewFlowOpen(false);
          }}
          onCancel={() => setNewFlowOpen(false)}
        />
      )}
    </>
  );
}

/**
 * Slot-consumer wrapper for the `session-card-action-bar` claim.
 * Reads per-session `flows_list` and `commands_list` from the plugin-
 * runtime per-session-data store (mirrored by the shell on every
 * `flows_list` / `commands_list` browser-protocol message). Dispatches
 * via pluginContext.send. See change: pluginize-flows-via-registry.
 *
 * Returns null when the session has no flows AND no `flows:new`
 * command — this matches the shell's previous gate at
 * SessionCard.tsx:651 (`flows && onFlowAction && ...`).
 */
export function SessionFlowActionsClaim({ session }: { session: DashboardSession }) {
  const flows = useSessionData<FlowInfo[]>(session.id, "flowsList") ?? [];
  const commands = useSessionData<CommandInfo[]>(session.id, "commandsList") ?? [];
  const { flowState } = useFlowsSessionState(session.id);
  const send = usePluginSend();

  const hasFlowsNew = commands.some((c) => c.name === "flows:new");
  const hasFlowsEdit = commands.some((c) => c.name === "flows:edit");
  const hasFlowsDelete = commands.some((c) => c.name === "flows:delete");

  // Render when there's a flow active OR action buttons are available.
  // See change: fix-flows-plugin-polish (A5).
  if (flows.length === 0 && !hasFlowsNew && !flowState) return null;

  return (
    <SessionFlowActions
      flows={flows}
      hasFlowsNew={hasFlowsNew}
      hasFlowsEdit={hasFlowsEdit}
      hasFlowsDelete={hasFlowsDelete}
      flowState={flowState}
      onAbortFlow={() => send({ type: "flow_control", sessionId: session.id, action: "abort" })}
      onFlowAction={(action, opts) =>
        send({
          type: "flow_management",
          sessionId: session.id,
          action,
          flowName: opts?.flowName,
          task: opts?.task,
          description: opts?.description,
        })
      }
    />
  );
}
