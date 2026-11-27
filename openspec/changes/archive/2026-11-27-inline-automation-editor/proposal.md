# Proposal: inline-automation-editor

## Why

The automation board is already a full-page overlay route, yet Edit and Create open `CreateAutomationDialog` — a second `fixed inset-0` modal capped at `max-w-lg` stacked on that page. The narrow modal truncates action names, squeezes the `prompt.md` editor to ~250 px, and its inputs use an `input` class the dashboard client never defines, so Name and Cron render as borderless plain text. Editing belongs in the board itself, at full width, next to the automation being changed.

## What Changes

- The board edits an automation **inside its card**: Edit (or the name / trigger summary) expands that card into the editor; only one card edits at a time; Edit becomes **Close editor** while open.
- **Create** inserts a dashed **draft card** at the top of the list holding the same editor plus Name + Scope; no modal.
- The folder actions menu "New automation" item **navigates to the board with the draft open** (`/folder/:encodedCwd/automations?new=1`) instead of opening a dialog in the sidebar.
- Editor layout: Trigger, Runs as (agent + model), collapsed Advanced (summary shows current values) in one column; Action (picker with full names + wide prompt editor + sessions per run + extra actions) in a wider column; one column on narrow widths with no horizontal scroll.
- The dashboard client defines the `.input` class the editor (and the flows plugin's input-wiring rows) already use, from theme tokens, so text, select and textarea controls get a visible border. No field-family migration and no per-field "Changed" markers in this change; the existing unsaved count stays.
- Saving an automation keeps its `disabled` flag (today Save silently re-arms a disabled automation).
- A sticky **save bar** at the card bottom replaces the dialog footer, subtitle and header chip: scope + write path, unsaved-change count, Cancel / Save (edit) or Create with "arms on create · next run" (create).
- **Unsaved-changes guard inside the board**: opening another editor (incl. this folder's menu "New automation"), Close editor or Cancel on a dirty editor shows an inline warning with Discard / Save & switch (or Save & close). Leaving the board (Back, sidebar, folder switch) is not guarded and discards the edits; Back keeps calling the shell's `onBack`.
- While a card edits, Run now / Disable, the last-run line and run history hide (Stop and the orphaned-run notice stay). Phone: planned trigger kinds fold into one "+N coming soon" chip.
- Deep links kept: name → editor, trigger summary → editor focused on Trigger; focus returns to the opener on close.
- **BREAKING (plugin client export)**: `CreateAutomationDialog` is removed from `packages/automation-plugin/src/client/index.tsx`; the editor body becomes an inline `AutomationEditor` component. No in-repo consumer outside the plugin.
- Mockup: mockups/2026-11-25-automation-inline-editor (in this change)

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `automation-content-view`: "Create Automation entry point" and "Editor visual presentation" are replaced (inline draft from the board and the folder menu; inline editor, save bar, phone rules); "Automation card shows a last-run summary and a Stop action" is modified (Edit toggles the inline editor; Run now / Disable hide while editing); new requirements for the scope/model writes (incl. `disabled` kept) and the single-editor guard.
- `message-severity-tokens`: "No raw colour literals on aligned action surfaces" names `CreateAutomationDialog.tsx`; the guarded file becomes the inline editor's file.
- `goals-folder-page`: "Goal create presented as a modal dialog" cites the automation dialog as its pattern source; the goal dialog keeps its own classes, the citation is dropped.
- `theme-system`: "Readable text on aligned action surfaces" has a scenario on the automation dialog's locked-name text, which is removed; it now names the editor's save-bar caption.

## Impact

- `packages/client/src/index.css`: token-styled `.input` component class.
- `packages/automation-plugin/src/client/`: `AutomationBoard.tsx` (card expansion, draft card, `?new=1`, in-board guard), `CreateAutomationDialog.tsx` → `AutomationEditor.tsx` (modal shell removed, fields migrated), `FolderAutomationSection.tsx` (menu item navigates; lazy dialog import removed), `index.tsx` (export), `AGENTS.md` rows.
- Unit tests: `CreateAutomationDialog*.test.tsx` → `AutomationEditor*.test.tsx`, `AutomationBoard.test.tsx`, `FolderAutomationSection.test.tsx`, `AutomationSettings.test.tsx` (harness comment).
- Ratchets keyed on the file name: `scripts/settings-kit-baseline.json`, `packages/client/src/lib/__tests__/aligned-surfaces-no-literals.test.ts`.
- E2E: `tests/e2e/overlay-layout.spec.ts` (F3 create-dialog Save reachable) and `tests/e2e/ui-token-alignment.spec.ts` (editor subtitle, `armed-chip`, `max-w-lg` ancestor, Esc) are rewritten against the inline editor.
- Comments / docs naming the dialog: `mdi-chunk-size.test.ts`, `WorktreeSpawnDialog-primary.test.tsx`, `packages/goal-plugin/src/client/CreateGoalDialog.tsx` + its `AGENTS.md` row, `packages/shared/src/dashboard-plugin/slot-types.ts`, `packages/dashboard-plugin-runtime/src/slot-consumers.tsx`, `packages/flows-plugin/src/client/FlowInputWiring.tsx`, `docs/plugin-seams.md` (lazy-load example), `docs/architecture.md`.
- No server, protocol or on-disk format change: same `createAutomation` / `updateAutomation` payloads, except `disabled` is now carried through.

## Discipline Skills

- `doubt-driven-review` — removes a public plugin client export and changes a spec'd entry point.
- `code-simplification` — the 1.3k-line dialog becomes an inline editor; run once tests pass.
- `systematic-debugging` — only if the `?new=1` search param or sticky save bar misbehaves inside the overlay route.
