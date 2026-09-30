# history-back.ts — index

Exports `goBack(navigate, currentRoute, tracker)` — depth-aware mobile/overlay back action. Replaces `goBackOrHome`. Hybrid: predecessor depth `<` current depth → `window.history.back()` + `tracker.popNav()`; else `navigate(computeBackTarget(currentRoute))`. Depth 0 → no-op. Cold-load/deep-link (no predecessor) → depth-navigate. `BackTracker` interface = `{ predecessor(), popNav() }`. See change: fix-mobile-back-depth-aware (replaces overlay-url-routing `goBackOrHome`).

`returnTo(navigate, target, tracker)` — overlay dismissal without history growth. Tracked predecessor url === target → `history.back()` + `popNav()`; else `navigate(target, { replace: true })`. Never pushes. Used by App `dismissOverlay`. See change: fix-overlay-dismiss-flip-loop.
