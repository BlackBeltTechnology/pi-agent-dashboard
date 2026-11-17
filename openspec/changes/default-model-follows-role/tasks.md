# Tasks

## 1. Shared resolver helper and type

- [x] 1.0 Add `resolveDefaultModel(value, cfg)` to `packages/shared/src/role-schema.ts` as a thin wrapper over `resolveModelRef` (no second resolver): `@`-prefixed → `{provider, id, level?}` or `{unresolved}` (unknown, unassigned, or assigned without `provider/`); other values returned verbatim as concrete. Verify with role-schema unit tests (each unresolved case, suffix, role level).
- [x] 1.1 Widen `PiMirrorResult.skipped` in `packages/shared/src/rest-api.ts` (and the local type in `packages/server/src/pi-agent-settings.ts`) to `"no-provider-separator" | "unresolved-role"`. Verify with `npx tsc --noEmit -p packages/shared` and the server typecheck.

- [x] 1.2 Test (test-plan #E1), see `packages/shared/src/__tests__/role-schema.test.ts`: roles planning=anthropic/claude-sonnet-5-5:high, coding=claude-haiku-5-5 · `resolveDefaultModel` on `@planning`, `@planning:medium`, `@ghost`, `@validate`, `@coding`, `anthropic/x:high` · resolved provider/id+level, suffix level medium, three unresolved, concrete returned verbatim.

## 2. Bridge resolves a role-ref default

- [x] 2.1 In `packages/extension/src/bridge.ts` `applyDefaultModel`, resolve a `defaultModel` starting with `@` via `resolveDefaultModel(value, readRoleConfigFromDisk())` before the `provider/id` split (concrete values unchanged), re-resolving on every call including the pending retry; unresolved → return `null`, no pending retry, one log line `[default-model] unresolved role @<role>; using pi default`; resolved-but-not-in-registry → existing pending path with the resolved `provider/id`. Verify with the bridge default-model tests.
- [x] 2.2 Level after `setModel`, direct and pending-retry paths: non-empty `defaultThinkingLevel` as today; else for a role default the ref suffix, else the role level; else none. Verify with the bridge default-model tests.
- [x] 2.3 Update the `packages/extension/src/AGENTS.md` row for `bridge.ts`. Verify the row cites this change.

- [x] 2.4 Test (test-plan #E2), see `packages/extension/src/__tests__/bridge-default-model-apply.test.ts`: defaultModel `@planning`, role → anthropic/claude-sonnet-5-5 in registry · brand-new startup apply · `pi.setModel` called once with that model.
- [x] 2.5 Test (test-plan #E3), see `packages/extension/src/__tests__/bridge-default-model-apply.test.ts`: level table (`@planning`+low+role high / `@planning`+""+role high / `@planning:medium`+""+role high / `@coding`+""+no level / concrete+"") · apply · `setThinkingLevel` low / high / medium / not called / not called.
- [x] 2.6 Test (test-plan #E4), see `packages/extension/src/__tests__/bridge-default-model-apply.test.ts`: role file swapped from anthropic to proxy between two applies · two `applyDefaultModel()` calls · second `setModel` uses the proxy model (no cache).
- [x] 2.7 Test (test-plan #E5), see `packages/extension/src/__tests__/bridge-default-model-apply.test.ts`: `@validate` unassigned and `@coding` → `claude-haiku-5-5` · apply · returns null, no `setModel`, `pendingDefaultModel` null, one log line naming the role.
- [x] 2.8 Test (test-plan #E6), see `packages/extension/src/__tests__/bridge-default-model-apply.test.ts`: `@planning` → local/ocg/longcat-2.5-preview-free missing at startup · registry gains it, retry fires (also with the role file swapped first) · retry applies the local model / the new resolution.
- [x] 2.9 Test (test-plan #X1), see `packages/extension/src/__tests__/bridge-default-model-apply.test.ts`: providers.json unreadable or invalid JSON · apply with `@planning` · no throw, no `setModel`, one log line naming `@planning`.

## 3. Spawn roads pair with a resolved role default

- [x] 3.1 In `packages/server/src/browser-handlers/spawn-choice.ts` `resolveSpawnChoice`, resolve a role-ref `ctx.defaultModel` with `resolveDefaultModel` for the thinking-only pairing (explicit level wins); unresolved → no `--model`, one log line, no warning pushed (REST road stays 200). A request carrying the role as its own `model` keeps the existing `choiceWarning`. Verify with the spawn-choice unit tests.
- [x] 3.2 Same pairing in `packages/server/src/spawn-process/plugin-spawn-choice.ts` `mapPluginSpawnOptions`. Verify with the plugin-spawn-choice unit tests.
- [x] 3.3 Update the `packages/server/src/browser-handlers/AGENTS.md` and `packages/server/src/spawn-process/AGENTS.md` rows. Verify the rows cite this change.

- [x] 3.4 Test (test-plan #E7), see `packages/server/src/__tests__/session-api-spawn-choice.test.ts`: Settings `@planning`, role `:high` · `POST /api/session/spawn {cwd, thinkingLevel:"low"}` · 200, args `--model anthropic/claude-sonnet-5-5 --thinking low`.
- [x] 3.5 Test (test-plan #E8), see `packages/server/src/__tests__/plugin-spawn-choice.test.ts`: `ctx.defaultModel` `@planning` · `mapPluginSpawnOptions({thinking:"low"})` · model anthropic/claude-sonnet-5-5, thinking low, no warning.
- [x] 3.6 Test (test-plan #E9), see `packages/server/src/__tests__/session-api-spawn-choice.test.ts`: Settings `@validate` unassigned · REST spawn with only `thinkingLevel:"low"` · 200, no `--model`, `--thinking low`, no error.
- [x] 3.7 Test (test-plan #E10), see `packages/server/src/browser-handlers/__tests__/session-action-handler-spawn-choice.test.ts`: browser `spawn_session {model:"@validate"}` unassigned · spawn · no `--model`, `spawn_result` success with `choiceWarning` containing `validate`.

## 4. Server mirror and host services

- [x] 4.1 In `packages/server/src/pi-agent-settings.ts` `deriveMirrorWanted`, resolve an `@`-prefixed value with `resolveDefaultModel` (injectable role reader, default `readRoleConfigFromDisk`); unresolved → `skipped: "unresolved-role"`; role-default level = non-empty `defaultThinkingLevel` > suffix > role level. Verify with the pi-agent-settings mirror unit tests.
- [x] 4.2 In `packages/server/src/routes/system-routes.ts`, while the persisted `defaultModel` is a role ref, a save carrying either default key mirrors both. Verify with a system-routes test.
- [x] 4.3 Add `host.remirrorPiDefaults` and `host.defaultModelRef` in `packages/server/src/server.ts`, logic in an extracted module: in-memory last role-default resolution, updated by EVERY mirror write (save, drift repair, re-mirror) and seeded at start without writing; re-mirror writes only on a changed resolution; one log line per write. Verify with unit tests on that module (unchanged → no write; changed → write; concrete default → no write; save `@planning` then unrelated role edit → no write).
- [x] 4.4 In the Default model callout (`SettingsPanel.tsx` pi-mirror notice block), `skipped: "unresolved-role"` renders no separate skip notice (the dangling notice covers it); `no-provider-separator` keeps its notice. Verify with a SettingsPanel test.
- [x] 4.5 Update the `packages/server/src/AGENTS.md` rows for `pi-agent-settings.ts`, `server.ts` and the new module, and `packages/server/src/routes/AGENTS.md` for `system-routes.ts`. Verify the rows cite this change.

- [x] 4.6 Test (test-plan #E12), see `packages/server/src/__tests__/system-routes-pi-mirror.test.ts`: pi `{defaultProvider:"x", defaultModel:"y"}`, role planning `:high` · save `{defaultModel:"@planning", defaultThinkingLevel:""}` · pi anthropic / claude-sonnet-5-5 / high, other keys unchanged.
- [x] 4.7 Test (test-plan #E13), see `packages/server/src/__tests__/system-routes-pi-mirror.test.ts`: `@validate` unassigned · save `{defaultModel:"@validate"}` · mirror `{ok:true, skipped:"unresolved-role"}`, pi file byte-identical.
- [x] 4.8 Test (test-plan #E14), see `packages/server/src/__tests__/system-routes-pi-mirror.test.ts`: persisted `@planning` (role high) · saves `{defaultThinkingLevel:"low"}` then `{defaultThinkingLevel:""}` · pi level low, then high.
- [x] 4.9 Test (test-plan #E15), see `packages/server/src/__tests__/pi-agent-settings.test.ts`: remirror module seeded with `@planning` · seed / unchanged call / role swap call / save-then-hand-edit-then-unrelated-role call / concrete-default call · writes none / proxy keys once / none / none.
- [x] 4.10 Test (test-plan #X2), see `packages/server/src/__tests__/pi-agent-settings.test.ts`: pi settings truncated JSON · `remirrorPiDefaults()` after a resolution change · no throw, file byte-identical, one log line.

## 5. Roles plugin wiring

- [x] 5.1 In `packages/roles-plugin/src/server/index.ts`, on each watcher `onChange` call `ctx.consume("host.remirrorPiDefaults")` when present; register usage for owner `dashboard.defaultModel` reading `host.defaultModelRef` lazily (label `Default model (new sessions)`). Absent host services → no-op. Verify with roles-plugin server tests (re-mirror called on change; usage follows the getter).
- [x] 5.2 Update the `packages/roles-plugin/src/server/AGENTS.md` `index.ts` row. Verify the row cites this change.

- [x] 5.3 Test (test-plan #E16), see `packages/roles-plugin/src/server/__tests__/role-bindings-watcher.test.ts`: stub `host.remirrorPiDefaults`, and none registered · watcher `onChange` · stub called once per change; absent → no throw.
- [x] 5.4 Test (test-plan #E17), see `packages/roles-plugin/src/server/__tests__/roles-routes.test.ts`: stub `host.defaultModelRef` → `@planning`, then undefined · `GET /api/roles/used-by` twice · `Default model (new sessions)` under planning, then nowhere.

## 6. Settings UI

- [x] 6.1 Add `useRolesSnapshot()` in `packages/client/src/lib/roles/` (full `/api/roles` envelope → `{liveRows, activePreset, refetch}`; non-2xx → `null`) with a unit test; add `allowRoles` to the Default model picker in `SettingsPanel.tsx`; a role pick saves `@role` + `defaultThinkingLevel: ""`; a Models-tab pick replaces the ref. Update existing SettingsPanel test fetch mocks to answer `GET /api/roles` (now fetched on mount). Verify with SettingsPanel tests.
- [x] 6.2 Role-default level control: role-derived display with `role` tag while `defaultThinkingLevel` is empty, `role` placeholder when the level is unknown, never locked by role state, levels from the resolved model (all levels when not in the catalogue), a pick writes `defaultThinkingLevel`. Verify with a SettingsPanel test.
- [x] 6.3 Follow hint (`default-model-follows`) and dangling notice (`default-model-dangling`) rendering the ref through `RoleRef`: model from the live group, preset from the active named group; `useRolesSnapshot` on mount and `refetch` after each Default model pick; nothing when the API is absent. Add i18n keys (en, hu, zh-CN). Verify with a SettingsPanel test.
- [x] 6.4 Pass the resolved default (model + effective level) from `SettingsPanel.tsx` to `PiSettingsPage.tsx`; `deriveMirror` / `hasDrift` use it; unresolved role → no model drift. Verify with a PiSettingsPage test.
- [x] 6.5 Update the `packages/client/src/components/settings/AGENTS.md` rows for `ModelSelector.tsx`, `SettingsPanel.tsx` and `PiSettingsPage.tsx`. Verify the rows cite this change.

- [x] 6.6 Test (test-plan #F1), see `packages/client/src/components/__tests__/SettingsPanel.test.tsx`: `/api/roles` fixture (planning → anthropic, active Anthropic) · picker → Roles tab → `[data-role='planning']` → Save · partial `{defaultModel:"@planning", defaultThinkingLevel:""}`, `model-trigger-role-ref` shows `@planning` + `claude-sonnet-5-5`.
- [x] 6.7 Test (test-plan #F2), see `packages/client/src/components/__tests__/SettingsPanel.test.tsx`: config `@planning` / `@planning:low` · pick concrete on Models tab / pick `@planning` on Roles tab · partials `{defaultModel:"anthropic/claude-opus-5-5"}` / `{defaultModel:"@planning"}`.
- [x] 6.8 Test (test-plan #F3), see `packages/client/src/components/__tests__/SettingsPanel.test.tsx`: config `@planning`, `/api/roles` 404 · render + open picker · token shown, no `model-tab-role`, no hint or dangling notice.
- [x] 6.9 Test (test-plan #F4), see `packages/client/src/components/__tests__/SettingsPanel.test.tsx`: fixtures (`@planning`, Anthropic active) / (`@validate` unassigned, Free active) / (`@planning`, live group active) · render · follow hint with RoleRef + Anthropic / dangling with `@validate` + Free / hint without preset name.
- [x] 6.10 Test (test-plan #F5), see `packages/client/src/components/__tests__/SettingsPanel.test.tsx`: `/api/roles` response changes after first call · mount then pick `@coding` · at least two fetches, hint shows the second response's model.
- [x] 6.11 Test (test-plan #F6), see `packages/client/src/components/__tests__/SettingsPanel.test.tsx`: (`@planning`,"",role high) / pick low / (`@validate`,"") then pick low · render/select · `high` + `role` tag / partial `{defaultThinkingLevel:"low"}` without tag / `role` placeholder (not `off`) then partial `{defaultThinkingLevel:"low"}`.
- [x] 6.12 Test (test-plan #F7), see `packages/client/src/components/__tests__/SettingsPanel.test.tsx`: save response mirror `skipped:"unresolved-role"` with `@validate` · Save · `default-model-dangling` present, `default-model-pi-mirror-skipped` absent.
- [x] 6.13 Test (test-plan #E18), see `packages/client/src/components/__tests__/PiSettingsPage.test.tsx`: resolved proxy default vs pi anthropic / unresolved `@validate` / concrete `claude-opus-5-5` · render · drift action shown (repair writes proxy keys) / hidden / hidden.
- [x] 6.14 Test (test-plan #E11), see `packages/client/src/components/__tests__/DirectoryHomeView.test.tsx`: Settings defaults `{defaultModel:"@planning", defaultThinkingLevel:""}` · send without touching chips · `onSpawnSession` gets `model:"@planning"` and no `thinkingLevel` key.

## 7. Docs

- [x] 7.1 Delegate a `docs/` note (DocScribe, caveman style) on the role-following default model: value grammar, level precedence, preset-switch behaviour, unresolved fallback, re-mirror rule. Verify the doc row is added to `docs/AGENTS.md`.

## 8. Release note

- [x] 8.1 Add a `CHANGELOG.md` `## [Unreleased]` entry: Default model can follow a role; rollback note (re-pick a concrete default). Verify the entry exists.

## 9. End-to-end and manual verification

- [x] 9.1 Test (test-plan #F8), see `tests/e2e/role-aware-model-refs.spec.ts`: docker harness with roles plugin, `planning` assigned · Settings → Sessions → picker → Roles → `@planning` → Save, reload · `GET /api/config` has `defaultModel:"@planning"`; after reload `default-model-follows` names the active preset and the planning model.
- [x] 9.2 Test (test-plan #F9), see `tests/e2e/model-roles-promotion.spec.ts`: harness with two presets assigning `planning` differently, default `@planning` · load the second preset on the Model roles page, open Settings → Sessions · hint names the second preset and its model; config still `@planning`.
- [ ] 9.3 Manual check (test-plan: manual-only, #F10): follow hint and dangling notice in dark and light at narrow settings width read as one sentence with the RoleRef aligned.
