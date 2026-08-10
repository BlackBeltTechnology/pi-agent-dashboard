# Test plan — fix-tmux-session-shutdown-leak

Levels: **L1** pure/unit · **L2** out-of-band host probe against the container ·
**L3** browser/bus E2E against the harness.

Inherited instruments (landed by `fix-e2e-harness-memory-exhaustion`, no need to
rebuild): `scripts/probe-harness-memory.mjs`, `qa/tests/16-e2e-memory-bound.sh`,
the per-test reap fixture, the residual-session budget.

## Termination

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| T1 | Every strategy has a teardown path | decision-table | L1 | automated | each supported `PI_SPAWN_STRATEGY` value | resolve the teardown for a session | every strategy resolves one; an unknown/unhandled strategy fails loudly rather than returning a no-op |
| T2 | tmux session process is terminated | state-transition | L3 | automated | a session spawned under `PI_SPAWN_STRATEGY=tmux` | shut it down | its `pi` process is no longer resident **and** its tmux window no longer exists |
| T3 | headless is unchanged | regression | L1 | automated | a headless-spawned session with keeper PID | shut it down | the existing `killBySessionId` ladder runs exactly as before (no behaviour delta) |
| T4 | Ladder escalates on a process that ignores SIGTERM | fault-injection | L1 | automated | a stub process that ignores SIGTERM | shutdown | SIGKILL follows after the grace window; the process is gone |
| T5 | Double shutdown is safe | idempotence | L1 | automated | a session already terminated | shut down again | treated as success; no error, session stays absent |
| T6 | Advisory message alone is not accepted as termination | mutation | L1 | automated | gateway `shutdown` delivered, process deliberately survives | shutdown completes | the code escalates rather than reporting success — **fails if the escalation is removed** |

## Confirmation + observability

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| C1 | Not removed until confirmed | state-transition | L1 | automated | a session whose process exits normally | shutdown | `session_removed` is broadcast after termination is confirmed, exactly once |
| C2 | Failed termination is loud | fault-injection | L1 | automated | a process that survives the full ladder | shutdown | a diagnostic names the session id + surviving process; the shutdown is not reported as a clean success |
| C3 | Orphan comparison is queryable | decision-table | L1 | automated | resident-process set vs live-session set (disjoint / overlapping / equal) | compare | processes with no live session are reported as orphaned |

## Memory (moved from `fix-e2e-harness-memory-exhaustion`)

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | Memory does not climb | soak + threshold | L2 | automated | one early ~30-spec chunk, then a later one, same container | `memory.current` after the late chunk ≤ early sample + 10 % | chunk pair |
| P3 | Resident count tracks session count | soak | L2 | automated | full acceptance run sampled at chunk boundaries | resident `pi` minus reported live sessions stays constant — the measured pre-fix value was 21 vs 0 | full run |
| P4 | Full-run survival | soak | L2 | automated | all specs, one container, `globalTimeout` overridden | reaches the final spec; container still `healthy`; no unexplained `daemon restarted` | full run |

## Notes

- **T6 and C2 are the fails-on-revert teeth.** T1–T5 can all pass against an
  implementation that reports success it did not verify; T6 and C2 are what make
  reverting the fix turn the suite red.
- **P1/P3/P4 need the acceptance run**, which needs `globalTimeout` overridden on
  the CLI (see #450) and exclusive use of the Docker VM (see #451 — one worktree
  harness at a time on an 8 GB VM).
