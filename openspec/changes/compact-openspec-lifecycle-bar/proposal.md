## Why

The attached-change block on the session card takes ~112 px across four rows (badge+pill+Detach, 7-node stepper, labels + `N/M` sub-row, action row). Much of it repeats itself. The state pill repeats the stepper. The Explore node and button are always disabled once a change is attached. A disabled Archive button repeats the Archive node. Tasks and Apply both go `current` at once, which looks like two active steps. The OpenSpec board card shows a stepper *and* a separate progress bar. The target is ~48 px with one lifecycle visual and one primary action.

Mockup: `mockups/openspec-compact-states/index.html` (refined Option C); alternatives in `options.html`.

## What Changes

- **BREAKING (UI contract)**: Replace the 7-node pills+lines `OpenSpecStepper` with a **5-segment lifecycle bar**: `Proposal · Design · Specs · Tasks · Archive`.
  - `Explore` segment removed. Unattached sessions keep their own Explore button, unchanged.
  - `Tasks` and `Apply` merge into one `Tasks` segment. While READY/IMPLEMENTING its track fills by `completedTasks/totalTasks`.
  - Each segment is one button, ≥24 px tall (6 px track + label).
  - `skipped` artifacts render with a distinct hatched/"–" variant.
  - Below 250 px of bar width, a container query swaps the labels to letters.
- Shared `deriveStepperState` changes shape. The `NodeId` union loses `explore` and `apply`, and a `skipped` state is added. The session card, board card and composer chips all consume it.
- Session card, attached branch:
  - Removes the `StatePill`.
  - Removes the always-disabled Explore button.
  - Removes the disabled Archive button.
  - Renders **one primary action** per `ChangeState`: PLANNING → Continue, READY/IMPLEMENTING → Apply, COMPLETE → Archive.
  - Moves FF, Verify, Archive anyway and Detach into a `⋯` overflow menu.
  - Adds an enabled, change-scoped **Explore…** item to `⋯`. It replaces the hard-disabled inline Explore, and makes `/skill:openspec-explore <change>` reachable again as `openspec-frontend-actions` requires.
- Archive segment: clicking it while COMPLETE opens the same archive confirm as the primary button. Otherwise it is inert.
- OpenSpec board card: removes the state pill and the separate task-progress block. The bar (compact variant, no actions) carries both.
- Composer strip (`ComposerSessionActions`):
  - Hides the Explore icon while a change is attached.
  - Hides the Archive icon unless COMPLETE.
  - Turns the `T` chip into a count chip: `completed/total` becomes the chip text (it was a `sub` beside the letter), with a progress underline.
  - Keeps the P/D/S chips enabled while streaming, because they are read-only previews. The tasks chip stays disabled while streaming, because its list toggles checkboxes. The session-card Tasks segment follows the same rule.
- Attached-branch actions stay gated by the folder's OpenSpec workflow configuration (`wf()`). The primary is the first enabled candidate for the state.
- Ended attached sessions keep Detach reachable through `⋯`.
- Test IDs are renamed `stepper-node-*` → `stepper-segment-*`, for `proposal`, `design`, `specs`, `tasks` and `archive`.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `openspec-attach-combo`: the PDST-button requirement is scoped to the chat-view session header, where `ArtifactLettersButton` actually renders. The state pill requirement is removed. The stepper requirement becomes the lifecycle-bar requirement. The attached action row becomes one primary action plus a `⋯` overflow. The unattached Archive button is dropped, which aligns the spec with current code.
- `openspec-board`: proposal card content no longer includes a state pill or a separate progress bar. The lifecycle-stepper requirement becomes the compact lifecycle bar.
- `openspec-card-section`: the board session-row OpenSpec menu now mirrors the new header plus `⋯`. The worktree progress reference moves from the "card progress bar" to the card lifecycle bar's Tasks segment.
- `openspec-task-toggle`: the "Tasks popover button" becomes the lifecycle bar's Tasks segment, with no separate action-row button. It is inert while streaming.
- `openspec-board-status-visuals`: the "completed proposal" scenario points at the lifecycle bar instead of the removed state pill and task bar.
- `chat-view`: the `ComposerSessionActions` gating changes. Explore is hidden rather than disabled when attached. Archive renders only when COMPLETE. The T chip becomes a count chip.

## Impact

- **Code**:
  - `packages/client/src/components/openspec/OpenSpecStepper.tsx` (rewrite render plus `deriveStepperState`)
  - `SessionOpenSpecActions.tsx`
  - `OpenSpecBoardView.tsx`
  - `session/ComposerSessionActions.tsx`
  - `session/StatePill.tsx` plus its test and its `StatePill.tsx.AGENTS.md` sidecar are deleted. `SessionOpenSpecActions` is the only importer.
  - The board per-session OpenSpec panel (`BoardSessionRow`) mounts `SessionOpenSpecActions`, so it inherits the new header and `⋯` menu.
  - `packages/client-utils` is consumed as-is: `statusPresentation` for segment tokens and glyphs, and `Popover` for `⋯`. The focus-on-open and focus-restore logic lives in the consumer (`SessionOpenSpecActions`), not in `client-utils`.
  - `index.css` (`.openspec-stepper-node-*` classes replaced)
- **Tests**:
  - `__tests__/OpenSpecStepper.test.tsx`
  - `SessionOpenSpecActions` and `ComposerSessionActions` tests
  - board tests
  - Playwright specs using `stepper-node-*`, `explore-btn`, `archive-btn` and `verify-btn` selectors
- **i18n**: add keys for the overflow label and the segment accessible names to `lib/i18n/i18n.tsx`, `lib/i18n/i18n-hu.ts` and `lib/i18n-en-source.json`. Remove the orphaned `openspec.node.explore` / `openspec.node.apply` keys, and assert their absence using the `lib/__tests__/i18n-orphans.test.ts` pattern.
- **No server / protocol / shared-type changes.** Client-only. Rollback = revert the client commit.

## Discipline Skills

- `review-code` — non-trivial client change before commit.
- None of `security-hardening`, `performance-optimization` or `observability-instrumentation` applies. The change adds no untrusted input, no latency budget and no new endpoints.
