import {
  usePluginSend,
  useSessionData,
  useT,
  useUiPrimitive,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { usePluginConfig } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import type { UiSelectOption as SelectOption } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type {
  CommandInfo,
  DashboardSession,
  FlowInfo,
  FlowState,
} from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiPencil, mdiPlay } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useEffect, useRef, useState } from "react";
import { FlowActivityBadge } from "./FlowActivityBadge.js";
import { FlowAuthorPromptDialog } from "./FlowAuthorPromptDialog.js";
import { FlowLaunchDialog } from "./FlowLaunchDialog.js";
import { useFlowsSessionState } from "./FlowsSessionStateContext.js";
import type { FlowsPluginConfig } from "./FlowsSettings.js";

export function SessionFlowActions({
  flows,
  editMode,
  hasFlowsDelete,
  onFlowAction,
  onEditFlow,
  flowState,
  onAbortFlow,
}: {
  flows: FlowInfo[];
  /** Edit-mode on → show the New / Edit launcher (authoring via the skill). */
  editMode: boolean;
  hasFlowsDelete?: boolean;
  onFlowAction: (action: string, opts?: { flowName?: string; task?: string; description?: string }) => void;
  /**
   * Launch the manage-flows skill for an existing flow (name) or a new flow
   * (undefined), carrying the user's stated intent (description for new, change
   * instruction for edit; empty string when none given).
   */
  onEditFlow: (flowName: string | undefined, instruction: string) => void;
  /** Current flow state for this session. Drives the status pill rendered above the action buttons. */
  flowState?: FlowState | null;
  /** Dispatch flow_control abort. Called by the running-flow pill's Abort button. */
  onAbortFlow?: () => void;
}) {
  const t = useT();
  const ConfirmDialog = useUiPrimitive(UI_PRIMITIVE_KEYS.confirmDialog);
  const SearchableSelectDialog = useUiPrimitive(UI_PRIMITIVE_KEYS.searchableSelectDialog);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editPickerOpen, setEditPickerOpen] = useState(false);
  // After picking from the edit launcher, capture intent before launching the skill.
  const [authorTarget, setAuthorTarget] = useState<{ mode: "new" | "edit"; flowName?: string } | null>(null);
  const [deletePickerOpen, setDeletePickerOpen] = useState(false);
  const [deleteFlowName, setDeleteFlowName] = useState<string | null>(null);
  const [selectedFlow, setSelectedFlow] = useState<FlowInfo | null>(null);

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

  if (flows.length === 0 && !editMode && !badgeProps) return null;

  const flowOptions: SelectOption[] = flows.map((f) => ({
    value: f.name,
    label: f.name,
    description: f.description,
  }));
  // Edit launcher options: existing flows + a "new flow" sentinel.
  const editOptions: SelectOption[] = [
    { value: "__new__", label: t("newFlowOption", undefined, "+ New flow"), description: t("newFlowOptionDesc", undefined, "Author a new flow with the edit-flow skill") },
    ...flowOptions,
  ];

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
              <Icon path={mdiPlay} size={0.4} className="inline mr-0.5" />{t("runFlowButton", undefined, "Run Flow...")}
            </button>
          )}
          {editMode && (
            <button
              onClick={(e) => { e.stopPropagation(); setEditPickerOpen(true); }}
              className="text-[10px] px-1.5 py-0.5 rounded border border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
              data-testid="flows-new-edit-button"
            >
              <Icon path={mdiPencil} size={0.4} className="inline mr-0.5" />{t("newEditButton", undefined, "New / Edit…")}
            </button>
          )}
          {hasFlowsDelete && flows.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setDeletePickerOpen(true); }}
              className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-subtle)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
            >
              &#215; {t("delete", undefined, "Delete")}
            </button>
          )}
        </div>
      </div>

      {/* Run: pick flow → task dialog */}
      {pickerOpen && (
        <SearchableSelectDialog
          title={t("runFlowDialogTitle", undefined, "Run Flow")}
          options={flowOptions}
          placeholder={t("searchFlows", undefined, "Search flows...")}
          emptyMessage={t("noFlowsAvailable", undefined, "No flows available")}
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

      {/* New / Edit: pick an existing flow or "new" → launch the edit-flow skill */}
      {editPickerOpen && (
        <SearchableSelectDialog
          title={t("newEditFlowTitle", undefined, "New / Edit flow")}
          options={editOptions}
          placeholder={t("pickFlowToEdit", undefined, "Pick a flow to edit, or + New flow…")}
          emptyMessage={t("noFlowsYet", undefined, "No flows yet — pick + New flow")}
          onSelect={(value) => {
            setAuthorTarget(
              value === "__new__" ? { mode: "new" } : { mode: "edit", flowName: value },
            );
            setEditPickerOpen(false);
          }}
          onCancel={() => setEditPickerOpen(false)}
        />
      )}

      {/* New / Edit: capture intent → launch the manage-flows skill */}
      {authorTarget && (
        <FlowAuthorPromptDialog
          mode={authorTarget.mode}
          flowName={authorTarget.flowName}
          onSubmit={(instruction) => {
            onEditFlow(authorTarget.flowName, instruction);
            setAuthorTarget(null);
          }}
          onCancel={() => setAuthorTarget(null)}
        />
      )}

      {/* Delete: pick flow → confirm dialog */}
      {deletePickerOpen && (
        <SearchableSelectDialog
          title={t("deleteFlowTitle", undefined, "Delete Flow")}
          options={flowOptions}
          placeholder={t("searchFlows", undefined, "Search flows...")}
          emptyMessage={t("noFlowsAvailable", undefined, "No flows available")}
          onSelect={(value) => {
            setDeleteFlowName(value);
            setDeletePickerOpen(false);
          }}
          onCancel={() => setDeletePickerOpen(false)}
        />
      )}

      {deleteFlowName && (
        <ConfirmDialog
          message={t("deleteFlowConfirm", { name: deleteFlowName }, `Delete flow "${deleteFlowName}"? This will remove the flow file and any associated agents.`)}
          confirmLabel={t("delete", undefined, "Delete")}
          onConfirm={() => {
            onFlowAction("delete", { flowName: deleteFlowName });
            setDeleteFlowName(null);
          }}
          onCancel={() => setDeleteFlowName(null)}
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
  const config = usePluginConfig<FlowsPluginConfig>();
  const editMode = config.editFlow ?? false;

  const hasFlowsDelete = commands.some((c) => c.name === "flows:delete");

  // Reconcile the GLOBAL edit-mode default down to this session once its flows
  // plugin is available (flowsList observed). pi-flows persists it to the
  // project .pi/settings.json. Idempotent — re-emits only when the default
  // changes. See change: rework-flows-plugin-for-new-pi-flows (D4).
  const reconciledRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (flows.length === 0) return; // wait until flows-plugin is available
    if (reconciledRef.current === editMode) return;
    reconciledRef.current = editMode;
    send({ type: "flow_management", sessionId: session.id, action: "set-edit-mode", enabled: editMode });
  }, [flows.length, editMode, session.id, send]);

  // Render when there's a flow active OR action buttons are available.
  if (flows.length === 0 && !editMode && !flowState) return null;

  return (
    <SessionFlowActions
      flows={flows}
      editMode={editMode}
      hasFlowsDelete={hasFlowsDelete}
      flowState={flowState}
      onAbortFlow={() => send({ type: "flow_control", sessionId: session.id, action: "abort" })}
      onEditFlow={(flowName, instruction) => {
        const intent = instruction.trim();
        // New flow: instruction describes what to build. Edit: flow name is
        // token-1 (the skill reads that file), instruction follows on a new line.
        const text = flowName
          ? intent
            ? `/skill:manage-flows ${flowName}\n\n${intent}`
            : `/skill:manage-flows ${flowName}`
          : `/skill:manage-flows ${intent}`;
        send({ type: "send_prompt", sessionId: session.id, text });
      }}
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
