# Tasks — Editor Layout Modes

## 1. State model + migration (`split-state.ts`)
- [x] 1.1 Replace `SplitState.open: boolean` with `mode: "closed" | "split" | "full"`; update `DEFAULT_SPLIT_STATE` to `{ mode: "closed", ratio: 0.5, orientation: "h" }`. → verify: `tsc --noEmit` clean across client.
- [x] 1.2 `isValidState`/`loadSplitState` migration with **precedence**: `mode` wins over legacy `open`; else `open:true→"split"`/`false→"closed"`; else default. `clampRatio` still applied. → verify: unit tests for new / legacy-true / legacy-false / both-fields / out-of-clamp-ratio / corrupt. (test-plan #mig)
- [x] 1.3 **Strip-on-write**: first `saveSplitState` after load persists only the `mode` shape (no `open` key). → verify: unit test asserts serialized blob has no `open`.
- [x] 1.4 Add `setMode(mode)`; **delete** `toggleSplit` (zero callers after 2.x/3.x). → verify: `grep -rn toggleSplit packages/client/src` returns nothing after 3.x.

## 2. Header layout switch (`SplitToggleButton.tsx` → `LayoutModeSwitch`)
- [x] 2.1 Replace the single pill with a `Chat | Split | Editor` segmented control; active segment reflects `split.mode`; renders null without a provider (unchanged self-contained contract). → verify: renders in all three states; null outside provider.
- [x] 2.2 A11y per WAI-ARIA APG: `role="radiogroup"` + three `role="radio"` `aria-checked` options, roving `tabindex`, Arrow/Home/End nav, accessible name per option; active mode announced. → verify: a11y test (arrow moves, enter/space selects, checked reflects mode), `data-testid="layout-mode-switch"`. (test-plan #a11y)
- [x] 2.3 Retire the full label set (`split.split`, `split.splitLabel`, `split.unsplit`, `split.unsplitLabel`, `editor.closeEditorUnsplit`) + decide `common.split`; add `layout.chat/split/editor` + peek/chevron tooltips at 1:1 en/hu parity. → verify: `grep -rn 'split.unsplit\|closeEditorUnsplit' packages/client/src` empty; en/hu key sets equal.
- [x] 2.4 Rewrite `SplitToggleButton.test.tsx` for `LayoutModeSwitch` (or delete + new spec). → verify: suite green.
- [x] 2.5 Add the switch to `MobileHeader` (`SessionHeader.tsx`) — today it hosts no split control. → verify: switch present + mode-reactive on a mobile-breakpoint render.

## 3. Context wiring (`SplitWorkspaceContext.tsx`)
- [x] 3.1 Migrate every `split.open` consumer to `split.mode` — incl. the **server-watch effect** currently keyed on `split.open`; expose `setMode`. → verify: `tsc` clean; watch declares open files iff `mode!=='closed'`.
- [x] 3.2 Point content openers (`openInSplit`, `openChanges`, `openDiffTab`, `openLiveTarget`) at `mode:"split"`; opener from `full` returns to `split`. → verify: opening a file from `full` enters `split`, never `full`. (test-plan #opener)
- [x] 3.3 Update `.AGENTS.md` sidecars for `split-state.ts` + `SplitWorkspaceContext.tsx` (`open`→`mode`). → verify: `kb dox lint` clean for those rows.

## 4. Layout surface (`SessionSplitView` + `SplitWorkspace` + `EditorPane`)
- [x] 4.1 Swap `<SplitToggleButton/>` for `<LayoutModeSwitch/>` in the desktop header. → verify: header renders switch.
- [x] 4.2 `SessionSplitView.tsx`: pass `mode` (not `open`) to `SplitWorkspace`; `SplitRouteSync` deep-link writes `updateSplit({mode:"split"})`. → verify: `tsc` clean; deep-link opens `split`.
- [x] 4.3 `SplitWorkspace.tsx`: prop `open:boolean`→`mode`; render `closed` (chat + right-edge Editor peek), `split` (chat|divider+chevrons|editor), `full` (editor + leading-edge Chat peek, `ChatView` **kept mounted hidden**). → verify: draft/scroll survive `split→full→split`. (test-plan #peek)
- [x] 4.4 `EditorPane.tsx`: ✕ close handler `updateSplit({open:false})`→`{mode:"closed"}`; label → `editor.closeEditor`. → verify: ✕ lands in `closed`; no `closeEditorUnsplit` ref remains.
- [x] 4.5 Divider `‹`/`›` collapse chevrons with drag-vs-click guard. → verify: `‹`→`full`, `›`→`closed`; a click leaves the persisted ratio unchanged; drag still resizes + persists. (test-plan #chevron)
- [x] 4.6 Migrate the remaining `.open` test files: `split-state.test.ts`, `SplitWorkspaceContext.test.tsx`, `rail-width.test.ts`, `FileLink.split.test.tsx`. → verify: full client suite green.

## 5. Discipline checkpoints
- [x] 5.1 `doubt-driven-review` on the `open→mode` migration (persisted shape change, per-session) BEFORE it stands. → verify: review notes recorded; migration covered by 1.2 tests.
- [x] 5.2 `code-simplification` pass: content openers + editor ✕ route through `setMode`/`updateSplit`; `toggleSplit` deleted (zero callers). → verify: removed-surface list matches design.md.

## 6. Tests — L1 unit (folded from test-plan.md; extend `packages/client/src/lib/__tests__/split-state.test.ts` + `.../components/__tests__/SplitWorkspaceContext.test.tsx` + `SplitToggleButton.test.tsx`)
- [x] 6.1 Migration matrix, see `split-state.test.ts`: `{open:true,ratio:0.6}` · loadSplitState · →`mode:"split",ratio:0.6`; and `{open:false}`·load·→`mode:"closed"`. (test-plan #E1 #E2)
- [x] 6.2 Both-fields precedence, see `split-state.test.ts`: `{open:false,mode:"split"}` · loadSplitState · → `mode:"split"` (mode wins). (test-plan #E3)
- [x] 6.3 Strip-on-write, see `split-state.test.ts`: loaded legacy blob · first saveSplitState · → serialized JSON has `mode`, NO `open`. (test-plan #E4)
- [x] 6.4 Ratio clamp on migrate, see `split-state.test.ts`: `{open:true,ratio:1.2}` · load · → `ratio===0.75`. (test-plan #E5)
- [x] 6.5 Corrupt state, see `split-state.test.ts`: malformed JSON · session opens · → `mode:"closed"` default, error logged, no crash. (test-plan #E6)
- [x] 6.6 Direct closed↔full, see `SplitWorkspaceContext.test.tsx`: `mode:"full"` · select `Chat` · → `mode:"closed"`, never `split` between. (test-plan #E8)
- [x] 6.7 Switch a11y, see `SplitToggleButton.test.tsx`: `LayoutModeSwitch` · Arrow/Home/End + Enter/Space · → `role="radiogroup"`+`radio`, focus roves, selection sets mode, `aria-checked` reflects mode. (test-plan #A1)

## 7. Tests — L3 e2e (folded; extend `tests/e2e/editor-pane.spec.ts`; read `dashboardPort` from `.pi-test-harness.json`, never hardcode `:18000`)
- [x] 7.1 Tri-state render, see `editor-pane.spec.ts`: `closed` · select `Split` · → chat+divider+editor mounted, chat interactive. (test-plan #F1)
- [x] 7.2 Full via switch + draft preserved: `split`, composer draft "wip", scrolled up · `split→full→split` · → `ChatView` not remounted, draft="wip" + scroll unchanged. (test-plan #F2 #F3)
- [x] 7.3 Divider chevrons: `‹`→`full`, `›`→`closed`; press+release `›` without movement · → `closed`, persisted ratio unchanged; drag past min stops at 0.25/0.75. (test-plan #F4 #F5 #F6 #E7)
- [x] 7.4 Peeks: `closed`·activate right Editor peek·→`split` w/ prior tabs; `full`·activate leading Chat peek·→`split` visible. (test-plan #F7 #F8)
- [x] 7.5 Opener from full: `full` · click header Changed-Files chip · → `split` (never `full`), chat visible. (test-plan #F9)
- [x] 7.6 Switch presence + per-session: switch visible+active in `closed` (F10) and on mobile (F11); A=`split`50/50,B=`closed` · switch A→B→A · → B `closed`, A restores `split`50/50 (F14). (test-plan #F10 #F11 #F14)
- [x] 7.7 Mobile full: mobile viewport · select `Editor` · → editor fills stacked area, chat = edge grabber restoring `split`. (test-plan #F12)
- [x] 7.8 Full persists across reload: session in `full` · reload+reopen · → renders `full` (editor-only, chat peek), pane tabs restored. (test-plan #F13)
- [x] 7.9 `openspec validate editor-layout-modes` passes; `npm run quality:changed` clean; full client suite + e2e green.

## 8. Manual / QA (manifest: manual-only — not folded to tests, deferred post-merge)
- [x] 8.1 Header **icon-only vs glyph+word** against the live cramped desktop header "reads clean". (test-plan: manual-only #M1)
- [x] 8.2 Mobile `full` chat edge grabber discoverable + thumb-reachable on a 360px phone. (test-plan: manual-only #M2)
