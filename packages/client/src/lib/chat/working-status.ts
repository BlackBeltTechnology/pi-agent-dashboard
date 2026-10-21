import { t } from "../i18n/i18n.js";

/**
 * Working-status word for the composer toolbar (`Thinking…` / `Generating…` /
 * `Running <tool>…`). Moved from the deleted `StatusBar.tsx`; `kind` lets the
 * caller pick a status SHAPE so the state is never colour-only.
 *
 * Returns `null` unless the session is streaming.
 * See change: add-composer-dock (D7).
 */
type WorkingStatusKind = "tool" | "generating" | "thinking";

interface WorkingStatus {
  label: string;
  kind: WorkingStatusKind;
}

export function workingStatusLabel(
  status: "idle" | "streaming" | "ended",
  currentTool?: string,
  streamingText?: string,
): WorkingStatus | null {
  if (status !== "streaming") return null;
  if (currentTool) {
    return { kind: "tool", label: t("status.runningTool", { tool: currentTool }, `Running ${currentTool}...`) };
  }
  if (streamingText) return { kind: "generating", label: t("status.generating", undefined, "Generating...") };
  return { kind: "thinking", label: t("status.thinking", undefined, "Thinking...") };
}
