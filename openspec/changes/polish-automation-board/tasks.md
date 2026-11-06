# Tasks

Test tasks are folded from `test-plan.md`; each carries its manifest id, its Triple, and the nearest exemplar to copy harness glue from.

## 1. Host seams (server + plugin runtime)

- [x] 1.1 Add optional `onResult({ outcome, pid })` to `AbortSpawnedRunArgs` in `packages/server/src/spawn-process/abort-spawned-run.ts`. Call it exactly once on every path: the result, `no-identity` on the early return, and `unconfirmed` before rethrowing a `terminate` error. Keep the boolean return. Verify: the 1.2 test passes and the existing `abort-spawned-run.test.ts` cases stay green.
- [x] 1.2 Test (test-plan #E9), see `packages/server/src/spawn-process/__tests__/abort-spawned-run.test.ts`. Input: `terminate` resolving each `TerminateOutcome`, no ids, and a throwing `terminate` · trigger: `abortSpawnedRun({..., onResult})` · observable: `onResult` called once with the outcome, `no-identity` on the early return, `unconfirmed` then rethrow; boolean return unchanged.
- [x] 1.3 Add `isConnected(id)` to `PluginSessionManager` and the optional `onResult` to the `abortSpawnedRun` type (`packages/dashboard-plugin-runtime/src/server/server-context.ts`). Wire `isConnected` to `piGateway.isSessionConnected` in `packages/server/src/server.ts`; the untrusted context returns `false`. Verify: the 1.4 test passes.
- [x] 1.4 Test (test-plan #X9), see `packages/dashboard-plugin-runtime/src/server/__tests__/server-context-abort.test.ts`. Input: trusted vs untrusted context, gateway socket open/closed · trigger: `sessionManager.isConnected(id)` · observable: trusted follows the socket, untrusted is always false.
- [x] 1.5 Update the `AGENTS.md` rows for `abort-spawned-run.ts` (`packages/server/src/spawn-process/`) and `server-context.ts` (`packages/dashboard-plugin-runtime/src/server/`) with `onResult` / `isConnected` and `See change: polish-automation-board`. Verify: both rows are present.

## 2. Run store + engine (server)

- [x] 2.1 Verify stamp survival on reattach: read the register path for a restored session (`session-scanner.ts:251`, gateway `session_register`). Record the finding in design.md Risks. If the stamp is cleared, preserve it for reattach. Verify: the 2.2 test passes.
- [x] 2.2 Test (test-plan #X10), extend `tests/e2e/automation-identity-restart.spec.ts`. Input: a stamped automation session, dashboard restart, bridge reattaches · trigger: read the session after re-register · observable: `automationRun.runId` and `scope` equal the pre-restart values.
- [x] 2.3 Add `scope` to the plugin's spawn stamp (`pluginRef.automationRun`, `engine.ts:~771`); add `engine.bootedAt`, `engine.isTracked(runId)`, and `isOrphaned(record)` per design D1. Verify: the 2.4 test passes.
- [x] 2.4 Test (test-plan #E1), see `packages/automation-plugin/src/__tests__/engine.test.ts`. Input: status {running, done} × tracked {yes, no} × startedAt {<, ≥ bootedAt} · trigger: classify · observable: orphaned only for running ∧ untracked ∧ pre-boot.
- [x] 2.5 Add `finishRunIfRunning` / `finishParentRunIfRunning` with a `{ prune }` option to `run-store.ts`; switch the reaper's on-disk orphan branch (`engine.ts:505-511`) to them. Verify: the 2.6 test passes and `run-store.test.ts` stays green.
- [x] 2.6 Test (test-plan #E11), see `packages/automation-plugin/src/__tests__/run-store.test.ts`. Input: an orphan that is the oldest of 101 terminal runs · trigger: orphan finalize with `prune:false` · observable: the record survives, `stopped`, non-empty `result.md`, not archived.
- [x] 2.7 `engine.stopRun` returns `StopOutcome`; `stopChild` and the spawn-window deferred finalize (`engine.ts:629-648, 817-821`) write `reasonFor(outcome)` instead of `"stopped by user"`; parent outcome aggregation per D4. Verify: the 2.8–2.9 tests pass.
- [x] 2.8 Test (test-plan #X7), see `engine.test.ts`. Input: a tracked run with no sessionId and no spawnToken · trigger: `stopRun` · observable: outcome `unconfirmed`; the record reason contains "before the session registered" after the continuation finalizes.
- [x] 2.9 Test (test-plan #X8), see `engine.test.ts`. Input: a tracked registered run whose abort `onResult` reports `unconfirmed` · trigger: `stopRun` · observable: the record reason contains "may still be running".
- [x] 2.10 Update `packages/automation-plugin/src/server/AGENTS.md` (engine, run-store) and `src/shared/AGENTS.md` (RunRecord client fields). Verify: rows carry `See change: polish-automation-board`.

## 3. Stop pipeline + routes (server)

- [x] 3.1 Implement `stopRun({ scope, scopeBase, runId })` in `index.ts` per design D2/D3/D6: tracked path with scope check; orphan path with the four D2 checks (`isConnected`, stamp runId + scope, `realpathSync` cwd match, sessionId); in-flight dedupe keyed by `realpath(scopeBase)\0runId`; parent cascade through the same map; `prune:false` finalize; `alreadyFinalized` on a lost compare-and-set. Verify: the 3.2–3.13 tests pass.
- [x] 3.2 Test (test-plan #E3), see `engine.test.ts`. Input: orphan + session rows (a)–(g) · trigger: `stopRun` · observable: abort only for (f)/(g); outcomes not-found / unconfirmed×4; record `stopped` in all rows.
- [x] 3.3 Test (test-plan #E4), see `engine.test.ts`. Input: an orphan record naming a connected human session with no stamp · trigger: `stopRun` · observable: abort call count 0, outcome `unconfirmed`.
- [x] 3.4 Test (test-plan #E6), see `packages/automation-plugin/src/__tests__/routes-stop.test.ts`. Input: `done` / `error` / `stopped` records · trigger: `stopRun` · observable: `ok:false`, abort count 0, records unchanged.
- [x] 3.5 Test (test-plan #E7), see `routes-stop.test.ts`. Input: a `running`, untracked, post-boot record · trigger: `stopRun` · observable: `ok:false`, the error mentions the reaper, the record is still running.
- [x] 3.6 Test (test-plan #E8), see `routes-stop.test.ts`. Input: a tracked run in `/a`, request admitted for `/b` · trigger: `stopRun` · observable: `ok:false`, abort count 0.
- [x] 3.7 Test (test-plan #E10), see `engine.test.ts`. Input: orphan parents with child outcomes {k,k}, {k,u}, {nf,nf}, all terminal · trigger: `stopRun(parent)` · observable: killed / unconfirmed / not-found / not-found; parent finalized with combined status + summed findings.
- [x] 3.8 Test (test-plan #X1), see `engine.test.ts`. Input: abort held pending · trigger: two `stopRun` calls for the same orphan · observable: abort count 1, equal results, one write.
- [x] 3.9 Test (test-plan #X2), see `engine.test.ts`. Input: the reaper finalizes while abort is pending · trigger: resolve abort · observable: `alreadyFinalized:true`, the record keeps the reaper's status.
- [x] 3.10 Test (test-plan #X3), see `engine.test.ts`. Input: abort pending · trigger: `stopRun(parent)` and `stopRun(child)` together · observable: abort called once for that child.
- [x] 3.11 Test (test-plan #X4), see `engine.test.ts`. Input: `abortSpawnedRun` rejects · trigger: `stopRun(orphan)` · observable: `unconfirmed`, record `stopped` with "may still be running", no unhandled rejection.
- [x] 3.12 Test (test-plan #X5), see `engine.test.ts`. Input: the scope dir is deleted so `realpathSync` throws · trigger: `stopRun(orphan)` · observable: abort count 0, outcome `unconfirmed`.
- [x] 3.13 Routes: `/stop` uses `withCwd(reply, body.cwd, scope !== "global", …)` and forwards `outcome` / `alreadyFinalized`; `plugin_action stop` admits its cwd through the same helper; `/runs` always overwrites `orphaned`, `tracked`, `sessionConnected` and `scope`. Verify: the 3.14–3.15 tests pass.
- [x] 3.14 Test (test-plan #E5), see `packages/automation-plugin/src/__tests__/routes-cwd-admission.test.ts`. Input: folder without cwd, unadmitted cwd, global without cwd, admitted cwd, `plugin_action` with an unadmitted cwd · trigger: Stop · observable: 400 / rejected / accepted / accepted / rejected; abort never called on a rejection.
- [x] 3.15 Test (test-plan #E2), see `routes-stop.test.ts`. Input: a `run.json` with forged `orphaned/tracked/sessionConnected/scope` · trigger: GET `/runs?scope=folder` · observable: recomputed values in the response; the file is byte-identical.
- [x] 3.16 Security pass (`security-hardening` skill) on groups 1–3. Verify: findings noted in the PR description; no open high findings.
- [x] 3.17 Update the automation-plugin README "Run finalization" section with orphan Stop rules and outcomes. Verify: the section names the four D2 checks and the three outcomes.

## 4. Formatting helpers (client)

- [x] 4.1 Add `client/schedule-format.ts`: `humanizeCron`, `relativeFire`, `runStartLabel`, `runDuration`, `sessionHref` per design D7/D9 and the decided label formats (all take `now`). Verify: the 4.2–4.6 tests pass.
- [x] 4.2 Test (test-plan #E12), see `packages/automation-plugin/src/__tests__/cron.test.ts`. Input: the 8 cron strings · trigger: `humanizeCron` · observable: the 6 strings + 2 nulls in the manifest row.
- [x] 4.3 Test (test-plan #E13), see `cron.test.ts`. Input: 5 start times around the day boundaries (en-GB, now 2026-11-06 10:00) · trigger: `runStartLabel` · observable: "Today 00:00", "Yesterday 23:59", "Yesterday 00:00", short date + 09:20 ×2 (no weekday).
- [x] 4.4 Test (test-plan #E14), see `cron.test.ts`. Input: 59s, 60s, 3599s, 3600s, 3912s, running 1080s · trigger: `runDuration` · observable: "59s", "1m 00s", "59m 59s", "1h 00m", "1h 05m", "18m 00s so far".
- [x] 4.5 Test (test-plan #E15), see `cron.test.ts`. Input: next today 16:30, tomorrow 09:20, +3 days 09:20 · trigger: `relativeFire` · observable: "today 16:30", "tomorrow 09:20", short date + 09:20.
- [x] 4.6 Test (test-plan #E16), see `cron.test.ts`. Input: the 7 run variants · trigger: `sessionHref` · observable: live link only for running+tracked; `?archived=1` for the next five; null without a sessionId.

## 5. Board UI (client)

- [x] 5.1 Token map in `automation-card-visuals.ts` (severity tints, `orphaned` → warning), stripe on rail + running pill, button recipe sizing; drop `statusClass` literals. Verify: the 5.2–5.4 checks pass.
- [x] 5.2 Check (test-plan #E23), see `scripts/theme-token-guard.mjs`. Input: plugin client sources · trigger: `node scripts/theme-token-guard.mjs` · observable: no new violation for `packages/automation-plugin/src/client`.
- [x] 5.3 Test (test-plan #F6), see `packages/automation-plugin/src/__tests__/automation-card-visuals.test.ts`. Input: `prefers-reduced-motion: reduce` · trigger: render a running card · observable: no animation class on stripe/glow; static status colour present.
- [x] 5.4 Test (test-plan #F7), see `automation-card-visuals.test.ts`. Input: a running card · trigger: render · observable: the stripe class is on the rail and the running pill, absent on the card root `li`.
- [x] 5.5 Card meta: humanised schedule (cron in `title`), relative next fire, "flow <name>"; per-automation history grouped by `scope:name` (latest 3 + "Show all (N)", findings chip > 0, archived filter), parent/child inside the card, Open session / Monitor / Result / Log via wouter `useLocation`; remove the global Recent runs section while keeping row testids. Verify: the 5.6–5.9 tests pass.
- [x] 5.6 Test (test-plan #E17), see `packages/automation-plugin/src/__tests__/AutomationBoard.test.tsx`. Input: folder `x` with 2 runs, global `x` with 1 · trigger: render · observable: 2 rows vs 1 row, no shared rows.
- [x] 5.7 Test (test-plan #E18), see `AutomationBoard.test.tsx`. Input: 5 runs with findings {0,2,0,0,0}, 1 archived · trigger: render, Show all, Show archived · observable: 3 rows → 4 → archived appears only with the toggle; one "2 findings" chip; no "0 findings".
- [x] 5.8 Test (test-plan #E19), see `AutomationBoard.test.tsx`. Input: rows running/orphaned/done/stopped/error/parent · trigger: render · observable: Monitor, Monitor, Result, Result, Log, expand control with no Result.
- [x] 5.9 Test (test-plan #E22), see `AutomationBoard.test.tsx`. Input: 0 automations · trigger: render · observable: explanation text + "+ Create Automation" button.
- [x] 5.10 Result/Log via `markdownContent` inside the `ui:dialog` primitive (replaces the raw `z-50` panel). Verify: a component test asserts rendered markdown in a dialog and no `<pre>`.
- [x] 5.11 Orphan UI: orphaned pill + `SettingsNotice` (tracked/connected wording from the listing), `ui:popover` stop confirm, outcome notice per `killed | not-found | unconfirmed`, Stop disabled while pending. Verify: the 5.12–5.15 tests pass.
- [x] 5.12 Test (test-plan #F3), see `AutomationBoard.test.tsx`. Input: an orphan card · trigger: click Stop, press Esc · observable: the popover closes; `stopAutomationRun` count 0.
- [x] 5.13 Test (test-plan #F4), see `AutomationBoard.test.tsx`. Input: mocked outcomes killed / not-found / unconfirmed · trigger: confirm Stop · observable: "process gone" only for killed; unconfirmed says "may still be running"; button disabled while pending.
- [x] 5.14 Test (test-plan #F5), see `AutomationBoard.test.tsx`. Input: an orphan card; stop + refetch returning `stopped` · trigger: confirm Stop · observable: ends at the `stopped` pill + Run now, no orphan notice.
- [x] 5.15 Test (test-plan #X6), see `AutomationBoard.test.tsx`. Input: `stopAutomationRun` rejects · trigger: confirm Stop · observable: error notice; Stop still offered.
- [x] 5.16 Update `api.ts`: `stopAutomationRun` returns `{ ok, outcome, alreadyFinalized, error }`. Update `packages/automation-plugin/src/client/AGENTS.md` rows (AutomationBoard, automation-card-visuals, api, schedule-format). Verify: rows carry `See change: polish-automation-board`.

## 6. Editor entry (E1)

- [x] 6.1 Visible Edit button; the automation name opens the editor; only Delete stays in `⋯`. Verify: the 6.2 test passes.
- [x] 6.2 Test (test-plan #E20), see `AutomationBoard.test.tsx`. Input: a valid card · trigger: render; click the name · observable: `edit-<name>` visible without the overflow menu; the dialog opens; the overflow holds only Delete.
- [x] 6.3 `CreateAutomationDialog` `initialSection` + footer dirty count; schedule text opens on `trigger`. Verify: the 6.4 test passes.
- [x] 6.4 Test (test-plan #E21), see `packages/automation-plugin/src/__tests__/CreateAutomationDialog.test.tsx`. Input: `initialSection:"trigger"` · trigger: open, change the time once · observable: Trigger expanded + first field focused; footer "1 unsaved change".

## 7. Integration

- [x] 7.1 Test (test-plan #F1), extend `tests/e2e/automation-stop-tmux.spec.ts` (restart glue from `tests/e2e/automation-identity-restart.spec.ts`). Input: an automation run, dashboard restarted mid-run, session reconnected · trigger: open the board, Stop, confirm · observable: orphaned pill + "still connected" notice, then the row converges to `stopped`, toast says killed, the pi pid is gone in the container.
- [x] 7.2 Test (test-plan #F2), see `tests/e2e/automation-fanout.spec.ts`. Input: a finished automation run with an archived session · trigger: click Open session on its row · observable: URL `/session/<id>?archived=1` and the read-only transcript renders.
- [x] 7.3 Retire the `automation-triage*` hooks: `rg -n "automation-triage|Recent runs" --glob '!openspec/changes/archive/**'` across the repo; update or remove each dependent; delegate the `docs/qa/distilled-current-test-cases.md` edit to DocScribe (`doubt-driven-review` checkpoint for the removal). Verify: the grep is empty outside the archive.
- [x] 7.4 Full test run: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`, then grep the summary. Verify: 0 failed.
- [ ] 7.5 Manual visual check (test-plan: manual-only, #F8): the board in Base dark, Base light and one non-base palette at 375 and 1440 in an isolated dashboard (non-8000 ports), compared to `mockups/automation-board-redesign` tabs A/E1/S1/P. Verify: screenshots attached to the PR.
- [x] 7.6 `review-code` pass on the full diff before commit. Verify: no blocking findings left open.
