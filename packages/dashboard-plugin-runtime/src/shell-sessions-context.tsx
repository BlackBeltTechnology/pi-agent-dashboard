/**
 * Shell sessions context — exposes the shell's per-session metadata map
 * to plugin claims via a narrow primitive `useShellSession(sessionId)`.
 *
 * Used by `<ShellOverlayRouteSlot>` to resolve `DashboardSession`
 * metadata for the param identified by each claim's `config.sessionParam`,
 * and by any plugin component that needs cwd/label/status of an
 * arbitrary session (not just the currently-selected one).
 *
 * Plugins MUST NOT use this primitive to reach for per-session derived
 * state (events, subagents, flows). Use `useSessionEvents` + plugin-owned
 * reducers for that.
 *
 * See change: add-flow-agent-popout.
 */
import React, { createContext, useContext, type ReactNode } from "react";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export type ShellSessionsValue = ReadonlyMap<string, DashboardSession>;

const ShellSessionsContext = createContext<ShellSessionsValue | null>(null);

export interface ShellSessionsProviderProps {
  value: ShellSessionsValue;
  children: ReactNode;
}

/**
 * Provider. Mount once near the root of the shell (App.tsx).
 */
export function ShellSessionsProvider({ value, children }: ShellSessionsProviderProps) {
  return (
    <ShellSessionsContext.Provider value={value}>
      {children}
    </ShellSessionsContext.Provider>
  );
}

/**
 * Strict-hook variant: throws if used outside the provider. Matches the
 * shape of other strict plugin hooks (`useSlotRegistry`, `useUiPrimitive`).
 */
export function useShellSession(sessionId: string): DashboardSession | undefined {
  const map = useContext(ShellSessionsContext);
  if (!map) {
    throw new Error(
      "useShellSession must be called inside a <ShellSessionsProvider>",
    );
  }
  return map.get(sessionId);
}

/**
 * Soft-hook variant: returns `undefined` outside the provider instead of
 * throwing. Useful for components that may render in test contexts without
 * the provider.
 */
export function useShellSessionOrNull(sessionId: string): DashboardSession | undefined {
  const map = useContext(ShellSessionsContext);
  return map?.get(sessionId);
}
