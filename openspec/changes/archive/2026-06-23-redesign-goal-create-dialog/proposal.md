# redesign-goal-create-dialog

## Why

Goal creation is the **only** folder-plugin create flow that renders inline. After
`add-goals-folder-page` (folder board) and `sophisticate-goal-authoring-and-control`
(rich `GoalForm`), the `+ Goal` / `+ New Goal` affordances drop a `<GoalForm>` panel
**in-place** — pushing the sidebar down or the board's filter bar + cards down — while
the sibling automation plugin opens a proper modal `CreateAutomationDialog`. The
inconsistency is visible and felt: automations get a focused overlay; goals get a panel
that displaces the surrounding list.

Two call sites render the **same** `GoalForm` inline today:

- `packages/goal-plugin/src/client/FolderGoalsSection.tsx` — `+ Goal` → inline panel in the sidebar.
- `packages/goal-plugin/src/client/GoalsBoardClaim.tsx` — `+ New Goal` → inline panel under the board header.

Both should open **one shared modal dialog** (parity with `CreateAutomationDialog`),
so the create surface is consistent across plugins and stops displacing the board/sidebar
while the user is authoring.

## What Changes

- Add `packages/goal-plugin/src/client/CreateGoalDialog.tsx` — a modal wrapper around the
  existing `GoalForm`, mirroring `CreateAutomationDialog`'s overlay (`fixed inset-0 z-50
  flex items-center justify-center bg-black/40 p-4` + centered `max-w-lg` card, click-backdrop
  to close, `data-testid="goal-create-dialog"`). `GoalForm` is reused **unchanged** — same
  fields, same `createGoal` payload, same testids (`goal-form-*`).
- `FolderGoalsSection`: `+ Goal` opens `CreateGoalDialog` instead of the inline panel.
- `GoalsBoardClaim`: `+ New Goal` opens `CreateGoalDialog` instead of the inline panel.
  Remove the `goals-board-create` inline container; the `goals-board-new` button now opens the dialog.
- Update the goal-plugin client tests (`GoalsBoardClaim.test.tsx`, `FolderGoalsSection.test.tsx`)
  to assert the dialog opens/closes and that `GoalForm` submits through it; add a `CreateGoalDialog.test.tsx`.
- Mockup `mockups/goal/index.html` Screen A is the visual source of truth (modal dialog, fields
  synced to shipped `GoalForm`, opens from both surfaces). Verified via the `frontend-mockup-loop`
  (GROUND against shipped `GoalForm` + `CreateAutomationDialog` overlay tokens; TEST screenshot pass
  in dark + light themes). Loop fixes applied: dropped the non-spec `Goals ›` header crumb to match
  the bare `<h2>` of `CreateAutomationDialog`; added `aria-label`s to the icon-only ✕ / + Add /
  remove buttons (a11y floor); marked the two teaching hints mockup-only in the legend.

## Capability

`goals-folder-page` — the create affordance presentation changes from an inline panel to a
shared modal dialog. No field, payload, or backend change.

## Non-goals

- **No `GoalForm` field changes** — the form (objective, criteria, max-turns, max-spend, judge,
  self-judge) stays exactly as shipped in `sophisticate-goal-authoring-and-control`.
- **No backend / API change** — `createGoal` and `POST /api/folders/:cwd/goals` are untouched.
- **No board layout, goal-card, or goal-detail changes.**
- **No edit flow** — `CreateGoalDialog` is create-only for now (edit remains future work; the
  mockup's Screen A is titled "Create goal" / header "New goal" — create-only, matching this change).
- The mockup's re-added teaching hints (judge-rationale, criterion→`/subgoal`) are
  **mockup-only**; adding them to `GoalForm` is a separate follow-up, not this change.
