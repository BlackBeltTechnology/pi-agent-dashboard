## Why

Three independent chat-layout defects, each with a single-surface fix. They share no code but one user-facing theme: the chat transcript shows jumps, blank areas or covered content.

- **#1100** — On desktop, a collapsed `ToolBurstGroup` re-expands in full whenever a new tool call joins it (`autoOpen = … isRunning`, `ToolBurstGroup.tsx:189`). A 47-row burst mounts all rows at once inside one virtualized row, then collapses again when the tool ends. The chat visibly flashes and jumps, and the cost scales with burst size.
- **#1083** — Two surfaces leave blank space: the inline subagent inspector (`MinimalChatView` `inline` mode is a fixed `h-[60vh]` box, `MinimalChatView.tsx:422`) and the virtualizer's pre-measure estimate for collapsed-first rows (a collapsed burst estimates a flat 220 px against a ~30 px header (claimed web-search rows, 160–400 px estimated, are normally absorbed into a burst; see design D4)).
- **#1084** — The canvas chip tray is a `fixed` overlay anchored to the viewport's right edge (`CanvasDriver.tsx:178-183`). It paints over the editor pane, the chat scrollbar, the transcript's last row and the composer dock's edge, and covers the newest message on mobile. Archived `2026-10-12-fix-canvas-chip-tray-overlay` chose this design (see design.md for why it is a gap in that change, not a code regression).

## What Changes

- **#1100 (chat-view):** a running burst auto-expands only while it is small (≤ N visible members, `N = 8`). A larger burst stays collapsed with its live header and stop control; the user can still expand it. This bounds the height jump. Decided by the owner 2026-11-03 (design D1: size cap, 8).
- **#1083a (minimal-chat-view):** inline `MinimalChatView` sizes to its content, capped at `max-h-[60vh]`, instead of a fixed `h-[60vh]`. Popout stays `h-full`. Decided 2026-11-03 (design D3).
- **#1083b (chat-transcript-virtualization):** the pre-measure estimate for a collapsed-by-default burst row matches its collapsed header height (was a flat 220 px). Estimate stays a pure O(1) function with an unchanged signature. Claimed custom-entry rows are normally absorbed into a burst, so they get no separate estimate path (design D4).
- **#1084 (auto-canvas):** the live composer column gets a content-height chip slot directly above the composer dock, aligned to the dock's `mx-5` insets. `CanvasDriver` renders the tray into that slot instead of a viewport-fixed overlay. The tray therefore stays inside the chat column (never over the editor pane or scrollbar) and the transcript shrinks to make room (never covered). With no live composer the tray keeps today's safe-area overlay fallback. `useAnchorBottom` (ResizeObserver/MutationObserver positioning) is deleted. Decided 2026-11-03 (design D5: in-column slot). The slot drops the sentinel's `aria-hidden`; the dock's Hide handle gets a gap; the scroller re-pins to the bottom via one `ResizeObserver` (D6). `docs/architecture.md` is updated to match.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `chat-view`: running-burst auto-expand is bounded by size (two requirements: "Running bursts group live, auto-expanded, with an honest count" and "A display preference controls the tool-group default collapse state").
- `minimal-chat-view`: inline mode sizes to content with a viewport cap ("Inline and popout modes" scenario of the layout-modes requirement).
- `chat-transcript-virtualization`: "Content-aware pre-measure row-height estimate" gains the collapsed burst row.
- `auto-canvas`: "Canvas chip tray floats above the composer without affecting layout" is renamed and rewritten to an in-column slot.
- `composer-dock`: "Dock replaces the composer strip in other capabilities" — scenario "Canvas chip tray anchor" reworded for the slot.
- `shared-timeline-view`: "Shared timeline renderer lives in client-utils" — scenario "Three modes adjust layout" states the inline cap on the root (it said body).

## Impact

- `packages/client/src/components/chat/ToolBurstGroup.tsx` (auto-open rule)
- `packages/client-utils/src/minimal-chat/MinimalChatView.tsx` (+ its test, + `AGENTS.md` row)
- `packages/client/src/lib/chat/chat-virtual-rows.ts` (burst estimate), `packages/client/src/components/chat/ChatView.tsx` (one `ResizeObserver` re-pin on scroller shrink)
- `packages/client/src/App.tsx` (anchor sentinel → chip slot), `packages/client/src/components/canvas/CanvasDriver.tsx`, `CanvasServerChip.tsx`
- Tests: `ToolBurstGroup.test.tsx`, `MinimalChatView.test.tsx`, `chat-virtual-rows.test.ts` (burst assertion changes; the `custom` → 400 assertion is kept), `CanvasDriver.test.tsx`, `tests/e2e/canvas-chip-tray-overlay.spec.ts`, `docs/architecture.md` (`composer-stack-anchor` row, via DocScribe)
- Client-only. Rebuild with `npm run build` + restart. No server, protocol or persistence change. Rollback: revert.

## Discipline Skills

- `systematic-debugging` — #1100 and #1083b root causes are code-verified as *contributing* but the visible flash / persistent blank space is not provable from source; tasks 1.15 and 3.1 reproduce before fixing.
- `performance-optimization` — #1100 bounds mount cost of a large burst; #1083b changes virtualizer estimates (scroll-drift risk, see `fix-chat-scroll-to-top-estimate-drift`).
- `review-code` — standard pre-commit checkpoint.
- `react-expert` spawn checkpoint — ≥3 React components touched (`ToolBurstGroup`, `MinimalChatView`, `App`, `CanvasDriver`, `ChatView`).

`security-hardening`, `observability-instrumentation`, `doubt-driven-review` do not apply: no auth, untrusted input, endpoint or irreversible step.

Fixes #1100
Fixes #1083
Fixes #1084
