> TDD throughout: every group writes its red test first and confirms it FAILS on
> current `develop` before the fix lands. Land order follows design.md —
> *Migration Plan*. Full suite: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`.
> Rebuild after client edits: `npm run build && curl -X POST http://localhost:8000/api/restart`.

## 1. Drag body-style lifecycle (§1 — capability `drag-body-style`)

- [ ] 1.1 Write `packages/client/src/hooks/__tests__/useBodyDragStyle.test.tsx` covering: begin sets `document.body.style.cursor`/`userSelect`; `endBodyDrag()` clears both; unmount MID-drag clears both; unmount while idle leaves both untouched; two mounted instances — the idle one's unmount does not clear the dragging one's styles. Verify the suite FAILS (module absent).
- [ ] 1.2 Add `packages/client/src/hooks/useBodyDragStyle.ts` exporting a hook returning `beginBodyDrag(cursor)` / `endBodyDrag()`, both idempotent and gated on a private `active` ref, with one unmount cleanup calling `endBodyDrag()`. Verify 1.1 passes, including under StrictMode double-invoke.
- [ ] 1.3 Extend `packages/client/src/components/shell/__tests__/ResizableSidebar.test.tsx`: body styles set on drag start, cleared on `mouseup`, cleared on unmount-mid-drag. Verify the unmount case FAILS first.
- [ ] 1.4 Delegate `components/shell/ResizableSidebar.tsx` (`:42-43`, `:59-60`) to the hook, keeping its own `dragging` ref for move/up gating. Verify 1.3 passes.
- [ ] 1.5 Delegate `components/split/SplitDivider.tsx` (`:47-48`, `:62-63`) to the hook, preserving the orientation-aware cursor (`col-resize`/`row-resize`). Verify existing SplitDivider tests plus a new unmount-mid-drag case pass.
- [ ] 1.6 Delegate the inline `ResizableTreePanel` in `components/diff/FileDiffView.tsx` (`:172-173`, `:190-191`) to the hook. Verify an unmount-mid-drag case passes and no `document.body.style` write remains in the file (`grep -n "body.style" components/diff/FileDiffView.tsx` → empty).
- [ ] 1.7 Confirm `hooks/useTreeColumnWidth.ts` is left unmodified (`git diff --stat` shows no entry for it) — deliberate per design.md Non-Goals.

## 2. Clipboard fallback (§2 — capability `content-copy`)

- [ ] 2.1 Extend `packages/client/src/components/primitives/__tests__/CopyButton.test.tsx`: with `navigator.clipboard.writeText` rejecting AND `execCommand("copy")` available, the text is copied, ✓ appears, and no hidden textarea remains in the document; with neither path available, nothing throws and ✓ does NOT appear. Verify both FAIL first.
- [ ] 2.2 Route `components/primitives/CopyButton.tsx` through `lib/util/clipboard.ts#copyText`, gating the 1.5 s ✓ on its boolean result; keep failure silent (no toast). Verify 2.1 passes and existing CopyButton/table/message-copy tests still pass.

## 3. Reconcile bookkeeping prune (§3 — capability `incremental-event-sync`)

- [ ] 3.1 Extend `packages/client/src/hooks/__tests__/useStaleToolReconcile.test.ts`: pure `selectActiveToolKeys(states)` returns exactly the `${sessionId}:${toolCallId}` keys of rows with `status === "running"` — and NOT keys of rows that are still present but terminal (the reducer never deletes `toolCalls`, so a presence-based prune would be a no-op); after a tick, retained `lastAttemptRef`/`count404Ref` entries contain no key absent from that set; a still-running row that already 404'd keeps its last-attempt time and 404 count across a prune. Verify FAILS first (selector absent + maps unpruned).
- [ ] 3.2 Add pure `selectActiveToolKeys(states)` beside the existing selectors in `hooks/useStaleToolReconcile.ts`, yielding running rows only, and have `tick()` delete non-member keys from `lastAttemptRef` and `count404Ref` BEFORE scanning; leave `inFlightRef` untouched. Verify 3.1 passes.
- [ ] 3.3 Verify unbounded growth is gone: simulate N tool rows that run and then reach a terminal state across ticks — leaving every row PRESENT in `toolCalls`, as the reducer does — and assert retained entry count tracks currently-running rows, not cumulative tool calls.

## 4. Mobile viewport bound (§4 — capability `mobile-resilience`)

- [ ] 4.1 Write `packages/client/src/components/shell/__tests__/MobileShell.test.tsx` asserting the root fills its parent (`w-full flex-1 min-h-0`) and claims no viewport unit (no `w-screen`, no `h-[100dvh]`). Verify it FAILS against `MobileShell.tsx:42`.
- [ ] 4.2 Change `components/shell/MobileShell.tsx:42` root to `w-full flex-1 min-h-0 relative overflow-hidden bg-[var(--bg-primary)]`. Verify 4.1 passes.
- [ ] 4.3 Change the `isMobile` branch root in `App.tsx` (`:2678`) to `flex flex-col h-[100dvh] overflow-hidden`, leaving the banners in flow above `MobileShell`. Verify desktop rendering is untouched (`git diff` shows no edit outside the `isMobile` branch).
- [ ] 4.4 Verify against the harness at 390×844 with the staleness banner visible: `document.scrollHeight === window.innerHeight` (was 887 vs 844), and opening a session / focusing the composer does not scroll the document or move the header out of view.
- [ ] 4.5 Confirm every viewport-anchored overlay in the mobile branch (`Toast`, `SpawnErrorToastHost`, `RecoveryOfferHost`, `WorktreeInitStack`, first-launch modal, add-folders dialog) is `fixed`/`fixed inset-0` and adds no flex-flow height.

## 5. Idle FX pause (§7 — capability `ui-animation-energy`)

- [ ] 5.1 Write `packages/client/src/hooks/__tests__/useIdleFx.test.tsx` with fake timers: `fx-idle` appears on the document root after `IDLE_FX_DELAY_MS`; each of `pointerdown`/`wheel`/`keydown`/`touchstart`/`focusin` clears it immediately; activity before the delay prevents it and restarts the timer; `pointermove` and `scroll` do NOT count as activity; listeners are removed on unmount. Verify FAILS (module absent).
- [ ] 5.2 Add `packages/client/src/hooks/useIdleFx.ts` mirroring `useAppHidden`'s shape: capture-phase `document` listeners for the five activity events, `IDLE_FX_DELAY_MS = 5000`, toggling `fx-idle` on `document.documentElement`, cleaning up timer + listeners on unmount. Verify 5.1 passes.
- [ ] 5.3 Add `:root.fx-idle *, :root.fx-idle *::before, :root.fx-idle *::after { animation-play-state: paused !important; }` to `index.css`, mirroring the `app-hidden` block at `:645-647`. Verify both classes compose (either set ⇒ paused).
- [ ] 5.3a Add the indeterminate-spinner exemption AND its two re-pause rules, in this source order: `:root.fx-idle .animate-spin { running }`, then `:root.app-hidden .animate-spin, :root.fx-idle .fx-offscreen .animate-spin { paused }`. Write the red test FIRST: a spinner keeps animating while only `fx-idle` is set, but is paused when `app-hidden` is also set, and paused when inside an `.fx-offscreen` container. Verify the naive single-rule form FAILS the latter two (specificity 0,3,0 beats both shipped pause blocks at 0,2,0).
- [ ] 5.3b Audit the `index.css` keyframe inventory for any other animation whose MOTION carries information not restated by static styling, and record the verdict per candidate. Known candidate: `.flow-edge-animated` (`:632-638`) — dash direction indicates edge direction. Confirm `.animate-pulse` and `.tool-group-spin-pulse` (`:464`) stay non-exempt.
- [ ] 5.4 Mount `useIdleFx()` in `App.tsx` next to `useAppHidden()`. Verify the class appears on a live idle dashboard and clears on first input.
- [ ] 5.5 Extend `SessionCard.test.tsx` to assert the selected card renders the static selection affordance classes (`ring-1 ring-blue-500/30 border-blue-500/60`) and the FX layer classes, so a rename cannot silently break the CSS selectors.
- [ ] 5.6 Measure before/after with a Chrome trace over ≥13 s of strict idle WITH a background session streaming: record `CrGpuMain`, `VizCompositorThread`, renderer `Compositor` totals and confirm the drop (baseline ~10 %/5 %/2 % CrGpuMain-class idle cost; background-stream stripes were 3268 ms/13.3 s). Record numbers in the change.

## 6. Markdown render identity (§6 — capability `chat-selection-preservation`)

- [ ] 6.1 Extend `packages/client/src/components/preview/__tests__/MarkdownContent.test.tsx`: render markdown containing a paragraph, inline code, a link and a table; re-render with a FRESH but equivalent `ToolContext` value; assert every one of those DOM nodes is the same node instance (no replacement). Verify it FAILS today.
- [ ] 6.2 Add a `MarkdownRenderContext` carrying `ToolContext`, syntax theme, loopback-link behavior and image base; move the `p`/`code`/`a`/`table` (and remaining inline) renderers in `components/preview/MarkdownContent.tsx` to module scope reading from that context; make the `components` object passed to `react-markdown` a module constant. Mount the provider INSIDE `MarkdownContent` (the value is per-instance — `context` is a prop) with a value memoized field-wise, and give the context an inert default (no `fileLink`, no `session`, default theme) so a provider-less embedder still renders. Verify 6.1 passes.
- [ ] 6.2a Add a test that `MarkdownContent` rendered with NO `context` prop and outside any provider renders without throwing, with file mentions degrading to plain text (the `chat-embed` embedder path).
- [ ] 6.3 Verify no markdown rendering regressions: full `MarkdownContent`, `MarkdownPreviewView`, `FilePreviewOverlay`, `SkillInvocationCard`, math, ASCII-table and code-copy tests pass unchanged.
- [ ] 6.4 Narrow `ToolContext.session` in `components/tool-renderers/types.ts:37` from `SessionState` to `session?: { subagents: SessionState["subagents"] }` — keeping optionality (`App.tsx:1499-1500` passes `undefined` when nothing is selected). This is a deliberate BREAKING change to a type re-exported for embedders: verify `tsc` is clean across every workspace that imports it, and that `SubagentDetailView`'s `SessionStateLike` still structurally matches.
- [ ] 6.5 Narrow the `App.tsx:1498-1503` memo so `toolContext` depends on the SELECTED session's `subagents` map instead of the whole `sessionStates` map. Verify `AgentToolRenderer` → `SubagentDetailView` still resolves subagents (its only read is `session.subagents`).
- [ ] 6.6 Add a regression asserting a background (unselected) session's state update causes zero child-list mutations in the selected transcript's markdown subtree — the isolated repro measured 26 before, 0 after — and holds under a sustained ~60/s event stream.

## 7. Scroll follow through measurement clamp (§5 — capability `chat-scroll-lock`)

- [ ] 7.1 RE-REPRODUCE on current `develop` before writing any fix: confirm all THREE bottom-pin sites (`ChatView.tsx:1189` onChange, `:1503` follow effect, `:1461-1464` session-switch near-bottom/first-visit branch) stamp only `programmaticScrollUntilRef` and then land in `handleScroll`'s `else` at `:1348`, clearing `stickToBottomRef`. Record the observed shape; if the current settle window already mitigates it, STOP and report before proceeding.
- [ ] 7.2 Add a browser-faithful `setScrollPosition` helper to `ChatView.scroll-race.test.tsx` that CLAMPS an assigned `scrollTop` to `scrollHeight - clientHeight` (a helper that stores out-of-range values cannot express this bug). Verify the helper clamps.
- [ ] 7.3 Write the red regression: a bottom-pin lands clamped, `scrollHeight` then grows by thousands of px, and the induced scroll event dispatches with no gesture → `stickToBottomRef` must stay true and the scroll-to-bottom button must not appear. Verify it FAILS.
- [ ] 7.4 Write the counterpart red regression: the view is moved ABOVE the recorded pin position with no gesture → the follow must still release and the button must appear. Verify it fails/passes appropriately against the intended behavior.
- [ ] 7.5 Implement writer tagging in `components/chat/ChatView.tsx`: ALL THREE bottom-pin sites (`:1189`, `:1503`, and the session-switch near-bottom/first-visit branch at `:1461-1464`) tag `"pin-bottom"` and record a snapshot of the achieved `scrollTop` + observed `scrollHeight`. Leave `scrollToBottom`/`scrollToTurn`/the saved-position restore at `:1457-1458`/splice corrections as `"jump"`, touching no pin refs.
- [ ] 7.6 Consult the tag in `handleScroll` BEFORE the position rules: hold the follow only when tag is `"pin-bottom"` AND event `scrollTop` matches the recorded achieved position WITHIN 1 px (exact `===` breaks on fractional readback under zoom / device-pixel rounding — including the 390×844 repro device) AND `scrollHeight` has grown since the snapshot AND the pin landed with real content; otherwise fall through unchanged. Verify 7.3 and 7.4 both pass.
- [ ] 7.6a Make the attribution SINGLE-USE: the first scroll event tested against the snapshot consumes it — an event that falls through clears it. Red test first: after a fall-through event, a later event that coincidentally lands on the recorded `scrollTop` with grown content must NOT re-arm the follow.
- [ ] 7.6b Persist the PRESERVED sticky state (not the raw `nearBottom: false`) into `scrollStateMap` (`ChatView.tsx:1352-1362`) when the clamp branch holds the follow. Red test first: after a clamp-preserved event, switching away and back must restore at the bottom with the scroll-to-bottom button hidden.
- [ ] 7.7 Clear the pin tag on real user input by extending the existing `onWheel`/`onTouchMove` → `cancelDescent` path (the one place that already means "user took over"). Verify a wheel gesture during replay still releases the follow within 150 ms.
- [ ] 7.7a Reset the pin attribution on `sessionId` change, alongside the existing `descendingRef`/`stickToBottomRef` reset in the restore effect (`ChatView.tsx:1428-1440`). Red test first: a snapshot recorded in session A must not be matched by session B's first scroll event.
- [ ] 7.8 Verify no regression in the existing latch family: `scrollToBottom` (`descendingRef`), `scrollToTop` (`ascendingRef`), auto-load intent (`programmaticScrollUntilRef` / `evaluateAutoLoad`), selection-suspended pin and splice-suppress behavior all pass their existing tests unchanged.
- [ ] 7.9 Verify end-to-end on a live long session at 390×844: opening it comes to rest at the latest message with the scroll-to-bottom button hidden (was `scrollTop 25521 / max 38909`).

## 8. Verification and documentation

- [ ] 8.1 Run the full suite and confirm zero failures: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then `grep -nE 'FAIL|Error|✗|✘|Tests +[0-9]+ (failed|passed)' /tmp/pi-test.log`.
- [ ] 8.2 Run `npm run quality:changed` (Biome) on the changed files and resolve findings.
- [ ] 8.3 Run the `review-code` discipline over the full diff, focusing on the seams design.md flags: drag-style lifecycle (StrictMode, two consumers, missed mouseup), `useIdleFx` timer/listener lifecycle, and the scroll + render-identity timing changes.
- [ ] 8.4 Run the Playwright E2E suite against the docker harness (`npm run test:e2e`) to confirm no transcript-virtualization or mobile regression.
- [ ] 8.5 Update `AGENTS.md` rows via DocScribe: `hooks/` (new `useBodyDragStyle.ts`, `useIdleFx.ts`, plus the `useStaleToolReconcile` prune detail), `shell/`, `split/`, `diff/`, `primitives/`, `tool-renderers/` (narrowed `ToolContext.session`), `src/` (`index.css` `fx-idle` block + spinner-exemption ladder); and per-file sidecars for `SplitDivider.tsx`, `FileDiffView.tsx`, `App.tsx`, `preview/MarkdownContent.tsx`, `chat/ChatView.tsx`. Verify `kb dox lint` reports no new stale/missing rows.
- [ ] 8.6 Run `openspec validate "fix-long-session-ux-degradation" --strict` and confirm it passes.
