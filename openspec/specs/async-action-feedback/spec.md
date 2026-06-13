# async-action-feedback Specification

## Purpose

Provide consistent, reusable feedback for user-triggered async actions in the dashboard: a `useAsyncAction` primitive that tracks an action lifecycle, disables its control while pending, optionally holds pending until a correlated WebSocket completion event lands, and surfaces success/info/error toasts. Slow-op REST endpoints echo a correlation `requestId` into their completion broadcast so clients can match the originating action.

## Requirements

### Requirement: useAsyncAction SHALL track an action lifecycle and disable its control

`useAsyncAction(fn, opts)` MUST expose `{ pending, error, run, bind }`. `bind` MUST provide an `onClick` that invokes `run` and a `disabled` value that is `true` while `pending`. The hook MUST set `pending` true synchronously when `run` is invoked and MUST ignore any further `run` invocations while `pending` (no concurrent runs). On failure, the hook MUST set `error` and surface it via the toast system.

#### Scenario: Pending disables the control during a fast action
- **GIVEN** a button bound via `useAsyncAction(fn, { confirm: "http" })`
- **WHEN** the user clicks it
- **THEN** the button becomes `disabled` and `pending` is `true`
- **AND** when `fn()` resolves the button re-enables and `pending` is `false`

#### Scenario: Concurrent runs are ignored
- **GIVEN** an action is already `pending`
- **WHEN** `run` is invoked again
- **THEN** the second invocation is a no-op and only one `fn()` call is in flight

#### Scenario: Failure routes to a toast
- **WHEN** `fn()` rejects
- **THEN** `pending` becomes `false`, `error` is set, and an error-variant toast is shown

### Requirement: WS-confirm mode SHALL hold pending until the correlated effect lands

When `opts.confirm === "ws"`, `pending` MUST remain `true` after `fn()`'s HTTP call resolves and MUST clear only when a `ServerToBrowserMessage` matching the action's echoed `requestId` arrives on the WebSocket bus (matched via `opts.confirmEvent`). A timeout (`opts.confirmTimeoutMs`, default 15000 ms) MUST always clear `pending` and emit an info-variant "still working in the background" toast, so a control can never remain stuck `pending`.

#### Scenario: Pending survives the HTTP ack
- **GIVEN** a restart action with `confirm: "ws"`
- **WHEN** the `POST /api/restart` call resolves with `202`
- **THEN** `pending` stays `true` (the button keeps spinning)
- **AND** when the correlated completion event arrives `pending` becomes `false` and a success toast is shown

#### Scenario: Timeout never leaves a stuck spinner
- **GIVEN** a `confirm: "ws"` action whose completion event never arrives
- **WHEN** `confirmTimeoutMs` elapses
- **THEN** `pending` becomes `false`
- **AND** an info-variant toast "Still working in the background…" is shown

### Requirement: Toast SHALL support success and info variants

`ToastMessage` MUST accept an optional `variant: "error" | "success" | "info"` defaulting to `"error"`. Each variant MUST render with distinct styling (success, info, error). Existing callers that omit `variant` MUST keep current error styling unchanged.

#### Scenario: Success toast on completed action
- **WHEN** a `useAsyncAction` completes and `opts.successToast` is set
- **THEN** a `variant: "success"` toast renders with success styling

#### Scenario: Existing error callers unchanged
- **WHEN** `showToast(text)` is called without a variant
- **THEN** the toast renders with the existing error styling

### Requirement: Slow-op REST endpoints SHALL echo a correlation requestId into their completion broadcast

For each slow operation migrated to `confirm: "ws"`, the originating REST call MUST carry a client-generated `requestId` and the server MUST echo that `requestId` into the WebSocket message it broadcasts when the effect completes. The `requestId` field MUST be additive and optional so clients and bridges that neither send nor read it are unaffected.

#### Scenario: Correlation token round-trips
- **GIVEN** a client sends a slow-op REST call with `requestId: "abc"`
- **WHEN** the effect completes server-side
- **THEN** the broadcast completion message includes `requestId: "abc"`
- **AND** the originating `useAsyncAction` matches it and clears `pending`

#### Scenario: Missing requestId is ignored
- **WHEN** a server-initiated effect completes with no originating `requestId`
- **THEN** the broadcast omits `requestId` and no client action is incorrectly resolved
