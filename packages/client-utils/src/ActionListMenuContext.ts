/**
 * Menu context for the `ui:action-list` primitive.
 *
 * When a non-null value is provided, `ActionList` renders its items as a
 * vertical list of `role="menuitem"` buttons (instead of the horizontal chip
 * row) and calls `onActivate` after a successful (enabled) activation so the
 * hosting menu can close itself. `null` (the default) keeps the standalone
 * horizontal-row rendering unchanged.
 *
 * `open` mirrors the hosting menu's open state, so a claim that stays mounted
 * while the menu is closed can refresh its data when the menu opens.
 *
 * See change: add-session-actions-flyout; stop-flows-edit-mode-project-writes (D4).
 */
import { createContext } from "react";

export interface ActionListMenuContextValue {
  /** Called after an enabled item was activated (handler already ran). */
  onActivate?: () => void;
  /** True while the hosting menu is open (undefined when the host does not report it). */
  open?: boolean;
}

export const ActionListMenuContext = createContext<ActionListMenuContextValue | null>(null);
