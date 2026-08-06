## 1. Types & schema (TDD)

- [ ] 1.1 Add to `shared/automation-types.ts`: `AutomationConfig.actions?: AutomationAction[]`, `AutomationAction.count?: number`, `AutomationConfig.maxConcurrentSpawns?: number`; `RunRecord` gains `children?: string[]`, `parentRunId?: string`, `actionLabel?: string`, `warning?: string`.
- [ ] 1.2 Write failing tests in `__tests__/automation-schema.test.ts`: `actions` list parses; `action` + `actions` together → error; empty `actions` → error; unregistered entry `kind` → error naming the index; `count: 0`/negative/non-integer → error; `count` default 1.
- [ ] 1.3 Implement `actions`/`count`/`maxConcurrentSpawns` validation in `server/automation-schema.ts` until 1.2 passes.

## 2. Child resolution (TDD)

- [ ] 2.1 Write failing `__tests__/resolve-children.test.ts`: single `action:` → 1 child; 2 entries → 2 children with distinct action specs; `count: 3` → 3 children; over-bound → truncated to bound with `truncated` count; under-bound → `truncated: 0`.
- [ ] 2.2 Implement pure `resolveChildren(automation, bound) → { specs: ChildSpec[]; truncated: number }` in `server/resolve-children.ts` (design decision 3).
- [ ] 2.3 Implement effective-bound resolution: per-automation `maxConcurrentSpawns` ?? settings default (4), with a unit test for the override.

## 3. Run store parent/child layout (TDD)

- [ ] 3.1 Write failing `__tests__/run-store.test.ts` cases: `startParentRun` writes `runs/<parentRunId>/run.json` with `children: []`; `startChildRun` writes `runs/<parentRunId>/<childRunId>/run.json` and appends to the parent; `finishRun` on a child writes that child's `result.md` only; legacy flat records still read via `listRuns`.
- [ ] 3.2 Implement the parent/child record API in `server/run-store.ts`; keep retention pruning at the parent (top-level) granularity.
- [ ] 3.3 Test + implement per-child `listStaleRunningRuns` so the reaper enumerates child records.

## 4. Engine fan-out (TDD)

- [ ] 4.1 Write failing `__tests__/engine.test.ts` cases: one fire with 3 children spawns 3 sessions concurrently, each stamped its OWN `childRunId`; model resolved once per fire; children spawn regardless of `concurrency: skip`.
- [ ] 4.2 Rework `engine.startRunFor` to: resolve model → `resolveChildren` → write parent (+ `warning` when truncated) → spawn one session per child stamped `automationRun.runId = childRunId` (design decision 2).
- [ ] 4.3 Test + implement per-child `buildRunDispatch` so entry 1 (`flows.run`) and entry 2 (`core.skill`) each get their own dispatch.
- [ ] 4.4 Test + implement the parent finalization counter (`{ remaining, statuses, findings }`): parent stays `running` until the last child; `done` when ≥1 done and none errored; `error` if any errored; findings summed; idempotent on a late signal; `runner.completeRun(key)` called exactly once when the parent finalizes (design decision 4).
- [ ] 4.5 Test + implement child-scoped isolation: a child spawn failure finalizes only that child (`error`) and siblings keep running; `onSessionDeath` and the stale reaper decrement the parent counter.

## 5. Stop cascade (TDD)

- [ ] 5.1 Write failing tests: `stopRun(parentRunId)` aborts every live child (including a child with only a `spawnToken`, no sessionId yet), finalizes each child stopped and the parent once; `stopRun(childRunId)` stops just that child and leaves the parent `running`; a stop racing a child's own session-end finalizes each exactly once.
- [ ] 5.2 Implement the cascade in `engine.stopRun` over the existing `abortSpawnedRun({sessionId?, spawnToken?})` primitive (design decision 7).

## 6. Routes & correlation wiring

- [ ] 6.1 Extend `server/routes.ts`: `/runs` returns parents with their child summaries; `/result` accepts a child run id; `/stop` accepts either a parent or child run id (test each in `__tests__/routes-stop.test.ts`).
- [ ] 6.2 Verify `server/index.ts` correlation/capture needs no keying change (children reuse the single-`runId` stamp); update only the `plugin_action` `stop` handler path if it assumes a single run.
- [ ] 6.3 Add `maxConcurrentSpawns` default to the plugin config (`configSchema.json` + `AutomationPluginConfig`) and thread it into `EngineConfig`.

## 7. Client UI

- [ ] 7.1 `CreateAutomationDialog`: multi-action editor — add/remove action entries, per-entry action picker + payload fields, per-entry `count`; writes `actions:` when >1 entry, `action:` when exactly 1. Update `CreateAutomationDialog.wiring.test.tsx`.
- [ ] 7.2 `AutomationBoard` / `AutomationRunMonitor`: render a parent run row with aggregate status + findings and the truncation warning, expandable to child rows (action label, status, findings, monitor link). Add component tests.
- [ ] 7.3 Verify effective visibility is computed once per fire and applied to parent + all children (test).

## 8. Verify & document

- [ ] 8.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then grep for failures; all automation-plugin suites green.
- [ ] 8.2 `npm run quality:changed` clean.
- [ ] 8.3 Update directory `AGENTS.md` rows for every touched file under `packages/automation-plugin/` with `See change: add-automation-concurrent-spawn`.
- [ ] 8.4 Delegate to DocScribe: automation fan-out section in `docs/architecture.md`, `packages/automation-plugin/README.md` (`actions:` / `count` / `maxConcurrentSpawns` config reference), and the `docs/AGENTS.md` row.
- [ ] 8.5 Manual smoke: an automation with `actions:` = [flow A, skill B, `count: 2` flow C], schedule fires once → 4 concurrent sessions appear as children of one parent; stop the parent → all end; parent aggregates.

## 9. Discipline gates

- [ ] 9.1 Run `review-code` on the full diff before commit.
- [ ] 9.2 Run `performance-optimization` sanity check on the fan-out spawn path (bound enforcement, no O(N) fs scans per completion).
- [ ] 9.3 Run `observability-instrumentation`: log per-fire child count, truncation events, and per-child finalize outcomes.
