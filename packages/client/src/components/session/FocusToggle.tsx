/**
 * Sidebar-header Focus mode toggle: a keyboard-operable toggle button exposing
 * its pressed state, visibly marked while Focus is on.
 * See change: add-focus-mode-and-card-block-toggles.
 */
import { mdiTarget } from "@mdi/js";
import { Icon } from "@mdi/react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { useFocusActions, useFocusState } from "../../lib/state/CardSectionsContext.js";

export function FocusToggle() {
  const { enabled } = useFocusState();
  const actions = useFocusActions();
  const label = i18nT("focus.toggle", undefined, "Focus mode");
  return (
    <button
      type="button"
      aria-pressed={enabled}
      aria-label={label}
      title={enabled ? i18nT("focus.toggleOn", undefined, "Focus mode on — click to turn off") : i18nT("focus.toggleOff", undefined, "Focus mode — minimal sidebar")}
      disabled={!actions.canWrite}
      data-testid="focus-toggle-btn"
      onClick={() => actions.setEnabled(!enabled)}
      className={`focus-ring inline-flex items-center justify-center rounded px-0.5 disabled:opacity-40 disabled:cursor-not-allowed ${
        enabled
          ? "text-blue-400 bg-blue-500/15"
          : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
      }`}
    >
      <Icon path={mdiTarget} size={0.6} />
    </button>
  );
}
