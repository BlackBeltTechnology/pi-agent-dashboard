# Test Plan — list-models-auto-resync

Stage: design   Generated: 2026-10-20

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | arm-tools: resync before read | state-transition | L1 | automated | fake registry whose `refresh()` adds `newprov/m1` (custom) to `getAvailable()`; `reloadProviders` dep resolves | `list_models.execute({})` | result `models` contains `{ref:"newprov/m1", custom:true}`; `reloadProviders` called before `refresh`, and `refresh` called before `getAvailable` (call-order spy) |
| E2 | arm-tools: resync before read | state-transition | L1 | automated | fake registry whose `refresh()` drops `oldprov/*` from `getAvailable()` | `list_models.execute({})` | no row with `provider:"oldprov"` |
| E3 | arm-tools: credential added | state-transition | L1 | automated | fake registry where `getAvailable()` gains `anthropic/x` only after `refresh()`; no `reloadProviders` dep | `list_models.execute({})` | `anthropic/x` present; `refresh` called exactly once |
| E4 | arm-tools: local-only | EP | L1 | automated | spy registry | `list_models.execute({})` | `refresh` called with an arg whose `allowNetwork === false` and **no** `signal` key |
| E5 | arm-tools: Selector parity | decision-table | L1 | automated | same fake registry fed to `request_models` (no `enabledModels` in a tmp `HOME` `settings.json`) and to `list_models` (no scope) | both invoked | set of `list_models` `ref`s == set of `models_list` `provider/id` |
| E6 | arm-tools: absent registry | EP | L1 | automated | `getRegistry()` returns `undefined`; spies on `reloadProviders` | `list_models.execute({})` | `{models:[], registryReady:false, reason:<non-empty>}`; `reloadProviders` 0 calls |
| E7 | arm-tools: registry cleared mid-resync | state-transition | L1 | automated | `getRegistry()` returns `reg` on the 1st call and `undefined` after; `reg.getAvailable()` yields 1 model | `list_models.execute({})` | `registryReady:true`, 1 model |
| E8 | arm-tools: refreshErrors omitted | EP | L1 | automated | `refresh` resolves `{aborted:false, errors:new Map()}` | `list_models.execute({})` | `"refreshErrors" in details === false` |
| E9 | arm-tools: annotated + resync | decision-table | L1 | automated | `annotated:true`; `refresh` adds uncredentialed `getAll()` entry `c/m` | `list_models.execute({annotated:true})` | row `c/m` present with `excludedReason:"no-credential"`; `refresh` called once |
| E10 | arm-tools: scope still applied | decision-table | L1 | automated | `getScopedModels()` = `[{model:{provider:"a",id:"1"}}]`; post-refresh `getAvailable()` = `a/1`, `b/2` | `list_models.execute({})` | only `a/1` returned |
| E11 | pab: explicit `{}` removes | EP | L1 | automated | `lastRegistered` has `gone`; `providers.json` = `{"providers":{}}` | `reloadProviders(pi)` | `pi.unregisterProvider("gone")` called; diff `removed:["gone"]` |
| E12 | pab: missing file removes | EP | L1 | automated | `lastRegistered` has `gone`; `providers.json` absent | `reloadProviders(pi)` | `unregisterProvider("gone")` called; `removed:["gone"]` |
| E13 | pab: keyless file | EP (invalid class) | L1 | automated | `lastRegistered` has `keep`; file = `{"roles":{}}`, then `{"providers":null}`, then `{"providers":[]}`, then `{"providers":"x"}` | `reloadProviders(pi)` per variant | every variant: 0 `unregisterProvider`/`registerProvider` calls; diff all empty; `console.error` with `[dashboard]` prefix |
| E14 | pab: malformed entry | EP (invalid class) | L1 | automated | `lastRegistered` has `keep`,`a`; file = `{"providers":{"a":null,"keep":{...}}}` | `reloadProviders(pi)` | 0 unregister/register calls; empty diff; error logged |
| E15 | pab: recovery | state-transition | L1 | automated | step 1: file is invalid JSON with `keep` registered; step 2: valid file omitting `keep` | `reloadProviders(pi)` twice | step 1: empty diff, `keep` kept; step 2: `removed:["keep"]` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | arm-tools: bounded re-apply | tail-latency (fake timers) | L1 | automated | `reloadProviders` never settles; `refresh` resolves immediately | tool resolves after advancing fake time by `PROVIDERS_RESYNC_TIMEOUT_MS` (and not before); `refresh` was called | single call |
| P2 | arm-tools: bounded refresh | tail-latency (fake timers) | L1 | automated | `reloadProviders` resolves; `refresh` never settles | tool resolves after advancing by `REFRESH_TIMEOUT_MS`; `registryReady:true` with the last-known models | single call |

### Frontend-quirk

_None. There is no rendered UI in this change._

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | arm-tools: re-apply throws | fault-injection (abort) | L1 | automated | `reloadProviders` rejects `Error("boom")` | `list_models.execute({})` | resolves (no throw); `refresh` still called; `registryReady:true`; warn logged |
| X2 | arm-tools: refresh throws | fault-injection (abort) | L1 | automated | `refresh` rejects | `list_models.execute({})` | resolves with the last-known `getAvailable()`; no `refreshErrors` |
| X3 | arm-tools: per-provider error | fault-injection | L1 | automated | `refresh` resolves `{aborted:false, errors: Map{flaky: Error("down")}}` | `list_models.execute({})` | `refreshErrors` deep-equals `[{provider:"flaky", message:"down"}]`; other models present |
| X4 | arm-tools: aborted with errors | fault-injection | L1 | automated | `refresh` resolves `{aborted:true, errors: Map{x: Error}}` | `list_models.execute({})` | no `refreshErrors` key |
| X5 | arm-tools: agent abort before refresh | fault-injection (abort) | L1 | automated | `reloadProviders` pending; `AbortController` aborted mid-wait | `execute({}, signal)` then `abort()` | resolves without throwing; `refresh` 0 calls |
| X6 | arm-tools: agent abort during refresh | fault-injection (abort) | L1 | automated | `refresh` pending (deferred); abort fired | `execute({}, signal)` then `abort()` | tool resolves before the refresh settles; `refresh` was called without any `signal`; the deferred refresh later resolves without an unhandled rejection |
| X7 | pab: invalid JSON keeps providers | fault-injection | L1 | automated | `keep` registered; `providers.json` content `{"providers":{` (truncated) | `reloadProviders(pi)` | 0 unregister calls; empty diff; `console.error` `[dashboard]` |
| X8 | pab: unreadable + credentials_updated still refreshes | fault-injection | L1 | automated | invalid `providers.json`; bridge `credentials_updated` dispatch with spy registry | dispatch `credentials_updated` | `registry.refresh` called with `{allowNetwork:false}` (empty-diff full local path) |
| X9 | request_models unchanged on valid config | regression | L1 | automated | existing `command-handler.test.ts` request_models fixtures | run the existing suite | all pass with no fixture edits |
| X10 | live out-of-band pickup | fault-injection (real config) | — | manual-only | live session, hand-edit `~/.pi/agent/providers.json` adding a provider (no Settings UI) | call `list_models` | new `ref` listed without a session restart [judgment: needs a live pi + real provider endpoint] |

## Coverage summary

- Requirements covered: 4/4 (arm-tools MODIFIED list_models, ADDED resync, ADDED degrade; pab MODIFIED hot-reload)
- Scenarios by class: edge 15 · perf 2 · frontend 0 · error 10
- Scenarios by level: L1 26 · L2 0 · L3 0
- Scenarios by disposition: automated 26 · manual-only 1

## New infra needed

- None. Exemplars: `packages/extension/src/__tests__/role-model-tools-registry-readiness.test.ts`, `provider-register-reload.test.ts`, `model-refresh-timeout.test.ts`, `command-handler.test.ts`.
