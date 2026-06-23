# Design — redesign-goal-create-dialog

## Decision

One shared modal dialog wraps the existing `GoalForm`. Both create surfaces
(`FolderGoalsSection · + Goal`, `GoalsBoardClaim · + New Goal`) open it. `GoalForm` is
reused unchanged so the payload contract and testids stay identical.

## Component shape

```
CreateGoalDialog({ cwd, onClose, onCreated })
  └─ overlay: fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4
       └─ card: w-full max-w-lg max-h-[90vh] overflow-auto rounded-lg bg-[var(--bg-primary)] p-4
            └─ header: "New goal · <folder>"  + ✕ (onClose)
            └─ <GoalForm onSubmit={createGoal(cwd,payload) → onCreated} onCancel={onClose} />
```

Overlay + card classes are copied verbatim from `CreateAutomationDialog`
(`packages/automation-plugin/src/client/CreateAutomationDialog.tsx:248-260`) for plugin
parity. Clicking the backdrop closes; `stopPropagation` on the card prevents it.

## Why mirror CreateAutomationDialog and not the `ui:dialog` primitive

A `ui:dialog` UI primitive exists (registered in `unify-dialog-system`,
`UI_PRIMITIVE_KEYS.dialog === "ui:dialog"`), but the shipped sibling
`CreateAutomationDialog` hand-rolls the `fixed inset-0 z-50 … bg-black/40` overlay rather
than consuming the primitive. To stay consistent with the **actual** plugin pattern (and
avoid a precedent-split where automations hand-roll and goals use the primitive), this
change replicates `CreateAutomationDialog`'s overlay. Migrating both dialogs onto
`ui:dialog` is a separate, plugin-wide refactor — out of scope here.

## Call-site diffs

```diff
// FolderGoalsSection.tsx
- {creating && (
-   <div className="mt-1.5 rounded …" data-testid="folder-goal-create">
-     <GoalForm onSubmit={submit} onCancel={() => setCreating(false)} />
-   </div>
- )}
+ {creating && (
+   <CreateGoalDialog cwd={cwd} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); refetch(); navigate(goalsBoardUrl(cwd)); }} />
+ )}
```

```diff
// GoalsBoardClaim.tsx
- {creating && (
-   <div className="px-3 py-2 border-b …" data-testid="goals-board-create">
-     <GoalForm onSubmit={submit} onCancel={() => setCreating(false)} />
-   </div>
- )}
+ {creating && (
+   <CreateGoalDialog cwd={cwd} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); refetch(); }} />
+ )}
```

`GoalForm`'s `submit` logic (the `createGoal` POST + state reset + refetch) moves into the
dialog's `onCreated` / internal handler; the `createGoal` import stays at the call site or
moves into `CreateGoalDialog` (preferred — the dialog owns the POST, mirrors
`CreateAutomationDialog` which calls `createAutomation` itself).

## testid plan

- New: `goal-create-dialog` (overlay), `goal-create-dialog-title`, `goal-create-dialog-close`.
- Reused (unchanged): `goal-form`, `goal-form-objective`, `goal-form-submit`, …
- Removed: `goals-board-create`, `folder-goal-create` (inline containers gone).
- Kept: `goals-board-new`, `folder-goal-new-btn` (now open the dialog instead of toggling inline).

## Mockup source of truth

`mockups/goal/index.html` Screen A — modal dialog, fields synced to shipped `GoalForm`,
caption "opens from both `+ Goal` and `+ New Goal` → one shared dialog".

Token/consistency control plane: `mockups/goal/ui-contract.md` — the `frontend-mockup-loop`
contract grounding every screen value to a dashboard theme token (no raw hex). Records the dialog
invariants this change ships: overlay recipe, bare-title header (no breadcrumb), input + primary/
secondary button recipes, icon-button `aria-label` rule. `CreateGoalDialog.tsx` maps 1:1 to these
recipes on promote (zero apply-gap).

## Risks

- **Sidebar dialog from a folder nav slot** — the slot lives inside the sidebar; a `fixed`
  overlay escapes the sidebar's clipping, so the dialog centers on the viewport (correct,
  same as automation's `+ New` which also lives in the sidebar). No portal needed; `fixed`
  already escapes `overflow` ancestors.
- **Focus trap / a11y** — `CreateAutomationDialog` has no focus trap today; this change
  matches that (no regression). A repo-wide focus-trap pass is separate.
