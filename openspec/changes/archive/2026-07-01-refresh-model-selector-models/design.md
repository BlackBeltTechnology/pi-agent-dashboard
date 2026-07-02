## Context

The status-bar `ModelSelector` is a pure prop consumer: it renders `models` passed from `StatusBar`, which receives `modelsMap.get(selectedId)` from `App`. `App` populates `modelsMap` by sending `request_models` over the browser→server→bridge WebSocket only:

- once as a global one-shot on connect (`globalRefreshRequestedRef`), and
- per-session on first subscribe, gated by `!modelsMap.has(sid)`.

The bridge's `request_models` handler (`packages/extension/src/command-handler.ts`) already does a full re-enumeration on every call: `authStorage.reload()` → `registry.refresh()` → `getAvailable()` → `models_list` push. The `model-refresh` spec documents that the bridge also pushes `models_list` on `credentials_updated` and `onProvidersChanged`. Despite those auto-push paths, a live session's dropdown can still show a stale list (push missed, or the model set changed for a reason without a corresponding push), and there is no manual escape hatch.

## Goals / Non-Goals

**Goals:**
- Give the user a one-click way to re-pull the model list for the current session from inside the dropdown.
- Reuse the existing `request_models` → `models_list` round-trip; no new protocol messages.
- Keep the change client-only and backward-compatible with the registered UI primitive.

**Non-Goals:**
- No changes to the bridge/server enumeration or push logic.
- No polling or automatic periodic refresh.
- No change to how `models_list` updates `modelsMap`.

## Decisions

**1. Trigger via existing `request_models`, not a new message.**
The bridge already re-enumerates on `request_models`. Sending it again for the selected session is the whole mechanism. Rejected: adding a dedicated `refresh_models` message — redundant, and the server/bridge already treat `request_models` as an on-demand fresh pull.

**2. Wire `onRefresh` top-down: App → StatusBar → ModelSelector.**
`App` owns `send()` and `selectedId`, so the handler `() => selectedId && send({ type: "request_models", sessionId: selectedId })` lives there. `StatusBar` forwards it. `ModelSelector` renders the control. Rejected: having `ModelSelector` reach for a context/send directly — it is a presentational primitive and takes callbacks as props everywhere else.

**3. Explicit action bypasses the `!modelsMap.has(sid)` guard.**
That guard only protects the automatic first-subscribe request. The manual handler calls `send` unconditionally, so re-requesting an already-cached session works.

**4. Busy state mirrors the existing `pendingModel` pattern.**
`ModelSelector` already uses a local state + 10s safety-timeout for `pendingModel`. Add an analogous `refreshing` local state: set true on click, cleared when the `models` prop reference changes (new `models_list` landed) or on a short safety timeout. Rejected: threading a global "refreshing" flag through App — unnecessary; the prop-identity change is a sufficient completion signal.

**5. `onRefresh` optional → control conditionally rendered.**
`ModelSelector` is registered as a UI primitive (`main.tsx`). An optional prop keeps existing callers valid; the footer control renders only when `onRefresh` is provided.

## Risks / Trade-offs

- **Completion signal is prop-identity, not an ack** → if the refreshed list is byte-identical, the `models` reference may not change and busy would rely on the safety timeout to clear. Mitigation: the safety timeout (short, e.g. matching existing 10s pattern or shorter) guarantees the control never sticks; a no-change refresh is still visually acknowledged by the spinner window.
- **No session selected / ended session** → handler guards on `selectedId`; the control does not render when `onRefresh` is absent. Mitigation: App only supplies `onRefresh` when a live `selectedId` exists (or the handler no-ops otherwise).
- **Rapid repeat clicks** → multiple `request_models` in flight. Mitigation: disable the control while `refreshing` is true.

## Migration Plan

Pure additive client change. Deploy via the standard client rebuild + server restart (`npm run build` → `POST /api/restart`). Rollback = revert the three edited files; no persisted state or protocol surface changes.
