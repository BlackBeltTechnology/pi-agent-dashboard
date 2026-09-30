/**
 * FlowYamlPopoverButton — paper-icon button that opens the flow's YAML in the
 * host's built-in editor (Split view) via `useOpenFileInEditor`. Hidden without
 * a session (no editor to target).
 *
 * Used by `FlowDashboard` (live / idle flow) and `FlowSummary` (completed flow).
 *
 * The flow's YAML path is emitted by pi-flows in the `flow:flow-started`
 * event (`source: flow.source`) and stored on `FlowState.flowSource` by the
 * flow reducer; an attached idle flow carries it from `flowsList`.
 *
 * See change: add-ui-popover-primitive, attach-flow-before-run.
 */
import { useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import { mdiFileDocumentOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useOpenFileInEditor } from "./flow-files.js";

export function FlowYamlPopoverButton({
  flowSource,
  flowName,
  sessionId,
}: {
  flowSource: string;
  flowName: string;
  /** Owning session — the editor to open the YAML in. */
  sessionId?: string;
}) {
  const t = useT();
  const openInEditor = useOpenFileInEditor(sessionId);
  if (!openInEditor) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        openInEditor(flowSource);
      }}
      className="transition-colors p-0.5 rounded inline-flex items-center text-[var(--text-tertiary)] hover:text-blue-400 hover:bg-[var(--bg-surface)]"
      title={t("openFlowYamlInEditor", { name: flowName }, `Open ${flowName} YAML in editor`)}
    >
      <Icon path={mdiFileDocumentOutline} size={0.5} />
    </button>
  );
}
