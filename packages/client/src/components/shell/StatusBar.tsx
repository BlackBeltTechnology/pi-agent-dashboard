import { mdiFlash, mdiLoading } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useI18n } from "../../lib/i18n/i18n.js";

/**
 * StatusBar — working-status label only.
 *
 * The standalone model row (ModelSelector + ThinkingLevelSelector +
 * ComposerSessionActions) was retired in `redesign-prompt-input`: model and
 * thinking now live inside the composer toolbar, and session actions render as
 * a context strip above the composer card. StatusBar keeps ONLY the
 * working-status label (`Thinking…` / `Generating…` / `Running <tool>…`).
 */
interface Props {
  status: "idle" | "streaming" | "ended";
  currentTool?: string;
  streamingText?: string;
}

export function StatusBar({ status, currentTool, streamingText }: Props) {
  const { t } = useI18n();
  let statusLabel: string | null = null;
  let statusIcon = mdiLoading;
  let toolHighlight = false;

  if (status === "streaming") {
    if (currentTool) {
      statusLabel = t("status.runningTool", { tool: currentTool }, `Running ${currentTool}...`);
      statusIcon = mdiFlash;
      toolHighlight = true;
    } else if (streamingText) {
      statusLabel = t("status.generating", undefined, "Generating...");
    } else {
      statusLabel = t("status.thinking", undefined, "Thinking...");
    }
  }

  // Nothing to show when idle/ended — render nothing so the resting composer
  // footprint stays lean (design D4).
  if (!statusLabel) return null;

  return (
    <div
      className="flex items-center px-4 py-1 border-t border-[var(--border-primary)] text-xs"
      data-testid="status-bar"
    >
      <div className="flex items-center gap-1.5 text-[var(--text-secondary)]" data-testid="working-status">
        <Icon
          path={statusIcon}
          size={0.5}
          spin={statusIcon === mdiLoading}
          className={toolHighlight ? "text-yellow-400" : ""}
        />
        <span>{statusLabel}</span>
      </div>
    </div>
  );
}
