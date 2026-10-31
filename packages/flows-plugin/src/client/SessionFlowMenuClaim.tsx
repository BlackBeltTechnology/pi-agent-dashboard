import { usePluginSend, useSessionData, useSessionEvents, useT, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import { ActionList } from "@blackbelt-technology/pi-dashboard-client-utils/ActionList";
import { ActionListMenuContext } from "@blackbelt-technology/pi-dashboard-client-utils/ActionListMenuContext";
import type { UiSelectOption as SelectOption } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type {
  CommandInfo,
  DashboardSession,
  FlowInfo,
  FlowState,
} from "@blackbelt-technology/pi-dashboard-shared/types.js";
import React, { useContext, useMemo, useState } from "react";
import { FlowAuthorPromptDialog } from "./FlowAuthorPromptDialog.js";
import { FlowLaunchDialog } from "./FlowLaunchDialog.js";
import { useFlowsSessionState } from "./FlowsSessionStateContext.js";
import { newAttachmentId, setAttachment } from "./flow-attach-store.js";
import { hasFlowsCommand } from "./flowsActionsGate.js";
import { sessionHasFlowEvents } from "./flowsAvailability.js";
import { makeSafeSend } from "./send-safe.js";
import { useEditModeState } from "./useEditModeState.js";

function isAnyFlowRunning(
  flowState: FlowState | null | undefined,
  flowStates: ReadonlyMap<string, FlowState> | undefined,
): boolean {
  if (flowState?.status === "running") return true;
  return flowStates ? Array.from(flowStates.values()).some((s) => s.status === "running") : false;
}

/**
 * Explicit per-project write: the ONLY path that sends flow:set-edit-mode
 * (pi-flows then writes <cwd>/.pi/settings.json). The click requests the value
 * the label names. See change: stop-flows-edit-mode-project-writes (D5).
 */
function projectEditModeItem(t: ReturnType<typeof useT>, editMode: boolean, onClick: () => void) {
  return {
    label: editMode
      ? t("projectEditModeOff", undefined, "Turn off edit mode for this project")
      : t("projectEditModeOn", undefined, "Turn on edit mode for this project"),
    icon: editMode ? "mdiPencilOff" : "mdiPencilOutline",
    tooltip: t(
      "projectEditModeHint",
      undefined,
      "Writes flows.editFlow to this project's .pi/settings.json. The project value then overrides the global default.",
    ),
    onClick,
  };
}

/**
 * `session-card-action-bar` claim: the flow ACTIONS (Run Flow…, Open flow…,
 * New / Edit…, Delete, and the per-project edit-mode item) rendered as an
 * `ActionList` for the session actions menu, plus the dialogs they open. Flow
 * STATUS stays in the FLOWS subcard (`SessionFlowActionsClaim`).
 *
 * The claim stays mounted for the card's lifetime (dialogs portal to body and
 * survive the menu closing). Gated by availability — a `flows` / `flows:*`
 * command (not `flows:new` alone) or any flow event; never by `flowsList` length.
 *
 * Edit mode: New / Edit… and the per-project item follow the session's
 * EFFECTIVE edit mode (`useEditModeState`; hidden while unknown). The claim
 * never sends an edit-mode message on its own: only a click on "Turn on / off
 * edit mode for this project" sends `plugin_action flow.set-edit-mode`.
 *
 * See change: add-session-actions-flyout (D7, D12); stop-flows-edit-mode-project-writes (D1, D4, D5).
 */
export function SessionFlowMenuClaim({ session }: { session: DashboardSession }) {
  const t = useT();
  const ConfirmDialog = useUiPrimitive(UI_PRIMITIVE_KEYS.confirmDialog);
  const SearchableSelectDialog = useUiPrimitive(UI_PRIMITIVE_KEYS.searchableSelectDialog);
  const flows = useSessionData<FlowInfo[]>(session.id, "flowsList") ?? [];
  const commands = useSessionData<CommandInfo[]>(session.id, "commandsList") ?? [];
  const { flowState, flowStates, lastFlowStartedAt } = useFlowsSessionState(session.id);
  const events = useSessionEvents(session.id);
  const send = usePluginSend();
  // The action and author-prompt handlers cannot own the send
  // promise — discard it explicitly. See change: cleanup-client-plugin-promises.
  const dispatch = useMemo(() => makeSafeSend(send), [send]);
  const Dialog = useUiPrimitive(UI_PRIMITIVE_KEYS.dialog);
  const menuOpen = useContext(ActionListMenuContext)?.open;

  // commandsList (subscribed above) + the event stream drive re-evaluation; the
  // gate reads the same sources as `flowsActionsAvailable`.
  const available = hasFlowsCommand(commands) || sessionHasFlowEvents(session.id);
  const { enabled: editMode, error: editModeError, clearError } = useEditModeState(session.id, { active: available, menuOpen });
  const hasFlowsDelete = commands.some((c) => c.name === "flows:delete");

  const [pickerOpen, setPickerOpen] = useState(false);
  const [openPickerOpen, setOpenPickerOpen] = useState(false);
  const [editPickerOpen, setEditPickerOpen] = useState(false);
  // After picking from the edit launcher, capture intent before launching the skill.
  const [authorTarget, setAuthorTarget] = useState<{ mode: "new" | "edit"; flowName?: string } | null>(null);
  const [deletePickerOpen, setDeletePickerOpen] = useState(false);
  const [deleteFlowName, setDeleteFlowName] = useState<string | null>(null);
  const [selectedFlow, setSelectedFlow] = useState<FlowInfo | null>(null);

  if (!available) return null;

  const anyRunning = isAnyFlowRunning(flowState, flowStates);
  const hasFlows = flows.length > 0;

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

  const actions = [
    ...(hasFlows
      ? [{ label: t("runFlowButton", undefined, "Run Flow..."), icon: "mdiPlay", onClick: () => setPickerOpen(true) }]
      : []),
    ...(hasFlows
      ? [{
          label: t("openFlowButton", undefined, "Open flow…"),
          icon: "mdiEyeOutline",
          disabled: anyRunning,
          tooltip: anyRunning ? t("openFlowDisabledRunning", undefined, "A flow is running") : undefined,
          onClick: () => setOpenPickerOpen(true),
        }]
      : []),
    ...(editMode === true
      ? [{ label: t("newEditButton", undefined, "New / Edit…"), icon: "mdiPencil", onClick: () => setEditPickerOpen(true) }]
      : []),
    ...(editMode !== undefined
      ? [projectEditModeItem(t, editMode, () =>
          dispatch({
            type: "plugin_action",
            pluginId: "flows",
            sessionId: session.id,
            action: "flow.set-edit-mode",
            payload: { enabled: !editMode },
          }),
        )]
      : []),
    ...(hasFlowsDelete && hasFlows
      ? [{ label: `${t("delete", undefined, "Delete")}…`, icon: "mdiDeleteOutline", onClick: () => setDeletePickerOpen(true) }]
      : []),
  ];

  const onFlowAction = (action: string, opts?: { flowName?: string; task?: string }) =>
    dispatch({
      type: "flow_management",
      sessionId: session.id,
      action,
      flowName: opts?.flowName,
      task: opts?.task,
    });

  const onEditFlow = (flowName: string | undefined, instruction: string) => {
    const intent = instruction.trim();
    // New flow: instruction describes what to build. Edit: flow name is
    // token-1 (the skill reads that file), instruction follows on a new line.
    const text = flowName
      ? intent
        ? `/skill:manage-flows ${flowName}\n\n${intent}`
        : `/skill:manage-flows ${flowName}`
      : `/skill:manage-flows ${intent}`;
    dispatch({ type: "send_prompt", sessionId: session.id, text });
  };

  return (
    <>
      {actions.length > 0 && <ActionList actions={actions} />}

      {/* Per-project edit-mode change did not land: tell the user. */}
      {editModeError && (
        <Dialog open onClose={clearError} title={t("editModeErrorTitle", undefined, "Edit mode not changed")} size="sm" testId="flows-edit-mode-error">
          <p className="text-xs text-[var(--text-secondary)]">
            {editModeError === "not-delivered"
              ? t("editModeErrorNotDelivered", undefined, "The session could not be reached. Edit mode for this project is unchanged.")
              : t("editModeErrorTimeout", undefined, "pi-flows did not confirm the change in time. The menu shows the current value.")}
          </p>
          <Dialog.Footer>
            <Dialog.Cancel onClick={clearError}>{t("dismiss", undefined, "Dismiss")}</Dialog.Cancel>
          </Dialog.Footer>
        </Dialog>
      )}

      {/* Run: pick flow → task dialog */}
      {pickerOpen && (
        <SearchableSelectDialog
          title={t("runFlowDialogTitle", undefined, "Run Flow")}
          options={flowOptions}
          placeholder={t("searchFlows", undefined, "Search flows...")}
          emptyMessage={t("noFlowsAvailable", undefined, "No flows available")}
          onSelect={(value) => {
            const flow = flows.find((f) => f.name === value);
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

      {/* Open: pick flow → attach it to the flow slot (not started). See change:
          attach-flow-before-run (D7). */}
      {openPickerOpen && (
        <SearchableSelectDialog
          title={t("openFlowDialogTitle", undefined, "Open flow")}
          options={flowOptions}
          placeholder={t("searchFlows", undefined, "Search flows...")}
          emptyMessage={t("noFlowsAvailable", undefined, "No flows available")}
          onSelect={(value) => {
            const flow = flows.find((f) => f.name === value);
            if (flow) {
              // Baseline = newest flow_started seen now; null on an empty (not yet
              // replayed) stream — the flow slot resolves it from the first batch.
              // See change: attach-flow-before-run (D4).
              setAttachment(session.id, {
                id: newAttachmentId(),
                name: flow.name,
                source: flow.source,
                baselineStartedAt: events.length > 0 ? (lastFlowStartedAt ?? 0) : null,
              });
            }
            setOpenPickerOpen(false);
          }}
          onCancel={() => setOpenPickerOpen(false)}
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
