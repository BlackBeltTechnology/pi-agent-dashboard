/**
 * Shared flow actions for every flows surface (dock chip, panel headers,
 * session actions menu): run, open (attach without starting, expands the
 * panel), edit, new, delete and the per-project edit-mode write, plus the
 * dialogs they open (`<FlowActionDialogs>`, portaled by the host primitives so
 * closing a menu / popover never unmounts them).
 *
 * Opening the Run / Open picker asks the session for a rediscovered catalog,
 * so a flow removed on disk leaves the picker once the fresh catalog arrives.
 *
 * Extracted from `SessionFlowMenuClaim`. See change:
 * flows-dock-chip-and-panel-actions (D6, D9).
 */
import { usePluginSend, useSessionData, useSessionEvents, useT, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { UiSelectOption as SelectOption } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { CommandInfo, FlowState } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useMemo, useState } from "react";
import type { FlowCatalogEntry } from "../flow-catalog-contract.js";
import { FlowAuthorPromptDialog } from "./FlowAuthorPromptDialog.js";
import { FlowLaunchDialog } from "./FlowLaunchDialog.js";
import { useFlowsSessionState } from "./FlowsSessionStateContext.js";
import { newAttachmentId, setAttachment } from "./flow-attach-store.js";
import { setFlowCollapsed } from "./flow-collapse-storage.js";
import { makeSafeSend } from "./send-safe.js";
import { useEditModeState } from "./useEditModeState.js";
import { useFlowCatalog } from "./useFlowCatalog.js";

function isAnyFlowRunning(
  flowState: FlowState | null | undefined,
  flowStates: ReadonlyMap<string, FlowState> | undefined,
): boolean {
  if (flowState?.status === "running") return true;
  return flowStates ? Array.from(flowStates.values()).some((s) => s.status === "running") : false;
}

type Picker = "run" | "open" | "edit" | "delete" | null;

export interface FlowActions {
  sessionId: string;
  catalogKnown: boolean;
  flows: readonly FlowCatalogEntry[];
  hasFlows: boolean;
  anyRunning: boolean;
  canDelete: boolean;
  /** Effective edit mode; `undefined` while unknown. */
  editMode: boolean | undefined;
  refreshCatalog: (opts?: { rediscover?: boolean }) => void;
  run: () => void;
  /** Run a named flow (Run again): task dialog when the flow requires a task. */
  runFlow: (flowName: string) => void;
  open: () => void;
  edit: () => void;
  newFlow: () => void;
  remove: () => void;
  setEditMode: (enabled: boolean) => void;
  /** @internal dialog state consumed by `<FlowActionDialogs>`. */
  dialogs: FlowDialogState;
}

interface FlowDialogState {
  picker: Picker;
  setPicker: (p: Picker) => void;
  selectedFlow: FlowCatalogEntry | null;
  setSelectedFlow: (f: FlowCatalogEntry | null) => void;
  authorTarget: { mode: "new" | "edit"; flowName?: string } | null;
  setAuthorTarget: (t: { mode: "new" | "edit"; flowName?: string } | null) => void;
  deleteFlowName: string | null;
  setDeleteFlowName: (n: string | null) => void;
  editModeError: "not-delivered" | "timeout" | null;
  clearEditModeError: () => void;
  dispatchRun: (flowName: string, task?: string) => void;
  dispatchDelete: (flowName: string) => void;
  dispatchAuthor: (flowName: string | undefined, instruction: string) => void;
  attach: (flow: FlowCatalogEntry) => void;
}

export function useFlowActions(
  sessionId: string,
  opts: {
    /** When edit mode is fetched: only with flows (chip), only without (menu), or always (headers). */
    editModeWhen?: "has-flows" | "flowless" | "always";
    menuOpen?: boolean;
    autoAskCatalog?: boolean;
  } = {},
): FlowActions {
  const catalog = useFlowCatalog(sessionId, { autoAsk: opts.autoAskCatalog });
  const when = opts.editModeWhen ?? "always";
  const editModeActive =
    when === "always" || (catalog.known && (when === "has-flows" ? catalog.flows.length > 0 : catalog.flows.length === 0));
  const commands = useSessionData<CommandInfo[]>(sessionId, "commandsList") ?? [];
  const { flowState, flowStates, lastFlowStartedAt } = useFlowsSessionState(sessionId);
  const events = useSessionEvents(sessionId);
  const send = usePluginSend();
  const dispatch = useMemo(() => makeSafeSend(send), [send]);
  const { enabled: editMode, error: editModeError, clearError } = useEditModeState(sessionId, {
    active: editModeActive,
    menuOpen: opts.menuOpen,
  });

  const [picker, setPicker] = useState<Picker>(null);
  const [selectedFlow, setSelectedFlow] = useState<FlowCatalogEntry | null>(null);
  const [authorTarget, setAuthorTarget] = useState<{ mode: "new" | "edit"; flowName?: string } | null>(null);
  const [deleteFlowName, setDeleteFlowName] = useState<string | null>(null);

  const flows = catalog.flows;
  const dispatchRun = (flowName: string, task?: string) =>
    dispatch({ type: "flow_management", sessionId, action: "run", flowName, task: task || undefined });

  const openPicker = (p: "run" | "open") => {
    catalog.refresh({ rediscover: true });
    setPicker(p);
  };

  return {
    sessionId,
    catalogKnown: catalog.known,
    flows,
    hasFlows: flows.length > 0,
    anyRunning: isAnyFlowRunning(flowState, flowStates),
    canDelete: commands.some((c) => c.name === "flows:delete"),
    editMode,
    refreshCatalog: catalog.refresh,
    run: () => openPicker("run"),
    runFlow: (flowName) => {
      const flow = flows.find((f) => f.name === flowName);
      if (!flow) return;
      if (flow.taskRequired) setSelectedFlow(flow);
      else dispatchRun(flow.name);
    },
    open: () => openPicker("open"),
    edit: () => setPicker("edit"),
    newFlow: () => setAuthorTarget({ mode: "new" }),
    remove: () => setPicker("delete"),
    setEditMode: (enabled) =>
      dispatch({ type: "plugin_action", pluginId: "flows", sessionId, action: "flow.set-edit-mode", payload: { enabled } }),
    dialogs: {
      picker,
      setPicker,
      selectedFlow,
      setSelectedFlow,
      authorTarget,
      setAuthorTarget,
      deleteFlowName,
      setDeleteFlowName,
      editModeError,
      clearEditModeError: clearError,
      dispatchRun,
      dispatchDelete: (flowName) => dispatch({ type: "flow_management", sessionId, action: "delete", flowName }),
      dispatchAuthor: (flowName, instruction) => {
        const intent = instruction.trim();
        // New flow: instruction describes what to build. Edit: flow name is
        // token-1 (the skill reads that file), instruction follows on a new line.
        const text = flowName
          ? intent
            ? `/skill:manage-flows ${flowName}\n\n${intent}`
            : `/skill:manage-flows ${flowName}`
          : `/skill:manage-flows ${intent}`;
        dispatch({ type: "send_prompt", sessionId, text });
      },
      attach: (flow) => {
        // Baseline = newest flow_started seen now; null on an empty (not yet
        // replayed) stream — the flow slot resolves it from the first batch.
        // See change: attach-flow-before-run (D4).
        setAttachment(sessionId, {
          id: newAttachmentId(),
          name: flow.name,
          source: flow.source,
          baselineStartedAt: events.length > 0 ? (lastFlowStartedAt ?? 0) : null,
        });
        // Open flow… is an explicit request to see the flow: expand. (D10)
        setFlowCollapsed(sessionId, ["dashboard"], false);
      },
    },
  };
}

/** The dialogs the actions open. Render once next to the trigger surface. */
export function FlowActionDialogs({ actions }: { actions: FlowActions }) {
  const t = useT();
  const ConfirmDialog = useUiPrimitive(UI_PRIMITIVE_KEYS.confirmDialog);
  const SearchableSelectDialog = useUiPrimitive(UI_PRIMITIVE_KEYS.searchableSelectDialog);
  const Dialog = useUiPrimitive(UI_PRIMITIVE_KEYS.dialog);
  const d = actions.dialogs;
  const flows = actions.flows;

  const flowOptions: SelectOption[] = flows.map((f) => ({ value: f.name, label: f.name, description: f.description }));
  const close = () => d.setPicker(null);

  return (
    <>
      {/* Per-project edit-mode change did not land: tell the user. */}
      {d.editModeError && (
        <Dialog open onClose={d.clearEditModeError} title={t("editModeErrorTitle", undefined, "Edit mode not changed")} size="sm" testId="flows-edit-mode-error">
          <p className="text-xs text-[var(--text-secondary)]">
            {d.editModeError === "not-delivered"
              ? t("editModeErrorNotDelivered", undefined, "The session could not be reached. Edit mode for this project is unchanged.")
              : t("editModeErrorTimeout", undefined, "pi-flows did not confirm the change in time. The menu shows the current value.")}
          </p>
          <Dialog.Footer>
            <Dialog.Cancel onClick={d.clearEditModeError}>{t("dismiss", undefined, "Dismiss")}</Dialog.Cancel>
          </Dialog.Footer>
        </Dialog>
      )}

      {/* Run: pick flow → task dialog */}
      {d.picker === "run" && (
        <SearchableSelectDialog
          title={t("runFlowDialogTitle", undefined, "Run Flow")}
          options={flowOptions}
          placeholder={t("searchFlows", undefined, "Search flows...")}
          emptyMessage={t("noFlowsAvailable", undefined, "No flows available")}
          onSelect={(value) => {
            const flow = flows.find((f) => f.name === value);
            if (flow) d.setSelectedFlow(flow);
            close();
          }}
          onCancel={close}
        />
      )}

      {d.selectedFlow && (
        <FlowLaunchDialog
          flowName={d.selectedFlow.name}
          description={d.selectedFlow.description}
          onSubmit={(task) => {
            d.dispatchRun((d.selectedFlow as FlowCatalogEntry).name, task || undefined);
            d.setSelectedFlow(null);
          }}
          onCancel={() => d.setSelectedFlow(null)}
        />
      )}

      {/* Open: pick flow → attach it to the flow slot (not started). See change:
          attach-flow-before-run (D7). */}
      {d.picker === "open" && (
        <SearchableSelectDialog
          title={t("openFlowDialogTitle", undefined, "Open flow")}
          options={flowOptions}
          placeholder={t("searchFlows", undefined, "Search flows...")}
          emptyMessage={t("noFlowsAvailable", undefined, "No flows available")}
          onSelect={(value) => {
            const flow = flows.find((f) => f.name === value);
            if (flow) d.attach(flow);
            close();
          }}
          onCancel={close}
        />
      )}

      {/* Edit: pick an existing flow → capture intent → manage-flows skill */}
      {d.picker === "edit" && (
        <SearchableSelectDialog
          title={t("editFlowTitle", undefined, "Edit flow")}
          options={flowOptions}
          placeholder={t("pickFlowToEdit", undefined, "Pick a flow to edit…")}
          emptyMessage={t("noFlowsAvailable", undefined, "No flows available")}
          onSelect={(value) => {
            d.setAuthorTarget({ mode: "edit", flowName: value });
            close();
          }}
          onCancel={close}
        />
      )}

      {d.authorTarget && (
        <FlowAuthorPromptDialog
          mode={d.authorTarget.mode}
          flowName={d.authorTarget.flowName}
          onSubmit={(instruction) => {
            d.dispatchAuthor(d.authorTarget?.flowName, instruction);
            d.setAuthorTarget(null);
          }}
          onCancel={() => d.setAuthorTarget(null)}
        />
      )}

      {/* Delete: pick flow → confirm dialog */}
      {d.picker === "delete" && (
        <SearchableSelectDialog
          title={t("deleteFlowTitle", undefined, "Delete Flow")}
          options={flowOptions}
          placeholder={t("searchFlows", undefined, "Search flows...")}
          emptyMessage={t("noFlowsAvailable", undefined, "No flows available")}
          onSelect={(value) => {
            d.setDeleteFlowName(value);
            close();
          }}
          onCancel={close}
        />
      )}

      {d.deleteFlowName && (
        <ConfirmDialog
          message={t("deleteFlowConfirm", { name: d.deleteFlowName }, `Delete flow "${d.deleteFlowName}"? This will remove the flow file and any associated agents.`)}
          confirmLabel={t("delete", undefined, "Delete")}
          onConfirm={() => {
            d.dispatchDelete(d.deleteFlowName as string);
            d.setDeleteFlowName(null);
          }}
          onCancel={() => d.setDeleteFlowName(null)}
        />
      )}
    </>
  );
}
