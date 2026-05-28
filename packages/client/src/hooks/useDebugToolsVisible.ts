/**
 * @deprecated Use `useDisplayPrefs(sessionId)` and read `.debugTools` instead.
 * This hook now reads the server-managed `displayPrefs.debugTools` via the
 * DisplayPrefsContext. The localStorage key `show-debug-tools` is migrated
 * on first hydration by `useDisplayPrefsMigration`.
 *
 * See change: configurable-chat-display.
 */
import { useCallback } from "react";
import { useDisplayPrefs } from "./useDisplayPrefs.js";

const STORAGE_KEY = "show-debug-tools";

/** Set of tool names considered "debug" — hidden by default */
export const DEBUG_TOOL_NAMES = new Set([
  "flow:list-flows",
  "flow:rediscover",
  "resources_discover",
]);

export function isDebugTool(toolName: string): boolean {
  return DEBUG_TOOL_NAMES.has(toolName);
}

/**
 * @deprecated Read `useDisplayPrefs().debugTools` directly. The setter still
 * PATCHes the global server prefs for back-compat callers, but new code
 * SHOULD route through the Settings UI / display-prefs API.
 */
export function useDebugToolsVisible(): [boolean, (v: boolean) => void] {
  const prefs = useDisplayPrefs();
  const update = useCallback((v: boolean) => {
    // Back-compat shim: PATCH the server so other tabs / sessions update too.
    void fetch("/api/preferences/display", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ debugTools: v }),
      credentials: "include",
    }).catch(() => { /* swallow; UI will recover on next broadcast */ });
    // Also strip the legacy localStorage key if anyone still has it.
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
  }, []);

  return [prefs.debugTools, update];
}
