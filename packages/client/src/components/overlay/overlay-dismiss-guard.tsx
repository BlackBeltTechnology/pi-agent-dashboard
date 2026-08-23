/**
 * Dismissal guard seam for route-backed overlays (risk R1, clarification C3).
 *
 * Converting a full page into a dialog adds three dismissal gestures the page
 * never had — backdrop click, Escape, and the ✕. Each would navigate away and
 * silently discard unsaved edits, because the surfaces' existing dirty guards
 * are wired to their OWN affordances (`SettingsPanel`'s back arrow,
 * `InstructionsPage`'s file-switch and mobile back), not to the container.
 *
 * C3 resolved this as panel-level OPT-IN: a surface that has a dirty concept
 * registers an interceptor; everything else — including every plugin claim —
 * keeps dismissing immediately. That keeps the container ignorant of what
 * "dirty" means, which is the only reason one seam can serve settings, folder
 * settings and future surfaces alike.
 *
 * The interceptor REPLACES the dismissal rather than voting on it: the panel
 * already owns a discard/save confirm prompt, so it takes over and completes
 * (or abandons) the navigation itself.
 *
 * See change: add-route-backed-overlay-dialogs.
 */
import { createContext, useCallback, useContext, useEffect, useRef } from "react";

/**
 * Register a guard; the returned function removes THAT guard by identity.
 *
 * A stack, not a single slot: surfaces nest. `SettingsPanel` arms on its own
 * `isDirty` while its instructions tab renders `InstructionsPage`, which arms
 * its own guard. A last-write-wins slot let the inner guard's cleanup clear the
 * outer one, so the next Escape discarded unsaved settings with no prompt.
 * Dismissal runs the TOPMOST guard — the same rule as the shared escape-stack.
 * See change: add-route-backed-overlay-dialogs (audit finding, task 8.7).
 */
export type DismissGuardRegistrar = (handler: () => void) => () => void;

export interface OverlayDismissGuardApi {
  register: DismissGuardRegistrar;
  /** Dismiss for real, bypassing the guard — what a panel calls once the user
   *  has confirmed the discard. */
  dismiss: () => void;
}

export const OverlayDismissGuardContext = createContext<OverlayDismissGuardApi | null>(null);

/**
 * Opt this surface into intercepting overlay dismissal while `active`.
 *
 * @param active   Register only while this is true (i.e. while dirty).
 * @param onAttempt Called INSTEAD of dismissal — raise the discard prompt here.
 * @returns A `dismiss` to call once the user confirms the discard. Outside an
 *          overlay (the surface is a plain page) it is a no-op, so a panel can
 *          use one code path for both presentations.
 */
export function useOverlayDismissGuard(active: boolean, onAttempt: () => void): () => void {
  const api = useContext(OverlayDismissGuardContext);
  const register = api?.register;
  // Kept in a ref so a changing callback identity does not re-register on every
  // render — the effect depends only on whether the guard should be armed.
  const handler = useRef(onAttempt);
  handler.current = onAttempt;

  useEffect(() => {
    if (!register || !active) return;
    // Identity-scoped: the returned cleanup removes only THIS guard, so an
    // inner surface unmounting cannot disarm the one beneath it.
    return register(() => handler.current());
  }, [register, active]);

  return useCallback(() => api?.dismiss(), [api]);
}
