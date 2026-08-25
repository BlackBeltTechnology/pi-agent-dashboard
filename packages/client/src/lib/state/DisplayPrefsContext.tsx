/**
 * DisplayPrefsContext — exposes the global `DisplayPrefs` (or `undefined`
 * when the server has never seeded them) to every component that needs
 * to gate render on a preference.
 *
 * The single source of truth lives at the App level (kept in sync via
 * `useMessageHandler` on `display_prefs_updated`). Per-session overrides
 * ride on `Session.displayPrefsOverride` and are merged by
 * `useDisplayPrefs(sessionId)`.
 *
 * See change: configurable-chat-display.
 */
import React, { createContext, useContext } from "react";
import type { DisplayPrefs, PartialDisplayPrefs } from "@blackbelt-technology/pi-dashboard-shared/display-prefs.js";

export interface DisplayPrefsContextValue {
  /** Global prefs, or `undefined` when never seeded (first-launch state). */
  global: DisplayPrefs | undefined;
  /** Resolve a session's sparse override (may be `undefined`). */
  getSessionOverride: (sessionId: string | undefined) => PartialDisplayPrefs | undefined;
}

const DEFAULT: DisplayPrefsContextValue = {
  global: undefined,
  getSessionOverride: () => undefined,
};

/**
 * Resolve a session's override from the `sessions` map, normalizing a cleared
 * session's transient `null` (carried by a clearing `session_updated`
 * broadcast) to `undefined` so `mergeDisplayPrefs` and the `ChatViewMenu`
 * "modified" pill treat it as no override.
 * See change: fix-clear-display-override-broadcast (D2).
 */
export function resolveSessionOverride(
  sessions: Map<string, { displayPrefsOverride?: PartialDisplayPrefs | null }>,
  sessionId: string | undefined,
): PartialDisplayPrefs | undefined {
  if (!sessionId) return undefined;
  return sessions.get(sessionId)?.displayPrefsOverride ?? undefined;
}

const DisplayPrefsContext = createContext<DisplayPrefsContextValue>(DEFAULT);

export function DisplayPrefsProvider({
  value,
  children,
}: {
  value: DisplayPrefsContextValue;
  children: React.ReactNode;
}) {
  return <DisplayPrefsContext.Provider value={value}>{children}</DisplayPrefsContext.Provider>;
}

export function useDisplayPrefsContext(): DisplayPrefsContextValue {
  return useContext(DisplayPrefsContext);
}
