## 1. Types & schema

- [ ] 1.1 Add to `shared/automation-types.ts`: `AutomationConfig.actions?: AutomationAction[]`, `AutomationAction.count?: number`, `AutomationConfig.maxConcurrentSpawns?: number`; `RunRecord` gains `children?: string[]`, `parentRunId?: string`, `actionLabel?: string`, `warning?: string`.
- [ ] 1.2 Implement `actions`/`count`/`maxConcurrentSpawns` validation in `server/automation-schema.ts` (`count` honored on the single `action:` block too; bound is an integer ≥1, no upper cap).
- [ ] 1.3 Test both-forms-declared rejection — see `packages/automation-plugin/src/__tests__/automation-schema.test.ts`. Triple: config with both `action:` and `actions:` · schema parse · parse fails, error names the `action`/`actions` conflict (test-plan #E1).
- [ ] 1.4 Test two distinct actions parse and dispatch distinctly — see `automation-schema.test.ts`. Triple: `actions:` = [`flows.run` flow A, `core.skill` skill B] · schema parse + `resolveChildren` · 2 ChildSpecs, entry 1 dispatches flow A and entry 2 skill B (test-plan #E2).
- [ ] 1.5 Test empty list invalid — see `automation-schema.test.ts`. Triple: `actions: []` · schema parse · parse fails with a validation error (test-plan #E3).
- [ ] 1.6 Test unregistered entry kind names the index — see `automation-schema.test.ts`. Triple: `actions:` = [valid, `{kind: bogus}`] · schema parse · parse fails naming entry index `1` (test-plan #E4).
- [ ] 1.7 Test an invalid automation is isolated — see `packages/automation-plugin/src/__tests__/scanner.test.ts`. Triple: scope holding one invalid + one valid automation file · scan/list · invalid reported invalid, valid one still loads and is schedulable (test-plan #E5).
- [ ] 1.8 Test `count` boundary values — see `automation-schema.test.ts`. Triple: `count` ∈ {0, -1, 1.5, "2"} then {1, 3} · schema parse · 0/-1/1.5/"2" fail validation, 1 → 1 child, 3 → 3 children (test-plan #E6).
- [ ] 1.9 Test `count` default — see `automation-schema.test.ts`. Triple: entry with no `count` · `resolveChildren` · exactly 1 child for that entry (test-plan #E7).
- [ ] 1.10 Test `count` on the single `action:` block — see `automation-schema.test.ts`. Triple: single `action:` + `count: 3` · `resolveChildren` · 3 children of that action (test-plan #E8).
- [ ] 1.11 Test invalid bound rejected — see `automation-schema.test.ts`. Triple: `maxConcurrentSpawns` ∈ {0, -1, 2.5} · schema parse · each fails validation (test-plan #E14).

## 2. Child resolution

- [ ] 2.1 Implement pure `resolveChildren(automation, bound) → { specs: ChildSpec[]; truncated: number }` in `server/resolve-children.ts` (design decision 3), expanding `action:` | `actions:[]` × `count` and truncating in resolution order.
- [ ] 2.2 Implement effective-bound resolution: per-automation `maxConcurrentSpawns` ?? settings default (`4`).
- [ ] 2.3 Test legacy single action resolves to one child — new `__tests__/resolve-children.test.ts`, see `packages/automation-plugin/src/__tests__/predicates.test.ts` for the pure-function harness shape. Triple: single `action:` with no `count` · `resolveChildren` · exactly 1 child, dispatch identical to pre-fan-out (test-plan #E9).
- [ ] 2.4 Test over-bound truncation count — see `__tests__/resolve-children.test.ts` (2.3). Triple: 10 resolved children, effective bound 4 · `resolveChildren(automation, 4)` · 4 specs returned with `truncated: 6` (test-plan #E10).
- [ ] 2.5 Test truncation keeps declaration order — see `__tests__/resolve-children.test.ts` (2.3). Triple: `actions:` = [A `count:3`, B `count:3`], bound 4 · `resolveChildren` · surviving specs are A#0, A#1, A#2, B#0 in that order (test-plan #E11).
- [ ] 2.6 Test under-bound records no warning — see `__tests__/resolve-children.test.ts` (2.3). Triple: 2 resolved children, bound 4 · `resolveChildren` · `truncated: 0` and the parent record carries no `warning` (test-plan #E12).
- [ ] 2.7 Test per-automation bound overrides the settings default — see `__tests__/resolve-children.test.ts` (2.3). Triple: settings default 4, automation declares 2 · effective-bound resolution · at most 2 children (test-plan #E13).

## 3. Run store: child-aware resolution + parent/child layout

- [ ] 3.1 Implement `resolveRunDir(scopeBase, runId)` in `server/run-store.ts` (design decision 1a): top-level hit, else one-level-down search, else `null`. Route `finishRun`, `listRuns`, `listStaleRunningRuns` and `pruneRuns` through it.
- [ ] 3.2 Implement `startParentRun` / `startChildRun`: parent at `runs/<parentRunId>/run.json` with `children: []`; children at `runs/<parentRunId>/<childRunId>/run.json`, appended to the parent. Retention pruning stays top-level-granular.
- [ ] 3.3 Implement the direct parent finalization write (design decision 4b): status, `endedAt`, summed `findings`, optional `warning`; skips `result.md` derivation and the empty-result auto-archive branch.
- [ ] 3.4 Implement persisting a child's `sessionId` on its record when the session registers (design decision 4c).
- [ ] 3.5 Implement the live-occurrence prune guard (design decision 7b): `pruneRuns` skips any top-level record still `running`.
- [ ] 3.6 Test parent + child records are written — see `packages/automation-plugin/src/__tests__/run-store.test.ts`. Triple: a fire resolving 3 children · `startRunFor` · one parent `run.json` with `children` of length 3, and 3 child records each carrying its own `status`, `sessionId`, `startedAt` and action label (test-plan #E16).
- [ ] 3.7 Test a child is addressable by its own run id — see `run-store.test.ts`. Triple: a nested child record · `resolveRunDir(scopeBase, childRunId)` · resolves the child dir without the parent id, and `finishRun(childRunId)` writes that child's `result.md` and status (test-plan #E22).
- [ ] 3.8 Test legacy flat records stay readable — see `run-store.test.ts`. Triple: pre-existing flat `runs/<runId>/run.json` · `listRuns` / `resolveRunDir` · still listed and resolvable, treated as a flat run and not as a parent (test-plan #E23).
- [ ] 3.9 Test retention spares a live occurrence — see `run-store.test.ts`. Triple: a running occurrence with >100 newer runs present · `pruneRuns` · the running parent and its children are retained, with no resurrected half-deleted dir (test-plan #X14).
- [ ] 3.10 Test the stale sweep finds nested children — see `run-store.test.ts`. Triple: an aged child record nested under a parent · `listStaleRunningRuns` · the nested child is returned by the sweep (test-plan #X15).

## 4. Engine fan-out

- [ ] 4.1 Rework `engine.startRunFor`: resolve model once → `resolveChildren` → write parent (+ `warning` when truncated) → spawn one session per child stamped `automationRun.runId = childRunId` (design decision 2).
- [ ] 4.2 Implement per-child `buildRunDispatch` so entry 1 (`flows.run`) and entry 2 (`core.skill`) each get their own dispatch.
- [ ] 4.3 Split `finishAndRelease` per design decision 4a: the child path finalizes the child and decrements the parent counter but does NOT call `runner.completeRun`; only parent finalization calls it, exactly once. A legacy flat run keeps calling it directly.
- [ ] 4.4 Implement the parent finalization counter `{ remaining, statuses, findings }` with the aggregation rule: `error` if any child errored, else `stopped` if every child was stopped, else `done`; findings summed; idempotent on a late signal (design decision 4).
- [ ] 4.5 Implement the child-aware reaper: the sweep enumerates child records and never orphan-finalizes a parent that still has live children.
- [ ] 4.6 Test truncation warning text on the parent — see `packages/automation-plugin/src/__tests__/engine.test.ts`. Triple: 10 resolved children, bound 4 · fire · parent record `warning` names bound `4` and `6` not spawned (test-plan #E15).
- [ ] 4.7 Test aggregate when all children succeed — see `engine.test.ts`. Triple: 3 children finalize `done` with findings 2, 0, 5 · last child finalizes · parent `done` with findings `7` (test-plan #E17).
- [ ] 4.8 Test aggregate when any child errors — see `engine.test.ts`. Triple: children finalize `done`, `error`, `done` · last child finalizes · parent `error` (test-plan #E18).
- [ ] 4.9 Test aggregate when every child was stopped — see `engine.test.ts`. Triple: every child stopped and none errored · last child finalizes · parent `stopped` (test-plan #E19).
- [ ] 4.10 Test aggregate mixed stopped/done — see `engine.test.ts`. Triple: children finalize `stopped`, `done`, none errored · last child finalizes · parent `done` (test-plan #E20).
- [ ] 4.11 Test the parent stays running until the last child — see `engine.test.ts`. Triple: 3 children with 2 finalized · read the parent record · parent reports `running` (test-plan #E21).
- [ ] 4.12 Test sibling isolation on spawn failure — see `engine.test.ts`. Triple: child 2 of 3 spawn returns `success: false` · fire · child 2 finalized `error` with the spawn reason while children 1 and 3 keep running and finalize on their own signals (test-plan #X1).
- [ ] 4.13 Test per-child result isolation — see `packages/automation-plugin/src/__tests__/result-capture.test.ts`. Triple: 3 children each producing distinct assistant text · all finalize · 3 distinct `result.md` files under the parent dir, none overwriting another (test-plan #X2).
- [ ] 4.14 Test child session death finalizes only that child — see `engine.test.ts`. Triple: a child session ends with no terminal event · `onSessionDeath` for that child · only that child finalizes (buffered output → `done`, else `error`), siblings unchanged (test-plan #X3).
- [ ] 4.15 Test parent finalization is idempotent — see `engine.test.ts`. Triple: parent already finalized · a further child termination signal arrives · parent record byte-unchanged, no second finalization (test-plan #X4).
- [ ] 4.16 Test the fire slot is released only by the parent — see `packages/automation-plugin/src/__tests__/runner.test.ts`. Triple: `concurrency: queue` with the first child finalizing while siblings run · queued next fire evaluated · queued fire does NOT start, and starts only after the last child is terminal (test-plan #X5).
- [ ] 4.17 Test children spawn regardless of policy — see `engine.test.ts`. Triple: `concurrency: skip` with 4 resolved children · one fire · all 4 spawns initiated before any child has finalized (test-plan #X6).
- [ ] 4.18 Test an overlapping fire is dropped — see `runner.test.ts`. Triple: `concurrency: skip` with the parent still running · a second fire · second fire dropped and no additional children spawned (test-plan #X7).
- [ ] 4.19 Test a stale child is reaped without touching a live sibling — see `engine.test.ts`. Triple: child A exceeds `maxRunAgeMs` while child B still runs · reaper sweep · only child A finalized, parent stays `running` until B terminates (test-plan #X12).
- [ ] 4.20 Test the reaper never orphan-finalizes a live parent — see `engine.test.ts`. Triple: an aged parent record absent from the engine `pending` map with live children · reaper sweep · parent NOT force-finalized `error`, finalizing only via the child counter (test-plan #X13).

## 5. Stop cascade

- [ ] 5.1 Implement the cascade in `engine.stopRun` over the existing `abortSpawnedRun({sessionId?, spawnToken?})` primitive, resolving either a parent or a child run id (design decision 7).
- [ ] 5.2 Implement the spawn-window guard (design decision 7a): the child context records a `stopRequested` flag and the spawn continuation aborts immediately with the freshly-returned `spawnToken` when it observes the flag.
- [ ] 5.3 Test the stop cascades to all children — see `packages/automation-plugin/src/__tests__/routes-stop.test.ts`. Triple: a parent with 3 running children · `stopRun(parentRunId)` · all 3 child sessions aborted, each child finalized stopped, parent finalized once (test-plan #X8).
- [ ] 5.4 Test a single-child stop leaves siblings running — see `routes-stop.test.ts`. Triple: a parent with 3 running children · `stopRun(childRunId)` of child 2 · child 2 terminated and finalized while children 1 and 3 keep running and the parent stays `running` (test-plan #X9).
- [ ] 5.5 Test a stop inside the spawn window — see `engine.test.ts`. Triple: a child whose `spawnSession` has not yet resolved (no sessionId, no token) · `stopRun(parentRunId)` during that window · the child is aborted on token arrival using the returned `spawnToken` and does not survive to run (test-plan #X10).
- [ ] 5.6 Test a stop racing a child's own session-end — see `engine.test.ts`. Triple: a stop issued concurrently with a child's session-end · both signals delivered · each child finalized exactly once and the parent exactly once (test-plan #X11).

## 6. Routes, config & correlation wiring

- [ ] 6.1 Extend `server/routes.ts`: `/runs` returns parents with child summaries; `/result` resolves a child run id via `resolveRunDir`; `/stop` accepts either a parent or child run id. Update `client/api.ts` to match.
- [ ] 6.2 Extend `unknownActionKind` to validate every `actions:` entry, and make the `/create`/`/update` prompt-normalization branch handle an `actions:`-only config instead of reading `config.action.kind` directly (design decision 9).
- [ ] 6.3 Verify `server/index.ts` correlation/capture needs no keying change (children reuse the single-`runId` stamp); update only the `plugin_action` `stop` handler path if it assumes a single run.
- [ ] 6.4 Add `maxConcurrentSpawns` to `configSchema.json` (`additionalProperties: false`) + `AutomationPluginConfig`, and thread it into `EngineConfig`.
- [ ] 6.5 Implement `actions:` + per-entry `count` serialization in `server/automation-writer.ts`.
- [ ] 6.6 Test an invalid `actions:` entry is rejected on write — see `packages/automation-plugin/src/__tests__/routes-create-action-kind.test.ts`. Triple: POST create/update with `actions:` = [valid, `{kind: bogus}`] · `/create`, `/update` · rejected naming entry index `1`, with nothing persisted that `/list` would later mark invalid (test-plan #E24).
- [ ] 6.7 Test prompt normalization without an `action:` block — see `routes-create-action-kind.test.ts`. Triple: an `actions:`-only config · `/create` · succeeds with no throw from the `config.action.kind` branch (test-plan #E25).
- [ ] 6.8 Test the writer round-trips `actions:` — see `packages/automation-plugin/src/__tests__/automation-writer.test.ts`. Triple: a config with 2 entries + per-entry `count` · write then re-parse · YAML round-trips to an equal config (test-plan #E26).
- [ ] 6.9 Test the config schema accepts the new default — see `packages/automation-plugin/src/__tests__/manifest-discoverability.test.ts`. Triple: plugin config carrying `maxConcurrentSpawns` · configSchema validation under `additionalProperties: false` · accepted, not rejected as an unknown property (test-plan #E27).

## 7. Client UI

- [ ] 7.1 `CreateAutomationDialog`: multi-action editor — add/remove entries, per-entry action picker + payload fields, per-entry `count`; writes `actions:` when >1 entry and `action:` when exactly 1.
- [ ] 7.2 `AutomationBoard` / `AutomationRunMonitor`: parent row with aggregate status, findings and truncation warning, expandable to child rows (action label, status, findings, monitor link).
- [ ] 7.3 Test the parent discloses its children — see `packages/automation-plugin/src/__tests__/AutomationRunMonitor.test.tsx`. Triple: a parent run with 3 children · render `AutomationBoard` / `AutomationRunMonitor` · one parent row with aggregate status + findings, expanding to 3 child rows each with action label, status, findings and session link (test-plan #F1).
- [ ] 7.4 Test the truncation warning is surfaced — see `packages/automation-plugin/src/__tests__/AutomationBoard.test.tsx`. Triple: a parent record carrying `warning` · render the parent row · the warning text is visible on that row (test-plan #F2).
- [ ] 7.5 Test visibility applies to the whole occurrence — see `AutomationBoard.test.tsx`. Triple: effective visibility `hidden` for a fire · render the board · neither the parent nor any child appears (test-plan #F3).
- [ ] 7.6 Test the multi-action editor wiring — see `packages/automation-plugin/src/__tests__/CreateAutomationDialog.wiring.test.tsx`. Triple: dialog with 2 action entries and `count` on entry 2 · add entry, set count, submit · submitted config carries `actions:` with 2 entries, while a single entry submits `action:` instead (test-plan #F4).

## 8. End-to-end (docker harness)

- [ ] 8.1 Author `tests/e2e/automation-fanout.spec.ts` — see `tests/e2e/bus-client-goal-plugin-action.spec.ts` for plugin-action harness glue and `tests/e2e/session-spawn.spec.ts` for spawn/session-link assertions; read the harness port from `.pi-test-harness.json` (`dashboardPort`), never hardcode `:18000`. Triple: an automation with `actions:` = [flow A, skill B] against the docker harness · trigger the automation from the UI · the board converges to one parent entry expanding to 2 child rows with distinct action labels and live per-child status, each linking to a real session (test-plan #F5).
- [ ] 8.2 Author the parent-stop e2e case in `tests/e2e/automation-fanout.spec.ts` — same exemplars as 8.1. Triple: a live parent with 2 running children · click stop on the parent row · the board converges to parent terminal and both child rows terminal, with no child session left running (test-plan #F6).

## 9. Verify & document

- [ ] 9.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then grep for failures; all automation-plugin suites green.
- [ ] 9.2 `npm run quality:changed` clean.
- [ ] 9.3 Update directory `AGENTS.md` rows for every touched file under `packages/automation-plugin/` with `See change: add-automation-concurrent-spawn`.
- [ ] 9.4 Delegate to DocScribe: automation fan-out section in `docs/architecture.md`, `packages/automation-plugin/README.md` (`actions:` / `count` / `maxConcurrentSpawns` config reference), and the `docs/AGENTS.md` row.
- [ ] 9.5 Manual smoke: an automation with `actions:` = [flow A, skill B, `count: 2` flow C], schedule fires once → 4 concurrent sessions appear as children of one parent; stop the parent → all end; parent aggregates (test-plan #M1, manual-only).

## 10. Discipline gates

- [ ] 10.1 Run `review-code` on the full diff before commit.
- [ ] 10.2 Run `performance-optimization` sanity check on the fan-out spawn path (bound enforcement, no O(N) fs scans per completion).
- [ ] 10.3 Run `observability-instrumentation`: log per-fire child count, truncation events, and per-child finalize outcomes.
