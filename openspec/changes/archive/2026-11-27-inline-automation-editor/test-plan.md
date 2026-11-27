# Test Plan — inline-automation-editor

Stage: design   Generated: 2026-11-25

Harness exemplars: L1 `packages/automation-plugin/src/__tests__/AutomationBoard.test.tsx`, `CreateAutomationDialog.test.tsx` (→ `AutomationEditor.test.tsx`), `FolderAutomationSection.test.tsx`; L3 `tests/e2e/overlay-layout.spec.ts`, `tests/e2e/ui-token-alignment.spec.ts`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Automation editor writes … keeping keys it does not edit | EP | L1 | automated | definition `{ disabled: true, maxConcurrentSpawns: 3, action: core.prompt }` | edit prompt body, click `create-submit` | `updateAutomation` body `config.disabled === true` and `config.maxConcurrentSpawns === 3`; prompt body changed |
| E2 | Editor save bar: untouched editor reports no change | decision-table (scope × git × mode) | L1 | automated | definition `mode: worktree`, folder where `/git-capable` → `false` | open editor, let probe settle | `editor-dirty-count` absent, Save disabled, `create-mode` value `local` |
| E3 | Editor save bar: unsaved count | EP | L1 | automated | open editor for `daily-continuity` (cron `0 10 * * *`) | change raw cron to `30 9 * * *` | `editor-dirty-count` reads "1 unsaved change"; Save enabled |
| E4 | Sessions per run ≥ 1 (invariant) | BVA | L1 | automated | `create-action-count` = 1 | type `0`, then `-2`, then clear | count input value stays `1` each time; submitted `action.count` absent (=1) |
| E5 | Save bar names where it writes | EP (scope) | L1 | automated | global `pr-triage`; folder `daily-continuity` in `/w/app`; draft with empty name | open each editor | `editor-write-path` contains `~/.pi/automation/pr-triage/`; `/w/app/.pi/automation/daily-continuity/`; `.pi/automation/<name>/` |
| E6 | Re-requesting the open editor does nothing | state-transition (illegal edge) | L1 | automated | card A editing with 1 unsaved change | click `automation-name-A`, then `automation-summary-A` | no `editor-guard`; dirty count still 1; focus inside `group-trigger` |
| E7 | Create Automation opens an inline draft: empty folder | EP (list size 0) | L1 | automated | `/list` → `[]` | open board with `?new=1` | `automation-empty` explainer rendered AND `automation-draft` rendered after it; no `create-automation-dialog` |
| E8 | Inline editor presentation: edit hides identity | decision-table (create × edit) | L1 | automated | edit `daily-continuity`; create draft | open each | edit: no `create-name`, no `create-scope`, no `create-name-locked`; create: `create-name` and `create-scope` enabled |
| E9 | Editing card hides Run now and Disable | decision-table (running × editing) | L1 | automated | idle enabled card A; running card B | open editor on A, then (after close) on B | A: no `run-now-A`, no `toggle-A`, no `automation-last-run-A`; after close all three back. B editing: `stop-B` present |
| E10 | Direct model carries a thinking level, a role does not (agent carve-out) | decision-table (agent × role × direct) | L1 | automated | `/api/acp/agents` → one agent `claude-code` | pick agent `claude-code` | `create-model-by-agent` shown, no model/level control; picking pi + `anthropic/claude-sonnet-4-5` + `high` saves `model: "anthropic/claude-sonnet-4-5:high"` |
| E11 | Text controls are visibly bordered | EP | L1 | automated | `packages/client/src/index.css` | parse the `.input` rule | rule exists under `:where(.input)`, uses only `var(--…)` colour values; `aligned-surfaces-no-literals` + `theme-token-guard` report 0 new hits |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | One inline editor at a time: clean switch | state-transition | L1 | automated | card A editing, 0 changes | click `edit-B` | exactly one `[data-testid^=automation-editor-]` exists and it is B's; A shows `edit-A` "Edit" with `aria-expanded="false"` |
| F2 | Dirty editor warns before switching | state-transition | L1 | automated | card A editing, 2 changes | click `edit-B` | `editor-guard` in A names "2 unsaved changes"; no editor for B |
| F3 | Discard continues without saving | state-transition | L1 | automated | F2 state | click `editor-guard-discard` | 0 POST `/update`; B editor open; A collapsed |
| F4 | Closing a dirty editor warns | state-transition | L1 | automated | card A editing, 1 change | click Close editor, then Cancel | both raise `editor-guard` with Save & close; editor stays open |
| F5 | Edit expands the card in place + focus | state-transition | L1 | automated | board with 3 cards | click `edit-daily-continuity` | editor is a descendant of `automation-def-daily-continuity`; button reads "Close editor", `aria-expanded="true"`; `document.activeElement` inside `group-trigger` |
| F6 | Close editor restores the card and focus | state-transition | L1 | automated | F5 state, clean | click Close editor | editor gone; `automation-last-run-daily-continuity` back; focus on `edit-daily-continuity` |
| F7 | Clicks inside the editor do not re-select | event bubbling | L1 | automated | card A editing, card B selected before | click inside A's prompt textarea | selection unchanged by the click (A stays `aria-current="true"`), no extra `onSelect` |
| F8 | `?new=1` opens the draft and is consumed | state-convergence | L1 | automated | memory location `/folder/<enc>/automations?new=1`, `/list` resolves after 50 ms | mount board | while loading: no draft; after ready: `automation-draft` present and location search is `""` (replace, no new history entry) |
| F9 | New automation from the folder menu opens the board draft | state-convergence | L1 | automated | `FolderAutomationSection` for `/w/app` | select menu item `new-automation` | `setLocation` called with `/folder/<enc>/automations?new=1`; no `create-automation-dialog` rendered |
| F10 | Closing the draft does not reopen it on Back | state-transition | L3 | automated | harness folder, board via folder menu "New automation" | Cancel draft, board Back, browser Back | URL `/folder/<enc>/automations` without `?new=1`; `automation-draft` count 0 |
| F11 | Save bar stays reachable; one scroller | invariant | L3 | automated | 12 automations, editor open on the last card with a 60-line prompt | scroll board root to bottom/top | `editor-save-bar` bounding box within viewport; Back visible; overflowing vertical scrollers in the panel = `["automation-board"]` |
| F12 | Phone width has no horizontal scroll | invariant | L3 | automated | viewport 375×812, editor open | measure | `automation-board.scrollWidth <= clientWidth`; each editing card `scrollWidth <= clientWidth`; one "+4 coming soon" chip; planned pills hidden |
| F13 | Target size + readable text on the editor | BVA (44/32 px, 12 px) | L3 | automated | editor open at 375 and 1280 px, dirty guard shown | measure buttons + caption | every editor `button` ≥ 44 px tall at 375, ≥ 32 px at 1280; `editor-write-path`, guard text, coming-soon chip font-size ≥ 12 px, contrast ≥ 4.5:1 dark + light |
| F14 | Two-column layout only when the container fits | BVA (`@3xl` = 48rem) | L3 | automated | board at 1280 px with sidebar 300 px; board at 700 px | open editor | 1280: Trigger column and Action column side by side (`left < right` x); 700: stacked (Action top > Trigger bottom) |
| F15 | Inline editor visual match to approved mock | visual/subjective | — | manual-only | editor in base dark, base light, one non-base palette | human compares to mock variant A | [judgment: spacing/hierarchy reads like the accepted mock — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Failed save keeps the edits | fault-injection (abort) | L1 | automated | `/update` → 500 `{ error: "disk full" }` | F2 state, click `editor-guard-save` | A stays open with edits, `create-error` "disk full"; B not opened |
| X2 | Definition fetch fails on open | fault-injection (abort) | L1 | automated | `/definition` → 404 | click `edit-A` | inline error in card A with Retry + Close; no editor fields; Retry after fix opens editor |
| X3 | Definition fetch slow, user switches | fault-injection (delay) + last-wins | L1 | automated | `/definition?name=A` delayed 300 ms, B immediate | click `edit-A` then `edit-B` | only B's editor mounts; A's late response ignored |
| X4 | Load failure shows the error, not a draft | fault-injection (abort) | L1 | automated | `/list` → 503, location `?new=1` | mount board | `automation-error` + Retry; no `automation-draft`; search param stripped |
| X5 | Folder switch drops the editor | state-transition | L1 | automated | editor open on `folder:foo` in `/w/a`, dirty | rerender board with cwd `/w/b` (also has `foo`) | no editor open; no save request; B's list loads |
| X6 | Back is not intercepted | state-transition | L1 | automated | dirty editor open | click `automation-board-back` | `onBack` called once; no `editor-guard` |

---

## Coverage summary

- Requirements covered: 9/9 delta requirements (Create Automation opens an inline draft, writes scope/action/model, direct model vs role, inline presentation, save bar, phone widths, one editor + guard, card last-run/Stop (modified), theme-system readable text (modified)); message-severity-tokens + goals-folder-page deltas are file-name/citation edits covered by E11 and the ratchet tasks.
- Scenarios by class: edge 11 · perf 0 · frontend 15 · error 6
- Scenarios by level: L1 26 · L2 0 · L3 5 · — 1
- Scenarios by disposition: automated 31 · manual-only 1

## New infra needed

- none (L1 uses the existing plugin vitest harness with fixture `fetch`; L3 uses the docker harness and the existing overlay-layout helpers).
