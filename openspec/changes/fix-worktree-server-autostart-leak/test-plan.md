# Test Plan — fix-worktree-server-autostart-leak

Stage: apply   Generated: 2026-08-13

## ⚠ Clarifications needed (4)

- [ ] **C1** — Spawn readiness budget has no value. Blocks E7/E8 (the staleness boundary) and X4 (the loser's wait). The health-check timeout is 10s; the budget must be larger. Candidates: 30s, 60s, or derive as `healthTimeoutMs × 3`. Without a number the just-below/just-above boundary pair cannot be written.
- [ ] **C2** — The normal-path port-conflict exit code is unspecified. Blocks E10 (parent classification). Recovery already uses `2`; design says "a distinct code", tasks said `3`. Pin a value, or drop the exit-code path in favour of the existing probe-based `PortConflictError`.
- [ ] **C3** — The worktree predicate is self-contradictory on symlinks (accepted trade-off, design.md). Blocks E14: cannot state an expected observable for a symlinked worktree, because `realpath` strips the segment the check requires. Decide: match pre-realpath (catches symlinks, risks siblings), post-realpath (current spec, misses symlinks), or both paths.
- [ ] **X-gap** — The port-less zombie (5 of 7 observed leaks) has no reproduction and no requirement. No scenario can assert it. Recorded so coverage is not mistaken for completeness.

> Resolve before the blocked scenarios (marked below) can be authored.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | server-launch: failed startup leaves no port held | state-transition | L2 | automated | dashboard A live on gateway port G; server B configured for same G | B starts, gateway binds, a later startup step throws | B exits non-zero; `lsof -iTCP:G -sTCP:LISTEN` names only A's pid; no process with B's pid remains |
| E2 | server-launch: teardown preserves original error | fault-injection (abort) | L1 | automated | `start()` with a stubbed post-gateway step that throws `Error("plugin load failed")` | teardown runs, then rejection propagates | rejected error message is `plugin load failed`, not a teardown error; gateway `close()` called exactly once |
| E3 | server-launch: successful startup untouched | decision-table | L1 | automated | all startup steps resolve | `start()` completes | teardown path never invoked; both listeners remain open |
| E4 | auto-start single-flight | state-transition | L1 | automated | two `autoStartServer` calls, injected deps, no reachable dashboard | both reach the spawn step within the same tick | `launchServer` invoked exactly once across both calls |
| E5 | lock staleness: holder dead, child alive | decision-table | L1 | automated | lockfile `{sessionPid: dead, childPid: alive, startedAt: now}` | a third session evaluates staleness | lock evaluated NOT stale; `launchServer` not invoked |
| E6 | lock staleness: pid reuse | decision-table | L1 | automated | lockfile `{sessionPid: P, startedAt: T}`; process P exists with start time `T + 60s` | staleness evaluated | lock evaluated stale (reuse detected); acquisition permitted |
| E7 | lock staleness: age just below budget | BVA | L1 | automated | lock age = budget − 1s, holder alive | staleness evaluated | NOT stale; second spawn refused — [NEEDS CLARIFICATION: budget value — see C1] |
| E8 | lock staleness: age just above budget | BVA | L1 | automated | lock age = budget + 1s | staleness evaluated | stale; acquisition permitted — [NEEDS CLARIFICATION: budget value — see C1] |
| E9 | lock released after failed spawn | state-transition | L1 | automated | holder whose `launchServer` rejects with readiness timeout | rejection settles | lockfile absent; next `autoStartServer` acquires without waiting for staleness |
| E10 | port conflict distinguishable | decision-table | L1 | automated | child exits with the normal-path conflict code | parent classifies the exit | classified as port conflict, not generic early exit — [NEEDS CLARIFICATION: code value — see C2] |
| E11 | recovery-path conflict also classified | decision-table | L1 | automated | child exits `2` (recovery EADDRINUSE) | parent classifies | classified as port conflict |
| E12 | generic early exit stays generic | decision-table | L1 | automated | child exits `1` for an unrelated reason | parent classifies | NOT classified as port conflict |
| E13 | worktree refusal: both ports default | decision-table | L1 | automated | resolved cliPath `/repo/.worktrees/os-x/packages/server/src/cli.ts`, port 8000, piPort 9999, no dashboard reachable | `autoStartServer` runs | returns `{}` without throwing; `launchServer` never invoked |
| E14 | worktree refusal: symlinked worktree | decision-table | L1 | automated | cliPath reaching a worktree only via a symlink | predicate evaluated | [NEEDS CLARIFICATION: observable — realpath strips the segment; see C3] |
| E15 | worktree refusal: gateway-port-only evasion | decision-table | L1 | automated | cliPath in `.worktrees/`, port 8001 (non-default), piPort 9999 (default) | `autoStartServer` runs | refused; `launchServer` never invoked |
| E16 | fully isolated worktree still spawns | decision-table | L1 | automated | cliPath in `.worktrees/`, port 18042, piPort 19042 | `autoStartServer` runs | `launchServer` invoked once with those ports |
| E17 | host install serving worktree cwd | decision-table | L1 | automated | cwd `/repo/.worktrees/os-x`, resolved cliPath `~/.pi-dashboard/node_modules/.../cli.ts`, ports default | `autoStartServer` runs | `launchServer` invoked (refusal keys on cliPath, not cwd) |
| E18 | sibling directory does not match | BVA (string boundary) | L1 | automated | cliPath under `/repo/.worktrees-backup/os-x/...`, ports default | predicate evaluated | NOT refused; `launchServer` invoked |
| E19 | refusal precedes lock acquisition | state-transition | L1 | automated | a session that will refuse, plus a concurrent host session | both run | refusing session creates no lockfile; host session acquires without contention |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | single-flight under real concurrency | threshold | L2 | automated | 5 concurrent pi sessions started within 25s in worktree-free cwds, no dashboard running | exactly 1 server process listening on 8000 and 1 on 9999 at steady state | 2 min after last start |
| P2 | lock acquisition is not a startup tax | tail-latency | L1 | automated | 100 sequential `autoStartServer` calls with a dashboard already reachable | p95 added latency from the lock path < 5ms (uncontended path must short-circuit before locking) | full run |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | spinner not leaked on refusal | state-transition | L1 | automated | injected deps recording `onLaunchStart`/`onLaunchEnd` | worktree refusal path returns | `onLaunchStart` never called; if called, `onLaunchEnd(false)` also called — never a start without an end |
| F2 | spinner not leaked on lock loss | state-transition | L1 | automated | same deps, session loses the lock | lock-loss path returns | same invariant holds |
| M1 | worktree refusal does not break isolated verification | exploratory | — | manual-only | a real `isolated-ui-verification` run in a worktree | operator brings up the isolated dashboard on allocated ports | [judgment: the flow still works end to end for a human operator — no automatable signal beyond E16, which covers the predicate but not the whole flow] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | refusal is durably logged | fault-injection (abort) | L1 | automated | log file does not yet exist (refusal skips the launch primitive that creates it) | worktree refusal fires | log file created and contains one entry naming resolved cliPath, port, and piPort |
| X2 | headless session still logs | fault-injection (abort) | L1 | automated | deps with `notify` throwing (no UI available) | refusal fires | log entry still written; `autoStartServer` still returns `{}` without throwing |
| X3 | lock loss is durably logged | fault-injection (abort) | L1 | automated | lock held by another session | acquisition fails | log entry written naming the recorded holder |
| X4 | loser attaches after holder succeeds | fault-injection (delay) | L1 | automated | holder's spawn takes `budget/2`; loser blocked | loser re-checks health after the budget | loser returns the holder's server, never invokes `launchServer` — [NEEDS CLARIFICATION: budget value — see C1] |
| X5 | loser reports unavailable when holder fails | fault-injection (abort) | L1 | automated | holder's spawn fails; no dashboard comes up | loser re-checks health | loser returns `{}`; no spawn; no throw |
| X6 | lockfile in an unwritable directory | fault-injection (abort) | L1 | automated | `~/.pi/dashboard/` not writable | acquisition attempted | auto-start degrades to current behaviour (spawn proceeds) rather than throwing; degradation logged |
| X7 | stale lockfile with corrupt JSON | fault-injection (abort) | L1 | automated | lockfile containing `{not valid json` | staleness evaluated | treated as stale and broken; no throw |

---

## Coverage summary

- Requirements covered: 6/6 (but see X-gap — the port-less zombie has no requirement to cover)
- Scenarios by class: edge 19 · perf 2 · frontend 3 · error 7
- Scenarios by level: L1 27 · L2 2 · L3 0 · electron 0 · ci 0 · manual-only 1
- Scenarios by disposition: automated 30 · manual-only 1
- Blocked on clarification: 5 rows (E7, E8, E10, E14, X4)

## New infra needed

- None for L1 — `server-auto-start.ts` already takes injected `AutoStartDeps`, so lock/refusal/log/spinner scenarios are unit-testable without a real spawn.
- P1 and E1 need a real multi-process bind test in `qa/tests/`. No existing qa test spawns competing dashboards; extend the nearest process-lifecycle smoke rather than authoring a new harness.
- No L3 rows: nothing in this change asserts rendered UI. The spinner is TUI-side and is asserted through injected callbacks at L1, not through a browser.
