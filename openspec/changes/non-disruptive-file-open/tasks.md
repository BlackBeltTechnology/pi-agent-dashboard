# Tasks

## 0. Ground in the mockup + coordination (do this first)

- [ ] 0.1 Serve `openspec/changes/non-disruptive-file-open/mockups/` and open
  `/index.html`. It is the interaction source of truth: mode stickiness
  (closed→split, full stays full), background tab add (no focus change), the
  unread dot, and the one-time pulse. Skim `mockups/ux-review.md` so every
  affordance traces to a cited rule.
- [ ] 0.2 Confirm sequencing with `redesign-split-layout-controls` (proposal
  `## Coordination`): land this change AFTER it, and rebase the single shared
  scenario `Content opener from full …` in `split-editor-workspace`. If this lands
  first, flag the redesign to rebase instead.

## 1. Reducer: activate flag + unread (editor-pane-state.ts)

- [ ] 1.1 Add `activate?: boolean` to the `openFile` action (default `true`).
- [ ] 1.2 Add `unread?: boolean` to `OpenFile`.
- [ ] 1.3 `openFile` with `activate === false`: NEW tab → push, keep `activeIndex`,
  set `unread: true`; EXISTING inactive tab → keep `activeIndex`, set `unread: true`
  (repeat = re-signal, re-pulse); EXISTING active tab → no-op. `activate !== false`
  → today's behaviour (activate + no unread).
- [ ] 1.4 Enforce the invariant **the active tab is never unread**: clear `unread`
  on the newly-active tab in BOTH `setActive` AND `closeTab` (extract
  `clearUnreadAt(openFiles, index)`; return a NEW array so the dot re-renders).
- [ ] 1.5 `isValidState` tolerates the optional `unread` field (older blobs stay
  valid) AND type-guards it (`unread === undefined || typeof unread === "boolean"`)
  so a corrupt `unread: 42` blob is rejected, not rendered as a stray dot.
- [ ] 1.6 Unit tests: activate:false adds without moving active + sets unread;
  activate:false on existing non-active sets unread without activating; setActive
  clears unread; default (no flag) activates as before; persisted blob without
  `unread` loads valid.

## 2. Openers: sticky mode + background flavour (SplitWorkspaceContext.tsx)

- [ ] 2.1 Extract `ensureRevealed()` → `if (split.mode === "closed")
  updateSplit({ mode: "split" })`. Read `split.mode` via a **plain dep** on each
  opener's `useCallback` (NO `modeRef` — the value memo already re-creates on
  every mode change and the watch effect already deps on `split.mode`; the ref was
  over-engineering). Replace the unconditional `updateSplit({ mode: "split" })` in
  `openInSplit`, `openLiveTarget`, `openUrlTarget`, `openDiffTab`, `openChanges`.
- [ ] 2.2 Route the param-less deep-link mode transition in `SessionSplitView.tsx`
  (`else updateSplit({ mode: "split" })`) through `ensureRevealed()` so a deep-link
  from `full` does not yank to `split`.
- [ ] 2.3 Add `opts?: { background?: boolean }` to **all three** canvas openers
  (`openInSplit`, `openLiveTarget`, `openUrlTarget`). Background + editor already
  shown → dispatch `openFile` with `activate: false` and DO NOT set `pendingScroll`.
  Background + `closed` → reveal split + activate (default). Keep `restrictCsp` a
  separate, orthogonal flag (CSP egress ≠ focus).
- [ ] 2.4 Tests: closed→split reveal; full stays full; split stays split;
  background open in split/full does not change active tab; background open from
  closed reveals + activates; a `live`/`url` background target also adds silently.
- [ ] 2.5 **Rewrite the existing `F9` test** in `SplitWorkspaceContext.test.tsx` —
  it asserts the *inverse* ("openers from full land in split, never full"). Flip it
  to: `openChanges()` and `openInSplit(...)` from `full` keep `full`.

## 3. Call-site intent audit

- [ ] 3.1 `CanvasDriver.tsx`: give `useOpenTarget` a `background` param. The
  auto-open **effect** passes `background: true`; the **mobile chip `onClick`**
  passes `background: false` (foreground). Thread it into all three target branches
  (file / live / url).
- [ ] 3.2 Confirm foreground (no background flag) for the user-click paths:
  `FileLink` (chat + tool-result), file-tree click, search-result select,
  `OpenFileButton`, `ChatView` `openDiffTab` (change-summary link). NOTE: there is
  NO automatic tool-result file open — do not invent one.
- [ ] 3.3 Leave `EditorPane.tsx` `live:preview` direct `openFile` dispatch as-is
  (mode-preserving in-pane action; documented exception).
- [ ] 3.4 Test: an auto-canvas **effect** open while another tab is active leaves
  the active tab unchanged and marks the new tab unread (focus-steal regression);
  a **mobile chip tap** activates the tab (foreground, not unread).

## 4. Unread affordance (EditorPane tab strip)

- [ ] 4.1 Render an unread dot on tabs where `unread === true`.
- [ ] 4.2 Play a one-time highlight/pulse when a tab is added OR re-signalled in the
  background (transient, keyed on add/re-signal — not persisted in state). Gate the
  animation behind `@media (prefers-reduced-motion: reduce)` → dot only, no pulse.
- [ ] 4.3 Any activation (click, keyboard, or `closeTab` re-activation) clears the
  unread dot — the active tab never shows a dot.
- [ ] 4.4 Test: unread dot renders for a background tab and disappears after
  activation; a repeat background open of the same tab re-pulses; reduced-motion
  shows the dot without the pulse animation.

## 5. Verify against the mockup + gates

- [ ] 5.1 Run the client in dev; compare to `mockups/index.html` in dark AND light
  — mode stickiness, silent background add, unread dot, one-time pulse.
- [ ] 5.2 `npm run quality:changed` (Biome + tsc + tests) green.
- [ ] 5.3 Code-review gate on the diff (`review-changes.ts`); fix Critical/Warning.

## 6. QA / manual

- [ ] 6.1 In `full` mode, click a file in the tree → stays `full`, file activates.
- [ ] 6.2 In `split` mode reading `a.ts`, have the agent write `b.ts` → `a.ts` stays
  active, `b.ts` arrives unread with a pulse; click `b.ts` → dot clears.
- [ ] 6.3 In `closed` mode, agent writes `b.ts` → split reveals with `b.ts` shown.
- [ ] 6.4 Mobile viewport: agent write shows the tap-to-open chip, no pane yank;
  tapping the chip activates the tab (foreground).
- [ ] 6.5 Header Changed-Files chip from `full` → mode stays `full`, the Changes/tree
  rail expands inside the editor with chat hidden (sign off the intentional visual).
- [ ] 6.6 Deep-link `/session/:id/editor` (no file param) from `full` → stays `full`.

## 7. Folded automated scenarios (from test-plan.md manifest)

L1 reducer — extend `packages/client/src/lib/__tests__/editor-pane-state.test.ts`:

- [ ] 7.1 `activate:false` + tab-not-open → pushed, activeIndex unchanged, new tab
  `unread:true` (test-plan #E1).
- [ ] 7.2 `activate:false` + open-inactive tab → activeIndex unchanged, tab set
  `unread:true` (re-signal) (test-plan #E2).
- [ ] 7.3 `activate:false` + open-active tab → no-op, active stays `unread:false`
  (test-plan #E3).
- [ ] 7.4 `activate` omitted → tab activated, `unread` unset (back-compat)
  (test-plan #E4).
- [ ] 7.5 Invariant: `closeTab` re-points activeIndex onto an unread adjacent tab →
  that tab's `unread` cleared (test-plan #E5).
- [ ] 7.6 Persisted blob without `unread` loads valid (test-plan #E6).
- [ ] 7.7 Persisted blob `unread:42` rejected → EMPTY_PANE_STATE + log
  (test-plan #E7).
- [ ] 7.8 Background `unread:true` tab, not activated → save+load keeps it unread
  (test-plan #E8).

L1 openers/mode — extend `packages/client/src/components/__tests__/SplitWorkspaceContext.test.tsx`
(this is also where the `F9` rewrite from §2.5 lands):

- [ ] 7.9 `closed` + `openInSplit('a.ts')` → mode `split`, `a.ts` active
  (test-plan #F1).
- [ ] 7.10 `full` + `openInSplit('a.ts')` → mode stays `full`, `a.ts` active
  (test-plan #F2).
- [ ] 7.11 `split` + `openInSplit('a.ts')` → mode stays `split` (test-plan #F3).
- [ ] 7.12 `full` + `openChanges()` → mode stays `full` (rewrites F9) (test-plan #F4).
- [ ] 7.13 `split`/`full` reading `a.ts` + user `openInSplit('b.ts')` → `b.ts`
  active, NOT unread (test-plan #F5).
- [ ] 7.14 `split`/`full` reading `a.ts` + `openInSplit('b.ts',{background:true})` →
  `a.ts` stays active, `b.ts` unread, mode unchanged (test-plan #F6).
- [ ] 7.15 `closed` + background open → mode `split`, target active, NOT unread
  (test-plan #F7).
- [ ] 7.16 `split` + `openLiveTarget(url,{background:true})` → live tab unread,
  `a.ts` active (test-plan #F8).
- [ ] 7.17 `split` + `openUrlTarget(url,{background:true})` → url tab unread,
  `a.ts` active (test-plan #F9).
- [ ] 7.18 Background open with `line=20` → no `pendingScroll` stashed
  (test-plan #F10).

L1 tab-strip render — extend `packages/client/src/components/editor-pane/__tests__/EditorPane.test.tsx`:

- [ ] 7.19 Unread dot renders on a background tab; gone after click-activation
  (test-plan #F16).
- [ ] 7.20 Repeat background open of an open-unread tab re-pulses, stays unread +
  inactive (test-plan #F17).

L3 e2e — extend `tests/e2e/editor-pane.spec.ts` (mode/deep-link) +
`tests/e2e/canvas-declare-tool.spec.ts` (auto-canvas). Read the harness port from
`.pi-test-harness.json` (`dashboardPort`) — never hardcode `:18000`:

- [ ] 7.21 `full` + navigate `/session/:id/editor` (no file) → stays `full`
  (test-plan #F11).
- [ ] 7.22 desktop `split` reading `a.ts` + agent canvas → `b.ts` → `a.ts` stays
  active, `b.ts` unread + dot, mode unchanged (test-plan #F12).
- [ ] 7.23 desktop `closed` + agent canvas → mode `split`, target active
  (test-plan #F13).
- [ ] 7.24 mobile (<768w) canvas change → no yank, `canvas-file-chip` visible
  (test-plan #F14).
- [ ] 7.25 mobile chip tap → target opens active, NOT unread (test-plan #F15).
- [ ] 7.26 `prefers-reduced-motion: reduce` + background tab → dot shows, no pulse
  animation (test-plan #F19).

## 8. Manual-only scenarios (deferred post-merge by ship-change)

- [ ] 8.1 Pulse smoothness / one-shot feel — human watches a background tab arrive;
  pulse plays once, non-jarring, draws the eye without stealing focus
  (test-plan: manual-only).
- [ ] 8.2 Changed-Files chip from `full` — Changes/tree rail expands inside the
  editor with chat hidden; layout reads OK, not cramped (test-plan: manual-only).
