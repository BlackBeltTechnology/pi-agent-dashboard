## Why

On Windows (especially portable / NSIS installer launches from cold disk cache), the Electron app takes 3-8 seconds between double-click and any visible window. During this window the user sees nothing — no splash, no cursor indicator, no taskbar entry — and frequently double-clicks again thinking the launch failed, producing duplicate processes and confusing state.

The same cold-start happens on macOS and Linux to a lesser degree (typically 1-3s) but is still noticeable on first launch after a reboot.

Root cause: `app.whenReady()` in `packages/electron/src/main.ts` runs synchronous + async dependency detection (`detectPi`, `detectOpenSpec`, `detectSystemNode`, `isDashboardRunning`) BEFORE creating any window. No visible UI exists until one of `createWizardWindow()` / `createMainWindow()` completes.

## What Changes

Add a **splash window** that appears within milliseconds of `app.whenReady()` firing, displays the pi logo + a live status indicator, and closes once the next intended window (wizard or main) is ready to show.

### New surfaces

- `packages/electron/src/splash-window.ts` — splash window lifecycle (`createSplashWindow`, `updateSplashStatus`, `closeSplashWindow`).
- `packages/electron/src/splash.html` — self-contained HTML (inline CSS + minimal JS, no bundler). Frameless, transparent, alwaysOnTop. Shows logo, spinner, status line.
- Status updates via `ipcMain → webContents.send("splash:status", text)`.

### Modified surfaces

- `packages/electron/src/main.ts` — `app.whenReady()` handler:
  - Call `createSplashWindow()` FIRST (before any detection).
  - Emit `updateSplashStatus(...)` before each detection / launch phase.
  - Transfer to wizard or main window via `ready-to-show` event, then `closeSplashWindow()`.

### Status messages (user-visible)

Minimum viable set:

```
"Starting…"                           (initial, from splash.html default)
"Checking Node.js…"                   (detectSystemNode)
"Detecting pi agent…"                 (detectPi)
"Checking OpenSpec…"                  (detectOpenSpec)
"Checking dashboard server…"          (isDashboardRunning)
"Opening setup wizard…"               (if deps missing)
"Launching dashboard server…"         (if server not running)
"Opening dashboard…"                  (final transition)
```

If any phase takes > 2s, the spinner remains animated and the status line reassures the user work is in progress.

### Out of scope

- Progress bars or percentages (status text is sufficient and honest).
- Persistent splash on subsequent launches after first-run (splash shows on every launch; cost is near-zero and UX is consistent).
- Custom splash animations beyond a simple CSS spinner.
- Configurability (splash is always on; if a user doesn't want it they can't opt out — this is an end-user UX feature, not a developer preference).

## Impact

### Specs affected

- `electron-shell` — new requirements for splash-window lifecycle + status progression.

### Code surface

- **New files:** `splash-window.ts`, `splash.html` (both tiny — `<100` lines total).
- **Edited:** `main.ts` (~15 lines of insertions in `app.whenReady()`).
- **Bundled:** `splash.html` needs to ship in the packaged app. `forge.config.ts` `extraResources` already picks up `src/**/*.html`; verify explicitly.

### Risk

Very low. The splash window is additive — if `createSplashWindow()` throws, the rest of `main.ts` still proceeds (wrap in try/catch, log). Worst case: users see the current black-hole behavior if the splash itself fails to render.

### Migration / rollback

None required. Purely additive new window, no state persisted, no user-facing config.
