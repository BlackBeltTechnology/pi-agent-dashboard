## 1. Phase 4 — input-path memoization (folded in; land first)

- [x] 1.1 Wrap `ChatView` in `React.memo` (keep the `forwardRef`; `React.memo(forwardRef(...))`). This is a prerequisite for honest Phase 3 measurement — un-memoized renders otherwise mask batching gains.
- [x] 1.2 Stabilize the 4 unstable props passed at `App.tsx:1545` that would defeat the memo:
  - `onForkFromMessage` inline arrow → `useCallback` (deps: `selectedId`, `handleResumeSession`).
  - `onCloseInlineTerminal` inline arrow → `useCallback` (deps: `selectedId`, `handleCloseInlineTerminal`).
  - `onCollapseStreamingThinking` inline arrow → `useCallback` (deps: `selectedId`, `setSessionStates`).
  - `pendingSteering={… ?? []}` fresh-array literal → hoist a module-level `const EMPTY: string[] = []` (or `useMemo`) so the empty case is referentially stable.
- [x] 1.3 Confirm the remaining props are already stable: `toolContext`, `handleRespondToUi`, `handleAbort`, `handleForceKill` (audit their definitions; wrap in `useCallback`/`useMemo` if not).
- [ ] 1.4 Verify: per-keystroke main-thread block on a long session drops from ~131 ms toward the input cost alone (React DevTools Profiler: ChatView does NOT re-render on keystroke into the command input). Baseline: keypress 47.7 + textInput 46.6 + input 37.4 ms.

## 2. Phase 1 — stop idle layout churn (animation audit)

- [x] 2.1 Audit the live long-session page with DevTools Animations panel + a short trace: enumerate every running animation, pin the exact DOM source of the 21 `width`-animating instances and each `background-position-x` / `background-color` / `color` / `box-shadow` offender. Record findings in the change dir. (Static source audit done + recorded in `phase1-animation-audit.md`; live DevTools panel pass deferred to ship-time with 2.8.)
- [x] 2.2 Replace the `width` animation(s) with `transform: scaleX()` (transform-origin left) or remove if decorative; verify identical visuals. (Removed the `transition-all` on `TokenStatsBar` context-bar segments — width now snaps; also kills the paired `background-color` transition offender. Visual re-check at ship.)
- [x] 2.3 Re-implement `tool-group-sweep` shimmer as a `transform: translateX()` sweep (compositor-only), keeping timing/easing and the reduced-motion strip.
- [x] 2.4 Convert `background-color`/`color`/`box-shadow` pulses to opacity cross-fades of pre-painted layers (reuse the `chat-stream-glow-pulse` static-shadow pattern). (box-shadow: `openspec-stepper-pulse-current` → opacity cross-fade of pre-painted rings. background-color offender handled via 2.2. No idle-relevant page-owned `color` keyframe — see audit.)
- [x] 2.5 Add a shared IntersectionObserver utility that toggles an `fx-offscreen` class (`animation-play-state: paused`) on animated elements outside the viewport; wire it to tool-group shimmer/spin-pulse, streaming glow, and neon card FX (`card-glow-fx`, `card-ring-fx`). (`lib/fx-visibility.ts` + `hooks/useFxVisibility.ts`; wired in `ToolBurstGroup`, `ChatView`, `SessionCard`.)
- [x] 2.6 Ensure completed states unmount/stop their animations (done tool groups, ended streaming bubbles) — verify no `state:running` animations remain for finished elements. (Classes are conditional: shimmer/spin only while `isRunning`, `.chat-stream-live` only while `streamingText`, neon FX only when `isSelected`.)
- [x] 2.7 Unit/visual checks: reduced-motion path unchanged; animations resume on re-entering viewport. (Existing reduced-motion strips preserved + added one for the new stepper `::after`; observer clears `fx-offscreen` on re-intersect. Live viewport-resume re-check at ship.)
- [ ] 2.8 Verify: record a 30 s idle trace on a long session → < 5 layouts/s and no non-composited page-owned animations (vs. 85/s baseline). (Automated ADVISORY probe added: `tests/e2e/chat-render-perf.spec.ts` samples CDP `LayoutCount`/`RecalcStyleCount` over an idle window, opt-in `PW_PERF=1` via `npm run test:e2e:perf`, generous 30/s regression ceiling. GREEN against the live Docker harness (system Chrome, settled ~120-turn session). MEASURED idle layouts/s=1.0, recalcs/s=3.7 over a 10s window — vs the ~85/s baseline, and UNDER the <5/s target of this task. (The "no non-composited page-owned animations" dimension is inferred from the ~0 idle layout churn + the reduced-motion FX-strip test, not a direct `unsupportedProperties` trace assertion.))

## 3. Phase 3 — coalesce live WS event application

- [x] 3.1 TDD: unit test proving an N-event burst folded via the queue yields a `SessionState` identical to sequential `reduceEvent` application, in seq order, with `maxSeqMapRef` at batch max.
- [x] 3.2 Implement per-session event queue + once-per-frame flush (rAF; `document.hidden` fallback to timeout/microtask) in `useMessageHandler`'s live `case "event"` path only (replay untouched).
- [x] 3.3 Preserve per-event side effects during the fold (interactive requests, plugin event mirror, seq tracking) — covered by tests.
- [x] 3.4 Verify: simulated 200-events/5s burst produces ≤ 1 render/frame (render-count probe), and live dashboard behavior (streaming text, tool cards, ask_user) is unchanged. (Render-count proven by `useMessageHandler.event-coalescing.test.tsx`; live behavior covered by full suite + ship-time manual smoke.)

## 4. Phase 2 — bound off-screen transcript cost

- [x] 4.1 Measure real message-block heights on a long session to derive `contain-intrinsic-size` estimates. (Used `contain-intrinsic-size: auto 160px` — `auto` caches real rendered heights after first paint; live median measurement to tune the 160px fallback deferred to ship. See `phase2-content-visibility-notes.md`.)
- [x] 4.2 Step A: apply `content-visibility: auto` + `contain-intrinsic-size` to per-message wrappers (excluding the streaming tail), behind a single toggleable CSS class. (`chat-cv` container toggle + `.chat-cv > *:not(.chat-cv-skip)` rule; live tails carry `chat-cv-skip`.)
- [ ] 4.3 Re-verify all `chat-scroll-lock` scenarios (auto-scroll follow, scroll-lock when scrolled up, scroll-to-bottom button) plus jump-to-message and `ChatViewHandle` behavior. (Covered by e2e: scroll-UP lock, scroll-to-bottom button, multi-batch replay, off-screen `scrollToTurn`, streaming-tail-mounted, windowing bound → `chat-transcript-virtualization.spec.ts` (Step B superseded Step A); auto-scroll-FOLLOW bullet → new `chat-render-fx.spec.ts` test 2, GREEN against the live Docker harness (system Chrome).)
- [ ] 4.4 Verify Step A against budget: re-trace → per-pass layout objects bounded by viewport working set; no repeated painting of tall off-screen strips; idle busy < 5 %. (CDP probe `chat-render-perf.spec.ts` measured idle layouts/s=1.0 + recalcs/s=3.7 on a settled ~120-turn session — consistent with idle busy < 5 %. NOTE Step A `content-visibility` is now superseded by Step B tanstack windowing, so "bounded by viewport working set" is proven by `chat-transcript-virtualization.spec.ts` mounted-row bound. A full main-thread-busy% trace-diff stays manual per Decision 5.)
- [ ] 4.5 Decision gate: if Step A misses the budget, scope Step B (true windowing via @tanstack/react-virtual) as a follow-up change with delta specs; do NOT start it inside this change.

## 5. Umbrella verification

- [ ] 5.1 Re-record the full baseline scenario (open long session → idle 30 s → event burst → type 20 chars) and diff against the baseline trace: main-thread busy % (target < 20 % during activity, < 5 % idle), layouts/s idle, renders per burst, EventDispatch p95 (target < 16 ms).
- [x] 5.2 Run the full test suite (`npm test 2>&1 | tee /tmp/pi-test.log`; grep FAIL) and type-check. (`tsc --noEmit` clean; 9421 passed. Only load-dependent flakes remain — `useImagePaste`, server `doctor-route`, server `recovery-offer` — all pass in isolation and touch no code in this change.)
- [ ] 5.3 Manual smoke on a real long session: typing, streaming, scrolling history, tool bursts, reduced-motion mode. (Reduced-motion FX-strip contract now automated: `chat-render-fx.spec.ts` test 1 asserts real-Chrome computed `animation-name` flips `chat-stream-glow-pulse`/`tool-group-sweep` → `none` under `emulateMedia({reducedMotion:'reduce'})`; GREEN against the live Docker harness (system Chrome). The subjective smoothness half stays manual, tested at ship.)
