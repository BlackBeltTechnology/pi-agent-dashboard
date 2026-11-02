/**
 * The dialogs the shared flow actions open (pickers, task dialog, author
 * prompt, delete confirm, edit-mode error). Click-only, so this module is a
 * lazy chunk loaded by `FlowActionDialogs` in `useFlowActions.tsx` the first
 * time a dialog opens — the eager chip / menu claims stay small.
 * See change: flows-dock-chip-and-panel-actions (D6).
 */
import { useT, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import type { UiSelectOption as SelectOption } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { FlowCatalogEntry } from "../flow-catalog-contract.js";
import { FlowAuthorPromptDialog } from "./FlowAuthorPromptDialog.js";
import { FlowLaunchDialog } from "./FlowLaunchDialog.js";
import type { FlowActions } from "./useFlowActions.js";

export function FlowActionDialogsImpl({ actions }: { actions: FlowActions }) {
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
