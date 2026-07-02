## Why

The status-bar model selector's list is populated once per session (global one-shot on connect, then per-session only when `modelsMap` has no entry) and never re-pulled while a session stays live. When the available models change mid-session — a provider is authenticated, an API key is added, or a custom endpoint is registered — the dropdown keeps showing the stale list until the page reloads or a new session starts. Users have no way to force a fresh pull from the running session.

The bridge already re-enumerates models on demand: `request_models` calls `authStorage.reload()` → `registry.refresh()` → `getAvailable()` and pushes a fresh `models_list`. The gap is purely on the client — nothing lets the user trigger that re-request from the selector.

## What Changes

- Add a refresh control in the model selector dropdown footer that re-requests the model list for the currently selected session.
- Wire the control through `StatusBar` to a handler in `App` that sends `request_models` for the selected session — an explicit user action that intentionally bypasses the `!modelsMap.has(sid)` "fetch once" guard.
- Show a transient busy/spinner state on the control until the resulting `models_list` arrives (or a short timeout elapses), reusing the existing `models_list` update path.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `model-selector`: add a requirement for a user-initiated refresh control in the dropdown that re-requests the per-session model list.

## Impact

- `packages/client/src/components/ModelSelector.tsx` — new optional `onRefresh` prop + footer refresh button with busy state.
- `packages/client/src/components/StatusBar.tsx` — forward `onRefresh` to `ModelSelector`.
- `packages/client/src/App.tsx` — pass `onRefresh` that sends `{ type: "request_models", sessionId: selectedId }`.
- No server or bridge changes: `request_models` already triggers a fresh enumeration and `models_list` push (see `model-refresh` spec).
- `ModelSelector` is registered as a UI primitive (`main.tsx`); the new prop is optional and backward-compatible.
