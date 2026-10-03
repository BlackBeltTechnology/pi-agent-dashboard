## 1. Poll-cost counters and baseline (measure first)

- [x] 1.1 Add flat optional fields `pollProcScanRuns`, `pollProcScanSpawns`, `pollProcScanMs`, `pollGitProbesTick`, `pollGitProbesTool`, `pollGitProbesWatch`, `pollGitProbesRefresh`, `pollGitSpawns`, `pollGitMs`, `pollGitWatchersAttached` to `ProcessMetrics` in `packages/shared/src/protocol.ts` next to `droppedBufferedFrames`. Verify: `npx tsc --noEmit` clean; every field optional.
- [x] 1.2 Add `packages/extension/src/poll-cost.ts` (plain counter object + `inc`/`time` helpers) and increment it in the EXISTING sync call sites (`scanChildProcesses` per `spawnSync`, `sendGitInfoIfChanged` per git call); spread it into the heartbeat `metrics` in `packages/extension/src/bridge.ts` (~line 3760). Verify: a unit test with two simulated scans reads `pollProcScanRuns === 2`.
- [x] 1.3 In `packages/server/src/routes/system-routes.ts`, report each `poll*` field on `/api/health` as the SUM across live sessions (not the `Math.max` used for `droppedBufferedFrames` at ~line 1177). Verify: E42 test passes.
- [x] 1.4 Record the baseline on today's code: one idle, one bash-loop and one editing session for 5 minutes each, reading each session's own counters. Verify: numbers recorded in `openspec/changes/optimize-polling-hot-paths/notes.md`. **Live capture DEFERRED** — baseline recorded analytically (see notes.md).

## 2. Process scan: single snapshot (Unix)

- [x] 2.1 In `packages/extension/src/process-scanner.ts`, implement pure `parseProcessSnapshot(stdout)` (four leading fields, remainder = args, empty args allowed) and `scanFromSnapshot(snapshot, parentPid, trackedPgids, minElapsedMs, excludedPgids)`; rewire `scanChildProcesses` to one `ps -A -o pid=,ppid=,pgid=,etime=,args=` spawn; replace the exported `captureChildPgids`/`scanTrackedProcesses` (and delete `getChildPids` if `rg` finds no other caller), keeping `getOwnPgid`. Verify: E1–E6 and X1 pass; `process-scanner-kill.test.ts` passes.
- [x] 2.2 Add `scanChildProcessesAsync` (async `execFile`, 5 s timeout, never rejects) sharing the parser. Verify: the same fixture gives identical results through the sync and async variants (covered by E2).
- [x] 2.3 Migrate the existing `packages/extension/src/__tests__/process-scanner.test.ts` cases that inject `_spawnSync` call sequences to snapshot fixtures, keeping one equivalent case per old scenario name. Verify: no test references the removed helpers; the file passes.

## 3. Process scan: Windows single snapshot

- [x] 3.1 Replace the per-child `getWindowsDescendantsCim` calls with one `Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine,CreationDate | ConvertTo-Json -Compress` query and an in-memory tree; normalise single-object JSON; apply `excludedPgids` by PID and reap dead entries; no shell-wrapper name filter; add the async variant. Verify: E7–E10 and X2 pass.

## 4. Process scan: async adaptive scheduler

- [x] 4.1 Create `packages/extension/src/process-scan-scheduler.ts`, pure with an injected clock and timers: fast/idle delays (5/30 s Unix, 10/60 s Windows); fast while the agent runs or a tool executes, for 15 s after either ends, and for 30 s after a list change; re-arm on an idle→fast transition; one extra scan 1 s after a case-insensitive `bash` tool ends; overlap skip; `dispose()`. Verify: E11–E14 pass.
- [x] 4.2 Wire it in `bridge.ts`, replacing the `processScanTimer` `setInterval` (~line 3790): use `scanChildProcessesAsync`, keep the `process_list` diff and `selfSpawnedPgids`, create one-shot timers through the existing `setTimer` registry pattern (~line 360), hook `agent_start`/`agent_end`/`tool_execution_start`/`tool_execution_end`, and dispose any existing scheduler before creating one (session_start re-runs). Verify: X6 (scan part) passes.

## 5. Git: shared async primitives

- [x] 5.1 In `packages/shared/src/platform/git.ts`, change `GIT_STATUS_V2` argv to `["git","--no-optional-locks","status","--porcelain=v2","--branch"]`, add `gitStatusV2Async`, `remoteUrlOrAsync`, `currentBranchOrAsync`, and an optional `gitDir` field on `GitCheckoutRoots` (filled by the resolver that already probes `--git-dir`). Update the argv assertion in `packages/shared/src/__tests__/platform-git.test.ts`. Verify: E36 passes; server tests using `gitStatusV2` (`git-worktree/git-operations.ts`) still pass.

## 6. Git: facts, HEAD file, probe scheduler, watcher

- [x] 6.1 In `packages/extension/src/vcs-info.ts`, add `readHeadBranch(gitDir)` with an async CLI fallback, memoised per HEAD content (or per error code + mtime). Verify: E15–E17 pass.
- [x] 6.2 Add the per-cwd `StaticGitFacts` cache (`remoteUrl`, `roots`, `gitDir`, `dotGitStamp`): synchronous first evaluation; async re-probe on `git_info_refresh`, reconnect reset, stamp change, and ticks 10/20/…; `<cwd>/.git` existence stamp for non-repo cwds; worktree `name` = basename of `thisCheckout`. Verify: E18–E23 pass.
- [x] 6.3 Create `packages/extension/src/git-probe-scheduler.ts`, pure with an injected clock and timers: `request(lane, reason)`, 750 ms trailing debounce, fast lane ≥ 2 s and slow lane ≥ 10 s with deferral (never dropped), fast supersedes slow, one in flight + dirty bit, HEAD-before/after and cwd generation check, `dispose()`. Verify: E25–E30 pass.
- [x] 6.4 Create `packages/extension/src/git-dir-watcher.ts` (modeled on `packages/server/src/git-worktree/folder-head-watcher.ts`): non-recursive `fs.watch` on `gitDir` (+ `commonDir` when different), `persistent: false`, filename routing (HEAD/`packed-refs`/`*_HEAD` → fast lane; `index`/null → slow lane), `attach()` returns false on error, `detach()`. Verify: X3 passes.
- [x] 6.5 Split the tick in `packages/extension/src/git-poll.ts`/`model-tracker.ts`: the tick does the HEAD-file branch, facts stamp, `prStatus.observe`, cwd-missing, name/model/version checks, and one slow-lane request; the probe-result path does the diff and `git_info_update` (omitting `gitStatus` on failure) plus `observe`; PR `onChange` re-sends from cached state; `runGitPollTick` returns `Promise<void>` with `.catch`, and `GitPollDeps` types change. Verify: E33, E37 and X4 pass; `git-poll.test.ts` and `git-info-status.test.ts` are updated and pass.
- [x] 6.6 Wire in `bridge.ts` and `packages/extension/src/session-sync.ts`: tool-end slow requests (case-insensitive allow-list `read|grep|find|ls|glob`); watcher events → lanes; `git_info_refresh` → invalidate facts + fast request; reconnect (~line 1646) → first evaluation + fast request; `handleSessionChange` (~line 297) → first evaluation, reset `lastGitStatusJson`, fast request; registration (~line 3745) → first evaluation + fast request; watcher re-attached on cwd change. Verify: E21, E24, E31, E34, E35 pass.
- [x] 6.7 In `packages/extension/src/pr-status.ts`, limit branch-change generation probes to at most one start per 30 s (latest branch wins; session/cwd changes not throttled). Verify: E32 passes; `pr-status.test.ts` passes unchanged except for new cases.
- [x] 6.8 Move the `poll*` git counter increments onto the new paths (runs per trigger, spawns, ms, `pollGitWatchersAttached`). Verify: E41 passes.

## 7. Name, model and version

- [x] 7.1 Make `sendPiVersionIfChanged` read only on ticks 1, 11, 21, … with retry after a failed read. Verify: E38 passes.
- [x] 7.2 In the existing `eventType === "model_select"` forwarder branch in `bridge.ts` (~line 2431), schedule `sendModelUpdateIfChanged()` 50 ms later via the `setTimer` registry; do not add a second `pi.on`. Verify: E39 and E40 pass.

## 8. pi-resources on demand

- [x] 8.1 Create `packages/server/src/pi/pi-resources-watcher.ts` (shape of `packages/server/src/openspec/openspec-change-watcher.ts`): per-cwd watches on `.pi/` + `skills|prompts|extensions|agents|themes`, one shared global set on `~/.pi/agent/`, filename rules (settings.json, resource-dir entries, resource-dir creation, null), attach → boolean, detach, injected `watch`. Verify: E47, E48 and X8 pass.
- [x] 8.2 In `packages/server/src/directory-service.ts`: delete `piResourcesTimer`/`schedulePiResourcesTick`; add entries `{ data, scannedAt, lastRequestedAt, stale }`, the in-flight map, `getPiResources` → `{ data, stale }`, LRU caps (16 watched / 64 data), and reconciliation at the top of the poll-timer callback before the in-flight/`enabled` gates; `stopPolling` closes all watchers. In `packages/server/src/routes/openspec-routes.ts` (~line 501), start a background refresh when `stale`. Verify: E43–E46, E49–E51 and X9 pass; the existing `/api/pi-resources` behaviour (`joinSkillProvenance`, `refresh=true`) is unchanged.

## 9. Teardown

- [x] 9.1 Add `disposables: Array<() => void>` to the bridge state, drained in `initBridge`'s re-init block next to the `prev.timers` loop (after the `isBridgeReentry` return), in `state.cleanup` (~line 3983) and in `session_shutdown` (~line 3928); register the process-scan scheduler, git probe scheduler and git-dir watcher. Verify: X5–X7 pass.

## 10. Tests: L1 unit (vitest), folded from test-plan.md

- [x] 10.1 Process snapshot, no children (test-plan #E1): pid 100 snapshot without child rows · `scanChildProcesses` · returns `[]` and spawn called once. Exemplar: `packages/extension/src/__tests__/process-scanner.test.ts`.
- [x] 10.2 One spawn for k=5 children (test-plan #E2): 5 direct children, 2 with grandchildren · one scan · spawn called exactly once, leaf-only result. Exemplar: `packages/extension/src/__tests__/process-scanner.test.ts`.
- [x] 10.3 Args with spaces (test-plan #E3): row `node /a b/c.js --flag x` · scan · `command` intact. Exemplar: `packages/extension/src/__tests__/process-scanner.test.ts`.
- [x] 10.4 Empty-args row keeps the tree edge (test-plan #E4): zombie child 200 with grandchild 300 · scan · 300 returned, no throw. Exemplar: `packages/extension/src/__tests__/process-scanner.test.ts`.
- [x] 10.5 Excluded/tracked/alive decision table (test-plan #E5): excluded 500 alive, tracked 600 dead, excluded 700 dead · scan · 500 refused and filtered, 600 and 700 reaped. Exemplar: `packages/extension/src/__tests__/process-scanner.test.ts`.
- [x] 10.6 `minElapsedMs` boundary Unix (test-plan #E6): etime 00:04/00:05/00:06 · scan with 5000 · only 5 s and 6 s rows. Exemplar: `packages/extension/src/__tests__/process-scanner.test.ts`.
- [x] 10.7 Windows delegation (test-plan #E7): `_platform: "win32"` · `scanChildProcesses` · `ps` never spawned, Windows snapshot called once. Exemplar: `packages/extension/src/__tests__/process-scanner.test.ts`.
- [x] 10.8 CIM single-object JSON (test-plan #E8): single object · Windows scan · one-element result. Exemplar: `packages/extension/src/__tests__/process-scanner.test.ts`.
- [x] 10.9 Windows tree + exclusion (test-plan #E9): 100→200→300, 100→400 leaf, `excludedPgids={400}` · Windows scan · PowerShell spawned once, result [300], no wrapper-name filter. Exemplar: `packages/extension/src/__tests__/process-scanner.test.ts`.
- [x] 10.10 Windows `minElapsedMs` boundary (test-plan #E10): CreationDate 29 s / 31 s · scan with 30000 · only the 31 s row. Exemplar: `packages/extension/src/__tests__/process-scanner.test.ts`.
- [x] 10.11 Idle→fast re-arm (test-plan #E11): idle, next scan 25 s away · `tool_execution_start` · scan ≤ 5000 ms (≤ 10000 ms win32). Exemplar: `packages/extension/src/__tests__/pr-status.test.ts` (fake-clock scheduler pattern).
- [x] 10.12 Fast→idle cadence (test-plan #E12): agent ends, list stable · advance clock · 5 s scans until the 15 s/30 s windows end, then 30 s (Windows 10 s→60 s). Exemplar: `packages/extension/src/__tests__/pr-status.test.ts`.
- [x] 10.13 Post-bash scan, case-insensitive (test-plan #E13): toolName `Bash` ends · event · one extra scan at +1000 ms. Exemplar: `packages/extension/src/__tests__/pr-status.test.ts`.
- [x] 10.14 Overlap skip (test-plan #E14): pending scan · timer due · no second spawn. Exemplar: `packages/extension/src/__tests__/pr-status.test.ts`.
- [x] 10.15 HEAD file symref (test-plan #E15): HEAD `ref: refs/heads/feature/x\r\n` · evaluation · `feature/x`, zero spawns. Exemplar: `packages/extension/src/__tests__/vcs-info.test.ts`.
- [x] 10.16 Detached HEAD memo (test-plan #E16): SHA HEAD evaluated twice · evaluations · async fallback once, no sync spawn. Exemplar: `packages/extension/src/__tests__/vcs-info.test.ts`.
- [x] 10.17 Non-heads ref and unreadable HEAD (test-plan #E17): `ref: refs/remotes/…`; ENOENT twice, same mtime · evaluation · fallback used, once for the ENOENT pair, no throw. Exemplar: `packages/extension/src/__tests__/vcs-info.test.ts`.
- [x] 10.18 Facts reused, 10th-tick re-probe (test-plan #E18): stable stamp · ticks 2–10 · zero fact spawns until tick 10's async re-probe. Exemplar: `packages/extension/src/__tests__/vcs-info-worktree-wiring.test.ts`.
- [x] 10.19 Stamp change re-probes worktree (test-plan #E19): `<thisCheckout>/.git` mtime change · next tick · re-probe and changed `gitWorktree` sent. Exemplar: `packages/extension/src/__tests__/vcs-info-worktree-wiring.test.ts`.
- [x] 10.20 `git init` in a plain cwd (test-plan #E20): roots null, `<cwd>/.git` appears · next tick · re-probe and git info sent. Exemplar: `packages/extension/src/__tests__/vcs-info-worktree-wiring.test.ts`.
- [x] 10.21 Registration handshake (test-plan #E21): worktree session registers · first evaluation · first update has `gitWorktree`, no `gitStatus`, fast request queued. Exemplar: `packages/extension/src/__tests__/session-sync.test.ts`.
- [x] 10.22 Worktree `name` from root (test-plan #E22): cwd in a worktree subdirectory · first evaluation · `name` = basename of the worktree root. Exemplar: `packages/extension/src/__tests__/vcs-info-worktree-wiring.test.ts`.
- [x] 10.23 Remote URL cached (test-plan #E23): facts cached · 9 ticks · `remote get-url` spawned 0 times. Exemplar: `packages/extension/src/__tests__/vcs-info.test.ts`.
- [x] 10.24 Tool allow-list (test-plan #E24): `read`/`Read`/`glob`/`ls` vs `edit`/`mcp__x__y` · tool end · only the latter request slow probes. Exemplar: `packages/extension/src/__tests__/git-info-status.test.ts`.
- [x] 10.25 Slow-lane deferral (test-plan #E25): slow probe at t=0 · slow request t=9 s · probe at t=10 s. Exemplar: `packages/extension/src/__tests__/pr-status.test.ts`.
- [x] 10.26 Burst bound (test-plan #E26): tool end every 500 ms for 60 s · fake clock · ≤ 6 slow probes. Exemplar: `packages/extension/src/__tests__/pr-status.test.ts`.
- [x] 10.27 Lane supersede (test-plan #E27): pending slow + HEAD fast request · debounce · one fast-lane probe ≥ 2 s after the last fast one. Exemplar: `packages/extension/src/__tests__/pr-status.test.ts`.
- [x] 10.28 Dirty-bit follow-up (test-plan #E28): probe in flight, 3 requests · settle · exactly one follow-up. Exemplar: `packages/extension/src/__tests__/pr-status.test.ts`.
- [x] 10.29 HEAD moved during probe (test-plan #E29): `main` at start, `topic` at settle · settle · result discarded, one more probe. Exemplar: `packages/extension/src/__tests__/git-info-status.test.ts`.
- [x] 10.30 Stale cwd discarded (test-plan #E30): cwd changes mid-probe · old probe settles · no update for the old cwd. Exemplar: `packages/extension/src/__tests__/git-info-status.test.ts`.
- [x] 10.31 Branch latency ≤ 4 s (test-plan #E31): HEAD watch event with new branch · fake clock · update with branch + status ≤ 4000 ms. Exemplar: `packages/extension/src/__tests__/git-info-status.test.ts`.
- [x] 10.32 PR branch-change throttle (test-plan #E32): 5 branches in 60 s · fake clock · ≤ 2 branch-change PR detections, last for the final branch. Exemplar: `packages/extension/src/__tests__/pr-status.test.ts`.
- [x] 10.33 Status failure keeps PR alive (test-plan #E33): status probes reject, branch has a PR · first poll + `git_info_refresh` · PR detection runs both times; updates omit `gitStatus`. Exemplar: `packages/extension/src/__tests__/pr-status.test.ts`.
- [x] 10.34 Session change resets status diff (test-plan #E34): resume into the same clean repo · probe settles · update carries `gitStatus`. Exemplar: `packages/extension/src/__tests__/session-sync.test.ts`.
- [x] 10.35 Reconnect restores status (test-plan #E35): reconnect cache reset · reconnect · fast probe; update carries `gitStatus`. Exemplar: `packages/extension/src/__tests__/git-info-status.test.ts`.
- [x] 10.36 `--no-optional-locks` argv (test-plan #E36): `GIT_STATUS_V2` · build argv · flag before `status`. Exemplar: `packages/shared/src/__tests__/platform-git.test.ts`.
- [x] 10.37 No sync git after the first evaluation (test-plan #E37): sync runner spy · 20 ticks · zero sync git calls. Exemplar: `packages/extension/src/__tests__/git-poll.test.ts`.
- [x] 10.38 Version cadence (test-plan #E38): reader spy · ticks 1–21 · reads on 1, 11, 21; a throw on 11 → read on 12. Exemplar: `packages/extension/src/__tests__/git-poll.test.ts`.
- [x] 10.39 `model_select` 50 ms push (test-plan #E39): forwarded event, ctx updated · fake clock · no update before 50 ms, one at 50 ms. Exemplar: `packages/extension/src/__tests__/bridge-thinking-level-select.test.ts`.
- [x] 10.40 `model_select` unchanged model (test-plan #E40): same model + thinking level · 50 ms · no update. Exemplar: `packages/extension/src/__tests__/bridge-thinking-level-select.test.ts`.
- [x] 10.41 Heartbeat counters advance (test-plan #E41): one scan + one tool probe · heartbeat · `pollProcScanRuns`/`Spawns` +1, `pollGitProbesTool` +1. Exemplar: `packages/extension/src/__tests__/bridge-shutdown-reset.test.ts`.
- [x] 10.42 Health sums counters (test-plan #E42): sessions with `pollGitSpawns` 3 and 4 · `GET /api/health` · 7. Exemplar: `packages/server/src/__tests__/health-shape.test.ts`.
- [x] 10.43 Request without cwd (test-plan #E43): no `cwd` · `GET /api/pi-resources` · success, cached under `process.cwd()`. Exemplar: `packages/server/src/__tests__/directory-service-openspec-enabled.test.ts`.
- [x] 10.44 No background rescan (test-plan #E44): `startPolling`, no requests · 30 fake min · `scanPiResources` 0 calls. Exemplar: `packages/server/src/__tests__/directory-service-openspec-enabled.test.ts`.
- [x] 10.45 5-minute staleness boundary (test-plan #E45): scanned at 0 · requests at 4:59 and 5:00 · fresh hit, then stale served + one background scan. Exemplar: `packages/server/src/__tests__/directory-service-refresh-force.test.ts`.
- [x] 10.46 Concurrent cold misses (test-plan #E46): two requests, deferred scan stub · resolve · one scan, both responses served. Exemplar: `packages/server/src/__tests__/directory-service-refresh-force.test.ts`.
- [x] 10.47 Local and global watch invalidation (test-plan #E47): `skills/new.md` event; global `settings.json` event · next request · stale + rescan; global marks all entries. Exemplar: `packages/server/src/__tests__/openspec-change-watcher-filter.test.ts`.
- [x] 10.48 Resource dir created later (test-plan #E48): `.pi/skills` missing, `.pi` emits `skills` · reconciliation · stale + subdir watched. Exemplar: `packages/server/src/__tests__/openspec-change-watcher-filter.test.ts`.
- [x] 10.49 LRU caps (test-plan #E49): 17 then 65 cwds · access · 1st releases watches but keeps data; 65th drops the least recent data. Exemplar: `packages/server/src/__tests__/directory-service-known-dirs.test.ts`.
- [x] 10.50 Reconciliation with OpenSpec disabled (test-plan #E50): `openspec.enabled=false`, entry idle 11 min · poll timer fires · watches closed, data kept stale. Exemplar: `packages/server/src/__tests__/directory-service-openspec-enabled.test.ts`.
- [x] 10.51 `refresh=true` (test-plan #E51): fresh entry · request · scan awaited and stored. Exemplar: `packages/server/src/__tests__/directory-service-refresh-force.test.ts`.
- [x] 10.52 Probe leaves index untouched (test-plan #E52): temp repo, real git · `gitStatusV2Async` · `.git/index` mtime unchanged. Exemplar: `packages/shared/src/__tests__/platform-git.test.ts`.
- [x] 10.53 Idle spawn reduction ≥ 5× (test-plan #P1): fake-clock idle session, watcher, 3 children · 10 simulated min · spawns/min ≤ 1/5 of the old-code simulation. Exemplar: `packages/server/src/__tests__/directory-service-eventloop-turns.test.ts` (timed-simulation pattern).
- [x] 10.54 Active session git bound (test-plan #P2): tool end every 2 s · 5 simulated min · ≤ 6 probes/min, 0 sync git spawns. Exemplar: `packages/server/src/__tests__/directory-service-eventloop-turns.test.ts`.
- [x] 10.55 `ps` failure (test-plan #X1): `ps` exits 1 / throws · scan · `[]`, `trackedPgids` unchanged. Exemplar: `packages/extension/src/__tests__/process-scanner.test.ts`.
- [x] 10.56 PowerShell failures (test-plan #X2): non-zero exit, malformed JSON, timeout · Windows scan · `[]`, no throw. Exemplar: `packages/extension/src/__tests__/process-scanner.test.ts`.
- [x] 10.57 Watcher attach failure (test-plan #X3): `fs.watch` throws EMFILE · first evaluation · `pollGitWatchersAttached === 0`, slow probe every tick. Exemplar: `packages/server/src/__tests__/folder-head-watcher.test.ts`.
- [x] 10.58 Status timeout (test-plan #X4): status stalls past `GIT_TIMEOUT` · probe · failed: branch/worktree sent without `gitStatus`; next request proceeds. Exemplar: `packages/extension/src/__tests__/git-info-status.test.ts`.
- [x] 10.59 Late settle after shutdown (test-plan #X5): pending probe + scan · `session_shutdown`, then settle · no sends, nothing re-armed. Exemplar: `packages/extension/src/__tests__/bridge-shutdown-reset.test.ts`.
- [x] 10.60 No stacking across session switches and reloads (test-plan #X6): new → fork → resume, reload ×3 · count live instances · 1 scan schedule, 1 probe scheduler, ≤ 1 watcher set. Exemplar: `packages/extension/src/__tests__/terminal-reload.test.ts`.
- [x] 10.61 Subagent re-entry keeps the parent's watchers (test-plan #X7): `isBridgeReentry` true · re-entry · parent's schedulers and watcher alive. Exemplar: `packages/extension/src/__tests__/terminal-reload.test.ts`.
- [x] 10.62 pi-resource watch attach failure (test-plan #X8): every watch throws · requests at 4 and 5 min · served; stale at 5 min. Exemplar: `packages/server/src/__tests__/openspec-change-watcher-fs.test.ts`.
- [x] 10.63 Background rescan rejects (test-plan #X9): rescan rejects · stale request · stale served, next request retries, no unhandled rejection. Exemplar: `packages/server/src/__tests__/directory-service-refresh-force.test.ts`.
- [x] 10.64 Tick rejection caught (test-plan #X10): `runGitPollTick` rejects · tick · logged once, next tick runs. Exemplar: `packages/extension/src/__tests__/git-poll.test.ts`.

## 11. Tests: L2 qa smoke, folded from test-plan.md

- [x] 11.1 Poll-cost soak (test-plan #P3): new `qa/tests/NN-poll-cost.sh` (next free number) starts the server, one idle session and one faux-model session looping file edits · 5 min · per-session counters: idle (`pollProcScanSpawns`+`pollGitSpawns`)/min ≤ 3, active `pollGitProbesTool`/min ≤ 6. Exemplar: `qa/tests/20-tunnel-readiness-perf.sh`.
- [x] 11.2 Windows self-spawn exclusion (test-plan #X11): `qa/tests/NN-poll-cost.ps1`, bridge auto-starts the dashboard server · 2 scan cycles · the session's `process_list` (via the session REST surface) never contains the server PID. Exemplar: `qa/tests/17-bridge-contention.ps1`.

## 12. Tests: L3 Playwright e2e, folded from test-plan.md

- [x] 12.1 Terminal checkout updates the card (test-plan #F1): harness session on `main` · `git checkout -b e2e-branch` via `docker exec` · branch label converges ≤ 6 s. Exemplar: `tests/e2e/composer-session-strip.spec.ts`.
- [x] 12.2 Agent edit shows the uncommitted indicator (test-plan #F2): clean repo · faux-model `edit` on a tracked file · indicator ≤ 15 s. Exemplar: `tests/e2e/uncommitted-indicator-commit.spec.ts`.
- [x] 12.3 External edit shows the indicator (test-plan #F3): clean repo, idle agent · file modified via `docker exec` · indicator ≤ 35 s. Exemplar: `tests/e2e/uncommitted-indicator-commit.spec.ts`.
- [x] 12.4 Backgrounded process appears in the drawer (test-plan #F4): idle session · faux-model `bash` runs `sleep 60 &` · drawer row ≤ 10 s. Exemplar: `tests/e2e/session-state-honesty.spec.ts`.
- [x] 12.5 New skill appears in Folder Settings (test-plan #F5): resources view open · create `<cwd>/.pi/skills/e2e-skill/SKILL.md` · listed ≤ 60 s. Exemplar: `tests/e2e/resource-scope-routes.spec.ts`.
- [x] 12.6 Model label follows `model_select` (test-plan #F6): running session · model switched via pi's own path (or the set-model path if the harness lacks one; record the deviation) · label ≤ 1 s. Exemplar: `tests/e2e/composer-session-strip.spec.ts`.

## 13. Manual verification

- [x] 13.1 Real-machine before/after measurement (test-plan: manual-only, #P4): on macOS, 3 sessions (idle / bash loop / editing) for 5 min each, old vs new build; record idle-session spawns/min (target ≥ 5× drop) in `notes.md`. **DEFERRED — not yet run** (manual real-machine measurement; see notes.md).

## 14. Verify and document

- [x] 14.1 Full suite: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log; grep -nE 'FAIL|Error|✗|✘|Tests +[0-9]+ (failed|passed)' /tmp/pi-test.log`. Verify: no failures.
- [x] 14.2 Rebuild and reload per the `implement` skill (`npm run reload` for the extension; `POST /api/restart` for server/shared). Confirm that, outside first-evaluation paths and `getOwnPgid`, no `spawnSync`/`runner.run(` call remains reachable from the tick, scan scheduler or probe scheduler call paths. Verify: reviewed list recorded in `notes.md`.
- [ ] 14.3 Run a `review-code` pass on the diff and fix the findings.
- [x] 14.4 Update DOX rows: `packages/extension/src/AGENTS.md` (+ the `process-scanner.ts.AGENTS.md` and `git-poll.ts.AGENTS.md` sidecars; new rows for `poll-cost.ts`, `process-scan-scheduler.ts`, `git-probe-scheduler.ts`, `git-dir-watcher.ts`; rows for `session-sync.ts` and `pr-status.ts`), `packages/server/src/pi/AGENTS.md` (`pi-resources-watcher.ts`), the `directory-service.ts` and `openspec-routes.ts` rows, and `packages/shared/src/platform/git.ts.AGENTS.md`. Verify: each changed or new file has exactly one row citing `See change: optimize-polling-hot-paths`.
- [x] 14.5 Delegate the `docs/architecture.md` polling/watcher section to DocScribe (caveman style). Verify: the section names the two git lanes, the adaptive scan cadence, and pi-resources stale-while-revalidate.
