import React, { type ReactNode } from "react";
import { Icon } from "@mdi/react";
import { mdiLoading, mdiFlash } from "@mdi/js";
import { ModelSelector } from "./ModelSelector.js";
import { ThinkingLevelSelector } from "./ThinkingLevelSelector.js";
import type { ModelInfo, RoleInfo } from "@blackbelt-technology/pi-dashboard-shared/types.js";

interface Props {
  model?: string;
  models?: ModelInfo[];
  thinkingLevel?: string;
  status: "idle" | "streaming" | "ended";
  currentTool?: string;
  streamingText?: string;
  onSelectModel: (model: string) => void;
  onSelectThinkingLevel: (level: string) => void;

  /**
   * @deprecated Roles UI moved to a `settings-section` plugin contribution
   * in `@blackbelt-technology/pi-dashboard-roles-plugin` (Settings →
   * General → Roles). These props are still accepted for one minor so the
   * App.tsx call site can be cleaned up incrementally; they are not used
   * here. See change: fix-pi-flows-end-to-end (Group 5).
   */
  roles?: RoleInfo;
  /** @deprecated — moved to BuiltInRolesSettings; ignored here. */
  onRoleSet?: (role: string, modelId: string) => void;
  /** @deprecated — moved to BuiltInRolesSettings; ignored here. */
  onPresetLoad?: (presetName: string) => void;
  /** @deprecated — moved to BuiltInRolesSettings; ignored here. */
  onPresetSave?: (presetName: string) => void;
  /** @deprecated — moved to BuiltInRolesSettings; ignored here. */
  onPresetDelete?: (presetName: string) => void;

  /**
   * Inline session-action slot rendered between the thinking-level selector
   * and the working-status label. Used by App.tsx to mount
   * <ComposerSessionActions> so OpenSpec / Git / JJ actions live inline
   * with the model bar instead of as a separate strip above the textarea.
   * See change: redesign-session-card-and-composer (statusbar-inline).
   */
  actions?: ReactNode;

  /**
   * Inline slot rendered BEFORE the ModelSelector (left edge of the bar).
   * Used by App.tsx for the OpenSpec refresh button — placed there per
   * user feedback ("refresh button before the model selector").
   * See change: redesign-session-card-and-composer (refresh-before-model).
   */
  leading?: ReactNode;
}

export function StatusBar({
  model,
  models,
  thinkingLevel,
  status,
  currentTool,
  streamingText,
  onSelectModel,
  onSelectThinkingLevel,
  actions,
  leading,
}: Props) {
  let statusLabel: string | null = null;
  let statusIcon = mdiLoading;
  let toolHighlight = false;

  if (status === "streaming") {
    if (currentTool) {
      statusLabel = `Running ${currentTool}…`;
      statusIcon = mdiFlash;
      toolHighlight = true;
    } else if (streamingText) {
      statusLabel = "Generating…";
    } else {
      statusLabel = "Thinking…";
    }
  }

  return (
    <div
      className="flex items-center justify-between px-4 py-1 border-t border-[var(--border-primary)] text-xs"
      data-testid="status-bar"
    >
      <div className="flex items-center gap-2 flex-wrap min-w-0">
        {leading && (
          <>
            {leading}
            <span aria-hidden="true" className="inline-block h-3 w-px bg-[var(--border-secondary)] flex-shrink-0" />
          </>
        )}
        <ModelSelector current={model} models={models} onSelect={onSelectModel} />
        <ThinkingLevelSelector current={thinkingLevel} onSelect={onSelectThinkingLevel} />
        {actions && (
          <>
            <span aria-hidden="true" className="inline-block h-3 w-px bg-[var(--border-secondary)] mx-1 flex-shrink-0" />
            {actions}
          </>
        )}
      </div>

      {statusLabel && (
        <div className="flex items-center gap-1.5 text-[var(--text-secondary)]" data-testid="working-status">
          <Icon
            path={statusIcon}
            size={0.5}
            spin={statusIcon === mdiLoading}
            className={toolHighlight ? "text-yellow-400" : ""}
          />
          <span>{statusLabel}</span>
        </div>
      )}
    </div>
  );
}
