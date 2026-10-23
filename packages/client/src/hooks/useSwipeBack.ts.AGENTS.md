# useSwipeBack.ts — index

iOS-style left-edge swipe-back gesture. Touch listeners decide horizontal vs vertical after 10px, triggers `onBack` past `threshold` of screen width. Returns `containerRef` + `swipeState` (`offset`, `swiping`). Exports `useSwipeBack`, `SwipeBackOptions`.

See change: keep-oversized-chat-selection (D6) — yields to a held text selection. `hasPageTextSelection()` is true for a non-collapsed `getSelection()` whose `document.activeElement` and anchor are NOT inside `input`/`textarea`/`[contenteditable]`. `touchstart` does not start tracking while one exists; every `touchmove` checks it FIRST (before direction is decided and before any `preventDefault`) and fully resets (`trackingRef`/`decidedRef`/`isHorizontalRef` false, offset 0, `swiping: false`), so `touchend` never calls `onBack`. Reads the global selection — no coupling to ChatView.
