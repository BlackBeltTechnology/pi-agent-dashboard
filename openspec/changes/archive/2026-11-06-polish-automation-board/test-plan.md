# Test Plan — polish-automation-board

Stage: design   Generated: 2026-11-06

Locale for every formatting row: tests pin `en-GB` and a fixed `now` = 2026-11-06 10:00 local, so `<t>` renders as `HH:MM`.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | run-lifecycle: orphaned run definition | decision-table | L1 | automated | records with status {running, done} × engine-tracked {yes, no} × startedAt {< bootedAt, ≥ bootedAt} | list runs | `orphaned: true` only for running ∧ untracked ∧ startedAt < bootedAt; the 7 other rows are false |
| E2 | run-lifecycle: listing marks orphaned / connectivity / scope | EP (forged input) | L1 | automated | `run.json` on disk containing `orphaned:false, tracked:true, sessionConnected:true, scope:"global"` for an untracked pre-boot folder run | GET `/runs?scope=folder` | response has `orphaned:true, tracked:false, sessionConnected:false, scope:"folder"`; the file on disk is byte-identical afterwards |
| E3 | run-lifecycle: orphan Stop targets only the stamped session | decision-table | L1 | automated | orphan record + session table: (a) no sessionId, (b) not connected, (c) stamp runId ≠ runId, (d) stamp missing `scope`, (e) stamp ok but cwd = other folder, (f) cwd is a symlink resolving to the scope, (g) all match | `stopRun` | `abortSpawnedRun` called only for (f) and (g); outcomes (a) `not-found`, (b)–(e) `unconfirmed`; record `stopped` in every row |
| E4 | run-lifecycle: forged record cannot target another session | EP (security) | L1 | automated | orphan `run.json` whose `sessionId` names a connected human session (no `automationRun` stamp) | `stopRun` | `abortSpawnedRun` call count 0; outcome `unconfirmed` |
| E5 | run-lifecycle: Stop scope admission | decision-table | L1 | automated | `/stop` bodies: folder without cwd, folder with unadmitted cwd, global without cwd, folder with admitted cwd; `plugin_action stop` with unadmitted cwd | POST / plugin action | 400 / rejected / accepted / accepted / rejected; abort not called on any rejection |
| E6 | run-lifecycle: Stop on a finished run rejected | EP | L1 | automated | records `done`, `error`, `stopped` | `stopRun` | `ok:false`, error set, abort call count 0, records unchanged |
| E7 | run-lifecycle: untracked non-orphan rejected | state-transition (illegal edge) | L1 | automated | `running` record, untracked, startedAt ≥ bootedAt | `stopRun` | `ok:false`, error contains "reaper"; record still `running` |
| E8 | run-lifecycle: Stop from another scope rejected | EP (security) | L1 | automated | tracked run with context scopeBase `/a`; request admitted for `/b` | `stopRun` | `ok:false`; abort call count 0; run still tracked |
| E9 | run-lifecycle: honest outcome (host mapping) | decision-table | L1 | automated | `terminate` resolving each `TerminateOutcome`; neither id given; `terminate` throws | `abortSpawnedRun({..., onResult})` | `onResult` called exactly once per call with the outcome; `no-identity` on early return; `unconfirmed` then rethrow on throw; boolean return unchanged |
| E10 | run-lifecycle: orphan Stop covers the whole occurrence | decision-table | L1 | automated | orphan parent with children outcomes {killed,killed}, {killed,unconfirmed}, {not-found,not-found}, {all already terminal} | `stopRun(parent)` | parent outcome killed / unconfirmed / not-found / not-found; parent record finalized with combined status and summed findings in every row |
| E11 | run-lifecycle: orphan finalize stays visible | BVA (retention) | L1 | automated | orphan record that is the oldest of 101 terminal runs (retention 100) | `stopRun` | record exists afterwards, `status:"stopped"`, non-empty `result.md`, `archived` not true |
| E12 | content-view: board text human-readable (schedule) | EP | L1 | automated | `*/5 * * * *`, `15 * * * *`, `20 9 * * *`, `0 17 * * 1-5`, `0 9 * * 1`, `0 8 1 * *`, `0 9 1-7 * 1`, `not a cron` | `humanizeCron` | "Every 5 minutes", "Hourly at :15", "Daily at 09:20", "Weekdays at 17:00", "Mondays at 09:00", "Monthly on day 1 at 08:00", null, null |
| E13 | content-view: run start label | BVA (calendar day) | L1 | automated | start = today 00:00, yesterday 23:59, yesterday 00:00, 2 days ago 09:20, 8 days ago 09:20 | `runStartLabel(start, now)` | "Today 00:00", "Yesterday 23:59", "Yesterday 00:00", short date + "09:20" (no weekday), short date + "09:20" |
| E14 | content-view: duration format | BVA | L1 | automated | 59s, 60s, 3599s, 3600s, 3912s; running 1080s | `runDuration` | "59s", "1m 00s", "59m 59s", "1h 00m", "1h 05m", "18m 00s so far" |
| E15 | content-view: next fire relative | BVA | L1 | automated | next = today 16:30, tomorrow 09:20, in 3 days 09:20 | `relativeFire(next, now)` | "today 16:30", "tomorrow 09:20", short date + "09:20" |
| E16 | content-view: Open session link target | decision-table | L1 | automated | runs {running tracked, running untracked, orphaned, done, error, stopped, no sessionId} | `sessionHref` | `/session/s1` only for running tracked; `?archived=1` for the next five; `null` for no sessionId |
| E17 | content-view: same-named automations keep separate histories | EP | L1 | automated | folder `x` with 2 runs, global `x` with 1 run | render board | folder card history lists 2 rows, global card 1 row; no row appears on both |
| E18 | content-view: history rows (findings, collapse, archived) | BVA | L1 | automated | automation with 5 runs: findings {0,2,0,0,0}, 1 auto-archived | render; click "Show all"; toggle "Show archived" | 3 rows by default; one "2 findings" chip, no "0 findings" text anywhere; "Show all (4)" reveals 4; archived row appears only with Show archived |
| E19 | content-view: secondary link matrix | decision-table | L1 | automated | rows running, orphaned, done, stopped, error, parent | render | Monitor, Monitor, Result, Result, Log, no Result link (expand control instead) |
| E20 | content-view: Edit directly reachable | EP | L1 | automated | valid automation card | render; click name | `edit-<name>` visible without opening `overflow-<name>`; name click opens the dialog; overflow menu holds only Delete |
| E21 | content-view: editor opens on section with dirty count | state-transition | L1 | automated | dialog with `initialSection:"trigger"` | open; change the time field once | Trigger group expanded and its first field focused; footer reads "1 unsaved change" |
| E22 | content-view: empty folder explains automations | EP | L1 | automated | folder with 0 automations | render | explanation text and a "+ Create Automation" button are present |
| E23 | content-view: colours follow theme contract | static check | ci | automated | plugin client sources after change | `node scripts/theme-token-guard.mjs` | no new violation reported for `packages/automation-plugin/src/client` |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | run-lifecycle: Stop on orphaned run after restart | state-transition | L3 | automated | harness: start an automation run, restart the dashboard while it runs, session reconnects | open board; click Stop on the card; confirm | card shows orphaned pill + notice "still connected" before; after confirm the row converges to `stopped`, toast reads killed, the run's pi pid is gone in the container |
| F2 | content-view: run row navigates to session | state-transition | L3 | automated | harness: a finished automation run whose session is archived | click "Open session" on its row | URL is `/session/<id>?archived=1` and the read-only transcript renders (no SessionNotFound) |
| F3 | content-view: orphan Stop confirm dismiss | state-transition | L1 | automated | orphan card | click Stop; press Esc | popover closes; `stopAutomationRun` call count 0 |
| F4 | run-lifecycle: honest outcome surfaced | decision-table | L1 | automated | mocked `stopAutomationRun` resolving outcome killed / not-found / unconfirmed | confirm Stop | notice text: "process gone" only for killed; unconfirmed text contains "may still be running"; the Stop button is disabled while the request is pending |
| F5 | content-view: orphaned state converges after Stop | convergence | L1 | automated | orphan card; mocked stop + refetch returning `stopped` | confirm Stop | card ends with `stopped` pill and Run now; no orphaned notice remains |
| F6 | content-view: visual language - reduced motion | EP | L1 | automated | `prefers-reduced-motion: reduce` | render running card | stripe/glow elements carry the reduced-motion class or no animation class; static status colour class present |
| F7 | content-view: running indicator on rail and pill only | EP | L1 | automated | running card | render | stripe FX class on the rail and running pill; absent on the card root `li` |
| F8 | content-view: board matches the adopted mockup | visual/subjective | — | manual-only | board in Base dark, Base light, one non-base palette at 375 and 1440 | human compares to `mockups/automation-board-redesign` tabs A/E1/S1/P | [judgment: spacing, hierarchy and calm running state match the mockup — no automatable observable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | run-lifecycle: concurrent Stops signal once | fault-injection (race) | L1 | automated | `abortSpawnedRun` held pending by a deferred promise | two `stopRun` calls for the same orphan before it resolves | abort call count 1; both results deep-equal; one record write |
| X2 | run-lifecycle: Stop races the reaper | fault-injection (race) | L1 | automated | reaper finalizes the orphan while abort is pending | resolve abort afterwards | Stop returns `alreadyFinalized:true`; record keeps the reaper's status; single finalize |
| X3 | run-lifecycle: parent and child Stops race | fault-injection (race) | L1 | automated | abort pending | `stopRun(parent)` and `stopRun(child)` concurrently | abort called once for that child |
| X4 | run-lifecycle: honest outcome on throw | fault-injection (abort) | L1 | automated | `abortSpawnedRun` rejects | `stopRun(orphan)` | outcome `unconfirmed`; record `stopped` with "may still be running"; no unhandled rejection |
| X5 | run-lifecycle: scope comparison fails closed | fault-injection (abort) | L1 | automated | scope dir deleted so `realpathSync` throws | `stopRun(orphan)` | abort call count 0; outcome `unconfirmed` |
| X6 | content-view: stop request fails | fault-injection (abort) | L1 | automated | `stopAutomationRun` rejects (network) | confirm Stop | error notice shown; card still offers Stop |
| X7 | run-lifecycle: spawn-window live stop honest | state-transition | L1 | automated | tracked run with no sessionId and no spawnToken yet | `stopRun` | outcome `unconfirmed`; when the spawn continuation finalizes, record reason contains "before the session registered" |
| X8 | run-lifecycle: live unverifiable kill honest | fault-injection | L1 | automated | tracked registered run; abort `onResult` reports `unconfirmed` | `stopRun` | record reason contains "may still be running" (not "stopped by user") |
| X9 | run-lifecycle: connectivity source | decision-table | L1 | automated | trusted vs untrusted plugin context; gateway socket open / closed | `sessionManager.isConnected(id)` | trusted: true / false following the socket; untrusted: always false |
| X10 | run-lifecycle: stamp survives reattach | state-transition | L3 | automated | harness: stamped automation session, dashboard restart, bridge reattaches | read the session after re-register | `automationRun.runId` and `scope` equal the pre-restart values |

---

## Coverage summary

- Requirements covered: 14/14 (content-view: 6 · run-lifecycle: 8)
- Scenarios by class: edge 23 · perf 0 · frontend 8 · error 10
- Scenarios by level: L1 36 · L3 3 · ci 1 · manual 1
- Scenarios by disposition: automated 40 · manual-only 1

## New infra needed

- none (L3 rows extend the existing docker harness specs `automation-identity-restart.spec.ts` / `automation-stop-tmux.spec.ts`)
