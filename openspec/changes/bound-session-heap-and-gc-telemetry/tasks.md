# Tasks — bound-session-heap-and-gc-telemetry

Test tasks below are folded from `test-plan.md`; the id in parentheses maps a
task back to its manifest row. TDD: write the test, watch it fail, then
implement.

## 1. Config schema (`packages/shared/src/config.ts`, new browser-safe defaults module)

- [ ] 1.1 Test defaults — config `{}` · `loadConfig()` · `sessionHeap.maxOldSpaceMb === 512`, `serverHeap.maxOldSpaceMb === 1536`, optional fields `undefined` not `0` · see `packages/shared/src/__tests__/config-keeper-log.test.ts` (test-plan #E1)
- [ ] 1.2 Test floor boundary — `maxOldSpaceMb: 63` · `loadConfig()` · returns `512`, no throw · see `packages/shared/src/__tests__/config-keeper-log.test.ts` (test-plan #E2)
- [ ] 1.3 Test floor is inclusive — `maxOldSpaceMb: 64` · `loadConfig()` · returns `64` · see `packages/shared/src/__tests__/config-keeper-log.test.ts` (test-plan #E3)
- [ ] 1.4 Test just above floor — `maxOldSpaceMb: 65` · `loadConfig()` · returns `65` · see `packages/shared/src/__tests__/config-keeper-log.test.ts` (test-plan #E4)
- [ ] 1.5 Test invalid values — `0`, `-1`, `1024.5`, `"lots"`, `null`, `[]` · `loadConfig()` each · every case returns `512` and never throws · see `packages/shared/src/__tests__/config-openspec.test.ts` (test-plan #E5)
- [ ] 1.6 Test partial block — `{"sessionHeap":{"maxSemiSpaceMb":8}}` · `loadConfig()` · `maxSemiSpaceMb === 8` and `maxOldSpaceMb === 512` · see `packages/shared/src/__tests__/config-keeper-log.test.ts` (test-plan #E6)
- [ ] 1.7 Test `memoryLimits` independence — config sets `sessionHeap` only · `loadConfig()` · `memoryLimits` deep-equals `DEFAULT_MEMORY_LIMITS` · see `packages/shared/src/__tests__/config-subagent-admission.test.ts` (test-plan #E7)
- [ ] 1.8 Test partial write preservation — persisted `sessionHeap`, then a partial `PUT` omitting it · write + reload · `sessionHeap` survives · see `packages/shared/src/__tests__/config-host-gate.test.ts` (test-plan #E8)
- [ ] 1.9 Implement `SessionHeapConfig`/`ServerHeapConfig` types, defaults, and parsers with fallback-on-invalid; put panel-visible defaults in a browser-safe module following the `memory-limits.ts` precedent (design D7)

## 2. Config write path (`packages/server/src/config-api.ts`)

- [ ] 2.1 Test sub-block deep-merge — persisted `{maxOldSpaceMb:512, initialOldSpaceMb:64}`, save `maxOldSpaceMb:256` only · config write · `initialOldSpaceMb` still `64` · see the existing `memoryLimits` deep-merge tests in `packages/server/src/__tests__/` (test-plan #E9)
- [ ] 2.2 Implement deep-merge for both heap keys, matching the existing `memoryLimits` handling; `serverHeap` sets the COLD-START-required indicator (not the generic restart-required banner, which promises an in-place restart that does not apply it), `sessionHeap` sets neither (design D7)

## 3. Spawn invocation (`packages/server/src/spawn-process/process-manager.ts`)

- [ ] 3.1 Test argv normalization — `piCmd` `["/abs/pi"]` and `[node,"/abs/cli.js"]` · build the invocation · both yield `[runtime, …heapArgs, entry, …piArgs]`, heap args strictly before the entry · see `packages/server/src/__tests__/process-manager-spawn-env.test.ts` (test-plan #E10)
- [ ] 3.2 Test ordering vs runtime re-point — a `[node, cli.js]` pair plus a differing resolved runtime · build the invocation · re-point still applied AND heap args present · see `packages/server/src/__tests__/process-manager-managed-path.test.ts` (test-plan #E11)
- [ ] 3.3 Test pi args untouched — session options producing pi flags · build the invocation · pi's args keep order and content, no heap flag among them · see `packages/server/src/__tests__/process-manager-spawn-env.test.ts` (test-plan #E12)
- [ ] 3.4 Test non-integer never reaches a process — `maxOldSpaceMb: "lots"` · build the invocation · no non-integer token in argv or any command string; default used · see `packages/server/src/__tests__/process-manager-spawn-env.test.ts` (test-plan #X5)
- [ ] 3.5 Implement the normalization, applied **after** `applySpawnRuntimeToPiArgv` so pair-detection is not destroyed (design D2), with integer validation at the boundary

## 4. Inherited-flag strip + provenance (`process-manager.ts`, `packages/extension/src/server-launcher.ts`)

- [ ] 4.1 Test provenance decision table — marker+matching flag · marker+different flag · no marker+flag · neither · build the child env · stripped only in case 1, operator flag preserved verbatim otherwise · see `packages/server/src/__tests__/process-manager-spawn-env.test.ts` (test-plan #E13)
- [ ] 4.2 Test surgical removal — `NODE_OPTIONS="--enable-source-maps --max-old-space-size=8192"` + matching marker · build the child env · result is exactly `--enable-source-maps` · see `packages/server/src/__tests__/process-manager-spawn-env.test.ts` (test-plan #E14)
- [ ] 4.3 Test no other var dropped — parent env with `PATH`, `HOME`, `PI_DASHBOARD_URL`, `NODE_OPTIONS` · build the child env · all pass through unchanged except the dashboard's own heap token · see `packages/server/src/__tests__/plugin-spawn-scope-env.test.ts` (test-plan #E15)
- [ ] 4.4 Implement the marker export at every stamping launcher and the marker-matched strip at the spawn site; replace the two divergent flag detectors (wrapper substring vs extension regex) with the single marker comparison (design D4)
- [ ] 4.5 Update the three existing `buildSpawnEnv` heap assertions in `packages/extension/src/__tests__/server-launcher.test.ts` (two assert `8192`, one asserts a user-pinned `2048` survives) to the config-derived behavior

## 5. Keeper invocation (`packages/server/src/rpc-keeper/keeper-manager.ts`)

- [ ] 5.1 Test the invocation handed to the keeper — headless spawn with a ceiling · inspect `PI_KEEPER_PI_CMD`/`PI_KEEPER_PI_ARGS` · heap args present in the invocation, absent from the keeper's own launch · see `packages/server/src/__tests__/process-manager-keeper-spawn.test.ts` (supporting unit test for the runtime assertion in 11.4)
- [ ] 5.2 Implement: heap args ride the invocation the keeper is given; the keeper's own process is never capped, and the env fallback is forbidden on this strategy (design D3a, D5)

## 6. Multiplexer delivery (`process-manager.ts` `buildTmuxCommand`, `spawnWslTmux`)

- [ ] 6.1 Test per-window env carries the ceiling — tmux/wsl-tmux spawn with a configured ceiling · build the tmux command · a `-e NODE_OPTIONS=--max-old-space-size=<n>` pair is present alongside the existing spawn-token `-e` · see `packages/server/src/__tests__/process-manager.test.ts` (supporting unit test; the runtime behavior is manual row X13)
- [ ] 6.2 Implement `-e`-delivered ceiling for tmux and wsl-tmux; leave the `["pi"]` invocation unrewritten so it still resolves inside the guest namespace (design D3)

## 7. Fallback reporting (`process-manager.ts`, `packages/server/src/routes/system-routes.ts`)

- [ ] 7.1 Test no false positive — every session spawned through the normal argv route · read the health endpoint · fallback not reported as in use · see `packages/server/src/__tests__/process-manager-codes.test.ts` (test-plan #X4)
- [ ] 7.2 Implement the last-resort `NODE_OPTIONS` fallback, a server-log line, and a `/api/health` field recording that it is in use

## 8. Server launch paths (`packages/extension/src/server-launcher.ts`, `packages/server/bin/pi-dashboard.mjs`)

- [ ] 8.1 Test standalone config-derived ceiling — `serverHeap.maxOldSpaceMb: 4096` · start via the standalone wrapper · server `heap_size_limit` within `[4096, 4396]` MB · see `qa/tests/02-server-start.sh` (test-plan #E22)
- [ ] 8.2 Test malformed config tolerated — corrupt JSON config · wrapper start · server starts at the `1536` default, no crash · see `qa/tests/02-server-start.sh` (test-plan #X1)
- [ ] 8.3 Test absent config tolerated — no config file · wrapper start · starts at the `1536` default · see `qa/tests/02-server-start.sh` (test-plan #X2)
- [ ] 8.4 Test bridge path stamps — a pi session whose env carries no heap flag · that session auto-starts a dashboard server · the server runs under the configured server ceiling, not the runtime default · see `qa/tests/02-server-start.sh` (test-plan #X12)
- [ ] 8.5 Implement config-derived `serverHeap` on the standalone wrapper via plain `JSON.parse` with a `1536` fallback (it runs before jiti — design D8)
- [ ] 8.6 Implement the bridge path stamp by passing `env` through `launchDashboardServer`, which currently receives none so the extension's `buildSpawnEnv` never runs (design D5a) — must land with task 4.4

## 9. Metrics + protocol (`packages/extension/src/process-metrics.ts`, `packages/shared/src/protocol.ts`)

- [ ] 9.1 Test optional-field compatibility — heartbeat metrics with all new fields · with none · with a subset · server ingest · accepted in every case, absent fields stay `undefined` not `0` · see `packages/server/src/__tests__/is-activity-event.test.ts` (test-plan #E16)
- [ ] 9.2 Test GC major classification — entries with `detail.kind` 1, 4, and absent `detail` · fold into counters · `gcCount` counts all three, `gcMajorCount` only the `4`, no throw on the `detail`-less entry · see `packages/extension/src/__tests__/process-metrics.test.ts` (test-plan #E17)
- [ ] 9.3 Test read-and-reset — GC activity, read, quiet interval, read again · two successive collections · second read reports `gcCount === 0`, not cumulative · see `packages/extension/src/__tests__/process-metrics.test.ts` (test-plan #E18)
- [ ] 9.4 Implement `heapSizeLimit`, `external`, `arrayBuffers` on `ProcessMetrics` plus scalar GC counters from a `PerformanceObserver("gc")`, classified via `entry.detail.kind` against `NODE_PERFORMANCE_GC_MAJOR` — never `entry.kind`, which is `undefined` (design D6)
- [ ] 9.5 Surface the new fields on `/api/health` `agents[]`

## 10. Settings panel (`packages/client/src/components/settings/SettingsPanel.tsx`)

- [ ] 10.1 Test page attribution — edit `sessionHeap` / edit `serverHeap` · compute dirty pages · `sessions` / `server` respectively, no cross-leak · see `packages/client/src/components/settings/__tests__/settings-page-composition.test.tsx` (test-plan #E19)
- [ ] 10.2 Test save payload — change a heap field · `computeConfigPartial` · the changed top-level key is present · see `packages/client/src/components/settings/__tests__/settings-field-contract.test.tsx` (test-plan #E20)
- [ ] 10.3 Test entry validation — enter `63`, `64`, `8192`, `8193` · blur · `63` refused with the floor explained, `64`/`8192` accepted silently, `8193` accepted with a warning · see `packages/client/src/components/settings/__tests__/settings-bespoke-validation.test.tsx` (test-plan #E21)
- [ ] 10.4 Test effect-boundary copy — Settings → Sessions and → Server · render · session fields say "applies to newly started sessions", server field says a cold start is required · see `tests/e2e/plugin-settings-pages.spec.ts` (test-plan #F1)
- [ ] 10.5 Test save round-trip — change a heap field, save, reload the panel · the panel converges on the saved value, no revert to default · see `tests/e2e/settings-default-model-catalogue.spec.ts` (test-plan #F2)
- [ ] 10.6 Test coupling guard arithmetic — ceiling `512` with `maxConcurrentSubagents` `2`,`4`,`5`,`8` · compute `512/(n+1)` · 171/102/85/57 MB, warning absent at `2`/`4`, present at `5`/`8` · see `packages/shared/src/__tests__/config-subagent-admission.test.ts` (test-plan #E23)
- [ ] 10.7 Test coupling warning rendered — ceiling `512`, raise `maxConcurrentSubagents` to `8` · blur · non-blocking warning names the per-child figure, value stays saveable · see `tests/e2e/plugin-settings-pages.spec.ts` (test-plan #E24)
- [ ] 10.8 Implement the coupling guard: pure helper in shared (so both the panel and tests use one formula), warning surfaced on both the Sessions heap field and the subagent bound field
- [ ] 10.9 Implement the fields, the `CONFIG_FIELD_PAGE` entries, the `computeConfigPartial` branches, and the effect-boundary copy

## 11. End-to-end behavior

- [ ] 11.1 Test telemetry readable — a running session with a configured ceiling · health endpoint after a heartbeat · that session's metrics carry `heapSizeLimit`, `external`, `arrayBuffers` and the GC counters as numbers · see `tests/e2e/archive-fold.spec.ts` for harness glue (test-plan #F3)
- [ ] 11.2 Test session ceiling end-to-end — `sessionHeap.maxOldSpaceMb: 512` · spawn a session, read its metrics · `heapSizeLimit` within `[512, 812]` MB and not the server's ceiling · see `qa/tests/02-server-start.sh` (test-plan #X6)
- [ ] 11.3 Test tooling is not capped — a capped session starts a Node subprocess · read that subprocess's ceiling · it is the runtime default, not the session ceiling — proves the cap did not travel through the environment · see `qa/tests/04-terminal.sh` (test-plan #X7)
- [ ] 11.4 Test keeper not capped — a capped headless session · inspect keeper and pi · pi is under the ceiling, the keeper is not · see `qa/tests/02-server-start.sh` (test-plan #X8)
- [ ] 11.5 Test fallback recorded — a resolution yielding no runtime position · spawn a session · a fallback line in the server log AND the health endpoint reports the fallback in use · see `qa/tests/02-server-start.sh` (test-plan #X3)
- [ ] 11.6 Test reload adopts new config — a running headless session, ceiling changed · reload · the replacement runs under the new ceiling, no stale invocation · see `tests/e2e/archive-fold.spec.ts` (test-plan #X9)
- [ ] 11.7 Test running sessions untouched — lower the ceiling without restarting · every running session keeps its original `heapSizeLimit` · see `qa/tests/02-server-start.sh` (test-plan #X10)
- [ ] 11.8 Test restart is cold-start-only — change `serverHeap`, restart in place · the restarted server keeps the previous ceiling; a cold start adopts the new one · see `qa/tests/02-server-start.sh` (test-plan #X11)

## 12. Manual verification (deferred post-merge)

- [ ] 12.1 Verify a tmux server started before the ceiling was configured still yields a capped pi process in a new pane (test-plan: manual-only)
- [ ] 12.2 Verify on a real Windows host with an existing Windows Terminal process that a spawned session runs under the configured ceiling (test-plan: manual-only)
- [ ] 12.3 Verify on a real Windows host with WSL + tmux that the pi process inside WSL runs under the configured ceiling (test-plan: manual-only)
- [ ] 12.4 After the live server has run ≥24 h on the new defaults, confirm `heapUsed` holds below ~1200 MB and `gcMajorCount` is not climbing, and record **RSS alongside heap** to test the "native overhead shrinks with the string churn" hypothesis; if `heapUsed` is sustained above ~1200 MB, raise `serverHeap.maxOldSpaceMb` to `2048` (test-plan: manual-only)

## 13. Server-side heap + GC telemetry (design D13)

- [ ] 13.1 Test server health telemetry — a running dashboard server · request `/api/health` · the server block carries `heapSizeLimit`, a major-GC count, and the effective starting ceiling · see the existing health-route tests for `packages/server/src/routes/system-routes.ts` (test-plan #E28)
- [ ] 13.2 Test effective ceiling tracks the process — configured ceiling changed without a cold start · request `/api/health` · reported effective ceiling is still the running process's value · see the same health-route test file (test-plan #E29)
- [ ] 13.4 Test configured-vs-effective divergence surfaced — configured ceiling differs from the running process's effective ceiling · render the Server settings page · the panel surfaces that the running value differs · see `packages/client/src/components/settings/__tests__/settings-field-contract.test.tsx` (test-plan #E32)
- [ ] 13.5 Test server ceiling labelled cold-start-only — operator edits `serverHeap.maxOldSpaceMb` · blur · panel states a full cold start is required and does not imply the in-place restart suffices · see `packages/client/src/components/settings/__tests__/settings-field-contract.test.tsx` (test-plan #E31)
- [ ] 13.6 Implement the cold-start-only labelling for `serverHeap` plus the configured-vs-effective divergence indicator, distinct from the generic restart-required banner (spec: settings-panel)
- [ ] 13.3 Implement server-side `v8.getHeapStatistics()` and a major-GC `PerformanceObserver` in `packages/server/src`, surfaced on `/api/health` — neither exists there today; mirror the session-side shape from `packages/extension/src/process-metrics.ts` (design D13)

## 14. Documentation

- [ ] 14.3 Delegate to DocScribe: document in `docker/README.md` that a 1536 MB heap implies ~2.5-3 GB RSS, so a container memory limit below that is SIGKILLed by the kernel before V8 reaches its ceiling — no heap dump, no GC telemetry, no `FATAL ERROR` line; state a memory floor (design D12)
- [ ] 14.1 Delegate to DocScribe: document the two heap config keys, the argv-vs-environment transport and why, the effect boundaries (next spawn; cold start for the server), and the distinction from the existing `memoryLimits` key
- [ ] 14.2 Update the directory `AGENTS.md` rows for every file this change touches
