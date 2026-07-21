/**
 * `useDisplayPrefs(sessionId?)` — returns effective `DisplayPrefs` for the
 * current scope. Merges the global prefs with the session's sparse
 * `displayPrefsOverride` via `mergeDisplayPrefs`.
 *
 * When the server has never seeded global prefs, returns
 * `DISPLAY_PRESETS.standard` so chat-view continues to render rather
 * than blanking out while the first-launch modal is open.
 *
 * See change: configurable-chat-display.
 */
import { useMemo } from "react";
import {
  type DisplayPrefs,
  DISPLAY_PRESETS,
  mergeDisplayPrefs,
} from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";
import { useDisplayPrefsContext } from "../lib/state/DisplayPrefsContext.js";

export function useDisplayPrefs(sessionId?: string): DisplayPrefs {
  const { global, getSessionOverride } = useDisplayPrefsContext();
  const override = getSessionOverride(sessionId);
  return useMemo(
    () => mergeDisplayPrefs(global ?? DISPLAY_PRESETS.standard, override),
    [global, override],
  );
}
