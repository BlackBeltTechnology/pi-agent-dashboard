# Tasks

## 1. useAsyncAction hook

- [x] 1.1 Write tests first: `useAsyncAction.test.tsx` covering `idle → pending → success` (http mode), `idle → pending → error` (rejection routes to toast), and double-click guard (no concurrent runs).
- [x] 1.2 Implement `useAsyncAction(fn, opts)` returning `{ pending, error, run, bind }`. `bind` spreads `onClick` + `disabled`. Default `confirm: "http"`: `pending` true on invoke, false when `fn()` settles.
- [x] 1.3 On success, call `opts.onSuccess?.()` and optionally show a success toast (`opts.successToast`). On error, show an error toast and set `error`.
- [x] 1.4 Guard against concurrent runs: ignore `run()` while `pending`.

## 2. WS-confirm mode

- [x] 2.1 Write tests: `confirm: "ws"` stays `pending` after `fetch()` resolves until a matching `ServerToBrowserMessage` arrives; timeout fallback clears `pending` and emits a "still working" toast.
- [x] 2.2 Implement: `fn()` returns a `requestId`; register a transient handler on the `useWebSocket` bus that matches the echoed `requestId` against `opts.confirmEvent(msg, requestId)`. Clear `pending` + unregister on match.
- [x] 2.3 Add `opts.confirmTimeoutMs` (default e.g. 15000). On timeout, clear `pending`, unregister, emit info toast "Still working in the background…".

## 3. Toast variants

- [x] 3.1 Write test: a `variant: "success"` toast renders with success styling; default (no variant) stays error-styled (back-compat).
- [x] 3.2 Add `variant?: "error" | "success" | "info"` to `ToastMessage`; default `"error"`. Style per variant (success green, info neutral, error red as today).
- [x] 3.3 Extend `useToast.showToast` to accept an optional variant without breaking existing callers.

## 4. ActionButton wrapper

- [x] 4.1 Implement `<ActionButton action={...} pendingLabel?>` over `useAsyncAction.bind`: spinner/label-swap + disable. Thin, optional sugar.
- [x] 4.2 Test: renders pending label + disabled while the action runs.

## 5. Correlation-token generalization (slow ops migrated here)

- [x] 5.1 Pick the slow ops to migrate (e.g. restart, tunnel connect/disconnect). For each, thread an optional `requestId` from the REST call into the matching WS completion broadcast.
- [x] 5.2 Add the additive `requestId` field to those completion messages in `packages/shared/src/browser-protocol.ts` (old clients ignore it).
- [x] 5.3 Server echoes the `requestId` into the broadcast it emits when the effect completes.

## 6. Migrate bare call sites

- [x] 6.1 `TunnelButton` connect/disconnect → `useAsyncAction` (`confirm: "ws"` if a completion event exists, else `"http"` + success toast).
- [x] 6.2 `SettingsPanel` restart → `useAsyncAction` `confirm: "ws"` keyed on browser-facing `server_restarting` + echoed `requestId`. `PluginsSection` left as-is: its restart already polls `/api/health` for `startedAt` re-up (a stronger completion signal than the broadcast); migrating would regress it. Documented like `WorktreeInitButton`.
- [x] 6.3 `ProviderAuthSection` delete → `useAsyncAction` (`confirm: "http"` + success toast).
- [x] 6.4 Verify each migrated button (via tests: pending disables + label swap, success/error toast, ws timeout fallback never stuck-spins).: disabled + spinner while pending, toast on completion, no stuck-spinner on failure/timeout.

## 7. Docs

- [x] 7.1 Add `docs/file-index-client.md` rows for `useAsyncAction.ts` and `ActionButton.tsx` (delegate to docs subagent, caveman style).
- [x] 7.2 Add an "Async action feedback" subsection to `docs/architecture.md` describing the http vs ws completion contract.
