/**
 * Notice shown on the card-blocks / Session cards / Effects settings while
 * Focus mode is on: those pages edit the user's NORMAL setup, which Focus
 * currently overrides. See change: add-focus-mode-and-card-block-toggles.
 */
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { useFocusActions, useFocusState } from "../../lib/state/CardSectionsContext.js";

export function FocusNotice() {
  const focus = useFocusState();
  const actions = useFocusActions();
  if (!focus.enabled) return null;
  return (
    <div
      role="status"
      data-testid="focus-notice"
      className="flex items-center gap-3 px-3 py-2.5 mb-4 rounded-lg border border-[var(--severity-info-border)] bg-[var(--severity-info-bg)] text-[var(--severity-info-fg)]"
    >
      <span className="flex-1 text-xs">
        {i18nT(
          "focus.noticeText",
          undefined,
          "Focus is on. This page shows your normal settings; Focus currently overrides them.",
        )}
      </span>
      <button
        type="button"
        data-testid="focus-notice-off"
        disabled={!actions.canWrite}
        onClick={() => actions.setEnabled(false)}
        className="text-xs px-2.5 py-1 rounded border border-current hover:opacity-80 disabled:opacity-50 focus-ring"
      >
        {i18nT("focus.turnOff", undefined, "Turn off Focus")}
      </button>
    </div>
  );
}
