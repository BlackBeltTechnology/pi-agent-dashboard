# Tasks

## 1. Delete App.tsx interceptor branches

- [ ] 1.1 Open `packages/client/src/App.tsx::wrappedHandleSend` and delete:
  ```ts
  if (trimmed === "/flows") { setFlowPickerOpen(true); return; }
  if (trimmed === "/flows:new") { setFlowNewOpen(true); return; }
  ```
- [ ] 1.2 Confirm the remaining body is: extension-UI-module match (with the existing `BUILTIN_SLASH_COMMANDS` collision check) → `handleSend(text, images)` default forward → draft + images cleared.

## 2. Delete flow-dialog state from App.tsx

- [ ] 2.1 Delete the seven `useState` declarations (lines ~562–568):
  - `flowPickerOpen` / `setFlowPickerOpen`
  - `flowNewOpen` / `setFlowNewOpen`
  - `flowEditPickerOpen` / `setFlowEditPickerOpen`
  - `flowEditFlowName` / `setFlowEditFlowName`
  - `flowDeletePickerOpen` / `setFlowDeletePickerOpen`
  - `flowDeleteFlowName` / `setFlowDeleteFlowName`
  - `flowLaunchTarget` / `setFlowLaunchTarget`
- [ ] 2.2 Delete the dialog JSX blocks in App.tsx around lines ~1154–1268:
  - `{flowPickerOpen && ...}` rendering the Flows `SearchableSelectDialog`
  - `{flowNewOpen && ...}` rendering the new-flow `FlowLaunchDialog`
  - `{flowEditPickerOpen && ...}` rendering the Edit-Flow `SearchableSelectDialog`
  - `{flowEditFlowName && ...}` rendering the edit-with-name `FlowLaunchDialog`
  - `{flowDeletePickerOpen && ...}` rendering the Delete-Flow `SearchableSelectDialog`
  - `{flowDeleteFlowName && ...}` rendering the `ConfirmDialog`
  - `{flowLaunchTarget && ...}` rendering the run-with-task `FlowLaunchDialog`
- [ ] 2.3 Remove now-unused imports from App.tsx: `SearchableSelectDialog`, `FlowLaunchDialog`, `ConfirmDialog` (only if no other code path imports them — verify with `rg`).
- [ ] 2.4 Type-check: `npm run typecheck` (or equivalent) — must pass cleanly.

## 3. Verify BUILTIN_SLASH_COMMANDS is untouched

- [ ] 3.1 Confirm the Set declaration around App.tsx:560 retains all nine entries: `/flows`, `/flows:new`, `/flows:edit`, `/flows:delete`, `/compact`, `/reload`, `/new`, `/model`, `/roles`.
- [ ] 3.2 Confirm the `wrappedHandleSend` collision-warning branch (`const colliding = modules.find(...)`) is unchanged and still fires when an extension UI module tries to claim any of those nine names.

## 4. Tests

- [ ] 4.1 Add `packages/client/src/__tests__/wrappedHandleSend-no-flow-interceptor.test.tsx`:
  - Render `<App />` (or the extracted handler) with a stub `handleSend`.
  - Submit `/flows`; assert `handleSend` is called once with `"/flows"`; assert no `SearchableSelectDialog` is in the document.
  - Submit `/flows:new`; assert same.
  - Submit `/myext:status` matching a stub UI module; assert the extension-module open path is taken (existing behavior, regression guard).
  - Submit `/compact`; assert `handleSend` is called (forwarded to bridge).
- [ ] 4.2 Find and update any existing test that asserts `/flows` opens a dashboard dialog. Search:
  ```bash
  rg -n "flowPickerOpen|setFlowPickerOpen|flowNewOpen|setFlowNewOpen" packages/client/src/__tests__/
  ```
  - If a test asserts the old behavior, update it to assert the new (forwarded) behavior or delete it if it's no longer meaningful.
- [ ] 4.3 Run full suite: `npm test 2>&1 | tee /tmp/pi-test.log; grep -nE 'FAIL|Error|✗|✘' /tmp/pi-test.log`. Must be green.

## 5. Plano file deletion

- [ ] 5.1 `git rm docs/plans/plano-pi-integration.md`.
- [ ] 5.2 (Out of scope, but worth noting in the commit message) — `docs/plans/command-palette-future.md` retains three references to the deleted file. Subsequent change can scrub those if they become a problem; this change leaves them as broken anchors deliberately to keep the diff minimal.

## 6. Documentation

- [ ] 6.1 Update the `App.tsx` row in `AGENTS.md`:
  - Remove the language about "/flows interceptor" / dashboard-side flow dialogs.
  - Add a short note that `wrappedHandleSend` is now extension-UI-module match → bridge forward, with no flow-specific branches.
- [ ] 6.2 No `docs/architecture.md` change needed (slot taxonomy is unchanged).
- [ ] 6.3 CHANGELOG `## [Unreleased]` entry under "Changed":
  - "Removed dashboard-side flow dialogs for `/flows` and `/flows:new`. These commands now route to the pi-flows extension's own `ctx.ui` handlers (rendered via the universal interactive-dialog surface), matching every other extension's command. The session-card flow action button is unchanged. Removed the stale `docs/plans/plano-pi-integration.md` plan."

## 7. Smoke verification

- [ ] 7.1 `npm run dev`, install pi-flows in a session.
- [ ] 7.2 Type `/flows` and submit → confirm a generic select dialog opens (PromptBus `DashboardDefaultAdapter` rendering of `ctx.ui.select`), with options like "New flow", "List flows", "Cancel".
- [ ] 7.3 Type `/flows:new` and submit → confirm an input dialog asks "Describe what the flow should do:".
- [ ] 7.4 Click the flow action button on a session card → confirm `SessionFlowActions`' rich picker still opens (unchanged).
- [ ] 7.5 In autocomplete, type `/` → confirm `/flows`, `/flows:new`, `/flows:edit`, `/flows:delete`, `/roles` appear when pi-flows is installed; uninstall pi-flows from the session and confirm they disappear.
- [ ] 7.6 `openspec validate remove-flow-dialog-interceptors` exits clean.
