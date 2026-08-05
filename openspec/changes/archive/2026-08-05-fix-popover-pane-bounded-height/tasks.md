## 1. Groundwork — resolve the design's open questions

- [x] 1.1 In `packages/client/src/components/settings/SettingsPanel.tsx`, determine which of the nested `overflow-y-auto` elements (lines ~835 and ~858) actually clips the model-selector popover; record the chosen element and whether the inner one is redundant.
- [x] 1.2 Confirm each of the 8 `usePopoverFlip` consumers has an inner scroll region (`flex-1 min-h-0 overflow-y-auto` or equivalent) so a bounded height inner-scrolls instead of clipping; list any consumer that lacks one.
- [x] 1.3 Decide floor scope: global ~260px vs per-consumer option defaulting to 120 with list-like popovers (`ModelSelector`, `ThinkingLevelSelector`, `ChatViewMenu`) opting into 260. Record the decision and rationale in `design.md` under Decisions.

## 2. Hook contract — tests first

- [x] 2.1 In `packages/client/src/hooks/__tests__/usePopoverFlip.test.ts`, add a failing test: when available space in the chosen direction is smaller than the floor, `maxHeight` equals the available space (never the larger floor).
- [x] 2.2 Add a failing test: `minHeight` is returned and equals `min(floor, availableSpace)`; when space < floor, `minHeight === maxHeight`.
- [x] 2.3 Add a failing test: `maxHeight` is never inflated above available space in either direction (down and flipped-up).
- [x] 2.4 Add a failing test: the measure path reads no popover content metrics — spy on the popover element's `scrollHeight` getter and assert it is not accessed during measurement on open, window scroll/resize, and boundary scroll/resize.
- [x] 2.5 Update existing tests that assert the old floor-in-`maxHeight` behavior to the new contract; verify they fail for the right reason before implementing.
- [x] 2.6 Run `npm test 2>&1 | tee /tmp/pi-test.log` and confirm only the new/updated popover tests fail.

## 3. Hook implementation

- [x] 3.1 In `packages/client/src/hooks/usePopoverFlip.tsx`, change `maxHeight` to the un-inflated available space in the chosen direction (drop `Math.max(MIN_POPOVER_HEIGHT, …)`).
- [x] 3.2 Add `minHeight` to `PopoverFlipState`, computed as `Math.min(floor, availableSpace)`; include it in `CLOSED_STATE`.
- [x] 3.3 Apply the floor decision from task 1.3 (raise `MIN_POPOVER_HEIGHT`, or add a per-consumer option defaulting to the current value).
- [x] 3.4 Update the hook's doc comment to state the `maxHeight` (bound) vs `minHeight` (floor, capped by bound) split, the reflow-free constraint, and `See change: fix-popover-pane-bounded-height`.
- [x] 3.5 Confirm tasks 2.1–2.5 now pass.

## 4. Consumer updates — apply both bounds at all 8 call sites (9 surfaces)

- [x] 4.1 `components/settings/ModelSelector.tsx` — apply `minHeight` alongside `maxHeight`; confirm the list region inner-scrolls.
- [x] 4.2 `components/settings/ThinkingLevelSelector.tsx` — apply `minHeight`.
- [x] 4.3 `components/settings/ThemePicker.tsx` — apply `minHeight`.
- [x] 4.4 `components/chat/ChatViewMenu.tsx` — apply `minHeight`.
- [x] 4.5 `components/chat/CommandInput.tsx` (composer dropdown, ~line 376) — apply `minHeight`.
- [x] 4.6 `components/chat/CommandInput.tsx` (attach menu, ~line 386) — apply `minHeight` if it consumes a height bound; note if height-agnostic.
- [x] 4.7 `components/worktree/WorktreeActionsMenu.tsx` — apply `minHeight`.
- [x] 4.8 `components/packages/PackageRow.tsx` — apply `minHeight`.
- [x] 4.9 Grep for every `maxHeight` destructured from `usePopoverFlip` and assert none applies it without `minHeight`; no call site may silently lose its floor.

## 5. Boundary provisioning at scroll panes

- [x] 5.1 Wrap the Settings clip pane identified in task 1.1 with `PopoverBoundaryProvider value={paneRef}` and attach the ref to that element.
- [x] 5.2 Wrap the chat composer host in `src/App.tsx` with `PopoverBoundaryProvider` bound to its scroll pane.
- [x] 5.3 Wrap the composer host in `components/folder/DirectoryHomeView.tsx`.
- [x] 5.4 Wrap the composer host in `components/session/ComposerSessionActions.tsx`.
- [x] 5.5 Verify in a dev browser session that the hook's dev warning ("boundaryRef does not contain the trigger") does not fire on any wrapped surface.
- [x] 5.6 Resolve whether `ThemePicker` and `CommandInput:376` need `usePopoverBoundary()` now that panes provide boundaries; wire or document as immune.

## 6. Verification — the no-second-scrollbar invariant

- [x] 6.1 Settings surface: open the model selector mid-pane and near the pane bottom; confirm the popover stays inside the pane, the pane's scroll extent is unchanged, and no second scrollbar appears.
- [x] 6.2 Chat surface: open the composer model selector with the composer pinned at the pane bottom; confirm it opens into available space, the chat pane does not stretch, and no second scrollbar appears.
- [x] 6.3 Confirm content-driven height: with a short filtered list the popover shrinks toward content but not below the floor; with a long list it stops at the bound and inner-scrolls.
- [x] 6.4 Regression-check the split chat pane (`SplitWorkspace`), which already provided a boundary, for unchanged behavior.
- [x] 6.5 Regression-check the small menus (`WorktreeActionsMenu`, `PackageRow`) against the floor decision from 1.3; confirm they are not oddly tall.
- [x] 6.6 Run the full suite: `npm test 2>&1 | tee /tmp/pi-test.log` then `grep -nE 'FAIL|Error|✗|✘' /tmp/pi-test.log`.
- [x] 6.7 `npm run quality:changed` and resolve findings on touched files.

## 7. Discipline checkpoints

- [x] 7.1 `performance-optimization` — confirm the measure path is reflow-free (task 2.4 passing) and that the added boundary `scroll`/`ResizeObserver` listeners on new panes do not thrash layout while scrolling with a popover open.
- [x] 7.2 `doubt-driven-review` — stress-test the `maxHeight`/`minHeight` contract split before it stands, given 8 dependent call sites.
- [x] 7.3 `review-code` — review the full diff before commit.

## 8. Documentation

- [x] 8.1 Update the `usePopoverFlip.tsx` row in `packages/client/src/hooks/AGENTS.md` with the new return shape and `See change: fix-popover-pane-bounded-height`.
- [x] 8.2 Update the `PopoverBoundaryContext.tsx` row in `packages/client/src/lib/state/AGENTS.md` to list every pane that now provides a boundary.
- [x] 8.3 Update the affected component rows / sidecars in their directory `AGENTS.md` files (`components/settings/`, `components/chat/`, `components/worktree/`, `components/packages/`, `components/folder/`, `components/session/`, `src/`).
- [x] 8.4 Delegate any `docs/` prose update to the `DocScribe` subagent in caveman style (main agent must not edit `docs/` directly); apply the tree rows it returns.

## 9. Rebase onto develop — re-audit the consumer enumeration

- [x] 9.1 Rebase onto `origin/develop`; resolve the `ModelSelector.tsx` conflict (#404's `useId`) and the auto-merged `ThinkingLevelSelector.tsx` (74facdf4's chip font size) preserving BOTH sides.
- [x] 9.2 Re-run the suite post-rebase and confirm red is stale-dependency only (`pnpm install` after #405's lockfile bump), not conflict fallout.
- [x] 9.3 Audit #404's launch-dialog run-config row as a new consumer surface: both bounds, host boundary, 260 opt-in. Record as design Decision 10.
- [x] 9.4 Update the spec consumer enumeration to 9 surfaces (surface → call site → floor table) and add scenarios to both spec deltas.
- [x] 9.5 Pin the new surface with tests in `components/__tests__/OpenSpecRunConfig.test.tsx`, including a contrast case proving the boundary assertion is not tautological.
- [x] 9.6 Update the affected `AGENTS.md` rows for the 9th surface.

## 10. Branch hygiene + docker-harness qualification

- [x] 10.1 Evict the 4 commits that do not belong to this change (`folder-chevron-drag-handle` ×3 + `fix-tags-lost-on-bridge-reattach`, the latter already squash-merged upstream as #396): reset to `origin/develop` (`5b695446`, #407) and cherry-pick only this change's 3 commits. Gate: `git diff --name-only origin/develop..HEAD` contains only this change's files.
- [x] 10.2 Confirm zero contact with #407's territory (`packages/server/src/terminal/*`, event-store essential-event set) — 0 files under `packages/{server,extension,shared}/`; this change is client-only.
- [x] 10.3 Re-verify both sides survived on the new base: #404's `useId`/`dropdownId`/aria in `ModelSelector`, 74facdf4's `text-xs` chip line in `ThinkingLevelSelector` (byte-identical to `origin/develop`), alongside our `minHeight`/`maxHeight`.
- [x] 10.4 Qualify in the worktree's OWN docker harness (never `:8000`). Overlay mode fails on this host (`cannot mount overlay read-only`, exit 32) → used the documented `TEST_COPY_MODE=1` fallback. Own derived port from `.pi-test-harness.json`; torn down with `docker/test-down.sh`.
- [x] 10.5 Harness-verify the no-second-scrollbar invariant in a slim pane and the floor's readability. See design Decision 11 for measurements and the surface-9 reachability gap.
