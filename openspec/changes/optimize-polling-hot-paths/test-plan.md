# Test Plan — optimize-polling-hot-paths

Stage: proposal/design (HARD gate — clarifications G1–G3 answered via `ask_user`, see below). Generated: 2026-10-01

Source artifacts read: `proposal.md`, `design.md`, `specs/session-process-tracking/spec.md`, `specs/session-process-tracker/spec.md`, `specs/git-context/spec.md`, `specs/bridge-session-state-poll/spec.md`, `specs/pi-resource-scanning/spec.md`.

## Clarifications resolved

- **G1** branch-change latency: L1 fake-clock asserts ≤ 4 s; L3 e2e asserts ≤ 6 s (CI headroom). The user selected both options; read as "both layers".
- **G2** `model_select` push: L1 fake-clock asserts emission at the 50 ms tick and not before; L3 asserts ≤ 1 s wall-clock. (Both selected → both layers.)
- **G3** spawn-reduction gates: L2 qa perf script reading per-session `poll*` counters over 5 min, plus L1 fake-clock simulations, plus one manual real-machine measurement. (All selected → all three.) The trailing "Other" selection had no text and is ignored.

## Requirement refs

| ref | requirement |
|---|---|
| PT-scan | `session-process-tracking` § Process scanner detects child processes of pi session |
| PT-plat | `session-process-tracking` § Process scanner is Unix-only with platform guard |
| PT-poll | `session-process-tracking` § Bridge polls process scanner and sends updates on change |
| PW-win | `session-process-tracker` § Windows process scanning |
| GC-branch | `git-context` § Git branch detection |
| GC-remote | `git-context` § Git remote URL detection |
| GC-refresh | `git-context` § Periodic git info refresh |
| BS-detect | `bridge-session-state-poll` § Git state detection |
| BS-facts | `bridge-session-state-poll` § Static git facts are cached per working directory |
| BS-head | `bridge-session-state-poll` § Branch is read from the HEAD file |
| BS-ver | `bridge-session-state-poll` § pi version is re-read on a slow cadence |
| BS-model | `bridge-session-state-poll` § Model selection runs the model-update check immediately |
| BS-cost | `bridge-session-state-poll` § Poll cost is reported in the heartbeat |
| BS-dispose | `bridge-session-state-poll` § Poll schedulers and watchers are disposed on teardown |
| PR-rest | `pi-resource-scanning` § REST endpoint |
| PR-cache | `pi-resource-scanning` § Polling integration |
| NG-pr | proposal Non-goals — PR cadence/back-off unchanged except the branch-change 30 s guard |

Level routing: L1 = vitest `packages/*/src/**/__tests__/*.test.ts` (fake clock + injected spawn/watch) · L2 = `qa/tests/*.sh` (process/CLI, no rendered UI) · L3 = Playwright `tests/e2e/*.spec.ts` against the docker harness (port from `.pi-test-harness.json`).

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | PT-scan | EP | L1 | automated | snapshot fixture: pi pid 100 with no child rows | `scanChildProcesses` | returns `[]`; injected spawn called exactly 1× |
| E2 | PT-scan | BVA (k=5) | L1 | automated | fixture: pid 100 with 5 direct children, 2 of them with grandchildren | one scan | spawn called exactly 1×; result = 3 childless children + the grandchildren; no wrapper with children present |
| E3 | PT-scan | EP | L1 | automated | fixture row `200 100 200 01:10 node /a b/c.js --flag x` | scan | result `command === "node /a b/c.js --flag x"` |
| E4 | PT-scan | BVA (empty field) | L1 | automated | fixture: child 200 row with empty args (zombie), grandchild 300 under 200 | scan | 300 present in result; 200 excluded by leaf-only rule; no parse throw |
| E5 | PT-scan | decision-table (excluded × tracked × alive) | L1 | automated | `excludedPgids={500}`, child 500 alive; `trackedPgids={600}` with no live 600 row; `excludedPgids` also holds dead 700 | scan | 500 not added to `trackedPgids` and not in result; 600 removed from `trackedPgids`; 700 removed from `excludedPgids` |
| E6 | PT-scan | BVA (`minElapsedMs` 5000) | L1 | automated | children with etime `00:04`, `00:05`, `00:06` | scan with `minElapsedMs=5000` | only the 5 s and 6 s rows returned |
| E7 | PT-plat | EP (platform) | L1 | automated | `_platform: "win32"`, injected spawn | `scanChildProcesses` | `ps` never spawned; Windows snapshot path invoked once |
| E8 | PW-win | EP (JSON shape) | L1 | automated | CIM JSON single object `{ProcessId:200,ParentProcessId:100,...}` | Windows scan | treated as one-element list; result has pid 200 |
| E9 | PW-win | EP | L1 | automated | CIM JSON array: 100→200 (with child 300), 100→400 (leaf); `excludedPgids={400}` | Windows scan | PowerShell spawned exactly 1×; result = [300]; 400 excluded; shell wrapper names NOT filtered (a leaf `bash.exe` child stays) |
| E10 | PW-win | BVA (`minElapsedMs` 30000) | L1 | automated | `CreationDate` 29 s and 31 s before fake now | Windows scan | only the 31 s row returned |
| E11 | PT-poll | state-transition | L1 | automated | scheduler idle, next scan armed 25 s away (Unix) | `tool_execution_start` | a scan starts ≤ 5000 ms after the event (fake clock); ≤ 10000 ms with `_platform: win32` |
| E12 | PT-poll | state-transition | L1 | automated | fast cadence; agent ends, no tools, list unchanged | advance fake clock | scans every 5000 ms until 15 s after `agent_end` and 30 s after last list change, then every 30000 ms (Windows: 10000 → 60000) |
| E13 | PT-poll | EP (tool name case) | L1 | automated | `tool_execution_end` with toolName `Bash` | event | exactly one extra scan 1000 ms later |
| E14 | PT-poll | state-transition | L1 | automated | scan pending (spawn promise unresolved) | timer falls due again | no second spawn started for that due time |
| E15 | BS-head | EP (HEAD content) | L1 | automated | `<gitDir>/HEAD` = `ref: refs/heads/feature/x\r\n` | evaluation after first | branch `feature/x`; zero git spawns |
| E16 | BS-head | EP | L1 | automated | HEAD = 40-hex SHA, evaluated twice with same content | two evaluations | async CLI fallback called once; branch = its short SHA; no sync spawn |
| E17 | BS-head | EP | L1 | automated | HEAD = `ref: refs/remotes/origin/main`; and separately HEAD read throws ENOENT twice with same mtime | evaluation | CLI fallback used; for ENOENT the fallback runs once for the two evaluations; no throw |
| E18 | BS-facts | state-transition | L1 | automated | facts probed for cwd A; stamp unchanged | ticks 2..9 | zero remote-URL / checkout-root spawns; tick 10 issues one async re-probe |
| E19 | BS-facts | state-transition | L1 | automated | linked worktree; tick stamp sees `<thisCheckout>/.git` mtime change | next tick | async re-probe runs; changed `gitWorktree` sent in a `git_info_update` |
| E20 | BS-facts | state-transition | L1 | automated | non-repo cwd (roots null); `<cwd>/.git` created | next tick | facts re-probed; `git_info_update` with branch sent |
| E21 | BS-facts / GC-refresh | EP | L1 | automated | session registers in a linked worktree | first evaluation | first `git_info_update` after `session_register` carries `gitWorktree` and omits `gitStatus`; one fast-lane probe requested |
| E22 | BS-detect | EP | L1 | automated | cwd = `<worktree root>/packages/client` | first evaluation | `gitWorktree.name === basename(worktree root)` |
| E23 | GC-remote | EP | L1 | automated | facts cached | 9 ticks | `git remote get-url origin` spawned 0 times after the first evaluation |
| E24 | GC-refresh | EP (tool allow-list) | L1 | automated | `tool_execution_end` for `read`, `Read`, `glob`, `ls` | event | no probe requested; `edit` and unknown `mcp__x__y` each request a slow-lane probe |
| E25 | GC-refresh | BVA (slow lane 10 s) | L1 | automated | slow-lane probe started at t=0 | slow request at t=9 s | probe starts at t=10 s (deferred, not dropped) |
| E26 | GC-refresh | BVA (burst) | L1 | automated | mutating tool ends every 500 ms for 60 s | fake clock 60 s | ≤ 6 slow-lane probes started |
| E27 | GC-refresh | decision-table (lanes) | L1 | automated | slow request pending; fast request (HEAD watch) arrives | debounce elapses | one probe starts, accounted to the fast lane, ≥ 2 s after previous fast probe |
| E28 | GC-refresh | state-transition | L1 | automated | probe in flight; 3 requests arrive | probe settles | exactly one follow-up probe |
| E29 | GC-refresh | state-transition | L1 | automated | HEAD file `main` at probe start, `topic` at settle | probe settles | result not sent; one more probe requested |
| E30 | GC-refresh | state-transition | L1 | automated | cwd changes while probe for old cwd is in flight | old probe settles | no `git_info_update` for the old cwd |
| E31 | GC-refresh | EP | L1 | automated | watcher attached; branch changes via HEAD watch event | fake clock | `git_info_update` with new branch + status sent ≤ 4000 ms after the event (G1) |
| E32 | GC-refresh / NG-pr | BVA (30 s) | L1 | automated | HEAD resolves to 5 different branches within 60 s (same session/cwd) | fake clock 60 s | ≤ 2 branch-change PR detections start; the last for the final branch |
| E33 | GC-refresh | fault-free EP | L1 | automated | every `git status` probe rejects; branch has a PR | first poll + `git_info_refresh` | PR detection starts on first poll and on refresh; branch/worktree updates sent with `gitStatus` omitted |
| E34 | GC-refresh | state-transition | L1 | automated | previous session reported clean; resume into same clean repo (`handleSessionChange`) | probe settles | resulting `git_info_update` carries `gitStatus` (diff cache reset) |
| E35 | GC-refresh | EP | L1 | automated | reconnect cache reset | reconnect | fast-lane probe requested; re-sent update carries `gitStatus` |
| E36 | GC-refresh | EP | L1 | automated | `GIT_STATUS_V2` recipe | build argv | `["git","--no-optional-locks","status","--porcelain=v2","--branch"]` |
| E37 | GC-refresh | EP | L1 | automated | ticks after first evaluation with sync runner spy | 20 ticks | sync runner (`run`/`spawnSync`) never called for git |
| E38 | BS-ver | BVA (tick 1/10/11) | L1 | automated | version reader spy | ticks 1..21 | reader called on ticks 1, 11, 21 only; a throw on tick 11 → called again on tick 12 |
| E39 | BS-model | state-transition | L1 | automated | `model_select` forwarded; `cachedCtx.model` updates in the same turn | fake clock | no `model_update` before 50 ms; one at the 50 ms tick (G2) |
| E40 | BS-model | EP | L1 | automated | `model_select` with unchanged model + thinking level | 50 ms | no `model_update` |
| E41 | BS-cost | EP | L1 | automated | one scan + one tool-triggered probe between heartbeats | heartbeat | `pollProcScanRuns +1`, `pollProcScanSpawns +1`, `pollGitProbesTool +1` |
| E42 | BS-cost | EP | L1 | automated | two live sessions report `pollGitSpawns` 3 and 4 | `GET /api/health` | `pollGitSpawns === 7` |
| E43 | PR-rest | EP | L1 | automated | `GET /api/pi-resources` without `cwd` | request | `{ success: true }`, cached under `process.cwd()` |
| E44 | PR-cache | EP | L1 | automated | `startPolling`; known dirs; no requests | fake clock 30 min | `scanPiResources` called 0 times |
| E45 | PR-cache | BVA (5 min) | L1 | automated | entry scanned at t=0 | requests at 4:59 and 5:00 | 4:59 → served, no scan; 5:00 → served stale immediately + one background scan |
| E46 | PR-cache | EP | L1 | automated | two concurrent requests, cold cwd, scan stub deferred | resolve stub | `scanPiResources` called once; both responses carry its data |
| E47 | PR-cache | state-transition | L1 | automated | entry cached; injected watch emits `skills/new.md` under `<cwd>/.pi/skills`; separately `settings.json` under `~/.pi/agent` | next request | stale served + background rescan; global event marks every entry stale |
| E48 | PR-cache | state-transition | L1 | automated | `.pi/skills` absent at scan; `.pi` watch emits `skills` | reconciliation | entry stale; `skills` subdir watch attached |
| E49 | PR-cache | BVA (16/64 caps) | L1 | automated | 17 cwds scanned in order; then 65 | access | 1st cwd releases watches (keeps data); at 65 the least recent data dropped |
| E50 | PR-cache | state-transition | L1 | automated | `openspec.enabled=false`; entry idle 11 min | poll timer fires | entry's watches closed; data kept as stale |
| E51 | PR-cache | EP | L1 | automated | `refresh=true` on a fresh entry | request | scan awaited; result stored |
| E52 | GC-refresh | EP (real git) | L1 | automated | temp repo, async probe real `git` | `git checkout -b x` then probe | `.git/index` mtime unchanged by the probe (no optional locks) |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | PT-poll + GC-refresh (design goal) | threshold (simulation) | L1 | automated | fake-clock idle session: agent idle, watcher attached, 3 long-lived children | process + git spawns/min ≤ 1/5 of a baseline simulation of today's code (3+k ps per 5 s; ~6 git per 30 s) | 10 simulated min |
| P2 | GC-refresh (design D6 gate) | threshold (simulation) | L1 | automated | fake-clock active session: mutating tool end every 2 s, no branch change | `git status` probes ≤ 6/min; sync git spawns = 0 | 5 simulated min |
| P3 | PT-poll + GC-refresh (G3) | soak + threshold | L2 | automated | `qa/tests/NN-poll-cost.sh`: start server, one idle pi session + one session looping file edits via faux model, read per-session `poll*` counters | idle: (`pollProcScanSpawns`+`pollGitSpawns`)/min ≤ 3; active: `pollGitProbesTool`/min ≤ 6 | 5 min |
| P4 | PT-poll + GC-refresh (G3) | real-machine measurement | — | manual-only | macOS dev machine, 3 sessions (idle / bash loop / editing), before vs after builds | idle-session spawns/min drop ≥ 5×, recorded in `notes.md` | 5 min each |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | GC-refresh | convergence | L3 | automated | harness session in a git repo on `main` | `git checkout -b e2e-branch` in the container (not via pi) | session card branch label converges to `e2e-branch` ≤ 6 s (G1) |
| F2 | GC-refresh | convergence | L3 | automated | clean repo session | agent `edit` tool via faux model modifies a tracked file | uncommitted indicator appears ≤ 15 s (10 s slow lane + probe + debounce) |
| F3 | GC-refresh | convergence | L3 | automated | clean repo session, idle agent | file modified via `docker exec` (outside pi) | uncommitted indicator appears ≤ 35 s (tick + probe) |
| F4 | PT-poll | convergence | L3 | automated | idle session | faux-model `bash` runs `sleep 60 &` | process drawer lists the `sleep` row ≤ 10 s (5 s min elapsed + post-bash/fast scan) |
| F5 | PR-cache | convergence | L3 | automated | Folder Settings resources view open | create `<cwd>/.pi/skills/e2e-skill/SKILL.md` | skill appears in the view after ≤ 2 client polls (≤ 60 s) |
| F6 | BS-model | convergence | L3 | automated | session running | model switched through pi's own `model_select` path (faux harness command) | session card model label updates ≤ 1 s (G2) |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | PT-scan | fault-injection (abort) | L1 | automated | injected `ps` exits 1 / throws | scan | returns `[]`; `trackedPgids` unchanged; no throw |
| X2 | PW-win | fault-injection (abort) | L1 | automated | PowerShell non-zero exit; malformed JSON; timeout | Windows scan | returns `[]` in each case; no throw |
| X3 | GC-refresh | fault-injection (abort) | L1 | automated | `fs.watch` throws EMFILE on attach | first evaluation | `pollGitWatchersAttached === 0`; tick still requests a slow-lane probe every 30 s |
| X4 | GC-refresh | fault-injection (delay) | L1 | automated | git status stalls past `GIT_TIMEOUT` | probe | treated as failed: branch/worktree change sent with `gitStatus` omitted; next request proceeds |
| X5 | BS-dispose | fault-injection (late settle) | L1 | automated | probe and scan pending | `session_shutdown`, then both settle | no `git_info_update` / `process_list` sent; no timer re-armed |
| X6 | BS-dispose | state-transition | L1 | automated | bridge init, then `session_start` new → fork → resume, then `initBridge` reload ×3 | count live schedulers/watchers (injected factories) | exactly 1 scan schedule, 1 probe scheduler, ≤ 1 watcher set active |
| X7 | BS-dispose | state-transition | L1 | automated | parent bridge active; subagent re-entry (`isBridgeReentry` true) | re-entry | parent's schedulers and watcher not disposed |
| X8 | PR-cache | fault-injection (abort) | L1 | automated | injected watch throws on attach for every dir | scan + requests at 4 min and 5 min | entry served; at 5 min treated stale (background rescan) |
| X9 | PR-cache | fault-injection (abort) | L1 | automated | background rescan rejects | stale request | stale data still served; next request retries; no unhandled rejection |
| X10 | GC-refresh | state-transition | L1 | automated | `runGitPollTick` rejects | tick | rejection caught and logged once; next tick runs |
| X11 | PT-poll | fault-injection (real process) | L2 | automated | `qa/tests/NN-poll-cost.sh` Windows variant `.ps1`: bridge auto-starts dashboard server | 2 scan cycles | `process_list` (read via `/api/sessions`) never contains the dashboard server PID |

---

## Coverage summary

- Requirements covered: 17/17
- Scenarios by class: edge 52 · perf 4 · frontend 6 · error 11
- Scenarios by level: L1 64 · L2 2 · L3 6 · — 1
- Scenarios by disposition: automated 72 · manual-only 1

## New infra needed

- `qa/tests/NN-poll-cost.sh` + `.ps1` (new L2 scripts; next free number at authoring time) — reads per-session `processMetrics.poll*` via the existing session REST surface; modeled on `qa/tests/20-tunnel-readiness-perf.sh`.
- L3 F6 needs a way to trigger pi's own `model_select` in the harness; if the faux model harness has no such command, the implementer drives it through the existing set-model path and asserts the forwarded event — record the deviation in the task.
