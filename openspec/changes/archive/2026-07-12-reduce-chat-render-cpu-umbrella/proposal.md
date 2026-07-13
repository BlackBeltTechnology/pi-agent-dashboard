## Why

A long-chat session page (`/session/<id>`) pegs the browser main thread at ~100 % for **any viewer who opens it** — not only the typing user. A 102.6 s Chrome performance trace of a live session shows 102.3 s main-thread busy, 23.5 s Layout (7 670 passes ≈ **75 layouts/second**), 20.7 s GC, DOM peaking at 46 918 nodes / 25 827 listeners, heap ~190 MB. Inputs stutter, fans spin, and every additional open tab of the same session multiplies the cost.

Trace analysis attributes the burn to four independent layers, each with direct evidence:

1. **Idle animation → per-frame layout (largest constant cost).** In a quiet 6 s window with zero WebSocket traffic and zero typing, the page still ran 511 layout passes (85/s) costing 1.29 s — triggered by 504 `ScheduleStyleRecalculation` / 499 `InvalidateLayout` events **with no JS stack**, i.e. CSS-animation-driven. Chrome reports non-composited (main-thread) animations animating `width` (21×), `background-position-x` (7×), `background-color` (4×), `color` (4×), `box-shadow` (2×). 7 185 of the 7 670 layout passes are small-dirty (10–99 objects) yet cost 20.5 s of the 23.5 s total, because each invalidation walks the ~7 000-object layout tree. Paint records show tall off-screen strips (868×3732) repainted ~58×/s.
2. **DOM size multiplies everything.** The transcript is fully materialized (no virtualization anywhere in `packages/client`): ~47 k nodes / ~7 000 layout objects make every layout pass ~3.1 ms and drive GC (20.7 s) and paint cost. This layer is the multiplier on layers 1, 3, and 4.
3. **WS event bursts re-render per event.** `useMessageHandler` calls `setSessionStates` per incoming `event` message (`useMessageHandler.ts:296` — live `case "event"`) with no batching/coalescing; the trace shows bursts up to 221 WS messages per 5 s window, each triggering a full un-memoized `ChatView` re-render (bucket JS cost up to 3.2 s / 5 s).
4. **Keystroke → full transcript re-render.** ~131 ms main-thread block per key (keypress 47.7 ms + textInput 46.6 ms + input 37.4 ms). Already proposed separately as change `memoize-chatview-to-fix-input-lag`; the umbrella tracks it as Phase 4 and does not duplicate it.

The server/replay layer is already size-safe (`truncateToolResultForReplay` + client `truncateOutputForDisplay`) — no server work in scope.

## What Changes

Priority-ordered phases (by ROI: impact ÷ risk):

- **Phase 1 — Stop idle layout churn (high impact, low effort).** Audit every running animation in the chat page and make them compositor-only or gated:
  - Replace/eliminate animations of layout-affecting properties (`width`) and paint-heavy properties (`background-color`, `color`, `box-shadow`, `background-position-x`) with `transform`/`opacity` equivalents where the effect is decorative.
  - Gate liveness animations (`tool-group-shimmer`, `tool-group-spin-pulse`, `chat-stream-glow-pulse`, spinners, neon card FX) so they run **only while their element is on-screen** (IntersectionObserver or `content-visibility`-based pausing) and only while the state they signal is actually active.
  - Acceptance: a quiet (no-typing, no-WS) long-session tab shows ~0 layout passes/second in a performance trace.
- **Phase 2 — Virtualize the transcript (high impact, higher effort).** Window the message list (e.g. `@tanstack/react-virtual` or `content-visibility: auto` + `contain-intrinsic-size` as a cheaper first step) so off-screen messages cost neither layout nor paint nor listeners. Preserve scroll anchoring, auto-scroll-to-bottom, scroll-lock behavior (existing `chat-scroll-lock` spec), and "jump to message" flows.
- **Phase 3 — Coalesce WS event application (medium impact, medium effort).** Batch `event` messages arriving in the same tick/frame into a single `setSessionStates` application (queue + `requestAnimationFrame` or microtask flush), so an N-event burst costs one reducer pass + one render instead of N.
- **Phase 4 — Input-path memoization (folded into this change).** Wrap `ChatView` in `React.memo` and stabilize the 4 unstable props at `App.tsx:1545` (`onForkFromMessage`, `onCloseInlineTerminal`, `onCollapseStreamingThinking` inline arrows → `useCallback`; `pendingSteering ?? []` fresh array → stable empty constant) so keystrokes into the command input no longer re-render the full transcript. Smallest phase; lands first because it unblocks honest measurement of Phase 3 (un-memoized renders otherwise mask batching gains).

Each phase is independently landable and independently verifiable against the trace metrics.

## Capabilities

### New Capabilities
- `chat-idle-render-cost`: an open chat page that is receiving no events and no input SHALL NOT run continuous style/layout work; decorative animations MUST be compositor-only and paused when off-screen or inactive.
- `chat-transcript-virtualization`: the chat transcript SHALL render only the messages near the viewport (plus streaming tail), keeping layout-tree size and listener count bounded regardless of session length, while preserving scroll anchoring and auto-scroll semantics.
- `chat-event-render-batching`: bursts of forwarded session events SHALL be coalesced so that multiple events arriving within one frame produce at most one state application and one render.

### Modified Capabilities
<!-- None: chat-view content rendering, chat-scroll-lock, and chat-display-preferences requirements are unchanged; phases must preserve them. -->

## Impact

- Code: `packages/client/src/index.css` (animation audit), `packages/client/src/components/ChatView.tsx`, `ToolBurstGroup.tsx`, card FX components (Phase 1); `ChatView.tsx` transcript list (Phase 2); `packages/client/src/hooks/useMessageHandler.ts` (Phase 3). No server, protocol, or persistence changes.
- Behavior: idle CPU near zero for open session tabs; per-keystroke and per-event costs decoupled from session length; existing rendered output, scroll behavior, and reduced-motion handling preserved.
- Risk: Phase 1 low (CSS-level, reduced-motion path already exists); Phase 2 highest (scroll anchoring, message-height variability, mermaid/images) — mitigated by the `content-visibility` first step; Phase 3 medium (ordering guarantees of reducer application must hold — events must apply in seq order within a batch).
- Dependencies/sequencing: Phase 4 (`memoize-chatview-to-fix-input-lag`) should land before Phase 3 so batching benefits aren't masked by un-memoized renders. Phase 1 is independent and can land immediately.
- Verification: re-record the same trace scenario after each phase; compare layouts/s (idle), main-thread busy %, EventDispatch latency, and DOM/layout-object counts.

## Discipline Skills

- `performance-optimization`: every phase is driven by a measured budget from the trace (layouts/s idle ≈ 0, per-keystroke block, per-burst render count); verify against re-recorded traces, not intuition.
- `doubt-driven-review`: Phase 2 (virtualization) is the irreversible-feeling structural step — review the scroll-anchoring design before it stands.
- `code-simplification`: prefer `content-visibility`/CSS-level wins over new dependencies where they meet the budget.
