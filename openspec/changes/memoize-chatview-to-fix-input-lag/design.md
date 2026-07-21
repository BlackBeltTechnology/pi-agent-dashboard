## Context

A Chrome performance trace of a live long-running session (`localhost:8000/session/019f41d8-…`) was analyzed to explain input lag and high CPU. Findings:

- Main thread busy 102.3 s of a 102.6 s window (~100 %). Layout alone: 23.5 s across 7 670 passes, average ~3.1 ms, each over a tree of ~7 000 layout objects. DOM peaked at 46 918 nodes / 25 827 listeners; JS heap grew to ~190 MB.
- Per-keystroke cost, measured by `EventDispatch` average duration: keypress 47.7 ms, textInput 46.6 ms, input 37.4 ms → ~131 ms of main-thread block per key, i.e. ~7–8 fps while typing.

Data-flow cause (verified in source):

```
type key  →  CommandInput onChange  →  onDraftChange  →  App.setDraftForSelected
          →  setDrafts(Map)                              [App.tsx:937]
          →  App re-renders
          →  <ChatView>  (NOT memoized, forwardRef)      [ChatView.tsx:202]
          →  groupedMessages.map(...)  full transcript re-render
          →  Chrome full Layout of ~7000-node tree  ×3 dispatches
```

The server/replay layer is already size-safe: `truncateToolResultForReplay` (server, `replay-truncate.ts:62`, wired at `subscription-handler.ts:51`) and client `truncateOutputForDisplay` (`event-reducer.ts:748`) both cap tool output to the last 200 lines. So no server work is warranted; the fix is entirely client-side render avoidance.

`ChatView` prop-stability audit (11 props) determined that a plain `React.memo` would NOT help as-is — 4 props get a fresh reference every render. The other 7 are already stable.

## Goals / Non-Goals

**Goals:**
- Eliminate the full-transcript re-render (and its layout pass) on every keystroke in the command input.
- Make `React.memo(ChatView)` effective by stabilizing the 4 currently-unstable props.
- Preserve the `ChatViewHandle` ref API and all current rendered output byte-for-byte.

**Non-Goals:**
- Transcript virtualization (windowing the ~7 000-node list). Deferred — larger, higher-risk, tracked separately.
- Reducing DOM node count / listener count / GC pressure. Those are session-size driven, not re-render driven; unaffected by this change and out of scope.
- Moving the draft state out of `App`. The `setDrafts` → `App` re-render still happens; we only stop it from cascading into `ChatView`.

## Decisions

**Decision 1: `React.memo` around `ChatView`, applied as `React.memo(forwardRef(...))`.**
`ChatView` is defined with `forwardRef` (exposes `ChatViewHandle`). `React.memo` must wrap the `forwardRef` result, not the inner render function, or the ref forwarding breaks. Default shallow prop comparison is sufficient once props are stable (Decision 2) — no custom `areEqual` needed.
- Alternative considered: custom `areEqual` comparator to tolerate unstable props. Rejected — hides the real problem, is error-prone (easy to miss a prop), and the props are cheaply stabilizable instead.
- Alternative considered: move draft state into `CommandInput` (uncontrolled). Rejected for this change — larger blast radius (draft persistence, history recall, image paste all read the lifted state) and higher risk; memoization is the surgical fix.

**Decision 2: Stabilize exactly the 4 unstable props; leave the 7 stable props untouched.**

| Prop | Current | Fix |
|---|---|---|
| `pendingSteering` | `selectedSession?.pendingQueues?.steering ?? []` (new `[]`) | module-level frozen `EMPTY_STEERING`, mirroring existing `EMPTY_IMAGES` (`App.tsx:906`) |
| `onCollapseStreamingThinking` | inline arrow | `useCallback`, deps `[selectedId, setSessionStates]` |
| `onForkFromMessage` | inline arrow | `useCallback`, deps `[selectedId, handleResumeSession]` |
| `onCloseInlineTerminal` | inline arrow | `useCallback`, deps `[selectedId, handleCloseInlineTerminal]` |

Already-stable (no change): `sessionId` (string primitive), `state` (`useMemo`, `App.tsx:894`), `toolContext` (`useMemo`, `App.tsx:1042`), `loadingHistory` (boolean primitive), `onRespondToUi` / `onAbort` / `onForceKill` (all `useCallback` in `useSessionActions.ts`, deps limited to `selectedId` + stable setters + `send`). Underlying `send` is `useCallback([])` in `useWebSocket.ts:89` — permanently stable. `selectedId` does not change while typing, so all `selectedId`-dependent callbacks are stable during a typing burst.

**Decision 3: `EMPTY_STEERING` as a frozen module constant.** Reuse the exact pattern already present for `EMPTY_IMAGES` so `pendingSteering` returns the same reference whenever the session has no steering queue. Consumers treat it read-only.

## Risks / Trade-offs

- [Ref forwarding breaks if memo/forwardRef order is wrong] → apply as `React.memo(forwardRef(fn))`; verify the ref-driven API (`chatViewRef` scroll/imperative calls) still works after the change.
- [A future prop added to `ChatView` reintroduces an unstable reference and silently defeats the memo] → mitigate by keeping all `ChatView` props stable-by-construction and noting the invariant in the spec; the render-performance scenario is the regression guard.
- [Memo masks a needed re-render (stale UI)] → low: the 7 stable props already carry every input that should trigger a re-render (`state` changes on new events, `toolContext`/`sessionId` on session switch). Typing is the only excluded trigger, which is correct.
- [Callback deps churn] → verified: `setSessionStates`/`setSessions` are stable React setters; `handleResumeSession`/`handleCloseInlineTerminal` are `useCallback` from `useSessionActions`; `selectedId` is constant during a typing burst.

## Migration Plan

Pure client refactor, no data migration. Deploy path: `npm run build` + `POST /api/restart` (production) or Vite HMR (dev). Rollback = revert the two-file diff; no persisted state or protocol change.

## Open Questions

- None blocking. Follow-up (separate change): transcript virtualization to attack the 47 k-node DOM / GC-pressure axis that this change intentionally does not touch.
