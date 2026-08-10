# Tasks — fix-tmux-session-shutdown-leak

Test ids reference `test-plan.md`. Instruments from
`fix-e2e-harness-memory-exhaustion` are already on `develop` and are reused, not
rebuilt.

## 1. Read the spawn paths before changing anything

- [x] 1.1 Read the tmux spawn path and record **how a session's window/pane is
      named today**. **Finding:** `buildTmuxCommand`
      (`packages/server/src/spawn-process/process-manager.ts:242-252`) passes NO
      `-n` flag, so windows take tmux's default index and nothing links a window
      to a session. Decisive: the **session id does not exist at spawn time**
      (pi mints it; the bridge registers it later), so neither registry-by-id nor
      derive-from-id is possible. The existing `PI_DASHBOARD_SPAWN_TOKEN`
      correlation channel — already passed into the tmux pane and echoed back in
      `session_register.spawnToken` — is the join key. See design.md D5.
- [x] 1.2 Read `headlessPidRegistry` + `killBySessionId` and record the exact
      escalation ladder. **Finding:** the ladder is `killProcess(pid, { timeoutMs:
      2000 })` = SIGTERM → 2 s → SIGKILL (`headless-pid-registry.ts:269-330`,
      keeper-aware). It is already shared and needs no reimplementation. Also:
      `findBySpawnToken` exists, and the idle-reaper reclaims through
      `killBySessionId` too — so tmux sessions are never idle-reclaimed either.
- [x] 1.3 Enumerate the session-ending call sites. **Finding — this reframes the
      whole change:** `handleForceKill` (:766) ALREADY kills any strategy via
      `killProcess(session.pid, ...)`; `handleShutdown` (:625) never references
      `session.pid`. Its `killHeadlessBySessionId` resolves PIDs by
      `findPidByMarker(sessionId)`, which returns `[]` for tmux because the pane
      command carries no session id. The bug is one handler forgetting the PID it
      already has — not tmux being unreachable. See design D6.

## 2. ~~Give tmux sessions a recoverable handle~~ — DROPPED (design D6)

D6 removed this whole section's premise. The server does not need a tmux handle:
it already stores `session.pid`, and killing pi collapses its pane as a
consequence (the pane runs `cd <cwd> && pi`; `remain-on-exit` is off). No `-n`
flag, no window registry, no tmux CLI, no new correlation mechanism.

- [→] 2.1 **MOVED to 3.6** — "every strategy resolves a teardown path" is still
      worth pinning (test-plan #T1), but it now asserts PID-based termination
      rather than a per-strategy handle lookup.
- [→] 2.2 **DROPPED.** No handle to record.
- [→] 2.3 **DROPPED.** No handle to survive a restart. The equivalent risk — a
      session whose PID the server does not know — is covered by 3.7.

## 3. Terminate, using the shared ladder

- [x] 3.1 L1: headless behaviour is unchanged by the refactor (test-plan #T3).
      Write this BEFORE touching the shared ladder — it is the regression net.
- [x] 3.2 Make `handleShutdown` escalate to `session.pid` with the same
      `killProcess(pid, { timeoutMs: 2000 })` ladder `handleForceKill` uses, AFTER
      a bounded grace window for the graceful `sendToSession({type:"shutdown"})`
      to work. Shutdown stays polite; the ladder is the backstop, not the opening
      move (design D6).
- [x] 3.3 L1: the ladder escalates to SIGKILL against a process that ignores
      SIGTERM (test-plan #T4). `shutdown-terminates-any-strategy.test.ts` spawns a
      REAL node process with a no-op `SIGTERM` handler; only the SIGKILL rung can
      end it, so the test is vacuous unless the escalation exists.
- [x] 3.4 L1: double shutdown / shutdown-after-natural-exit is success, not error
      (test-plan #T5).
- [x] 3.5 L1 **fails-on-revert** — VERIFIED by construction: all three scenarios
      in `shutdown-terminates-any-strategy.test.ts` were RED before the escalation
      existed ("the session's process survived shutdown") and GREEN after. Remove
      the `killProcess` call and they go red again.
- [x] 3.5b L1 **fails-on-revert** (original wording): an advisory gateway message alone is not
      accepted as termination — deleting the escalation MUST turn this red
      (test-plan #T6). Verify by actually reverting the escalation once and
      observing the failure.
- [x] 3.6 L1 (was 2.1): a session is terminable regardless of spawn strategy,
      because termination keys on the stored PID rather than on any
      strategy-specific lookup (test-plan #T1). Assert `handleShutdown` reaches
      `killProcess` for a session that is NOT in `headlessPidRegistry` — that is
      exactly the tmux case.
- [x] 3.7 L1: a session with NO stored PID (bridge never registered) degrades to
      today's behaviour and is REPORTED, never claimed as terminated. Mirror
      `handleForceKill`'s existing no-PID branch rather than inventing a second
      policy.
- [x] 3.8 Decide whether the idle-reaper (`embed-lifecycle/idle-reaper.ts`)
      should route through the same escalation. **Decision: OUT OF SCOPE, filed
      as #459.** Confirmed real: the reaper's `killBySessionId` dep is wired to
      `headlessPidRegistry.killBySessionId` (`server.ts:1386`), and the caps
      reclaim path to the same (`server.ts:1355`) — so gears 1/3 and caps eviction
      all miss tmux sessions. It is the same root cause with a WIDER blast radius
      (reaping is unattended), and it needs its own gear-level + caps tests. Folding
      it in would mix two independently testable behaviours in one change.

## 4. Stop reporting unverified success

- [x] 4.1 L1: `session_removed` is broadcast only after termination is confirmed,
      exactly once (test-plan #C1). The test samples `isAlive(pid)` at the instant
      the broadcast lands — asserting the ordering, not merely the count.
- [x] 4.2 L1 **fails-on-revert**: a process surviving the full ladder produces a
      diagnostic naming the session id and the surviving process, and the
      shutdown is NOT reported clean (test-plan #C2).
- [x] 4.3 Confirm the wait is bounded by the existing ladder grace and that a
      stuck session cannot stall a suite (design.md D3 risk). **Confirmed:** the
      only waits are `SHUTDOWN_GRACE_MS` (1.5 s) and `killProcess`'s existing
      `timeoutMs: 2000` — no second independent timeout was added, so the worst
      case is ~3.5 s and the failure path is non-blocking (diagnose, unregister,
      broadcast). Pinned mechanically: the #T4 test asserts the whole
      SIGTERM-ignoring shutdown completes inside that bound.
- [x] 4.4 L1: orphan comparison — resident processes with no live session are
      reportable (test-plan #C3). `compareResidentToSessions` in
      `scripts/probe-harness-memory.mjs` makes the divergence a first-class query
      (design D4); `sample()` now also returns `residentPiPids` so the comparison
      has real input. Unit-tested over the disjoint / equal / overlapping cases in
      `scripts/__tests__/probe-orphan-comparison.test.mjs`.

## 5. Prove it against the harness

- [ ] 5.1 L3: a tmux-spawned session's process and window are both gone after
      shutdown (test-plan #T2). This is the scenario the whole change exists for.
- [ ] 5.2 Re-run the instant-in-time evidence capture that diagnosed the bug
      (`measurements/tmux-leak-evidence.txt` shape): panes, resident `pi`, and
      server records SHALL agree instead of reading 21 / 21 / 0.

## 6. The memory guarantee this unblocks

- [ ] 6.1 L2: memory does not climb across an early vs late chunk
      (test-plan #P1), via `qa/tests/16-e2e-memory-bound.sh`.
- [ ] 6.2 L2: resident count tracks session count with no persistent divergence
      (test-plan #P3).
- [ ] 6.3 L2 acceptance: the full suite in one container with `globalTimeout`
      overridden reaches the final spec, container still healthy
      (test-plan #P4). Needs exclusive use of the Docker VM — see #451.
- [ ] 6.4 Record the acceptance run's spec-level results verbatim. This is the
      input #433 part 1 (red-spec triage) has been waiting for since before
      `fix-e2e-harness-memory-exhaustion`.

## 7. Close the loop

- [ ] 7.1 Comment on #452 with the fix and the re-measured evidence.
- [ ] 7.2 Comment on #433 stating the harness is now survivable and parts 1 and 2
      are unblocked.
- [ ] 7.3 Update the measurements record in the archived
      `fix-e2e-harness-memory-exhaustion` change (or link forward from it), so the
      retracted Group 2 numbers are not the last word in the repo.
- [ ] 7.4 Consider whether #449 (REST shutdown omits the liveness write) should be
      folded in while this code is open, or stay separate.
