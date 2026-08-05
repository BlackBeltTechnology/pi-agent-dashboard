# Tasks

## 1. SessionBanner component

- [x] 1.1 Remove the `stopButton` (`error-banner-stop`) and the `onAbort` prop from `SessionBanner`.
- [x] 1.2 Remove `CollapsedRetryPill`, the `collapsed`/sticky-collapse state (`useState`, `useRef`, the reset `useEffect`), and the collapsed-pill early return.
- [x] 1.3 Remove the collapse control from `ExpandedActions` (drop `error-banner-collapse`, `stopButton`, `retrying`, `onCollapse` params) — leaving show-more + Copy.
- [x] 1.4 Drop now-unused imports (`mdiChevronDown`, `mdiChevronUp`, `mdiStop`, `ReactNode` if orphaned) and refresh the component doc comment.
- [x] 1.5 In `App.tsx`, remove `onAbort={handleAbort}` from the `SessionBanner` mount and update the adjacent comment.

## 2. Tests

- [x] 2.1 Update `SessionBanner.test.tsx`: drop the stop/collapse/expand/sticky-collapse cases; keep single-card composition, retry status sub-line, and settled-dismiss.
- [x] 2.2 `npm test` green. (SessionBanner suite 14/14; the 28 repo failures are pre-existing pi-ai-shape / faux-session / fs-watch / ModelSelector, unrelated to this change.)

## 3. Build & verify

- [x] 3.1 `npm run build` (client) succeeds.
- [x] 3.2 `review-code` pass on the diff (net-negative removal; status + auto-clear + settled-dismiss retained).
