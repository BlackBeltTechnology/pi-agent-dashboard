import {
  usePluginSend,
  useSessionData,
  useSessionEvents,
  useT,
  useUiPrimitive,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import { usePluginConfig } from "@blackbelt-technology/dashboard-plugin-runtime/context";
import { ActionList } from "@blackbelt-technology/pi-dashboard-client-utils/ActionList";
import type { UiSelectOption as SelectOption } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type {
  CommandInfo,
  DashboardSession,
  FlowInfo,
  FlowState,
} from "@blackbelt-technology/pi-dashboard-shared/types.js";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { FlowAuthorPromptDialog } from "./FlowAuthorPromptDialog.js";
import { FlowLaunchDialog } from "./FlowLaunchDialog.js";
import { useFlowsSessionState } from "./FlowsSessionStateContext.js";
import type { FlowsPluginConfig } from "./FlowsSettings.js";
import { newAttachmentId, setAttachment } from "./flow-attach-store.js";
import { hasFlowsCommand } from "./flowsActionsGate.js";
import { sessionHasFlowEvents } from "./flowsAvailability.js";
import { makeSafeSend } from "./send-safe.js";

function isAnyFlowRunning(
  flowState: FlowState | null | undefined,
  flowStates: ReadonlyMap<string, FlowState> | undefined,
): boolean {
  if (flowState?.status === "running") return true;
  return flowStates ? Array.from(flowStates.values()).some((s) => s.status === "running") : false;
}

/**
 * `session-card-action-bar` claim: the flow ACTIONS (Run Flow…, Open flow…,
 * New / Edit…, Delete) rendered as an `ActionList` for the session actions menu,
 * plus the dialogs they open and the edit-mode reconcile. Flow STATUS stays in
 * the FLOWS subcard (`SessionFlowActionsClaim`).
 *
 * The claim stays mounted for the card's lifetime (dialogs portal to body and
 * survive the menu closing; the reconcile runs without the menu being opened).
 * Gated by availability — a `flows` / `flows:*` command (not `flows:new` alone)
 * or any flow event; never by `flowsList` length.
 *
 * See change: add-session-actions-flyout (D7, D12).
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
  // The edit-mode reconcile and author-prompt handlers cannot own the send
  // promise — discard it explicitly. See change: cleanup-client-plugin-promises.
  const dispatch = useMemo(() => makeSafeSend(send), [send]);
  const config = usePluginConfig<FlowsPluginConfig>();
  const editMode = config.editFlow ?? false;

  // commandsList (subscribed above) + the event stream drive re-evaluation; the
  // gate reads the same sources as `flowsActionsAvailable`.
  const available = hasFlowsCommand(commands) || sessionHasFlowEvents(session.id);
  const hasFlowsDelete = commands.some((c) => c.name === "flows:delete");

  const [pickerOpen, setPickerOpen] = useState(false);
  const [openPickerOpen, setOpenPickerOpen] = useState(false);
  const [editPickerOpen, setEditPickerOpen] = useState(false);
  // After picking from the edit launcher, capture intent before launching the skill.
  const [authorTarget, setAuthorTarget] = useState<{ mode: "new" | "edit"; flowName?: string } | null>(null);
  const [deletePickerOpen, setDeletePickerOpen] = useState(false);
  const [deleteFlowName, setDeleteFlowName] = useState<string | null>(null);
  const [selectedFlow, setSelectedFlow] = useState<FlowInfo | null>(null);

  // Reconcile the GLOBAL edit-mode default down to this session once flows is
  // available. pi-flows persists it to the project .pi/settings.json. Idempotent
  // — re-emits only when the default changes. See change:
  // rework-flows-plugin-for-new-pi-flows (D4), add-session-actions-flyout (D12).
  const reconciledRef = useRef<boolean | null>(null);
  useEffect(() => {
    if (!available) return; // wait until flows is available
    if (reconciledRef.current === editMode) return;
    reconciledRef.current = editMode;
    dispatch({ type: "flow_management", sessionId: session.id, action: "set-edit-mode", enabled: editMode });
  }, [available, editMode, session.id, dispatch]);

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
    ...(editMode
      ? [{ label: t("newEditButton", undefined, "New / Edit…"), icon: "mdiPencil", onClick: () => setEditPickerOpen(true) }]
      : []),
    ...(hasFlowsDelete && hasFlows
      ? [{ label: `${t("delete", undefined, "Delete")}…`, icon: "mdiDeleteOutline", onClick: () => setDeletePickerOpen(true) }]
      : []),
  ];

  const onFlowAction = (action: string, opts?: { flowName?: string; task?: string }) =>
    send({
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
