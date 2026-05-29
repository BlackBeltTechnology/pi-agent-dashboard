> **Reference mockup:** [`mockup.html`](./mockup.html) in this change directory.
> Open in any browser to see every target state (no-proposal / implementing / complete × 4 palette profiles × light/dark). The implementation MUST match it visually.

## 1. Foundations

- [ ] 1.1 Add `--neon-rim-alpha`, `--neon-glow-alpha`, `--neon-glow-blur`, `--neon-glow-opacity`, `--neon-bg-tint` CSS variables to `:root` and the `[data-theme="light"]` block in `packages/client/src/index.css`. Values per the session-card-selection spec table.
- [ ] 1.2 Add the `@property --neon-angle { syntax: "<angle>"; inherits: false; initial-value: 0deg; }` declaration and the `@keyframes neon-rotate { to { --neon-angle: 360deg; } }` keyframes in `index.css`.
- [ ] 1.3 Add the `.card-selected-ring::before` (rim, masked, `inset: -1px`, 13 s rotation) and `.card-selected-ring::after` (glow, blurred, `inset: -3px`, 13 s rotation) rules in `index.css`.
- [ ] 1.4 Add the `@supports not (background: conic-gradient(...))` fallback that swaps the rim for a flat `rgba(96,165,250,.5)` border and animates the glow with a 6 s `neon-breathe` opacity pulse (35 % → 65 % → 35 %).
- [ ] 1.5 Add the `@media (prefers-reduced-motion: reduce) { .card-selected-ring::before, .card-selected-ring::after { animation: none; } }` rule.
- [ ] 1.6 Add the `.openspec-stepper-node-base` rule pattern that stacks `linear-gradient(var(--bg-tertiary), var(--bg-tertiary))` over `var(--bg-tertiary)` so completed-node tints never reveal the connecting line behind the node interior.

## 2. OpenSpecStepper component

- [ ] 2.1 Create `packages/client/src/components/OpenSpecStepper.tsx` exporting `<OpenSpecStepper variant="sidebar" | "compact" change={…} attached={…} />`.
- [ ] 2.2 Implement the pure `deriveStepperState({ attached, artifacts, completedTasks, totalTasks, changeState })` function in the same file (or a sibling `openspec-stepper-state.ts`). Return type: `{ explore, proposal, design, specs, tasks, apply, archive } : Record<NodeId, "done" | "current" | "todo" | "disabled">`.
- [ ] 2.3 Render 7 nodes in order `Explore → Proposal → Design → Specs → Tasks → Apply → Archive` with connecting lines. Use `mdi-compass-outline` for Explore, letters `P / D / S / T` for the artifact nodes, `mdi-play` for Apply, `mdi-archive-outline` for Archive. Done nodes use `mdi-check`.
- [ ] 2.4 Apply current-node halo pulse (2.4 s `pulse-current` keyframes, `3px → 5px → 3px` box-shadow). Suppress under `prefers-reduced-motion`.
- [ ] 2.5 Apply the opaque-base trick from 1.6 to every node's `background`.
- [ ] 2.6 `compact` variant: 18 px node diameter, no per-node text label, `title` attribute on each node carrying the label text, container `transform: scale(.92) translate(0,0)`.
- [ ] 2.7 Tasks node `<sub>` element rendering `<completed>/<total>` when `totalTasks > 0`.

## 3. OpenSpecStepper tests

- [ ] 3.1 Create `packages/client/src/components/__tests__/OpenSpecStepper.test.tsx`.
- [ ] 3.2 Snapshot test for the three canonical states: (a) no proposal + no changes, (b) IMPLEMENTING with 4/12 tasks, (c) COMPLETE with 12/12 tasks. Both `sidebar` and `compact` variants.
- [ ] 3.3 Pure-function test for `deriveStepperState` covering every (`ChangeState`, `artifact-statuses`, `tasks-progress`) matrix row from the openspec-attach-combo spec's stepper requirement.
- [ ] 3.4 Test that the connecting line CSS never bleeds through a done node: render with consecutive done nodes, assert the computed `background-color` of the node element is fully opaque.

## 4. Action gating in SessionOpenSpecActions

- [ ] 4.1 In `packages/client/src/components/SessionOpenSpecActions.tsx`, change the `Explore` button to always render but disable when `attached` is truthy. Tooltip: "Detach proposal to explore freely".
- [ ] 4.2 Always render the `Archive` button when actions are visible (status not ended). Disable when `attached` is falsy → tooltip "Attach a change to archive". Disable when `attached` AND `deriveChangeState !== COMPLETE` → tooltip "Complete tasks first". Streaming session takes precedence with tooltip "Session is streaming".
- [ ] 4.3 Mount `<OpenSpecStepper variant="sidebar">` above the action button row when `change` is non-null (attached path).
- [ ] 4.4 Update existing tests in `packages/client/src/components/__tests__/SessionOpenSpecActions.test.tsx` to reflect the new always-rendered disabled buttons and stepper presence.

## 5. WORKSPACE split → GIT + JJ subcards

- [ ] 5.1 In `packages/client/src/components/SessionCard.tsx`, delete the existing `WorkspaceSubcard` helper. Add `GitSubcard` (renders `<SessionSubcard title="GIT">` when `showGitInfo || session.gitWorktree`, contains `GitInfo` + `WorktreeActionsMenu`) and `JjSubcard` (renders `<SessionSubcard title="JJ">` when `useSlotHasClaimsForSession("session-card-badge", session) || useSlotHasClaimsForSession("workspace-action-bar", session)`, contains `SessionCardBadgeSlot` + `WorkspaceActionBarSlot`).
- [ ] 5.2 Update the subcard order in `SessionCard`'s desktop render path to `OPENSPEC → GIT → JJ → PROCESS → FLOWS → MEMORY`.
- [ ] 5.3 Remove any `WORKSPACE` references in helper components (e.g. `WorktreePill` is referenced by `GitInfo` — make sure it still renders inside `GitSubcard`).
- [ ] 5.4 Update `packages/client/src/components/__tests__/SessionCard*.test.tsx`:
  - Replace existing `WORKSPACE` predicate tests with the four-case matrix (colocated / pure-git / pure-jj / neither) from the session-card-subcards spec.
  - Add a regression test that the worktree pill renders inside GIT and never inside JJ.

## 6. Selected-card iridescent ring

- [ ] 6.1 In `packages/client/src/components/SessionCard.tsx`, add the `card-selected-ring` class token to the card root when `isSelected === true && !isMobile`. Keep the existing `border-blue-500/60 bg-blue-500/5 ring-1 ring-blue-500/30` tokens as the static fallback.
- [ ] 6.2 Add `isolation: isolate` to `.card-selected-ring` and `position: relative; z-index: 2` to direct children (`> *`) so card content stays above rim + glow.
- [ ] 6.3 Visual smoke check in `packages/client/src/components/__tests__/SessionCard.selection.test.tsx`: assert presence of the `card-selected-ring` class on the desktop selected card and absence on the mobile selected card.

## 7. ComposerSessionActions component

- [ ] 7.1 Create `packages/client/src/components/ComposerSessionActions.tsx`. Props: `{ session, change?, openspecHasDir, openspecPending, onSendPrompt, onAttach, onDetach, onReadArtifact, onBulkArchive, onRefresh }`.
- [ ] 7.2 Layout — single flex row with `flex-wrap: wrap`:
  1. Strip header: gradient dot + `session actions · <session-name>` label + refresh button.
  2. Divider.
  3. OpenSpec group: `<OpenSpecStepper variant="compact">` + reused action buttons (extract a shared `<OpenSpecActionButtons>` helper from `SessionOpenSpecActions` if needed).
  4. Divider.
  5. Git group: extract a `<GitActionButtons>` helper from the existing `WorktreeActionsMenu` desktop branch. Render only when `showGitInfo || session.gitWorktree`.
  6. Divider.
  7. JJ group: `<SessionCardBadgeSlot>` + `<WorkspaceActionBarSlot>`. Render only when the corresponding slot predicates fire.
- [ ] 7.3 Apply the same disabled-state gating as the sidecard: `Explore` disabled when attached; `Archive` disabled when not attached; all disabled when `status === "streaming"` (refresh excepted).
- [ ] 7.4 OpenSpec group hidden when `openspecHasDir === false && pending === false`.
- [ ] 7.5 Strip hidden when no session is selected (parent gate in `CommandInput`).

## 8. ComposerSessionActions tests

- [ ] 8.1 Create `packages/client/src/components/__tests__/ComposerSessionActions.test.tsx`.
- [ ] 8.2 Render with the three canonical session states (no proposal, IMPLEMENTING, COMPLETE) — assert button gating matches the sidecard.
- [ ] 8.3 Render in the four VCS predicate states (colocated / pure-git / pure-jj / neither) — assert git and jj groups appear/disappear independently.
- [ ] 8.4 Click `Apply` and assert `onSendPrompt` fires with `/skill:openspec-apply-change <change>`.
- [ ] 8.5 Render with `status: "streaming"` — assert every action button is disabled and refresh is enabled.

## 9. CommandInput wiring

- [ ] 9.1 In `packages/client/src/components/CommandInput.tsx`, mount `<ComposerSessionActions>` between the existing model/level row and the textarea. Pass session + openspec props through; reuse parent callbacks.
- [ ] 9.2 Pull session data from the same source the sidecard uses (likely a `useSession(selectedId)` selector or props from `ChatView`). Avoid duplicating data fetches — share the existing hooks/props.
- [ ] 9.3 No-op when no session selected (parent passes `session={undefined}` → strip renders nothing).
- [ ] 9.4 Add a regression test in `packages/client/src/components/__tests__/CommandInput.test.tsx` asserting the strip mounts in the expected DOM position (after model row, before textarea).

## 10. MDI migration on existing components

- [ ] 10.1 Audit `SessionCard.tsx`, `SessionOpenSpecActions.tsx`, `WorktreeActionsMenu.tsx`, `GitInfo`, `WorktreePill`, `CommandInput.tsx` for any remaining unicode-glyph-as-icon usage. Replace each with the MDI icon mapped in `/tmp/session-card-mockup/index.html` (canonical mapping table is in design.md §6).
- [ ] 10.2 Keep `P / D / S / T` artifact letters and the `PDST` chip's letter rendering as letters — these are semantic identifiers, not icons.
- [ ] 10.3 Verify no MDI icon path is loaded twice (consolidate imports in `mdi-icons.ts` if it exists).

## 11. Plugin re-test

- [ ] 11.1 Run `packages/jj-plugin/src/client/__tests__/*` and fix any assertions that pin the slot-host to `WORKSPACE` (now `JJ`).
- [ ] 11.2 Run `packages/honcho-plugin/src/client/__tests__/*` (claims `session-card-memory` only — should be unaffected; verify).
- [ ] 11.3 Run `packages/dashboard-plugin-runtime` tests; verify `WorkspaceActionBarSlot` export signature unchanged.

## 12. Visual smoke + integration

- [ ] 12.1 Manual smoke: open `/` on `npm run dev`, verify desktop card and composer strip match the mockup at [`mockup.html`](./mockup.html) across all 4 palette profiles × 2 modes. (Note: the `Default`-only palette ships from this change; the other 3 profiles in the mockup are dashboard-existing.)
- [ ] 12.2 Check mobile session list shows no iridescent ring and renders normally.
- [ ] 12.3 Selected-card neon visible but not distracting in the worst-case combination: `Solarized Light` + `card-input-pulse` simultaneously.
- [ ] 12.4 Run `npm test` — all suites green.

## 13. Docs

- [ ] 13.1 Update `docs/file-index-client.md` to note the new components: `OpenSpecStepper.tsx`, `ComposerSessionActions.tsx`. Annotate `SessionCard.tsx`, `SessionOpenSpecActions.tsx`, `CommandInput.tsx`, `index.css` rows with `See change: redesign-session-card-and-composer`.
- [ ] 13.2 If a `docs/file-index-plugins.md` row for `JjActionBar.tsx` exists, annotate with the same change reference noting the host-container move.
