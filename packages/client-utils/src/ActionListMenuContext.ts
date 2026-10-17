/**
 * Menu context for the `ui:action-list` primitive.
 *
 * When a non-null value is provided, `ActionList` renders its items as a
 * vertical list of `role="menuitem"` buttons (instead of the horizontal chip
 * row) and calls `onActivate` after a successful (enabled) activation so the
 * hosting menu can close itself. `null` (the default) keeps the standalone
 * horizontal-row rendering unchanged.
 *
 * See change: add-session-actions-flyout.
 */
import { createContext } from "react";

export interface ActionListMenuContextValue {
  /** Called after an enabled item was activated (handler already ran). */
  onActivate?: () => void;
}

export const ActionListMenuContext = createContext<ActionListMenuContextValue | null>(null);
