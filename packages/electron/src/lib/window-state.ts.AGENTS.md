# window-state.ts — index

Persists BrowserWindow size/position to `~/.pi/dashboard/window-state.json`. Exports `WindowState` interface, `loadWindowState()` (clamps off-screen coords via `isPointOnAnyDisplay`), `saveWindowState(win)`. `migrateLegacyStateFile()` moves legacy `~/.pi-dashboard/window-state.json` one-shot.
