/**
 * One open actions menu at a time across the sidebar.
 *
 * `SessionList` owns the scope key — `folder:<cwd>` for a folder actions menu,
 * `session:<id>` for a session actions menu — and provides it here, so opening
 * any menu closes whichever other one was open (and vice versa). A card rendered
 * outside a provider (standalone tests, board rows) falls back to its own local
 * state, which keeps it fully functional but trivially "single".
 *
 * Besides the key, the state records HOW a session menu opened (`source`), the
 * pointer point for a right-click open, and the element that had focus (the
 * opener Escape returns to). A hover open records no opener: it must never move
 * focus.
 *
 * See change: add-session-actions-flyout (D6).
 */
import React from "react";

export type SessionMenuSource = "trigger" | "hover" | "contextmenu" | "keyboard";

export interface SessionMenuState {
  /** `folder:<cwd>` | `session:<id>` | null. */
  menuFor: string | null;
  source?: SessionMenuSource;
  /** Viewport pointer position for a right-click open. */
  point?: { x: number; y: number };
  /** Element that had focus when the menu opened (non-hover opens). */
  opener?: HTMLElement | null;
}

export interface SessionMenuScope {
  state: SessionMenuState;
  setState: (next: SessionMenuState) => void;
}

export const SessionMenuScopeContext = React.createContext<SessionMenuScope | null>(null);

export const sessionScopeKey = (sessionId: string) => `session:${sessionId}`;

/** The `SessionList`-owned scope when present, else a private local one. */
export function useSessionMenuScope(): SessionMenuScope {
  const shared = React.useContext(SessionMenuScopeContext);
  const [local, setLocal] = React.useState<SessionMenuState>({ menuFor: null });
  return React.useMemo(
    () => shared ?? { state: local, setState: setLocal },
    [shared, local],
  );
}
