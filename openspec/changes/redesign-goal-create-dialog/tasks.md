# Tasks

## 1. CreateGoalDialog component

- [ ] 1.1 Add `packages/goal-plugin/src/client/CreateGoalDialog.tsx` — modal wrapper around `GoalForm`. Overlay `fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4` + card `w-full max-w-lg max-h-[90vh] overflow-auto rounded-lg bg-[var(--bg-primary)] p-4` (verbatim from `CreateAutomationDialog.tsx:248-260`). Backdrop click → `onClose`; card `stopPropagation`. → verify: renders `data-testid="goal-create-dialog"` + `GoalForm` inside.
- [ ] 1.2 Dialog owns the `createGoal(cwd, payload)` POST (move the submit side-effects — refetch, navigate, close — into an `onCreated` callback prop; mirror `CreateAutomationDialog` calling `createAutomation` itself). → verify: submitting `GoalForm` POSTs and calls `onCreated`.
- [ ] 1.3 Header: `New goal · <folder leaf>` + ✕ close button (`goal-create-dialog-close`). → verify: ✕ calls `onClose`.

## 2. Swap call sites

- [ ] 2.1 `FolderGoalsSection.tsx`: replace the inline `folder-goal-create` panel with `<CreateGoalDialog>` gated on `creating`; `+ Goal` (`folder-goal-new-btn`) toggles `creating`. `onCreated` → refetch + `navigate(goalsBoardUrl(cwd))`. → verify: `+ Goal` opens centered dialog; board opens after create; sidebar no longer pushes down.
- [ ] 2.2 `GoalsBoardClaim.tsx`: replace the inline `goals-board-create` panel with `<CreateGoalDialog>`; `+ New Goal` (`goals-board-new`) toggles `creating`. `onCreated` → refetch. → verify: `+ New Goal` opens dialog; filter bar + cards no longer displaced during authoring.
- [ ] 2.3 Remove now-unused inline panel styles/imports at both sites. → verify: no dead `GoalForm` import left dangling at the call sites (it moves into `CreateGoalDialog`).

## 3. Tests

- [ ] 3.1 Add `packages/goal-plugin/src/client/__tests__/CreateGoalDialog.test.tsx` — renders dialog + `GoalForm`; backdrop click + ✕ close; submit calls `createGoal` then `onCreated`. → verify: passes with ephemeral HOME.
- [ ] 3.2 Update `GoalsBoardClaim.test.tsx` — `goals-board-new` opens dialog (assert `goal-create-dialog` present, `goals-board-create` gone); create flow still yields a goal card. → verify: green.
- [ ] 3.3 Update `FolderGoalsSection.test.tsx` — `folder-goal-new-btn` opens dialog; `folder-goal-create` inline panel no longer asserted. → verify: green.
- [ ] 3.4 Run `npm test --workspace=@blackbelt-technology/pi-dashboard-goal-plugin` (ephemeral HOME). → verify: all goal-plugin tests pass.

## 4. Docs + mockup

- [ ] 4.1 Update `docs/file-index-plugins.md` row for `packages/goal-plugin/src/client/` — add `CreateGoalDialog.tsx`; note `GoalsBoardClaim`/`FolderGoalsSection` now open the dialog. (Delegate to docs subagent, caveman style.)
- [ ] 4.2 Mockup `mockups/goal/index.html` Screen A already reflects the dialog — no further mockup work; reference it in the proposal/design. → verify: mockup matches shipped dialog (fields + overlay).
- [ ] 4.3 Remove scratch `mockups/goal/before.html` + `mockups/goal/compare.html` before commit (comparison scaffolding, not part of the change). → verify: only `mockups/goal/index.html` remains.

## 5. Build + verify

- [ ] 5.1 `npm run build` (client). → verify: Vite build succeeds.
- [ ] 5.2 Restart server (`curl -X POST http://localhost:8000/api/restart`) and browser-verify both `+ Goal` and `+ New Goal` open the centered modal. → verify: live parity with automation dialog.
