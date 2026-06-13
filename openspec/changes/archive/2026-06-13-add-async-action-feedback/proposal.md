## Why

Most user-triggered actions in the dashboard give no feedback during the gap between the click and the effect. The action fires a `fetch()`, the HTTP call returns (often just an "accepted" ack), and the real result lands seconds later via a WebSocket broadcast. During that window the UI shows nothing — no spinner, no disabled control, no confirmation. The user clicks, sees silence, then "several seconds later the thing happens."

The codebase already contains the *good* pattern and the *bare* pattern side by side:

- **Gold standard** — `WorktreeInitButton.tsx` runs a `phase: "idle" | "running" | "failed"` FSM, disables the button while running, swaps its label to "Initializing…", streams a live tail, and renders a failure card. The user always knows the state.
- **Bare case** — `TunnelButton.handleConnect/handleDisconnect` does `await fetch(...)` with an empty `catch {}` and no pending state at all. Click → silence → status refreshes eventually. Many of the ~20 `lib/*-api.ts` callers (restart, provider-auth delete, tunnel connect/disconnect, etc.) are shaped this way.

This is a consistency problem, not a missing-capability problem. Every building block already exists:

- inline pending FSM (`WorktreeInitButton`),
- a toast system (`useToast` / `Toast.tsx`),
- a pub/sub WebSocket layer (`useWebSocket` `handlersRef` fans every `ServerToBrowserMessage` to registered handlers),
- effect-correlation tokens (`spawn-correlation-token`: `spawn_session { requestId }` echoed back on `session_added.spawnRequestId` / `spawn_result.requestId` / `spawn_error.requestId`).

The bare cases just never composed them. This change extracts a single reusable primitive that codifies the proven pattern so the bare cases get first-class feedback without per-component reinvention.

## What Changes

- **NEW**: `useAsyncAction` hook in `packages/client/src/hooks/`. Wraps an async action and exposes `{ pending, error, run, bind }`. Tracks an `idle → pending → success | error` lifecycle, auto-disables the bound control, and routes outcomes to the toast system. Two completion modes:
  - `confirm: "http"` (default, fast ops) — `pending` ends when `fetch()` resolves.
  - `confirm: "ws"` (slow ops) — `pending` ends when a correlated `ServerToBrowserMessage` arrives (matched by a `requestId` echoed back), with a timeout fallback that ends `pending` and emits a "still working…" toast.
- **NEW**: `Toast.tsx` / `useToast` gain a `variant: "error" | "success" | "info"` field. Today the toast is red-only (`bg-red-900`); success/info variants get distinct styling. Default behaviour and existing error callers are unchanged (variant defaults to `"error"`).
- **NEW**: a small `<ActionButton>` convenience wrapper (optional sugar over `useAsyncAction.bind`) for the common "button that fires one action" case — spinner/label-swap + disable baked in.
- **CHANGED**: migrate the bare call sites to `useAsyncAction`, starting with the worst offenders (`TunnelButton` connect/disconnect, `SettingsPanel`/`PluginsSection` restart, `ProviderAuthSection` delete). `WorktreeInitButton` is left as-is (it already has a richer streaming UI) but documented as the reference the hook generalizes.
- **NEW**: generalize the `spawn-correlation-token` pattern — add an optional echoed `requestId` to the other slow-op REST endpoints + their WebSocket completion broadcasts so `confirm: "ws"` has a real signal to wait on (scoped to the slow ops actually migrated in this change, not a blanket protocol change).

## Capabilities

### Added Capabilities

- `async-action-feedback`: defines the `useAsyncAction` lifecycle contract, the http/ws completion modes, the toast-variant requirement, and the correlation-token requirement for ws-confirmed actions.

## Impact

- `packages/client/src/hooks/useAsyncAction.ts` — new hook.
- `packages/client/src/components/Toast.tsx` — add `variant` field + success/info styling; `useToast` signature gains optional variant.
- `packages/client/src/components/ActionButton.tsx` — new optional wrapper.
- `packages/client/src/components/TunnelButton.tsx`, `SettingsPanel.tsx`, `PluginsSection.tsx`, `ProviderAuthSection.tsx` — migrate bare handlers to `useAsyncAction`.
- `packages/shared/src/browser-protocol.ts` — additive `requestId` echo on the slow-op completion messages migrated here (additive; old clients ignore the field).
- `packages/server/src/...` — echo the `requestId` from the originating REST call into the matching WS broadcast for the migrated slow ops.
- `docs/file-index-client.md` — rows for the new hook + ActionButton.
- `docs/architecture.md` — short subsection on the async-action feedback contract.

Rollback considerations:

- The hook and toast-variant changes are additive; existing error toasts and untouched components keep current behaviour.
- `confirm: "ws"` degrades safely: if the correlated event never arrives, the timeout fallback always clears `pending` so a button can never get stuck spinning.
- Protocol `requestId` echo is additive and optional; bridges/clients that don't send or read it are unaffected.
- Migration is incremental — each call site is an independent edit; partial adoption is valid.
