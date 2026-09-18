> TDD throughout: every group writes its red test first and confirms it FAILS on
> current `develop` before the fix lands. Land order follows design.md —
> *Migration Plan*. Full suite: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`.
> Rebuild after client edits: `npm run build && curl -X POST http://localhost:8000/api/restart`.
>
> Test tasks are folded from `test-plan.md`; each carries its manifest id, its
> Triple, and a harness exemplar to copy glue from. `test-plan.md` — not any tag
> here — is the source of truth for automated vs manual.

## 1. Drag body-style lifecycle (§1 — capability `drag-body-style`)

- [x] 1.1 Write `packages/client/src/hooks/__tests__/useBodyDragStyle.test.tsx` — mounted consumer with empty body styles · `beginBodyDrag("col-resize")` · `document.body.style.cursor === "col-resize"` AND `userSelect === "none"`. Verify it FAILS (module absent). See `packages/client/src/hooks/__tests__/useAppHidden.test.ts` for hook-under-test glue. (test-plan #E1)
- [x] 1.2 Add the drag-end case to that file — consumer mid-drag · `endBodyDrag()` · both `cursor` and `userSelect` back to `""`. (test-plan #E2)
- [x] 1.3 Add the unmount-mid-drag case — consumer mid-drag with no `mouseup` delivered · unmount · both properties `""` and the document selectable. See `packages/client/src/hooks/__tests__/effect-cleanup-contract.test.tsx` for unmount-cleanup glue. (test-plan #E3)
- [x] 1.4 Add the idle-unmount case — consumer that never began a drag, body pre-set to `cursor:"crosshair"` · unmount · `cursor` still `"crosshair"` (the hook must not clear a value it never set). (test-plan #E4)
- [x] 1.5 Add the two-instance isolation case — consumers A (mid-drag) and B (idle) · unmount B · A's overrides still applied. (test-plan #E5)
- [x] 1.6 Add the StrictMode case — consumer rendered under `<StrictMode>` · mount then begin drag · overrides applied exactly once, no clear fired by the discarded first mount. (test-plan #E6)
- [x] 1.7 Add the idempotence case — consumer that never began, or already ended · call `endBodyDrag()` twice · no throw, body styles unchanged. (test-plan #E7)
- [x] 1.8 Add `packages/client/src/hooks/useBodyDragStyle.ts` exporting a hook returning `beginBodyDrag(cursor)` / `endBodyDrag()`, both idempotent and gated on a private `active` ref, with one unmount cleanup calling `endBodyDrag()`. Verify 1.1–1.7 all pass.
- [x] 1.9 Extend `packages/client/src/components/__tests__/ResizableSidebar.test.tsx` and add equivalent cases for `SplitDivider` and the inline `ResizableTreePanel` — each handle mounted · `mousedown` then unmount before `mouseup` · body left selectable, no residual cursor, and no `document.body.style` write remains in the three source files. Verify the unmount cases FAIL first. (test-plan #E8)
- [x] 1.10 Delegate `components/shell/ResizableSidebar.tsx` (`:42-43`, `:59-60`) to the hook, keeping its own `dragging` ref for move/up gating.
- [x] 1.11 Delegate `components/split/SplitDivider.tsx` (`:47-48`, `:62-63`) to the hook, preserving the orientation-aware cursor (`col-resize`/`row-resize`).
- [x] 1.12 Delegate the inline `ResizableTreePanel` in `components/diff/FileDiffView.tsx` (`:172-173`, `:190-191`) to the hook. Verify 1.9 now passes and `grep -n "body.style" components/diff/FileDiffView.tsx` is empty.
- [x] 1.13 Author `tests/e2e/drag-body-style.spec.ts` — desktop viewport with a sidebar drag in progress · flip the breakpoint so the dragger unmounts mid-drag · page text still selectable, no residual resize cursor. See `tests/e2e/chat-render-fx.spec.ts` for harness/port glue. (test-plan #F23)
- [x] 1.14 Confirm `hooks/useTreeColumnWidth.ts` is left unmodified (`git diff --stat` shows no entry for it) — deliberate per design.md Non-Goals.

## 2. Clipboard fallback (§2 — capability `content-copy`)

- [x] 2.1 Extend `packages/client/src/components/__tests__/CopyButton.test.tsx` — `navigator.clipboard.writeText` resolves · click · ✓ shown and no hidden textarea created or left in the DOM. (test-plan #E9)
- [x] 2.2 Add the fallback case — `writeText` rejects, `execCommand("copy")` available · click · text copied via the fallback, ✓ shown, no hidden textarea left behind. Verify it FAILS first. (test-plan #X1)
- [x] 2.3 Add the total-failure case — `writeText` rejects AND `execCommand` absent/returns false · click · nothing throws and ✓ does NOT appear. (test-plan #X2)
- [x] 2.4 Route `components/primitives/CopyButton.tsx` through `lib/util/clipboard.ts#copyText`, gating the 1.5 s ✓ on its boolean result; keep failure silent (no toast). Verify 2.1–2.3 pass and existing CopyButton/table/message-copy tests still pass.
- [x] 2.5 Author `tests/e2e/copy-insecure-context.spec.ts` — dashboard served over a plain-http origin (the zrok/ngrok shape) · click a copy affordance · the ✓ feedback appears, proving the fallback ran. See `tests/e2e/table-copy.spec.ts` for copy-affordance glue. (test-plan #X3)

## 3. Reconcile bookkeeping prune (§3 — capability `incremental-event-sync`)

- [x] 3.1 Extend `packages/client/src/hooks/__tests__/useStaleToolReconcile.test.ts` — state with 3 `running` and 7 terminal tool rows, ALL still present in `toolCalls` · call `selectActiveToolKeys(states)` · returns exactly the 3 running `${sessionId}:${toolCallId}` keys. Verify it FAILS (selector absent). (test-plan #E10)
- [x] 3.2 Add the tick-discard case — bookkeeping populated for 10 rows, 7 then terminal (rows remain present) · one reconcile tick · `lastAttemptRef`/`count404Ref` retain only the 3 running keys. Verify it FAILS (maps unpruned). (test-plan #E11)
- [x] 3.3 Add the backoff-preservation case — a running row with last-attempt `T` and 404 count `2` alongside terminal rows being discarded · one tick · that row's `T` and count `2` are unchanged. (test-plan #E12)
- [x] 3.4 Add the late-404 case — a reconcile request in flight when its row goes terminal and its key is discarded · the 404 response lands and re-inserts the key · the NEXT tick discards it again, returning retained entries to the running-row count. (test-plan #X4)
- [x] 3.5 Add the soak case — 5 000 tool rows each run→terminal with all rows remaining present, ticks driven throughout · retained entry count equals the currently-running count (≤ 10), NOT 5 000. (test-plan #P1)
- [x] 3.6 Add pure `selectActiveToolKeys(states)` beside the existing selectors in `hooks/useStaleToolReconcile.ts`, yielding `status === "running"` rows only, and have `tick()` delete non-member keys from `lastAttemptRef` and `count404Ref` BEFORE scanning; leave `inFlightRef` untouched. Verify 3.1–3.5 pass.

## 4. Mobile viewport bound (§4 — capability `mobile-resilience`)

- [x] 4.1 Write `packages/client/src/components/shell/__tests__/MobileShell.test.tsx` — `MobileShell` rendered · inspect root classes · has `w-full flex-1 min-h-0`, contains neither `w-screen` nor `h-[100dvh]`. Verify it FAILS against `MobileShell.tsx:42`. (test-plan #E13)
- [x] 4.2 Change `components/shell/MobileShell.tsx:42` root to `w-full flex-1 min-h-0 relative overflow-hidden bg-[var(--bg-primary)]`. Verify 4.1 passes.
- [x] 4.3 Change the `isMobile` branch root in `App.tsx` (`:2678`) to `flex flex-col h-[100dvh] overflow-hidden`, leaving the banners in flow above `MobileShell`. Verify `git diff` shows no edit outside the `isMobile` branch.
- [x] 4.4 Author `tests/e2e/mobile-viewport-bound.spec.ts` — 390×844 with the plugin-staleness banner visible (43 px) · render the mobile shell · `document.scrollHeight === window.innerHeight` (baseline defect: 887 vs 844). See `tests/e2e/gateway-board-mobile.spec.ts` for mobile-viewport + harness-port glue. (test-plan #F12)
- [x] 4.5 Add the banner-cycle case to that spec — banner toggles on then off · observe after each transition · document non-scrollable in both states. (test-plan #F13)
- [x] 4.6 Add the navigation case — mobile viewport with a banner visible · enter a session, then focus the composer · `document.scrollTop` stays 0 and the header stays at the top of the viewport. (test-plan #F14)
- [x] 4.7 Add the overlay case — toast, worktree-init stack, spawn-error host, recovery host, first-launch modal and add-folders dialog each mounted · document stays non-scrollable for every one. (test-plan #F15)

## 5. Idle FX pause (§7 — capability `ui-animation-energy`)

- [x] 5.1 Write `packages/client/src/hooks/__tests__/useIdleFx.test.tsx` with fake timers — mounted hook, `IDLE_FX_DELAY_MS = 5000` · advance 4999 ms then 1 ms more · no `fx-idle` at 4999 ms, `fx-idle` present at 5000 ms. Verify it FAILS (module absent). See `packages/client/src/hooks/__tests__/useAppHidden.test.ts`. (test-plan #E17)
- [x] 5.2 Add the non-activity case — dispatch `pointermove` and `scroll` repeatedly, then advance past the delay · `fx-idle` IS applied (neither counts as activity). (test-plan #E18)
- [x] 5.3 Add the activity case — with `fx-idle` applied, dispatch each of `pointerdown`, `wheel`, `keydown`, `touchstart`, `focusin` (at capture, from a stopped-propagation subtree) · each clears `fx-idle` and restarts the delay. Also assert listeners and timer are removed on unmount. (test-plan #E19)
- [x] 5.4 Add `packages/client/src/hooks/useIdleFx.ts` mirroring `useAppHidden`'s shape: capture-phase `document` listeners for the five activity events, `IDLE_FX_DELAY_MS = 5000`, toggling `fx-idle` on `document.documentElement`, cleaning up timer + listeners on unmount. Verify 5.1–5.3 pass.
- [x] 5.5 Add `:root.fx-idle *, :root.fx-idle *::before, :root.fx-idle *::after { animation-play-state: paused !important; }` to `index.css`, mirroring the `app-hidden` block at `:645-647`.
- [x] 5.6 Add the exemption ladder in this source order: `:root.fx-idle .animate-spin, :root.fx-idle .fx-progress { running }`, then `:root.app-hidden .animate-spin, :root.app-hidden .fx-progress, :root.fx-idle .fx-offscreen .animate-spin, :root.fx-idle .fx-offscreen .fx-progress { paused }`. (Exemption is 0,3,0; `:root.app-hidden *` is 0,2,0 and `.fx-offscreen *` is 0,1,0 — without the re-pause rules both shipped pauses lose.)
- [x] 5.7 Add `className="fx-progress"` to the `@mdi/react` spinner sites, which animate via an INLINE style with no class and so cannot be reached by `.animate-spin`: `ToolBurstGroup.tsx:227` (the running tool group's `mdiLoading` glyph — the canonical in-flight indicator), `StatusBar.tsx:54`, `UnifiedPackagesSection.tsx:329` and `:360`.
- [x] 5.8 Add a decorative-classes case to the CSS/unit layer — markup carrying `animate-pulse` and `.tool-group-spin-pulse` · apply `fx-idle` · neither is matched by an exemption rule. (test-plan #E20)
- [x] 5.9 Mount `useIdleFx()` in `App.tsx` next to `useAppHidden()`.
- [x] 5.10 Author `tests/e2e/idle-fx-pause.spec.ts` — visible dashboard with a selected card and a streaming background card · no input for the idle delay · `fx-idle` on the document root and background stripes + status dots report `animation-play-state: paused`. See `tests/e2e/chat-render-fx.spec.ts`. (test-plan #F16)
- [x] 5.11 Add the resume case — animations paused by idle · one `pointerdown` · `fx-idle` cleared and animations report `running` on the next frame. (test-plan #F17)
- [x] 5.12 Add the exemption case — an in-flight operation showing an `animate-spin` indicator AND an `fx-progress` mdi glyph · idle delay elapses with only `fx-idle` set · both report `running`. Verify an exemption-only CSS form FAILS 5.13/5.14. (test-plan #F18)
- [x] 5.13 Add the hidden-precedence case — same indicators, document marked BOTH `app-hidden` and `fx-idle` · both report `paused`. (test-plan #F19)
- [x] 5.14 Add the off-screen-precedence case — an indicator inside an `.fx-offscreen` container with the document `fx-idle` · reports `paused`. (test-plan #F20)
- [x] 5.15 Extend `packages/client/src/components/__tests__/SessionCard.test.tsx` — selected card rendered · inspect classes · static ring/border selection affordance present, so a rename cannot silently break the CSS selectors. (test-plan #F21)
- [x] 5.16 Audit the animation inventory — BOTH `index.css` keyframes AND package-injected animations applied by inline style — for any animation whose MOTION carries information not restated by static styling; record a verdict per candidate. Known candidate: `.flow-edge-animated` (`:632-638`), dash direction indicates edge direction.
- [x] 5.17 MANUAL — measure the idle CPU collapse with a Chrome trace: visible dashboard, ≥ 1 background session streaming, no input, no in-flight spinner, ≥ 13 s strict idle · `CrGpuMain` share drops from ~10 % toward ~1.6 % and the background-stream stripes cost falls from 3 268 ms toward zero. Record the numbers in the change. (test-plan: manual-only)
- [x] 5.18 MANUAL — with animations paused, confirm every session's state is still distinguishable from static styling alone, and the selected session is still visually identified. (test-plan: manual-only)

## 6. Markdown render identity (§6 — capability `chat-selection-preservation`)

- [x] 6.1 Extend `packages/client/src/components/__tests__/MarkdownContent.test.tsx` — markdown with a paragraph, inline code, a link and a table · re-render with a FRESH but equivalent `ToolContext` value · every one of those DOM nodes is the same node instance. Verify it FAILS today. (test-plan #F9)
- [x] 6.2 Add the provider-less case — `MarkdownContent` mounted with no `context` prop and outside any `MarkdownRenderContext` provider · renders without throwing, file mentions degrade to plain text. (test-plan #F10)
- [x] 6.3 Add the churn-soak case — selected transcript rendered · background session emits state updates at ~60/s for ≥ 2 s · child-list mutations in the selected transcript's markdown subtree = 0 (baseline repro: 26 from a single event). (test-plan #P2)
- [x] 6.4 Add a `MarkdownRenderContext` carrying `ToolContext`, syntax theme, loopback-link behavior and image base; move the `p`/`code`/`a`/`table` (and remaining inline) renderers in `components/preview/MarkdownContent.tsx` to module scope reading from that context; make the `components` object a module constant. Mount the provider INSIDE `MarkdownContent` with a field-wise memoized value, and give the context an inert default (no `fileLink`, no `session`, default theme). Verify 6.1–6.3 pass.
- [x] 6.5 Narrow `ToolContext.session` in `components/tool-renderers/types.ts:37` from `SessionState` to `session?: { subagents: SessionState["subagents"] }`, keeping optionality (`App.tsx:1499-1500` passes `undefined` when nothing is selected). Run the workspace typecheck · `tsc` clean across every workspace importing `ToolContext`, and `SubagentDetailView`'s `SessionStateLike` still structurally matches. This is a deliberate BREAKING change to a re-exported type. (test-plan #E21)
- [x] 6.6 Narrow the `App.tsx:1498-1503` memo so `toolContext` depends on the SELECTED session's `subagents` map instead of the whole `sessionStates` map. Verify `AgentToolRenderer` → `SubagentDetailView` still resolves subagents.
- [x] 6.7 Verify no markdown rendering regressions: full `MarkdownContent`, `MarkdownPreviewView`, `FilePreviewOverlay`, `SkillInvocationCard`, math, ASCII-table and code-copy tests pass unchanged.
- [x] 6.8 Author `tests/e2e/background-stream-selection.spec.ts` — user holds a text selection in the selected session's transcript · a DIFFERENT, unselected session streams assistant output · the selection stays anchored and non-collapsed. See `tests/e2e/selection-anchor.spec.ts`. (test-plan #F11)

## 7. Scroll follow through measurement clamp (§5 — capability `chat-scroll-lock`)

- [x] 7.1 RE-REPRODUCE on current `develop` before writing any fix: confirm all FOUR bottom-pin sites (`ChatView.tsx:1189` onChange, `:1503` follow effect, `:1461-1464` session-switch near-bottom/first-visit, `:1456-1459` anchor-row-not-found fallback) stamp only `programmaticScrollUntilRef` and then land in `handleScroll`'s `else` at `:1348`, clearing `stickToBottomRef`. Record the observed shape; if the current settle window already mitigates it, STOP and report before proceeding.
- [x] 7.2 Add a browser-faithful `setScrollPosition` helper to `packages/client/src/components/__tests__/ChatView.scroll-race.test.tsx` that CLAMPS an assigned `scrollTop` to `scrollHeight - clientHeight` (a helper that stores out-of-range values cannot express this bug). Verify the helper clamps.
- [x] 7.3 Write the clamp-holds regression — bottom-pin written and clamped · off-screen rows measure in growing `scrollHeight` by thousands of px, then the induced event dispatches with no gesture · `stickToBottomRef` stays true and the scroll-to-bottom button is not shown. Verify it FAILS. (test-plan #F1)
- [x] 7.4 Write the no-gesture-escape regression — view programmatically moved ABOVE the recorded pin, no gesture · induced event dispatches · follow released and the button shown. (test-plan #F2)
- [x] 7.5 Write the single-use regression — snapshot recorded, one event falls through (consuming it) · a later event coincidentally reports the recorded `scrollTop` with grown content · follow NOT re-armed. (test-plan #F3)
- [x] 7.6 Write the scrollbar-drag regression — snapshot recorded, no wheel/touch at all · scroll event at a position off the recorded pin · clamp branch does not apply, follow released. (test-plan #F4)
- [x] 7.7 Write the session-crossing regression — snapshot recorded in session A · switch to B and dispatch B's first scroll event · not matched against A's snapshot. (test-plan #F5)
- [x] 7.8 Write the writer-taxonomy regression — exercise each of the four bottom-pin writers in turn with growth-then-event · each induced event is attributable, while the `idx >= 0` restore path, `scrollToBottom`, `scrollToTurn` and splice corrections leave pin refs untouched. (test-plan #F6)
- [x] 7.9 Write the restore regression — a clamp-preserved event has just held the follow · switch away and back · restores at the bottom with the button hidden, not mid-transcript. (test-plan #F7)
- [x] 7.10 Write the tolerance boundary pair — snapshot at `scrollTop 5000.0` with grown content · event reports `5000.4` · treated as a clamp, follow preserved. (test-plan #E14)
- [x] 7.11 Write the just-outside-tolerance case — same snapshot · event reports `5005` · falls through, follow released. (test-plan #E15)
- [x] 7.12 Write the empty-transcript guard — pin written against an empty transcript (`scrollHeight === clientHeight`, achieved `scrollTop 0`) · induced event dispatches · clamp branch does NOT apply. (test-plan #E16)
- [x] 7.13 Write the gesture-wins case — replay in progress with the follow active · user wheels upward · follow released within 150 ms, button appears, later replay batches do not pull the view back. (test-plan #X5)
- [x] 7.14 Implement writer tagging in `components/chat/ChatView.tsx`: all four bottom-pin sites tag `"pin-bottom"` and record a snapshot of the achieved `scrollTop` + observed `scrollHeight`. Leave `scrollToBottom`/`scrollToTurn`/the `idx >= 0` restore path (`:1443-1455`)/splice corrections as `"jump"`, touching no pin refs. Confirm the clamp branch PRESERVES the pin's sticky state rather than forcing it true, so tagging `:1456-1459` (which sets `stickToBottomRef = false`) is safe.
- [x] 7.15 Consult the tag in `handleScroll` BEFORE the position rules: hold the follow only when tag is `"pin-bottom"` AND event `scrollTop` matches the recorded achieved position WITHIN 1 px (exact `===` breaks on fractional readback under zoom / device-pixel rounding, including the 390×844 repro device) AND `scrollHeight` has grown since the snapshot AND the pin landed with real content; otherwise fall through unchanged.
- [x] 7.16 Make the attribution SINGLE-USE: the first scroll event tested against the snapshot consumes it — an event that falls through clears it.
- [x] 7.17 Persist the PRESERVED sticky state (not the raw `nearBottom: false`) into `scrollStateMap` (`ChatView.tsx:1352-1362`) when the clamp branch holds the follow.
- [x] 7.18 Clear the pin tag on real user input by extending the existing `onWheel`/`onTouchMove` → `cancelDescent` path (the one place that already means "user took over").
- [x] 7.19 Reset the pin attribution on `sessionId` change, in the restore effect's UNCONDITIONAL prologue beside `prevSessionRef.current = sessionId` (`ChatView.tsx:1432`) — NOT beside the `descendingRef`/`stickToBottomRef` clears at `:1438-1440`, which run only on the scroll-locked-restore path and would skip the near-bottom/first-visit switch. Verify 7.3–7.13 all pass.
- [x] 7.20 Verify no regression in the existing latch family: `scrollToBottom` (`descendingRef`), `scrollToTop` (`ascendingRef`), auto-load intent (`programmaticScrollUntilRef` / `evaluateAutoLoad`), selection-suspended pin and splice-suppress behavior all pass their existing tests unchanged. (test-plan #F8)
- [x] 7.21 Author `tests/e2e/long-session-settle.spec.ts` — harness session whose transcript is large enough that rows measure in after the pin (baseline: `scrollHeight` 21 136 → 39 578) · open the session · view comes to rest within one viewport of the bottom (baseline defect: `scrollTop 25521 / max 38909`) with the scroll-to-bottom button hidden. See `tests/e2e/scroll-to-top.spec.ts` and `tests/e2e/tail-only-scroll-perf.spec.ts`. (test-plan #P4)

## 8. Verification and documentation

- [x] 8.1 Run the full suite and confirm zero failures: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then `grep -nE 'FAIL|Error|✗|✘|Tests +[0-9]+ (failed|passed)' /tmp/pi-test.log`.
- [x] 8.2 Run `npm run quality:changed` (Biome) on the changed files and resolve findings.
- [x] 8.3 Run the `review-code` discipline over the full diff, focusing on the seams design.md flags: drag-style lifecycle (StrictMode, two consumers, missed mouseup), `useIdleFx` timer/listener lifecycle, and the scroll + render-identity timing changes.
- [x] 8.4 Run the Playwright E2E suite against the docker harness (`npm run test:e2e`) to confirm no transcript-virtualization or mobile regression, and that the seven new specs pass.
- [x] 8.5 Update `AGENTS.md` rows via DocScribe: `hooks/` (new `useBodyDragStyle.ts`, `useIdleFx.ts`, plus the `useStaleToolReconcile` prune detail), `shell/`, `split/`, `diff/`, `primitives/`, `tool-renderers/` (narrowed `ToolContext.session`), `src/` (`index.css` `fx-idle` block + spinner-exemption ladder); and per-file sidecars for `SplitDivider.tsx`, `FileDiffView.tsx`, `App.tsx`, `preview/MarkdownContent.tsx`, `chat/ChatView.tsx`. Verify `kb dox lint` reports no new stale/missing rows.
- [x] 8.6 Run `openspec validate "fix-long-session-ux-degradation" --strict` and confirm it passes.
