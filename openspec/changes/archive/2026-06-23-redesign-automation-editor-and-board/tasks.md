# Tasks — redesign-automation-editor-and-board

## 1. Two-level trigger taxonomy (server → client seam)
- [x] 1.1 Add `TriggerCategoryDescriptor` + `TriggerEventDescriptor` to `src/shared/automation-types.ts`; add `events?: string[]` to the trigger config type → verify: types exported, used by client.
- [x] 1.2 Derive category+event descriptors from the registry + static planned list in `src/server/trigger-registry.ts`; expose via read-only route in `src/server/routes.ts` → verify: route returns `scheduled` enabled + planned categories/events.
- [x] 1.3 `automation-schema.ts`: accept `on.kind`=category + `on.events[]`; require non-empty `events` for multi-type categories; keep `schedule`/`on.cron` shape valid → verify: existing schedule file parses; openspec multi-event parses; empty-events rejected (tests).
- [x] 1.4 Test: `scheduled` reports `enabled`; planned category reports `planned`; planned event within enabled category reports `planned` → verify: trigger-registry test passes.

## 2. Editor redesign (`CreateAutomationDialog.tsx`)
- [x] 2.1 Group fields into Identity / Trigger / Action / Advanced (collapsed) → verify: groups render, Advanced collapsed by default (test).
- [x] 2.2 Replace Model text input with `ModelSelector` + `@role` dropdown → verify: chosen model id / `@role` written to config (test).
- [x] 2.3 Two-level picker: level-1 category tab strip + level-2 event-type multi-select checklist, descriptor-driven; planned categories/events disabled → verify: checklist lists events, multi-select writes `on.events`, planned disabled, submission blocked for planned category (test).
- [x] 2.4 `scheduled` category swaps the checklist for the cron helper (interval/day/time) + raw-cron escape hatch + display-only next-run preview → verify: preview shows next fire; raw cron written to `on.cron` (test).
- [x] 2.5 Inline help on Advanced fields; sandbox per-level help text → verify: hint text present (test).
- [x] 2.6 Gate `worktree` mode on git capability of the chosen scope/cwd; disable + fall back to `local` for non-git folders with hint → verify: non-git disables worktree, git allows it (test).

## 3. Board redesign (`AutomationBoard.tsx`)
- [x] 3.1 Per-automation definition cards: trigger summary, next-run, model, action, scope, enabled state → verify: card renders summary (test).
- [x] 3.2 Per-row actions: Run now / Edit / Enable-Disable / Delete (valid); Edit / Delete only (invalid) → verify: action visibility by validity (test).
- [x] 3.3 Recent-runs table: status, runId, findings, relative time, result/log link; archived toggle preserved → verify: run row + link render (test).

## 4. Wire mode/sandbox into spawn (currently inert)
- [x] 4.1 Extend `SpawnLike` in `engine.ts` to pass `mode` + `sandbox`; thread into the server spawn hook → verify: worktree spawns an isolated checkout; sandbox level applied (test with injected spawn).
- [x] 4.2 Confirm the server spawn hook honors mode/sandbox (worktree create/cleanup; sandbox enforcement) → verify: integration test or documented limitation.

## 5. Edit / Delete / update path
- [x] 5.1 `automation-writer.ts` + `routes.ts`: add explicit update operation (overwrite by scope/name, fail if missing); make create reject existing-name collisions → verify: create-collision rejected, update overwrites, update-missing fails (tests).
- [x] 5.2 Board card Delete action with confirmation, wired to `DELETE /api/plugins/automation`; refresh list → verify: confirm required, route called with scope+name, card disappears (test).
- [x] 5.3 `CreateAutomationDialog` accepts an initial config (edit mode); board Edit pre-loads `automation.yaml` + `prompt.md`; save routes through update → verify: fields populated from existing config, save updates in place (no duplicate dir) (test).
- [x] 5.4 Name handling on edit: rename or disable name field to avoid orphaning → verify: documented behavior + test.

## 6. Wiring + docs
- [x] 6.1 Confirm `ModelSelector` export path is consumable from the plugin package → verify: import resolves, build passes.
- [x] 6.2 Update `docs/file-index-plugins.md` rows for touched files (caveman style, delegated) → verify: rows present.
- [x] 6.3 Full rebuild + restart + reload per AGENTS.md → verify: dialog + board render live; `npm test` green.
