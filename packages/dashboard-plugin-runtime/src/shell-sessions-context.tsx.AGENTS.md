# shell-sessions-context.tsx — index

React context exposing shell's `ReadonlyMap<string,DashboardSession>` to plugin claims. Exports `ShellSessionsValue`, `ShellSessionsProvider`, `useShellSession(sessionId)` (strict, throws outside provider), `useShellSessionOrNull(sessionId)` (soft). Used by `<ShellOverlayRouteSlot>` to resolve `DashboardSession` metadata by `config.sessionParam`.
