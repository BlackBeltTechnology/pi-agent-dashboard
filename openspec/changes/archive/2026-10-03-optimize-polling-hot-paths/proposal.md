## Why

Every pi session's bridge runs two timers that shell out **synchronously on pi's own event loop**, and the server rescans pi resources for every known folder in the background although almost nobody reads the result. Measured on a 681-process macOS host in this repo: a full `ps -eo …` costs ~20 ms, `git status --porcelain=v2` ~170 ms, a `git rev-parse` ~10 ms.

- **Process scan** (`packages/extension/src/process-scanner.ts`, every 5 s Unix / 10 s Windows, per session): `getChildPids` reads the WHOLE process table with `ps -eo pid=,ppid=` once for pi and once more **per direct child**, then `ps -p … -o pgid=`, then another full `ps -eo pid=,pgid=,etime=,args=` — (3 + k) blocking spawns per tick, where k is the number of pi children (MCP servers, LSPs and other long-lived sidecars keep k > 0 even when idle). On Windows, `scanWindowsProcesses` launches PowerShell `Get-CimInstance` synchronously 1 + k times per tick — hundreds of ms of PowerShell start-up blocking pi every 10 s.
- **Git tick** (`git-poll.ts` → `model-tracker.ts` `sendGitInfoIfChanged` → `vcs-info.ts`, every 30 s, per session): branch, remote URL, three `rev-parse` for checkout roots, and `git status` — ~6 synchronous spawns, ~220 ms of blocking per tick on this repo, landing in the middle of agent streaming. Remote URL and checkout roots never change for a cwd, yet are re-probed every tick. `git status` has no `--no-optional-locks`, so the probe can itself rewrite `.git/index`. Meanwhile a commit or checkout takes up to 30 s to show.
- **pi version** is re-resolved from disk every 30 s although it cannot change without a bridge reload.
- **pi-resources** (`directory-service.ts` `schedulePiResourcesTick`, every 300 s): rescans `.pi/`, `~/.pi/agent/`, every package directory (synchronous `readdirSync`/`readFileSync` on the server loop) and runs pi's `PackageManager.resolve()` (≤ 5 s) for **every known cwd**, while the cache is read only when a Settings/Folder-Settings resources view is open — which already polls the endpoint every 30 s itself.

The server's OpenSpec and folder-HEAD polls were already converted to async + `fs.watch` hybrids (`openspec-change-watcher.ts`, `folder-head-watcher.ts`); this change brings the remaining hot paths to the same standard.

## What Changes

- **Process scan — one snapshot per scan (Unix).** Replace the (3 + k) `ps` calls with ONE `ps -A -o pid=,ppid=,pgid=,etime=,args=` snapshot (split-limit parse, empty args allowed); build the parent→child map in memory and run capture + check against it. Observable results unchanged (leaf-only, one level of grandchildren, `excludedPgids` refusal + reaping, `minElapsedMs`). `captureChildPgids`/`scanTrackedProcesses` are replaced by a pure `scanFromSnapshot`; their tests migrate to snapshot fixtures.
- **Process scan — one snapshot per scan (Windows).** Replace the 1 + k PowerShell launches with ONE `Get-CimInstance Win32_Process` query, tree built in memory; the Windows path now also honours `excludedPgids`.
- **Process scan — async + adaptive cadence.** Async `execFile` with an in-flight guard. **Fast** (5 s Unix / 10 s Windows, as today) while the agent is running, a tool is executing, within 15 s after either ends, or within 30 s after the list changed; otherwise **idle** (30 s / 60 s). A `bash` `tool_execution_end` triggers one extra scan 1 s later.
- **Git — static facts cached per cwd.** Remote URL and checkout roots are probed synchronously ONCE per cwd (keeps the registration handshake carrying `gitWorktree`) and re-probed asynchronously on `git_info_refresh`, reconnect, a change in a cheap per-tick `stat` of `<topLevel>/.git` + `gitDir`, or every 10th tick.
- **Git — branch from the HEAD file.** `<gitDir>/HEAD` `ref: refs/heads/<name>` → `<name>`; detached/unexpected content falls back to an **async** CLI detection.
- **Git — async, event-triggered `git status`.** New `gitStatusV2Async` with `--no-optional-locks`, one in flight per session, sent from the settled probe result (branch + facts + status in one coherent update; stale-cwd results discarded) — except the synchronous first evaluation, which sends branch + worktree immediately with status following. Triggers in two rate-limited lanes, 750 ms trailing debounce: **fast lane** (≥ 2 s apart) for `HEAD`/refs changes seen by a non-recursive `fs.watch` on `gitDir`/`commonDir`, `git_info_refresh`, reconnect; **slow lane** (≥ 10 s apart; rate-limited requests are deferred, never dropped) for every 30 s tick, `tool_execution_end` of any tool outside `read|grep|find|ls|glob` (case-insensitive), and `index` changes. A first evaluation (registration, session change, cwd change) requests a fast-lane probe. A probe whose branch changed while it ran is discarded and re-run. `prStatus.observe` is fed on every branch resolution (tick, first evaluation, settled probe incl. failed), never from raw watcher events, so rapid HEAD flips cannot churn PR detection and a failing `git status` cannot stall it; the PR scheduler's `onChange` re-sends from cached state without spawning git. The 30 s tick stays for cheap checks (cwd-missing, name, model, version, facts stamp).
- **pi version re-read every 10th tick** instead of every tick.
- **`model_select` runs the model-update check** (deferred 50 ms, like the dashboard path) in the existing forwarder branch — pi-TUI model switches; dashboard switches and `thinking_level_select` already push.
- **pi-resources — on demand, stale-while-revalidate.** Remove the background `piResourcesTimer` (`openspec.pollIntervalSeconds` no longer governs it). A cold miss scans and waits; a stale entry (watch event or ≥ 5 min old) is served immediately and rescanned in the background; `?refresh=true` scans and waits. Per-cwd in-flight dedupe. Non-recursive watches on `<cwd>/.pi/`, `~/.pi/agent/` and their resource subdirs mark entries stale; reconciliation (re-attach; idle > 10 min releases watchers but keeps data as stale; LRU caps 16 watched / 64 cached cwds) runs on cache access and on the existing OpenSpec poll tick — no new timer.
- **Bridge teardown.** A `disposables` list drained in `initBridge`'s re-init block (not on subagent re-entry), `state.cleanup` and `session_shutdown`; the new schedulers and watcher register there (today a plain `session_shutdown` leaves the process-scan interval running).
- **Poll-cost counters.** Flat optional `poll*` scalars in the heartbeat `ProcessMetrics`, summed on `/api/health`; landed first on today's code paths to capture a baseline.
- **Spec drift closed while touching these areas:** `session-process-tracking` (Windows "returns `[]`", `pgrep`), `session-process-tracker` (`wmic`/`tasklist`), `pi-resource-scanning` ("every 30 seconds"; `cwd` "required" → 400), `git-context` branch/remote detection (always-CLI wording); `bridge-session-state-poll` worktree `name` (cwd basename → worktree root basename, as shipped). Deltas restate them as shipped by this change.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `session-process-tracking`: one process-table snapshot per scan; Windows delegates instead of returning `[]`; async bridge poll with in-flight guard, fast/idle adaptive cadence, post-`bash` scan, disposal on teardown.
- `session-process-tracker`: Windows scanning via one `Get-CimInstance Win32_Process` snapshot per scan, async, honouring `excludedPgids`.
- `git-context`: "Git branch detection" and "Git remote URL detection" restated (HEAD file / cached probe, CLI as fallback); "Periodic git info refresh" — status probed asynchronously in two rate-limited lanes (tick every 30 s + tool/watch triggers), branch latency ~1–3 s with a watch, PR observation on every branch resolution.
- `bridge-session-state-poll`: "Git state detection" restated (worktree `name` = worktree root basename; cached roots); ADDED requirements for per-cwd static git facts, HEAD-file branch read, version re-read cadence, `model_select` check, poll-cost counters, and scheduler/watcher disposal.
- `pi-resource-scanning`: "Polling integration" replaced by an on-demand, watch-invalidated, stale-while-revalidate cache; "REST endpoint" restated with optional `cwd`.

## Non-goals

- **No change to the server OpenSpec poll or the folder-HEAD poll.** Both are already async (`execFile`, worker thread, semaphore), mtime-gated (an unchanged cwd costs only `stat`s, no spawn), and backed by `fs.watch`. The remaining gain is too small to justify the risk.
- **No cross-session `git status` dedupe** (N sessions in one repo still probe independently). Moving git state ownership to the server is a protocol change; a follow-up if the counters show it matters.
- **No recursive working-tree watch.** Linux inotify cost per directory (`node_modules`), macOS FSEvents coalescing, and unreliable events on Docker bind mounts / WSL `/mnt/*` make it the wrong tool; tool events + git-dir watch + safety poll cover the cases.
- **No async conversion of the pi-resource directory walk.** It still runs synchronously on the server loop, but only for cwds someone is viewing and mostly in the background after a stale response is served, instead of for every known cwd every 5 min.
- **No reuse of the server's folder-HEAD watcher for bridges** (would need a new server→bridge message); see design D6 rejected alternative.
- No change to heartbeat, keepalive, flush, reaper or sweeper timers — they are deliberate timers, not change detection.
- No change to PR detection cadence or back-off (`pr-status.ts`) beyond one guard: branch-change-driven detections start at most once per 30 s, so faster branch resolution cannot multiply `gh` calls.
- No wire-protocol change beyond optional heartbeat metric fields; no persistence change; no migration.

## Impact

- **extension** (`packages/extension/src`): `session-sync.ts` (`handleSessionChange` git send → first-evaluation path + fast probe, resets `lastGitStatusJson`), `pr-status.ts` (branch-change generation probes ≤ 1 per 30 s), `process-scanner.ts` (snapshot parser, async variant, Windows snapshot), `bridge.ts` (process-scan scheduler, git trigger wiring, `model_select` check in the forwarder branch, `disposables` teardown), `git-poll.ts` (tick body split: cheap checks vs. status probe), `model-tracker.ts` (`sendGitInfoIfChanged` uses cached static facts + HEAD read + async status; pi-version memo), `vcs-info.ts` (HEAD-file branch reader, static-facts cache), new small module for the git trigger scheduler (debounce/rate-limit/in-flight) and git-dir watcher.
- **shared** (`packages/shared/src/platform/git.ts`): `GIT_STATUS_V2` argv gains `--no-optional-locks` (also affects server `git-worktree/git-operations.ts` and the argv test in `shared/src/__tests__/platform-git.test.ts`); new async twins `gitStatusV2Async`, `remoteUrlOrAsync`, `currentBranchOrAsync`; `GitCheckoutRoots` gains optional `gitDir`. `packages/shared/src/protocol.ts`: flat optional `poll*` fields on `ProcessMetrics`.
- **server routes** (`packages/server/src/routes/system-routes.ts`): `/api/health` sums the `poll*` fields across live sessions.
- **server** (`packages/server/src`): `directory-service.ts` (drop `piResourcesTimer`, stale-while-revalidate cache, in-flight dedupe, reconcile at the top of the poll timer; `getPiResources` returns `{ data, stale }`), `routes/openspec-routes.ts` (background refresh on stale), new `pi/pi-resources-watcher.ts` (modelled on `openspec-change-watcher.ts`).
- **tests**: `packages/extension/src/__tests__/process-scanner*.test.ts` (snapshot fixtures, Windows JSON fixture, async), `git-poll.test.ts`, model-tracker/vcs-info tests (HEAD parse, static cache, trigger coalescing, stale-result discard), `directory-service` pi-resources tests, new watcher tests.
- **docs**: `packages/extension/src/AGENTS.md` rows (+ sidecars for `process-scanner.ts`, `git-poll.ts`), `packages/server/src/AGENTS.md` / `pi/AGENTS.md` rows, `docs/architecture.md` polling section via DocScribe.
- **Compatibility:** bridge↔server protocol unchanged; new heartbeat metric fields are optional and additive. Old bridges keep working against a new server and vice versa.
- **Rollback:** revert the commit, `npm run reload` (extension) + `POST /api/restart` (server). Nothing is persisted, so there is no data to migrate back. Every watcher fails safe to the polling path (attach failure → `false` → tick/TTL covers it).

## Discipline Skills

- `performance-optimization`: the whole change is a measured latency/throughput fix — baseline the poll-cost counters before optimising, compare after (tasks 1 and 8).
- `observability-instrumentation`: new heartbeat poll-cost counters surfaced on `/api/health`.
- `node-inspect-debugger`: opaque runtime state (async probes interleaving with `fs.watch` events in a live pi process) if the trigger scheduler misbehaves.
- `review-code`: non-trivial change across extension, shared and server, reviewed before commit.
- No `security-hardening` trigger: no auth, secrets, PII, endpoint or untrusted input — watched paths derive from the session cwd and `~/.pi/agent`, which the code already reads.
- No `doubt-driven-review` trigger: no irreversible step (no migration, no public API change; rollback is a revert).
