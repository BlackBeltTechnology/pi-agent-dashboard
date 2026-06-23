## Why

The automation **Create dialog** and **board/content view** shipped in `add-automation-plugin` are functional but not user-friendly, and the trigger model has no UI seam for the event triggers the architecture was built to host.

1. **Create dialog is a flat field dump.** `CreateAutomationDialog.tsx` renders 10 ungrouped fields in one column (Name, Scope, Schedule, Action, Prompt, Model, Mode, Sandbox, Concurrency, Visibility). There is no grouping, no inline help, no progressive disclosure of expert knobs, and the visibility field sits below the fold.

2. **Trigger is implicit, cron-only, and not granular.** The dialog hardcodes `on: { kind: "schedule", cron }` with a single raw cron string. There is no trigger picker, no human-readable schedule helper, and no "next run" preview. The registry was designed to host more kinds without changing `automation.yaml`, but the UI cannot express any kind other than `schedule`. Worse, a flat `kind` cannot express categories that have many events (OpenSpec alone has change.created / change.archived / change.validated / tasks.completed / spec.updated). Triggers need a **two-level taxonomy**: event category → selectable event type(s).

3. **Model is free text.** The Model field is a bare text input (`@fast`) although the spec promises selection "direct via `ModelSelector` or `@role` via role dropdown". Typos produce invalid configs.

4. **Expert knobs lack guidance — and two are inert.** `mode` / `sandbox` / `concurrency` are bare enum dropdowns with no explanation. Worse: `mode` and `sandbox` are parsed/validated by `automation-schema.ts` but **never threaded into the spawn** (`SpawnLike` in `engine.ts` passes only `cwd`/`model`/`automationRun`). Selecting `worktree` or `read-only` today does nothing. Also, `worktree` is only viable in a git repo — the editor must gate it.

5. **No edit, and delete is unreachable.** The `CreateAutomationDialog` is create-only — it never loads an existing automation, and there is no Edit entry point, so editing means hand-editing YAML on disk. `DELETE /api/plugins/automation` exists and works but **no UI calls it**. Worse, the create writer overwrites by name with `mkdirSync(recursive)` + file overwrite, so re-creating with an existing name **silently clobbers** it with no confirmation or merge.

6. **Board/content view is a bare text list.** `AutomationBoard.tsx` shows two flat sections — "Definitions" (`name` + scope badge) and "Triage" (status + runId). No schedule shown, no next-run, no last-run result, no per-automation actions (run now / edit / disable / delete), and no link from a run to its `result.md` findings.

This change redesigns the dialog and the content view for clarity, and adds a **trigger-type picker** so future event triggers have a UI home the day they register.

## What Changes

- **Create dialog → grouped editor.** Reorganize into labeled sections (Identity, Trigger, Action, Advanced). Move `mode` / `sandbox` / `concurrency` / `visibility` into a collapsed **Advanced** group with inline help. Replace the Model text input with `ModelSelector` + an `@role` dropdown.
- **Two-level trigger picker (UI seam).** Add a level-1 **event category** selector (tab strip) and a level-2 **event type** multi-select (checklist) within the selected category, both populated from registry-derived descriptors. `scheduled` is special: its level-2 is the cron helper (interval/day/time) with a raw-cron escape hatch and a **next-run preview**. Categories/events not yet wired render disabled ("coming soon"). On disk: `on.kind` = category, `on.events: string[]` for multi-type categories; `scheduled` keeps `on.cron`. Backward compatible — existing `kind: schedule` files need no migration.
- **Wire mode/sandbox into the spawn.** Thread the parsed `mode` (worktree|local) and `sandbox` into the run spawn so the fields take effect (they are currently inert). Gate `worktree` in the editor on the target being a git repo, falling back to `local` otherwise.
- **Editable + deletable automations.** Card Delete action (confirm) wired to the existing `DELETE` route. Card Edit action opens the editor pre-loaded from `automation.yaml` + `prompt.md`. Add an explicit **update path** so editing updates in place instead of relying on create's silent clobber-by-name; create rejects (or flags) an existing-name collision.
- **Content/board view → cards.** Replace the two-section text list with per-automation cards showing trigger summary, next-run, model, action kind, enabled state, last-run result, and per-row actions (Run now / Edit / Enable-Disable / Delete). Nest recent runs with a link to each run's findings.
- **HTML mockups** committed under `design/` so the redesign is reviewable visually and screenshots can be attached to the spec.

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `automation-content-view`: redesigned create editor (grouped sections, `ModelSelector`, Advanced disclosure) and redesigned board (per-automation cards with actions + nested runs).
- `automation-trigger-registry`: two-level taxonomy (category → event types); registry exposes category+event descriptors (enabled/planned) to the client for a two-level picker; `on.kind`=category + `on.events[]` format, backward compatible with existing `schedule` files.

## Impact

- **Code**:
  - `packages/automation-plugin/src/client/CreateAutomationDialog.tsx` — grouped layout, trigger-type picker, schedule helper + next-run preview, `ModelSelector`, Advanced disclosure.
  - `packages/automation-plugin/src/client/AutomationBoard.tsx` — card-based content view with per-automation actions and nested runs.
  - `packages/automation-plugin/src/server/trigger-registry.ts` + `routes.ts` — expose category+event descriptors to the client (read-only).
  - `packages/automation-plugin/src/server/automation-schema.ts` — accept `on.events[]`; validate non-empty for multi-type categories; keep `schedule` shape.
  - `packages/automation-plugin/src/server/engine.ts` — thread `mode` + `sandbox` into `SpawnLike` so they take effect (currently inert).
  - `packages/automation-plugin/src/server/routes.ts` + `automation-writer.ts` — add an explicit update route (load + overwrite by scope/name); make create reject existing-name collisions instead of silently overwriting.
  - `packages/automation-plugin/src/client/AutomationBoard.tsx` + `CreateAutomationDialog.tsx` — Delete (confirm) + Edit (pre-load existing config) card actions; dialog accepts an initial config for edit mode.
  - `packages/automation-plugin/src/shared/automation-types.ts` — add `TriggerCategoryDescriptor` + `TriggerEventDescriptor`; add `events?: string[]` to the trigger config.
- **Tests**: `CreateAutomationDialog.test.tsx`, `AutomationBoard.test.tsx` — assert grouped sections, trigger picker lists kinds, Advanced disclosure, card actions render.
- **Docs**: `docs/file-index-plugins.md` rows for touched files.
- **UX**: clearer creation flow, schedule preview, granular event selection, actionable board.
- **Risk — current silent clobber**: until the explicit update path lands, re-creating an automation with an existing name overwrites it with no confirmation. This change closes that by rejecting create-collisions and routing edits through update.
- **Migration / compatibility / rollback**: on-disk format extends additively — `on.events[]` is new; existing `kind: schedule` files stay valid with no migration. Threading `mode`/`sandbox` into the spawn changes run behavior (worktree/read-only now take effect) — call out in release notes since prior runs silently ignored these. Rollback = revert client components, the descriptor route, the schema `events` acceptance, and the spawn threading; on-disk `events[]` written meanwhile is simply re-ignored by the old parser only if it also drops the field (otherwise old parser errors on unknown `events` — so gate rollback by also reverting any automations using `events`).
