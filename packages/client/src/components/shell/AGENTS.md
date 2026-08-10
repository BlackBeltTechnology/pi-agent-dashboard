# DOX — packages/client/src/components/shell

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `LandingPage.tsx` | Onboarding landing screen. Three-step gated flow: credentials → pin folder → spawn session; step states… → see `LandingPage.tsx.AGENTS.md` |
| `MobileActionMenu.tsx` | Kebab session-action menu for mobile. Rows: rename, hide/unhide, resume/fork, OpenSpec… Native-editor rows removed (change: remove-external-editor-integration). → see `MobileActionMenu.tsx.AGENTS.md` |
| `MobileOverlay.tsx` | Mobile sidebar overlay (`md:hidden`): fixed backdrop + left 72-width panel. Exports `HamburgerButton` (menu trigger) and `MobileOverlay`. |
| `MobileShell.tsx` | Two-panel mobile shell (list + detail) with CSS-transform slide transitions and `useSwipeBack` (finger-tracked transform). Depth 0=list, 1=detail, 2=preview reuses detail panel. Exports `MobileShell`. |
| `ResizableSidebar.tsx` | Drag-to-resize + collapse sidebar shell. Takes `SidebarState` (from `useSidebarState`). Clamp width 180–500px. Collapsed strip width 28px. Exports `ResizableSidebar`. |
| `StatusBar.tsx` | Working-status label ONLY; null when idle. Model row retired; model/thinking moved to composer toolbar → see `StatusBar.tsx.AGENTS.md`. See change: redesign-prompt-input. |
