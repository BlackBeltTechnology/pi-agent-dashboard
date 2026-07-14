/**
 * Content-view claim renderer for the flow YAML preview, gated by the
 * `isFlowYamlPreviewActive` predicate.
 *
 * Replaces the shell's `flowYamlPreview` state + MarkdownPreviewView
 * call site that App.tsx used to have. The content (yaml string +
 * title) is set by the plugin's UI-state actions (see Part F.4 / F.5
 * callbacks) when the user clicks "view yaml" or "view agent source".
 *
 * See change: pluginize-flows-via-registry (design.md Decision 3
 * RECONSIDERED — predicates over routes).
 */

import { useT, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import { UI_PRIMITIVE_KEYS } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/ui-primitives.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiArrowLeft } from "@mdi/js";
import { Icon } from "@mdi/react";
import React from "react";
import { useFlowsUiActions, useFlowsUiState } from "./FlowsUiStateContext.js";

/**
 * Slot-consumer wrapper for the `content-view` claim. Reads the
 * preview content from the plugin's internal UI-state context. On
 * dismiss, clears `flowYamlPreview` and `sourceOpenAgent` and calls
 * the slot's `onClose`.
 */
export function FlowYamlPreviewClaim({
  onClose,
}: {
  // session prop is part of the slot contract but unused here \u2014 the
  // preview content is already in the plugin's UI-state context.
  session: DashboardSession;
  routeParams: Record<string, string>;
  onClose: () => void;
}) {
  const t = useT();
  const MarkdownContent = useUiPrimitive(UI_PRIMITIVE_KEYS.markdownContent);
  const { flowYamlPreview } = useFlowsUiState();
  const actions = useFlowsUiActions();

  if (!flowYamlPreview) return null;

  const handleBack = () => {
    actions.setFlowYamlPreview(null);
    actions.setSourceOpenAgent(null);
    onClose();
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-3 py-2 border-b border-[var(--border-subtle)] bg-[var(--bg-secondary)] flex items-center gap-2">
        <button
          onClick={handleBack}
          className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          title={t("back", undefined, "Back")}
        >
          <Icon path={mdiArrowLeft} size={0.7} />
        </button>
        <div className="font-medium text-sm truncate">{flowYamlPreview.title}</div>
      </div>
      <div className="flex-1 overflow-auto p-3">
        <MarkdownContent content={flowYamlPreview.content} />
      </div>
    </div>
  );
}
