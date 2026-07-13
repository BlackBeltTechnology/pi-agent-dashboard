# Phase 1 — animation audit findings (task 2.1)

Static source audit of `packages/client/src/index.css` + component call sites,
cross-referenced against the trace offenders (design.md). The **live DevTools
Animations-panel pass on a running long session** (exact running-instance counts
+ before/after idle trace) is deferred to ship-time manual QA (task 2.8).

## Non-composited property offenders → source + fix

| Trace offender | Pinned source | Fix (task) | Status |
|---|---|---|---|
| `width` ×21 | `TokenStatsBar.tsx` context-usage stacked bar: up to 5 segments each `className="h-full transition-all"` with inline `width: N%`. `transition-all` tweens `width` (layout) on every token update. Renders in `StatusBar` (chat page) + cards. | Drop `transition-all` → segments snap; width no longer animates (2.2). | ✅ done |
| `background-color` ×4 | Same `transition-all` on the bar segments also tweens the inline `backgroundColor` (gradientColor) on value change. | Removed with the same `transition-all` drop (2.2). | ✅ done |
| `background-position-x` ×7 | `@keyframes tool-group-sweep` (`background-position 160%→-60%`), used by `.tool-group-shimmer::after` (running tool-group header) and `.chat-stream-live::after` (streaming bubble). | Re-implemented as compositor-only `transform: translateX(-100%→100%)` on the full-bleed pseudo; dropped `background-size`; added `will-change: transform`. Timing 1.6s linear infinite unchanged (2.3). | ✅ done |
| `box-shadow` ×2 | `@keyframes openspec-stepper-pulse-current` (`box-shadow 3px→5px`), on `.openspec-stepper-node-current`. | Converted to opacity cross-fade of two pre-painted box-shadow rings (base ring static on node; larger static ring on `::after`, `opacity 0→1`), reusing the `chat-stream-glow-pulse` pattern (2.4). | ✅ done |
| `color` ×4 | Not a page-owned `@keyframes` in `index.css`. Closest is `prompt-edge-pulse` (`border-left-color`), but it runs **only transiently while a prompt is "sending"**, not during idle — so it is not an idle-churn offender. Likely the trace's `color` count is Tailwind hover/state `transition-colors` fired during interaction, not continuous. | No idle-relevant page-owned source; left as-is. Re-confirm in the ship-time trace (2.8). | ⏳ verify at ship |

## Visibility/state gating (tasks 2.5, 2.6)

- **2.5** Shared IntersectionObserver (`lib/fx-visibility.ts` + `hooks/useFxVisibility.ts`) toggles `fx-offscreen` (CSS: `animation-play-state: paused` on the element + descendants). Wired to: running tool-group root (`ToolBurstGroup` `GroupFrame`, observed only while `isRunning`), the streaming bubble (`ChatView` `.chat-stream-live`), and animated session cards (`SessionCard` `<li>`, observed only when `isSelected || stripeFxClass`). One shared observer instance.
- **2.6** Completed states already stop their animations by class removal: `.tool-group-shimmer`/`.tool-group-spin-pulse` apply only when `isRunning`; `.chat-stream-live` renders only while `state.streamingText`; neon FX render only when `isSelected`. No `state:running` animation persists on a finished element.

## Reduced motion (task 2.7)

- Existing `prefers-reduced-motion` strips for tool-group / chat-stream FX unchanged (still `animation: none` + `background: none` on the `::after`, valid after the transform rewrite).
- Added a reduced-motion strip for the new `.openspec-stepper-node-current::after` (`animation: none; opacity: 0`).
- The `fx-offscreen` pause rule is orthogonal to reduced motion (paused vs stripped).

## Deferred to ship-time (needs live browser)

- 2.8: record a 30 s idle trace on a real long session → confirm < 5 layouts/s and no non-composited page-owned animations (baseline 85/s).
- Confirm the `color ×4` offender is interaction-only (not idle) in the fresh trace.
