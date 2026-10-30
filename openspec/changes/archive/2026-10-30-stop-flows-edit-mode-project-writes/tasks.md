# Tasks

## 1. Shared pi-settings lock (D3)

- [x] 1.1 Move `withPiSettingsLock`, `PiSettingsState`, `LockedStep`/`LockedResult`, `formatJson`, `FsDeps` and their private helpers from `packages/server/src/pi-agent-settings.ts` into new `packages/shared/src/pi-agent-settings-lock.ts`; add `FsDeps.settingsPath` override; move `proper-lockfile` + `@types/proper-lockfile` to `packages/shared/package.json`; server re-imports. Verify: `pnpm install` clean, typecheck passes.
- [x] 1.2 Regression: run the existing `packages/server/src/__tests__/pi-agent-settings*.test.ts` unchanged after the move; all pass with zero test edits (test-plan #E14).
- [x] 1.3 Boundary test (L1, see `packages/server/src/__tests__/plugin-event-seam.test.ts` for a repo-scan style exemplar): scan `packages/client/src/**` and `packages/*-plugin/src/client/**` for imports of `pi-agent-settings-lock` · trigger vitest run · observable zero matches and no barrel re-export (test-plan #E13).

## 2. Edit-mode resolver and routes (D2, D4)

- [x] 2.1 Add `packages/flows-plugin/src/server/edit-mode.ts`: `resolveEditMode(cwd,{home})` (project ?? global ?? false; `flows.editFlow` then `flowsEditFlow`; unparseable = unset; global path `<home>/.pi/agent/settings.json`, env ignored). Verify via 2.4.
- [x] 2.2 Mount `GET`/`PUT /api/plugins/flows/edit-mode-default` and `GET /api/plugins/flows/edit-mode-state?sessionId` in an encapsulated scope with `networkGuard` + `@fastify/rate-limit` (copy `flow-files.ts` scope); PUT uses `withPiSettingsLock({settingsPath})`, writes only `flows.editFlow`, 400 + `parseError` / 503; state route 404 before any fs read. Verify via 2.5–2.9.
- [x] 2.3 Add `route-tiers.ts` rows (two GETs `observe`, PUT `operate`). Verify via 2.10.
- [x] 2.4 L1 test (exemplar `packages/flows-plugin/src/__tests__/flow-inputs.test.ts`): project × global × legacy decision table · `resolveEditMode` · equals project ?? global ?? false for every row, unparseable = unset (test-plan #E1).
- [x] 2.5 L1 test (exemplar `packages/flows-plugin/src/__tests__/flow-inputs-route.test.ts`): unparseable `<cwd>/.pi/settings.json` · GET edit-mode-state · 200 with global value, project bytes + mtime unchanged (test-plan #E2).
- [x] 2.6 L1 test (exemplar `flow-inputs-route.test.ts`): bodies `{enabled:"yes"}`, `{}`, `null`, `{enabled:1}`, `{enabled:true,path:"/etc/x"}` · PUT edit-mode-default · first four 400 + file byte-identical, fifth writes only `flows.editFlow` (test-plan #E3).
- [x] 2.7 L1 test (exemplar `packages/server/src/__tests__/pi-agent-settings.test.ts`): global with `packages`, `dashboardPluginBridges`, `flows.someOtherKey` · PUT `{enabled:true}` · `flows.editFlow` true, other keys deep-equal (test-plan #E4).
- [x] 2.8 L1 test (exemplar `pi-agent-settings.test.ts` `agentDirEnv` seam): `PI_CODING_AGENT_DIR=<tmp>/alt`, `home=<tmp>/home` · PUT `{enabled:true}` · home file written + lock at home path, alt file untouched (test-plan #E5).
- [x] 2.9 L1 test (exemplar `flow-inputs-route.test.ts`): global `{}` / `{flowsEditFlow:true}` / missing · GET edit-mode-default · false / true / false with no file created (test-plan #E6).
- [x] 2.10 L1 test (exemplar `flow-inputs-route.test.ts`): sessionId not active · GET edit-mode-state · 404 and fs-read spy zero calls (test-plan #E7).
- [x] 2.11 L1 test (exemplar `packages/server/src/identity/__tests__/http-road-classification.test.ts`): new route rows · coverage test · GETs `observe`, PUT `operate` (test-plan #E12).
- [x] 2.12 L1 test (exemplar `pi-agent-settings.test.ts` failure paths): global `{"flows":` · PUT `{enabled:true}` · 400 with `parseError` position-only, file byte-identical (test-plan #X1).
- [x] 2.13 L1 test (exemplar `pi-agent-settings.test.ts` busy-lock case): lock held for the full retry budget · PUT · 503, file byte-identical (test-plan #X2).
- [x] 2.14 L1 perf test (exemplar `packages/flows-plugin/src/__tests__/flows-for-cwd.test.ts`): 50 active sessions across 5 cwds · PUT `{enabled:true}` · exactly 5 project-file reads and 50 `flows_edit_mode_state` frames (test-plan #P1).

## 3. Per-project action (D5)

- [x] 3.1 Add `flow.set-edit-mode` to the `plugin_action` handler in `packages/flows-plugin/src/server/index.ts` (payload `{enabled}` = desired; compare with `resolveEditMode`; emit only on difference; `not-delivered` / poll 10 × 200 ms / `timeout`; broadcast per session in cwd). Add `flow:set-edit-mode` to `package.json` `emits`. Verify via 3.2–3.5.
- [x] 3.2 L1 test (exemplar `packages/flows-plugin/src/__tests__/plugin-action-handler.test.ts`): project already `true` · `flow.set-edit-mode {enabled:true}` · emit 0×, one state frame per session in cwd (test-plan #E10).
- [x] 3.3 L1 test (exemplar `manifest-discoverability.test.ts` + `packages/server/src/__tests__/plugin-event-seam.test.ts`): flows manifest · manifest + seam check · `emits` includes `flow:set-edit-mode`, seam returns true for plugin `flows` (test-plan #E11).
- [x] 3.4 L1 test (exemplar `plugin-action-handler.test.ts`): `emitEventToSession` returns false · `flow.set-edit-mode {enabled:true}` · no poll, frame `error:"not-delivered"` with unchanged value (test-plan #X3).
- [x] 3.5 L1 test (exemplar `plugin-action-handler.test.ts`, fake timers): emit true, file never changes · `flow.set-edit-mode {enabled:true}` · 10 resolves at 200 ms then frame `{enabled:false,error:"timeout"}` (test-plan #X4).

## 4. Legacy migration (D6)

- [x] 4.1 On `registerPlugin`, migrate legacy plugin-config `editFlow` under `withPiSettingsLock` (check-then-write inside the lock), then `ctx.updatePluginConfig({ editFlow: undefined })`; keep the key on failure. Change `configSchema.json` `editFlow` description to "DEPRECATED, ignored…". Verify via 4.2–4.4.
- [x] 4.2 L1 test (exemplar `packages/flows-plugin/src/__tests__/plugin-action-handler.test.ts` ctx mocks): config {true,false,absent} × global {unset,false,unparseable} · `registerPlugin` · outcomes per test-plan row, key absent from persisted `config.json`, no project file written (test-plan #E8).
- [x] 4.3 L1 test (exemplar `pi-agent-settings.test.ts` concurrency): legacy true, global unset · two concurrent migrations · exactly one write, final `flows.editFlow:true` (test-plan #E9).
- [x] 4.4 L1 test (exemplar `pi-agent-settings.test.ts` `fs` failure seam): lock step `io` error · `registerPlugin` · key kept; second start with healthy fs migrates (test-plan #X6).

## 5. Client (D1, D4, D5)

- [x] 5.1 Remove the reconcile effect from `SessionFlowMenuClaim.tsx`; add the edit-mode state hook (GET on mount and on menu open, `usePluginMessage("flows_edit_mode_state")` filtered by sessionId); gate New/Edit… on effective state; add the per-project item with hint naming `.pi/settings.json`; show an error notification on `error`. Verify via 5.3–5.9.
- [x] 5.2 Bind `FlowsSettings.tsx` to GET/PUT `edit-mode-default` (draft commit calls PUT, surfaces `parseError`); fix hint to `manage-flows`. Verify via 5.10.
- [x] 5.3 L1 test (exemplar `packages/flows-plugin/src/__tests__/session-flow-actions-edit.test.tsx`): availability × effective {true,false,unknown} · render claim · New/Edit only for (open,true); per-project labels per row; hint contains `.pi/settings.json` (test-plan #E15).
- [x] 5.4 L1 test (exemplar `packages/flows-plugin/src/__tests__/flows-actions-gate.test.ts`): empty `flowsList`, no flow events, effective on · `shouldRenderFlowsSubcard` + card · false, no FLOWS title, New/Edit in menu (test-plan #E16).
- [x] 5.5 L1 test (exemplar `session-flow-actions-edit.test.tsx`): flows available, config `editFlow` {true,false,absent} · mount + 5 re-renders · send mock 0 edit-mode calls (test-plan #F1).
- [x] 5.6 L1 test (exemplar `session-flow-actions-edit.test.tsx`): same session in 2 provider trees · mount both, remount one · 0 edit-mode sends (test-plan #F2).
- [x] 5.7 L1 test (exemplar `session-flow-actions-open.test.tsx`): hook off, GET now returns true · open menu · GET re-called, label "Turn off edit mode for this project" (test-plan #F6).
- [x] 5.8 L1 test (exemplar `packages/flows-plugin/src/__tests__/FlowsSessionStateContext.test.tsx`): frames for session S and T · hook for S · only S's frame updates state (test-plan #F7).
- [x] 5.9 L1 test (exemplar `session-flow-actions-edit.test.tsx`): GET rejects / 500 / 404 · render claim · neither New/Edit nor per-project item, no throw (test-plan #X5).
- [x] 5.10 L1 test (exemplar `packages/flows-plugin/src/__tests__/FlowsSettings.test.tsx`): GET `{enabled:false}` · toggle on + commit · one PUT `{enabled:true}`, no `plugin_config_write`; 400 `parseError` shown in section (test-plan #F8).

## 6. End-to-end (L3)

- [x] 6.1 L3 spec (exemplar `tests/e2e/flow-attach-before-run.spec.ts`, docker harness, pi-flows >= 0.8.1): clean repo, global `flows.editFlow:true` · open dashboard, render card, reload twice · `git status --porcelain` empty, no `.pi/settings.json` / `.pi/skills/manage-flows/`, New/Edit… visible (test-plan #F3).
- [x] 6.2 L3 spec (exemplar `tests/e2e/blackhole-settings.spec.ts` for settings save + `flow-attach-before-run.spec.ts` for the menu): idle session, no project value, global unset · Settings › Plugins › Flows Edit mode on → Save · container `~/.pi/agent/settings.json` has `flows.editFlow:true`, repo clean, New/Edit… shown with no prompt sent (test-plan #F4).
- [x] 6.3 L3 spec (exemplar `flow-attach-before-run.spec.ts`): two sessions in one cwd, effective off · session A "Turn on edit mode for this project" · repo `.pi/settings.json` `flows.editFlow:true`, session B label flips without reload, global unchanged (test-plan #F5).

## 7. Docs and release notes

- [x] 7.1 Update `packages/flows-plugin/**/AGENTS.md` rows (`edit-mode.ts`, `index.ts`, `SessionFlowMenuClaim.tsx`, `FlowsSettings.tsx`, `configSchema.json`, `package.json`), `packages/shared/src/AGENTS.md` (`pi-agent-settings-lock.ts`), `packages/server/src/AGENTS.md` (`pi-agent-settings.ts`); note the pi-flows >= 0.8.1 floor in the `recommended-extensions.ts` pi-flows comment. Verify: `git diff` shows the rows.
- [x] 7.2 CHANGELOG `[Unreleased]`: BREAKING no auto edit-mode reconcile; global toggle now writes `~/.pi/agent/settings.json` (affects terminal pi sessions too); legacy setting migrated once; leftover project `flows.editFlow` overrides global (delete the key to follow global); upgrade pi-flows to >= 0.8.1. Verify: entry present.
- [x] 7.3 Manual check: a human reads the per-project item and settings hints and confirms they make clear the item writes the repo file and the global toggle does not (test-plan: manual-only, #F9).

## Workflow follow-up

- On archive/sync, update `openspec/specs/flows-edit-mode-settings/spec.md` `## Purpose` to drop the reconcile wording.
