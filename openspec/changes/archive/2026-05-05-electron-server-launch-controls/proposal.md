## Why

When the Electron app's initial `ensureServer()` attempts fail (e.g. user dismissed the "Run Setup / Retry / Quit" dialog, or a transient bootstrap error), the app falls back to a passive loading page (`packages/electron/src/main.ts:158-198`) that only displays static `npm install` / `pi-dashboard start` copy and polls `/api/health` every 1.5 s. The user is left with no way to **trigger another launch attempt from the UI** — they must quit the app and relaunch, or open a separate terminal. The system tray (`packages/electron/src/lib/tray.ts`) only exposes `Show` / `Quit`, so it cannot help either. This is a real UX gap on Windows where Doctor reports everything healthy but the user is stuck on "Cannot connect to dashboard server".

## What Changes

- Add a **"Start server" / "Retry launch"** primary action button to the Electron loading-page error state that re-invokes `ensureServer()` from the renderer (via a preload-bridged IPC call).
- Add tray menu items **`Start server`** (when no managed server is running) and **`Restart server`** (when one is) above the existing `Show` / `Quit` items.
- Add a secondary **"Open Doctor"** link on the loading-page error state to launch the existing Doctor diagnostic window.
- Surface the **last ~20 lines of `~/.pi/dashboard/server.log`** (when present) inside a collapsible "Server log" panel on the loading-page error state, so users can see *why* the previous launch failed.
- All four entry points share a single, idempotent **`requestServerLaunch()`** routine in the main process that debounces concurrent requests, surfaces structured errors back to the caller, and updates loading-page status text in real time.

Non-goals:
- No change to the bridge-side auto-start flow (`packages/extension/src/server-auto-start.ts`).
- No change to the Doctor diagnostic itself — only adding an entry point to it.
- No new persisted config; behaviour is driven entirely by current runtime state.

## Capabilities

### New Capabilities

(none — all changes extend the existing `electron-shell` capability)

### Modified Capabilities

- `electron-shell`: extends the **Loading page** and **System tray** requirements with user-initiated server-launch actions (Start/Retry button, tray Start/Restart item, Open Doctor link, server.log tail panel) backed by a shared idempotent launch routine.

## Impact

**Code**
- `packages/electron/src/main.ts` — replace inline `data:text/html` loading page with a small loaded HTML resource; add IPC handlers `dashboard:request-launch`, `dashboard:open-doctor`, `dashboard:read-server-log`.
- `packages/electron/src/lib/tray.ts` — add `Start server` / `Restart server` dynamic menu item driven by current `isServerRunning()` probe.
- `packages/electron/src/lib/server-lifecycle.ts` — extract idempotent `requestServerLaunch()` reusing existing `ensureServer()` logic; export `isManagedServerRunning()`.
- `packages/electron/src/preload-loading.ts` (new) — small contextBridge exposing the three IPC channels to the loading page.
- `packages/electron/resources/loading.html` (new) — extracted from inline string; adds button, log panel, Doctor link.

**APIs**
- New Electron-internal IPC channels (`dashboard:request-launch`, `dashboard:open-doctor`, `dashboard:read-server-log`); no public REST/WS surface change.

**Dependencies**
- None added. All work uses existing Electron + Node primitives.

**Compatibility / migration / rollback**
- Backward compatible — additive UI only. No config schema changes.
- Rollback = revert PR; no persisted state to clean up.

**Testing**
- Unit: pure helpers in `server-lifecycle.ts` (debounce + idempotency contract).
- E2E (existing `qa/` harness): manual verification via `make manual-linux-x86` clicking the new button after killing the server.
