## Context

Trace: `Trace-20260708T153518.json` (487 MB, 2.07 M events, 102.6 s window) of a live long session (`/session/019f41d8-…`, 768 messages, 6.2 MB JSONL). Key measurements, all derived by sandbox analysis of the trace:

| Metric | Value |
|---|---|
| Main-thread busy | 102.3 s / 102.6 s (~100 %); per-5s buckets 73–126 % (never idle) |
| Layout | 23.5 s, 7 670 passes ≈ 75/s, avg 3.1 ms over ~7 000 layout objects |
| Layout dirty profile | 7 185 passes dirty 10–99 objects → 20.5 s; 486 passes dirty 1k–5k → 3.0 s |
| GC | 20.7 s (93 399 events); heap 81 → 190 MB peak |
| DOM | max 46 918 nodes, 25 827 listeners |
| Quiet window (no WS, no typing, 6 s) | 511 layouts (85/s) = 1.29 s; invalidators: 504 ScheduleStyleRecalculation + 499 InvalidateLayout **with no JS stack** (CSS animations); only 18 React-originated |
| Non-composited animations (Chrome `Animation` events, `unsupportedProperties`) | `width` ×21, `background-position-x` ×7, `background-color` ×4, `color` ×4, `box-shadow` ×2 |
| Paint (quiet window) | 6 270 paints/6 s incl. tall off-screen strips 868×3732 repainted ~58×/s |
| WS bursts | up to 221 messages / 5 s; `useMessageHandler.ts:296` applies one `setSessionStates` per event |
| Typing | keypress 47.7 + textInput 46.6 + input 37.4 ≈ 131 ms block/key (addressed by Phase 4, folded into this change) |
| CPU-sample shares (busy samples) | index chunk 33.2 %, markdown chunk 32.6 %, react-vendor 15.6 % |

Existing protections (verified, no work needed): server `truncateToolResultForReplay` (`replay-truncate.ts:62`, wired `subscription-handler.ts:51`), server `truncateOutputForDisplay` (`server/src/replay-truncate.ts`), `MarkdownContent` already `React.memo` (`MarkdownContent.tsx:371`). Reduced-motion CSS paths exist for the FX classes.

Key insight from the dirty-object profile: the dominant cost is NOT huge relayouts but **many tiny invalidations, each walking a ~7 000-object layout tree**. Two attack angles follow: stop the invalidations (Phase 1, 3) and shrink the tree (Phase 2).

### Corroborating diagnosis (consumed from `lag-dashboard-transcript-rendering`)

An earlier problem-only proposal (now consumed) measured the **mount-time** freeze across three separate large sessions, complementing the single steady-state trace above:

| messages | DOM nodes | total blocking | worst block | mount time | heap |
|---:|---:|---:|---:|---:|---:|
| ~1900 | ~23 000 | ~23 s | ~765 ms | ~28 s | 33 MB |
| ~1300 | ~23 000 | ~29 s | ~723 ms | ~33 s | 40 MB |
| ~1800 | ~31 000 | ~38 s | ~730 ms | ~41 s | 48 MB |

- Main thread blocked ~93 % over a ~41 s mount — can trip the browser "page unresponsive" prompt. DOM nodes grow **linearly** with message count. Reproduces on text-heavy sessions with 0–11 images, so it is CPU/render, not memory or image decode. Directly motivates **Phase 2** (bound the tree).
- **JS data pipeline is cheap** and NOT the cost: `JSON.parse` 7–40 ms, reducer 22–118 ms, burst grouping 0.01–0.28 ms. The cost is DOM construction + per-message renderers (react-markdown parse, Prism highlight, serialized Mermaid), confirming Phase 2 (fewer mounted rows) is the correct lever, not data-pipeline tuning.
- **Keystroke mechanism isolated** (heavier-transcript trace, corroborates Phase 4): worst single task **6.79 s** containing **64 input events processed with no yielding**; inside it React reconcile `FunctionCall` 5.15 s and **forced `Layout` 2.23 s across 84 synchronous layouts** — per-keystroke work scales with mounted DOM size because synchronous React render + browser re-layout traverse the whole tree. This is exactly what Phase 4 (memoize `ChatView`) + Phase 2 (shrink the tree) attack together.

## Goals / Non-Goals

**Goals:**
- Idle long-session tab: ~0 layouts/s, main-thread busy < 5 %.
- Event bursts: one render per frame, not per event.
- Layout/paint cost decoupled from session length (bounded working set).
- Preserve: rendered output, scroll anchoring + auto-scroll (`chat-scroll-lock` spec), reduced-motion behavior, `ChatViewHandle` API, mermaid/image rendering.

**Non-Goals:**
- Server/protocol/persistence changes (replay layer already size-safe).
- Reducing markdown parse cost at build (MarkdownContent is memoized; re-parses only on new content). [Phase 4 keystroke memoization is now IN scope, folded into this change.]
- Electron/webview-specific tuning; this is plain web-client work.
- **Inline full-resolution screenshot cost** (preserved from the consumed `lag-dashboard-transcript-rendering` diagnosis; see deferred follow-up below). Distinct render problem from the four phases here.

**Deferred follow-up (from consumed diagnosis, do NOT lose):** image-heavy `browser` tool results inline full-resolution base64 PNG `image` parts (one heavy session: 56 inline images ≈ 351 MB decoded RGBA, ~858 ms decode). Rendered full-res in `packages/client/src/components/tool-renderers/ToolResultImages.tsx` (CSS constrains display size, NOT the decoded bitmap); each image usually has a sibling text part with the on-disk path, so full-res bytes are inlined redundantly. NOT covered by `@blackbelt-technology/pi-image-fit` (that hooks the agent `read` tool, not screenshots inlined into `browser` results). Scope as its own change (downscale/lazy-decode/thumbnail-with-path) after this umbrella lands.

## Decisions

**Decision 1 — Phase order by ROI: 4 → 1 → 3 → 2.**
Phase 4 (memo, folded into this change) is smallest and unblocks honest measurement of the rest (un-memoized renders otherwise mask Phase 3 gains). Phase 1 is CSS-only and kills the *constant* idle burn every viewer pays. Phase 3 is a contained hook change. Phase 2 is the structural multiplier fix but carries the most behavioral risk, so it lands last with the best cost/benefit data.
- Alternative: virtualization first (fixes the multiplier). Rejected: highest risk first with no quick wins landed; Phases 1+3+4 already cut the recurring costs that users feel.

**Decision 2 (Phase 1) — Compositor-only or removed; visibility-gated where kept.**
- `width`-animating element(s) (Chrome flags 21 running instances): replace with `transform: scaleX()` on a full-width bar (`transform-origin: left`) or remove if decorative. Must locate exact source at implementation time (candidates found in audit: progress/usage bars use static width %, so the running instances likely come from a transition on a live-updating bar — e.g. `ContextUsageBar` fill or similar — the audit task pins it via DevTools Animations panel).
- `background-position-x` shimmer (`tool-group-sweep`): re-implement as a `transform: translateX()` sweep of an oversized pseudo-element (compositor-friendly) instead of `background-position`.
- `background-color`/`color`/`box-shadow` pulses: convert to opacity cross-fades of pre-painted layers (pattern already used by `chat-stream-glow-pulse`'s static box-shadow + opacity — replicate it for the remaining offenders).
- Gating: liveness FX (`tool-group-shimmer`, `spin-pulse`, neon `card-glow-fx`/`card-ring-fx` 13 s rotations) get an `IntersectionObserver`-driven class (e.g. `fx-offscreen`) that sets `animation-play-state: paused`. Cheap, no DOM restructuring. Animations also MUST be conditional on active state (a done tool group must not keep its shimmer node mounted).
- Alternative: `content-visibility: auto` on message blocks would also stop off-screen animation work. It is Phase 2's first step; Phase 1 stays CSS/observer-level so it can land without scroll-anchoring analysis.

**Decision 3 (Phase 2) — Two-step virtualization: `content-visibility` first, windowing only if needed.**
- Step A: `content-visibility: auto` + `contain-intrinsic-size` estimate on per-message wrappers. Keeps React tree unchanged (no unmount churn, `ChatViewHandle`/scroll code untouched); browser skips layout+paint for off-screen messages, shrinking the effective layout tree from ~7 000 objects to the viewport slice. Risks: scroll-anchor jumps from bad intrinsic-size estimates; `overflow-anchor` interplay — mitigated by measuring real average message heights and re-testing the `chat-scroll-lock` scenarios.
- Step B (only if Step A misses the budget): true windowing (`@tanstack/react-virtual`), which also fixes the 47 k DOM nodes / 25 k listeners and GC pressure. Higher risk: variable heights (mermaid, images, collapsed groups), bottom-anchored reverse scrolling, find-in-page loss for unmounted rows.
- Acceptance gate between steps: re-trace after Step A; if idle busy < 5 % and per-event render < 16 ms at p95, Step B is deferred to its own change.

**Decision 4 (Phase 3) — Frame-coalesced event application in `useMessageHandler`.**
Queue incoming `event` payloads per session; flush once per animation frame (or microtask when tab hidden): single `setSessionStates` that folds the queued events through `reduceEvent` in seq order. Invariants: (a) strict seq order preserved within a flush; (b) `maxSeqMapRef` updated to the batch max; (c) interactive-request side-effects (ask_user etc.) still fire per event during the fold; (d) replay path (`event_replay`) already batches — only the live `case "event"` changes. React 18's automatic batching already merges same-tick `setState`s, but WS messages arrive in separate macrotasks, so explicit queueing is required.
- Alternative: throttle in the server/bridge. Rejected: client-only concern; server batching would add latency for all clients and touch protocol.

**Decision 5 — Verification is trace-diff, not vibes.**
Each phase re-records the same scenario (open long session, idle 30 s, receive burst, type 20 chars) and compares: layouts/s idle, main-thread busy %, renders per WS burst, EventDispatch p95. The budget numbers live in the spec scenarios.

## Risks / Trade-offs

- [Phase 1: shimmer re-implementation changes visuals subtly] → side-by-side visual check; keep timing/easing identical; reduced-motion path untouched.
- [Phase 1: IntersectionObserver per message-group adds bookkeeping] → one shared observer instance, class toggle only; measure observer cost in re-trace.
- [Phase 2A: `content-visibility` scroll-anchor jumps] → tune `contain-intrinsic-size` from measured message heights; verify all `chat-scroll-lock` scenarios; feature-flag rollback (single CSS class).
- [Phase 2B: windowing breaks bottom-anchored UX or `ChatViewHandle`] → only entered if Step A fails its gate; separate change with its own spec deltas.
- [Phase 3: reordering or side-effect loss in coalesced fold] → unit tests: N-event burst ⇒ identical final `SessionState` to sequential application; ask_user prompt still surfaces mid-batch.
- [Phase 3: rAF starvation when tab backgrounded] → fall back to `setTimeout(0)`/microtask flush when `document.hidden`.
- [Cross-phase: regressions masked by landing order] → land 4 → 1 → 3 → 2 with a re-trace at each boundary; keep per-phase revert possible (no phase depends on a later one).

## Migration Plan

Pure client changes; deploy per phase via `npm run build` + `POST /api/restart`. Rollback = revert the phase's diff. No data or protocol migration. Phase 2B (if ever needed) becomes its own follow-up change with delta specs against `chat-transcript-virtualization`.

## Open Questions

- Exact DOM source of the 21 `width`-animating instances — pinned during Phase 1 audit task (DevTools Animations panel on the live page); candidates: live-updating usage/progress bars with width transitions.
- Whether `bootstrap-autofill-overlay.js` (a browser-extension content script visible in the trace: MutationObserver work on every DOM change) contributes materially for end users — out of our control, but worth noting in verification traces recorded in a clean profile.
- Does the sidebar (session cards with neon FX) share the burn on the session page, or is it chat-panel-only? Phase 1 audit measures both; gating applies wherever the FX classes render.
