## 1. Shared argv layer — `SessionFlags` + `sessionFlagsToArgv`

- [ ] 1.1 Add capability-scope fields to `SessionFlags` in `packages/shared/src/platform/spawn-mechanism.ts` (`tools?`, `excludeTools?`, `noBuiltinTools?`, `noTools?`, `skills?`, `noSkills?`, `extensions?`) — flat primitives, matching the existing `model`/`name` convention. Deliberately NO `noExtensions` field.
- [ ] 1.2 Emit the scope flags from `sessionFlagsToArgv`: comma-joined single arg for `--tools`/`--exclude-tools`; repeated `--skill <path>` and `-e <path>`; bare `--no-builtin-tools`/`--no-tools`/`--no-skills`. Each only when present; empty array emits nothing. Append after the existing session/model/name flags so absent-scope argv is byte-identical.

## 2. Env layer — `SessionOptions` + `buildSpawnEnv`

- [ ] 2.1 Add scope fields + `extensionConfig?: Record<string,Record<string,string>>` to `SessionOptions` in `packages/server/src/spawn-process/process-manager.ts`; thread the argv scope fields into the `sessionFlagsToArgv` call sites (`buildHeadlessArgs`/wt/tmux) via `SessionFlags`.
- [ ] 2.2 Project `extensionConfig` into env in `buildSpawnEnv`: for each `name`/`key`, set `PI_EXT_<NAME>_<KEY>` where name+key are uppercased with every `[^A-Z0-9_]` char replaced by `_`. Absent `extensionConfig` leaves env untouched. Applies on the headless mechanism (the plugin-spawn path).

## 3. Mapper + plugin-facing type

- [ ] 3.1 Add the optional `scope` block to `PluginSpawnOptions` in `packages/dashboard-plugin-runtime/src/server/server-context.ts` (nested block per design D1; no `noExtensions`).
- [ ] 3.2 Add exported total pure function `pluginSpawnToSessionOptions(opts: PluginSpawnOptions): SessionOptions` (dashboard-plugin-runtime) that flattens `scope` → `SessionOptions` scope fields + `extensionConfig`. Total: never throws; malformed containers (`null`/array/primitive where an array/record is expected) treated as absent; argv-bound strings dropped when not a non-empty string or containing NUL; `extensionConfig` values dropped when non-string or containing NUL.

## 4. Server hook wiring

- [ ] 4.1 In the `spawnSession` hook (`packages/server/src/server.ts` ~2185) replace the inline `spawnPiSession(cwd, {...})` literal with a call to `pluginSpawnToSessionOptions(opts)`, spread into the `spawnPiSession` call. Call the mapper BEFORE `pendingAutomationRunRegistry.enqueue` so a malformed-input path cannot strand a stale `automationRun` stamp keyed by `cwd`. Trust gate (`priority <= 100`) unchanged.

## 5. Folded automated tests — L1 argv (extend `packages/shared/src/platform/__tests__/spawn-mechanism.test.ts`)

- [ ] 5.1 Partial scope block. Input: `scope.tools=["read"]`, all else absent · trigger: mapper→argv · observable: `--tools read` and no skill/extension/builtin flag. (see spawn-mechanism.test.ts) (test-plan #E2)
- [ ] 5.2 Allowlist comma-joined. Input: `scope.tools=["read","grep","ls"]` · trigger: mapper→argv · observable: `--tools` then single arg `read,grep,ls`. (test-plan #E3)
- [ ] 5.3 Repeatable `--skill`. Input: `scope.skills=["/a/skill.md","/b/skill.md"]` · trigger: mapper→argv · observable: `--skill /a/skill.md` and `--skill /b/skill.md` separate pairs. (test-plan #E4)
- [ ] 5.4 Repeatable `-e`. Input: `scope.extensions=["/x/ext.js","/y/ext.js"]` · trigger: mapper→argv · observable: `-e /x/ext.js` and `-e /y/ext.js` separate pairs. (test-plan #E5)
- [ ] 5.5 Boolean toggles bare. Input: `scope.noTools=true`,`scope.noSkills=true` · trigger: mapper→argv · observable: argv contains `--no-tools` and `--no-skills`. (test-plan #E6)
- [ ] 5.6 Empty array emits no flag. Input: `scope.tools=[]` · trigger: mapper→argv · observable: no `--tools` flag present. (test-plan #E7)
- [ ] 5.7 Conflicting fields both forwarded. Input: `scope.noTools=true` + `scope.tools=["read"]` · trigger: mapper→argv · observable: both `--no-tools` and `--tools read`; neither dropped nor rejected. (test-plan #E8)
- [ ] 5.8 No `--no-extensions` ever emitted. Input: any combination of `scope` fields (incl. every boolean true) · trigger: mapper→argv · observable: argv NEVER contains `--no-extensions`. (test-plan #E14)
- [ ] 5.9 Non-string allowlist entries dropped. Input: `scope.tools=["read",42,"",null,"grep"]` (runtime JS) · trigger: mapper→argv · observable: `--tools read,grep`; invalids dropped; no throw. (test-plan #X1)
- [ ] 5.10 NUL in argv-bound string dropped. Input: a `skills`/`extensions`/`tools` entry contains `\0` · trigger: mapper→argv · observable: that entry dropped; spawn proceeds; no `spawn` crash. (test-plan #X2)

## 6. Folded automated tests — L1 env (new test beside `packages/server/src/__tests__/cli-env-no-clobber.test.ts`)

- [ ] 6.1 Config → namespaced env. Input: `scope.extensionConfig={myext:{token:"abc"}}` · trigger: mapper→`buildSpawnEnv` (headless) · observable: `PI_EXT_MYEXT_TOKEN=abc`; no argv element derived. (see cli-env-no-clobber.test.ts) (test-plan #E9)
- [ ] 6.2 Name/key normalization. Input: `{"my-ext":{"api.key":"v"}}` · trigger: mapper→env · observable: `PI_EXT_MY_EXT_API_KEY=v`. (test-plan #E10)
- [ ] 6.3 extensionConfig absent leaves env untouched. Input: `scope.extensionConfig` absent · trigger: mapper→env · observable: env carries no `PI_EXT_*` from this capability. (test-plan #E11)
- [ ] 6.4 NUL in env value dropped. Input: an `extensionConfig` value contains `\0` · trigger: mapper→env · observable: entry dropped; spawn proceeds; no crash. (test-plan #X3)

## 7. Folded automated tests — L1 mapper (new test in `packages/dashboard-plugin-runtime/src/__tests__/`)

- [ ] 7.1 Scope omitted ⇒ byte-identical. Input: `{cwd,model}` no `scope` · trigger: `pluginSpawnToSessionOptions`→`sessionFlagsToArgv`+`buildSpawnEnv` · observable: argv byte-identical to pre-change output; env carries no `PI_EXT_*`. (see server-context-model-runtime.test.ts) (test-plan #E1)
- [ ] 7.2 Mapper forwards existing fields unchanged. Input: `{cwd,model}` no scope · trigger: `pluginSpawnToSessionOptions` · observable: returned `SessionOptions.model` unchanged; argv equals prior inline-literal argv. (test-plan #E12)
- [ ] 7.3 Mapper forwards scope fields. Input: full `scope` block · trigger: `pluginSpawnToSessionOptions` · observable: each `scope.*` reaches `sessionFlagsToArgv` (argv) and `buildSpawnEnv` (`extensionConfig`). (test-plan #E13)
- [ ] 7.4 Malformed container treated as absent. Input: `scope.extensionConfig`/`scope` = `null` | array | primitive · trigger: mapper · observable: treated as absent; no throw; no iteration error. (test-plan #X4)
- [ ] 7.5 Mapping precedes automationRun enqueue. Input: options carry both `automationRun` + malformed `scope` · trigger: `spawnSession` hook · observable: `pluginSpawnToSessionOptions` runs BEFORE `pendingAutomationRunRegistry.enqueue`; a sanitized/rejected input cannot strand a stamp keyed by `cwd`. (test-plan #X5)

## 8. Folded automated tests — L3 e2e (extend `tests/e2e/automation-fanout.spec.ts` pattern)

- [ ] 8.1 Scope preserves control channel. Input: headless spawn with `scope.noTools=true` · trigger: session boots against docker harness (`dashboardPort` from `.pi-test-harness.json`, never hardcode `:18000`) · observable: session loads the dashboard bridge and REGISTERS (session card converges into the dashboard list), is abortable — control channel intact despite `noTools`. (see tests/e2e/automation-fanout.spec.ts) (test-plan #F1)

## 9. Docs

- [ ] 9.1 Document the `scope` block + `PI_EXT_<NAME>_<KEY>` env convention and the deliberate no-`noExtensions` control-channel rule. Update the per-file `AGENTS.md` rows for the changed exports: `packages/dashboard-plugin-runtime/src/server/AGENTS.md` (`PluginSpawnOptions`, `pluginSpawnToSessionOptions`), `packages/shared/src/platform/AGENTS.md` (`SessionFlags`/`sessionFlagsToArgv`), `packages/server/src/spawn-process/AGENTS.md` (`SessionOptions`/`buildSpawnEnv`). Any `docs/` prose is delegated to DocScribe in caveman style.
