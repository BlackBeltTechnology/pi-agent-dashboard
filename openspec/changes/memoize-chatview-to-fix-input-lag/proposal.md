## Why

Typing in the command input of a long-running session lags badly (measured ~131 ms of main-thread block per keystroke). A Chrome performance trace of a live session (`localhost:8000/session/019f41d8-…`) shows the browser main thread pegged at ~100 % (102.3 s busy of 102.6 s), with 23.5 s spent in Layout across 7 670 full-tree layout passes (~7 000 DOM objects each). Root cause: the per-session chat-input draft state lives at the top of `App`, so every keystroke calls `setDrafts` → the whole `App` re-renders → `ChatView` (which is NOT memoized) re-renders its entire transcript → Chrome runs a full layout of the ~7 000-node message tree. Each keystroke fires keypress + textInput + input dispatches, so the ~47 ms layout cost is paid three times.

The server/replay layer is already size-safe (`truncateToolResultForReplay` + client `truncateOutputForDisplay` cap tool output to 200 lines), so this is purely a client render problem. It worsens linearly with session length because a longer session means a larger rendered DOM, making every avoidable re-layout more expensive.

## What Changes

- Wrap `ChatView` in `React.memo` so a parent (`App`) re-render caused by unrelated state (chat-input draft typing) skips the transcript re-render when `ChatView`'s props are referentially unchanged.
- Stabilize the four `ChatView` props that are currently created fresh on every `App` render, so the memo actually holds:
  - `pendingSteering` — currently `?? []` (new array each render) → reuse a module-level frozen `EMPTY_STEERING` constant, mirroring the existing `EMPTY_IMAGES` pattern in `App.tsx`.
  - `onCollapseStreamingThinking` — inline arrow → `useCallback` (deps: `selectedId`, `setSessionStates`).
  - `onForkFromMessage` — inline arrow → `useCallback` (deps: `selectedId`, `handleResumeSession`).
  - `onCloseInlineTerminal` — inline arrow → `useCallback` (deps: `selectedId`, `handleCloseInlineTerminal`).
- Preserve `forwardRef`: apply the memo as `React.memo(forwardRef(...))` so the existing `ChatViewHandle` ref API keeps working.

The remaining `ChatView` props are already stable and need no change: `sessionId` (string), `state` (`useMemo`), `toolContext` (`useMemo`), `loadingHistory` (boolean), and the `onRespondToUi`/`onAbort`/`onForceKill` handlers (all `useCallback` with stable deps; the underlying `send` is `useCallback([])`).

Out of scope: transcript virtualization and the large-DOM / GC-pressure problem (47 k nodes, ~190 MB heap). Those are size-driven, not re-render-driven, and are tracked separately. This change targets only the per-keystroke input lag.

## Capabilities

### New Capabilities
- `chat-view-render-performance`: `ChatView` SHALL not re-render its transcript in response to `App` re-renders that do not change any of its props (e.g. chat-input draft typing), and the props passed to `ChatView` SHALL be referentially stable across such re-renders.

### Modified Capabilities
<!-- None: existing chat-view content-rendering behavior is unchanged. -->

## Impact

- Code: `packages/client/src/App.tsx` (add `EMPTY_STEERING` const; convert three inline arrows to `useCallback`), `packages/client/src/components/ChatView.tsx` (wrap export in `React.memo(forwardRef(...))`).
- Behavior: typing in the command input no longer triggers a full transcript re-render/re-layout; per-keystroke main-thread cost drops from ~131 ms toward ~0 in long sessions. No change to rendered output or the `ChatViewHandle` ref API.
- Risk: low — four localized changes plus one wrapper; the only pitfall is preserving `memo(forwardRef())` ordering. No server, protocol, or data-flow impact.
- Verification: React DevTools Profiler shows `ChatView` "Did not render" while typing; existing `ChatView`/`InputRenderer` tests still pass.

## Discipline Skills

- `performance-optimization`: this change is driven by a measured latency budget (per-keystroke main-thread block) — verify the fix against the profiler evidence, not just correctness.
- `code-simplification`: keep the fix surgical (memo + 4 prop stabilizations); avoid over-engineering (no custom `areEqual`, no premature virtualization).
