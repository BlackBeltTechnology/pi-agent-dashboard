## 1. Shared state model (TDD)

- [x] 1.1 L1 test, `deriveStepperState` decision table (test-plan #E1). Harness exemplar: `packages/client/src/components/__tests__/OpenSpecStepper.test.tsx`.
  - Input: changeState ∈ {PLANNING, READY, IMPLEMENTING, COMPLETE, null} × tasks {0/0, 0/39, 12/39, 39/39}.
  - Trigger: call derive.
  - Observable:
    - Tasks is todo/current/current/done by state (current even at 39/39 while IMPLEMENTING);
    - Archive is current iff COMPLETE;
    - null gives all `todo`;
    - keys are exactly proposal, design, specs, tasks, archive.

  Verify: fails on current code.
- [x] 1.2 L1 test, artifact segment states (test-plan #E2). Harness exemplar: `__tests__/OpenSpecStepper.test.tsx`.
  - Input: artifact status ∈ {done, skipped, ready, blocked, absent}.
  - Trigger: call derive.
  - Observable: maps to done / skipped / current / todo / todo.

  Verify: fails on current code.
- [x] 1.3 L1 test, current-count invariant (test-plan #E3). Harness exemplar: `__tests__/OpenSpecStepper.test.tsx`.
  - Input: READY; IMPLEMENTING 12/39 and 39/39; COMPLETE; PLANNING with design+specs `ready`.
  - Trigger: derive and count `current`.
  - Observable: exactly 1 current in READY/IMPLEMENTING/COMPLETE; exactly `design` and `specs` in the PLANNING case.

  Verify: fails on current code.
- [x] 1.4 Reshape `deriveStepperState` in `packages/client/src/components/openspec/OpenSpecStepper.tsx` per design D1/D2:
  - `SegmentId` / `SegmentState` types;
  - drop the `attached` and `hasAnyChanges` inputs.

  Verify: 1.1–1.3 pass, and `npx tsc --noEmit -p packages/client` lists every consumer to fix.

## 2. Lifecycle bar renderer

- [x] 2.1 L1 test, Tasks label and fill boundaries (test-plan #E4). Harness exemplar: `__tests__/OpenSpecStepper.test.tsx`.
  - Input: totalTasks ∈ {0, 1, 39}, completed ∈ {0, 12, total}.
  - Trigger: render the bar.
  - Observable: `Tasks —` as an inert `<div>` at 0; `0/1` gives fill 0 %; `12/39` gives width 31 %±1; `39/39` gives 100 %.

  Verify: fails first.
- [x] 2.2 L1 test, skipped rendering (test-plan #E5). Harness exemplar: `__tests__/OpenSpecStepper.test.tsx`.
  - Input: specs `skipped`.
  - Trigger: render.
  - Observable: `stepper-segment-specs` has `data-state="skipped"`, a label containing `–`, and the `statusPresentation("done")` token.

  Verify: fails first.
- [x] 2.3 L1 test, accessible names and focusability (test-plan #E13). Harness exemplar: `__tests__/OpenSpecStepper.test.tsx`.
  - Input: design ready, tasks 12/39.
  - Trigger: render.
  - Observable:
    - root `role="group"` named "OpenSpec lifecycle";
    - segment names `Design, current` and `Tasks 12 of 39 done`;
    - inert segments are `<div>` with no tabindex.

  Verify: fails first.
- [x] 2.4 L1 test, missing handlers (test-plan #X2). Harness exemplar: `__tests__/OpenSpecStepper.test.tsx`.
  - Input: compact bar with `onReadArtifact` and `onArchive` undefined.
  - Trigger: click Proposal, then Archive.
  - Observable: no throw, both segments inert.

  Verify: fails first.
- [x] 2.5 Rewrite the `OpenSpecStepper` render as the segmented bar:
  - each segment is a `<button>` (or an inert `<div>`) holding track + label, at least 24 px tall;
  - `variant: "sidebar" | "compact"`, with compact rendering no actions;
  - optional `onArchive`;
  - `role="group"` root, keeping `data-testid="openspec-stepper"`;
  - `data-testid="stepper-segment-<id>"` and `data-state` per segment;
  - `done`/`current`/`todo` from `statusPresentation`; `skipped` uses `done`'s token plus a local `–` glyph;
  - segment clicks `stopPropagation`.

  Verify: 2.1–2.4 pass.
- [x] 2.6 In `packages/client/src/index.css`, replace the `.openspec-stepper-node-*` rules with the bar styles:
  - colors from `statusPresentation(kind).tokenVar`, with no raw hex;
  - hatched `skipped` track;
  - `container-type: inline-size` on the bar and `@container (max-width: 250px)` swapping labels to letters;
  - pulse `animation: none` under `prefers-reduced-motion: reduce`.

  Verify: covered by 6.2–6.4.

## 3. Session card (`SessionOpenSpecActions`)

- [x] 3.1 L1 test, primary by state and workflow gating (test-plan #E6). Harness exemplar: `packages/client/src/components/__tests__/SessionOpenSpecActions.test.tsx`.
  - Input: state × workflows {all, core, all-minus-archive}.
  - Trigger: render.
  - Observable:
    - PLANNING: `continue-btn` with all; no primary with core;
    - READY and IMPLEMENTING: `apply-btn`;
    - COMPLETE: `archive-btn` with all; `verify-btn` with all-minus-archive;
    - never a `state-pill`, an inline `explore-btn`, or a disabled `archive-btn`.

  Verify: fails first.
- [x] 3.2 L1 test, `⋯` contents by state (test-plan #E7). Harness exemplar: `__tests__/SessionOpenSpecActions.test.tsx`.
  - Input: state × isComplete, all workflows.
  - Trigger: click `openspec-overflow-btn`.
  - Observable:
    - PLANNING: FF, Explore…, Detach;
    - READY: Explore…, Detach;
    - IMPLEMENTING + isComplete + artifacts done: Archive anyway…, Explore…, Detach;
    - IMPLEMENTING with isComplete≠true: no Archive anyway;
    - COMPLETE: Verify, Explore…, Detach;
    - every item has an MDI icon.

  Verify: fails first.
- [x] 3.3 L1 test, ended and not-found branches (test-plan #E8). Harness exemplar: `__tests__/SessionOpenSpecActions.test.tsx`.
  - Input: (a) attached + `ended`; (b) attached `archived-change` missing from data.
  - Trigger: render, then open `⋯`.
  - Observable:
    - (a) no primary, bar present, `⋯` holds only Detach;
    - (b) badge + `⋯` with only Detach, no bar, no standalone `detach-btn`.

  Verify: fails first.
- [x] 3.4 L1 test, unattached branch unchanged (test-plan #E9). Harness exemplar: `__tests__/SessionOpenSpecActions.test.tsx`.
  - Input: attachedProposal null, status active / ended.
  - Trigger: render.
  - Observable: active shows the attach combo, `+ Change` and an enabled `explore-unattached-btn`, with no Archive; ended shows none of them.

  Verify: passes before and after (regression guard).
- [x] 3.5 L1 test, segment clicks (test-plan #F1). Harness exemplar: `__tests__/SessionOpenSpecActions.test.tsx`.
  - Input: attached IMPLEMENTING 12/39, idle.
  - Trigger: click Design, then Tasks.
  - Observable: `onReadArtifact("add-auth","design")` called once; TasksPopover opens.

  Verify: fails first.
- [x] 3.6 L1 test, Archive segment gating (test-plan #F2). Harness exemplar: `__tests__/SessionOpenSpecActions.test.tsx`.
  - Input: (a) COMPLETE, idle, all workflows; (b) COMPLETE, streaming; (c) IMPLEMENTING.
  - Trigger: click `stepper-segment-archive`.
  - Observable:
    - (a) the Confirm opens, and confirming sends `/skill:openspec-archive-change add-auth`;
    - (b) and (c) no dialog, no prompt, and the segment is a `<div>`.

  Verify: fails first.
- [x] 3.7 L1 test, streaming (test-plan #F3). Harness exemplar: `__tests__/SessionOpenSpecActions.test.tsx`.
  - Input: attached IMPLEMENTING 12/39, `streaming`.
  - Trigger: click Proposal, click Tasks, open `⋯`.
  - Observable:
    - the proposal opens;
    - the Tasks popover does not open;
    - the primary is `aria-disabled="true"` with title "Session is streaming";
    - menu items are disabled except Detach.

  Verify: fails first.
- [x] 3.8 L1 test, portal bubbling (test-plan #F4). Harness exemplar: `packages/client/src/components/__tests__/SessionCard.test.tsx`.
  - Input: an unselected `SessionCard` with an attached change.
  - Trigger: open `⋯`, then select Explore….
  - Observable: ExploreDialog opens; the `onSelect` spy is called 0 times.

  Verify: fails first.
- [x] 3.9 L1 test, keyboard menu (test-plan #F5). Harness exemplar: `__tests__/SessionOpenSpecActions.test.tsx`.
  - Input: attached READY.
  - Trigger: focus `⋯`, press Enter, flush the rAF, then press Escape.
  - Observable: `document.activeElement` is the first enabled item; after Escape the menu is gone and focus is on `openspec-overflow-btn`.

  Verify: fails first.
- [x] 3.10 L1 test, change-scoped Explore (test-plan #F6). Harness exemplar: `__tests__/SessionOpenSpecActions.test.tsx`.
  - Input: attached `add-auth`.
  - Trigger: `⋯`, then Explore…, then submit `what does step 3 mean?`.
  - Observable: `onSendPrompt("/skill:openspec-explore add-auth\nwhat does step 3 mean?")`.

  Verify: fails first.
- [x] 3.11 L1 test, Detach via `⋯` (test-plan #F7). Harness exemplar: `__tests__/SessionOpenSpecActions.test.tsx`.
  - Input: attached, idle and ended.
  - Trigger: `⋯`, then Detach.
  - Observable: `onDetach` called once; after the prop update the unattached combo renders.

  Verify: fails first.
- [x] 3.12 L1 test, missing change between renders (test-plan #X1). Harness exemplar: `__tests__/SessionOpenSpecActions.test.tsx`.
  - Input: attached change present, then removed from `changes`.
  - Trigger: rerender.
  - Observable: bar and primary gone; badge + `⋯` (Detach only) remain; no throw.

  Verify: fails first.
- [x] 3.13 Implement the header row per design D4/D4b/D4c/D4d/D6/D9:
  - badge, spacer, primary `ActionButton` (first enabled candidate), and `openspec-overflow-btn` opening a `Popover` whose `anchorEl` state comes from `event.currentTarget`;
  - menu items as buttons with MDI icons and `stopPropagation`: `ff-btn`, `verify-btn`, `archive-anyway-btn`, `explore-menu-item`, divider, `detach-btn`;
  - first-item focus via rAF; refocus `⋯` in `onDismiss`;
  - `onArchive` / `onOpenTasks` passed to the bar only under their gates;
  - `ExploreDialog` triggered from Explore…;
  - ended and not-found branches use `⋯` with only Detach.

  Verify: 3.1–3.12 pass.
- [x] 3.14 Remove `StatePill`. Delete `session/StatePill.tsx`, `__tests__/StatePill.test.tsx` and the `session/StatePill.tsx.AGENTS.md` sidecar, and drop its row in `packages/client/src/components/session/AGENTS.md`. Verify: `grep -rnw "StatePill" packages/client/src` is empty.
- [x] 3.15 L1 test, i18n orphan keys (test-plan #E12). Harness exemplar: `packages/client/src/lib/__tests__/i18n-orphans.test.ts`.
  - Input: `lib/i18n/i18n.tsx` and `lib/i18n/i18n-hu.ts` sources.
  - Trigger: read the files.
  - Observable: `openspec.node.explore` and `openspec.node.apply` are absent; the new overflow and segment-name keys are present in both.

  Verify: fails first.
- [x] 3.16 Update the i18n catalogs:
  - add "More actions" and the segment-name keys to `lib/i18n/i18n.tsx`, `lib/i18n/i18n-hu.ts` and `lib/i18n-en-source.json`;
  - remove `openspec.node.explore` / `openspec.node.apply` from `i18n.tsx` and `i18n-hu.ts`.

  Verify: 3.15 passes.

## 4. Board card (`OpenSpecBoardView`)

- [x] 4.1 L1 test, card content (test-plan #E11). Harness exemplar: `packages/client/src/components/__tests__/OpenSpecBoardView.test.tsx`.
  - Input: board change IMPLEMENTING 3/8.
  - Trigger: render.
  - Observable: a compact bar with Tasks `3/8`; no `board-card-state`, no `board-card-progress`, and no primary or `⋯` inside the bar.

  Verify: fails first.
- [x] 4.2 L1 test, board session-row panel (test-plan #F8). Harness exemplar: `__tests__/OpenSpecBoardView.test.tsx`.
  - Input: a card whose session row is attached to an IMPLEMENTING change.
  - Trigger: `session-os-menu-<id>`, then `⋯`, then Detach.
  - Observable: `onDetachProposal(<id>)` called; no navigation callback; no drag start.

  Verify: fails first.
- [x] 4.3 In `ProposalCard`:
  - remove `BoardStatePill` (keep it in `DragChip`);
  - remove the `board-card-progress` block;
  - pass the new `deriveStepperState` inputs;
  - keep the bar wrapper's `onPointerDown` `stopPropagation`.

  Verify: 4.1–4.2 pass.

## 5. Composer strip (`ComposerSessionActions`)

- [x] 5.1 L1 test, composer gating (test-plan #E10). Harness exemplar: `packages/client/src/components/__tests__/ComposerSessionActions.test.tsx`.
  - Input: attached {no, yes} × {IMPLEMENTING 12/39, COMPLETE}.
  - Trigger: render.
  - Observable:
    - unattached: enabled `composer-explore-btn`, no archive;
    - attached IMPLEMENTING: no explore, no archive; `composer-artifact-t` with text `12/39`, aria-label "Tasks 12 of 39 done" and underline width 31 %;
    - attached COMPLETE: enabled `composer-archive-btn`.

  Verify: fails first.
- [x] 5.2 L1 test, streaming chips (test-plan #F13). Harness exemplar: `__tests__/ComposerSessionActions.test.tsx`.
  - Input: bound streaming session, attached 12/39.
  - Trigger: click the P chip, then the tasks chip.
  - Observable: the P chip calls `onReadArtifact`; the tasks chip is `disabled` and no popover opens.

  Verify: passes as a regression guard, and fails if 5.3 loosens it.
- [x] 5.3 Implement the composer changes:
  - Explore hidden when attached;
  - Archive only when COMPLETE;
  - `completed/total` as the tasks-chip main text with a proportional 2 px underline;
  - keep `wf()` gating;
  - P/D/S enabled and the tasks chip disabled while streaming;
  - `skipped` shown as done.

  Verify: 5.1–5.2 pass.

## 6. Rendered-UI (Playwright vs docker harness)

- [x] 6.1 L3 test, segment press vs drag (test-plan #F9). Harness exemplar: `tests/e2e/openspec-board-drop.spec.ts`.
  - Input: board with one card, proposal done.
  - Trigger: pointer-down and up on `stepper-segment-design` in the card.
  - Observable: the artifact dialog opens; the card stays in its column, with no reorder and no `DragChip` overlay.

  Verify: passes on the harness, reading the port from `.pi-test-harness.json`.
- [x] 6.2 L3 test, container-query collapse (test-plan #F10). Harness exemplar: `tests/e2e/openspec-init-affordances-session-card.spec.ts`.
  - Input: session and board card with the bar at 280, 251, 249 and 220 px.
  - Trigger: render.
  - Observable:
    - at ≥250 px, full labels;
    - below 250 px, labels `P D S A` with Tasks still `12/39`;
    - bar `scrollWidth ≤ clientWidth` at every width.

  Verify: passes.
- [x] 6.3 L3 test, hit target (test-plan #F11). Harness exemplar: `tests/e2e/openspec-init-affordances-session-card.spec.ts`.
  - Input: session card, IMPLEMENTING.
  - Trigger: `boundingBox()` of each interactive `stepper-segment-*`.
  - Observable: every height ≥ 24.

  Verify: passes.
- [x] 6.4 L3 test, reduced motion (test-plan #F12). Harness exemplar: `tests/e2e/chat-render-fx.spec.ts` (for `emulateMedia`).
  - Input: COMPLETE change, `emulateMedia({reducedMotion:"reduce"})`.
  - Trigger: read the computed `animation-name` of the Archive track.
  - Observable: `none`; without the emulation it is not `none`.

  Verify: passes.
- [x] 6.5 Rename selectors in `tests/e2e/openspec-init-affordances-session-card.spec.ts`, `openspec-artifact-dialog.spec.ts`, `overlay-layout.spec.ts` and `__tests__/SessionCard.test.tsx`:
  - `stepper-node-*` → `stepper-segment-*`;
  - `explore-btn` / `detach-btn` → the menu flow;
  - add `openspec-overflow-btn` to the OpenSpec-disabled absence list.

  Verify: `grep -rnE "stepper-node-|state-pill" tests packages/client/src --include=*.ts*` is empty, and every remaining `explore-btn` hit is unattached-only.

## 7. Docs & verification

- [x] 7.1 Update the rows for `OpenSpecStepper.tsx`, `SessionOpenSpecActions.tsx`, `OpenSpecBoardView.tsx` and `ComposerSessionActions.tsx` in their directory `AGENTS.md` / sidecar files, adding `See change: compact-openspec-lifecycle-bar`. Verify: `kb_search --doc-type agents "lifecycle bar"` finds them.
- [x] 7.2 Run the full suite: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`. Verify: the grep summary shows 0 failed.
- [x] 7.3 Run `review-code` on the diff and fix any blocking findings. Verify: the review shows no blocking items.
- [x] 7.4 Manual visual parity check (test-plan: manual-only, #F14): compare the session card in PLANNING / IMPLEMENTING / COMPLETE, the board card and the composer strip, in Studio and Light, against `mockups/openspec-compact-states/index.html`. Verify: human sign-off that the block is ≈48 px with no clipped labels at 300 px. **DEFERRED — not yet run** (post-merge human verification).
