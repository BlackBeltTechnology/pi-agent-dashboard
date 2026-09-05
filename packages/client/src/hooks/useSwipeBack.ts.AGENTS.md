# useSwipeBack.ts — index

iOS-style left-edge swipe-back gesture. Touch listeners decide horizontal vs vertical after 10px, triggers `onBack` past `threshold` of screen width. Returns `containerRef` + `swipeState` (`offset`, `swiping`). Exports `useSwipeBack`, `SwipeBackOptions`.
