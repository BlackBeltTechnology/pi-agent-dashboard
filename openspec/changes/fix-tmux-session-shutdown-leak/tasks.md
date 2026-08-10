# Tasks — fix-tmux-session-shutdown-leak

Test ids reference `test-plan.md`. Instruments from
`fix-e2e-harness-memory-exhaustion` are already on `develop` and are reused, not
rebuilt.

## 1. Read the spawn paths before changing anything

- [ ] 1.1 Read the tmux spawn path and record **how a session's window/pane is
      named today**, and whether that name is derivable from the session id or
      must be recorded at spawn. This decides design.md's open question (D2/registry
      vs derivation) and everything downstream depends on it.
- [ ] 1.2 Read `headlessPidRegistry` + `killBySessionId` and record the exact
      escalation ladder (signal, grace, escalation) so the tmux path reuses it
      rather than growing a second one.
- [ ] 1.3 Enumerate every supported `PI_SPAWN_STRATEGY` value and every call site
      that ends a session (WS `shutdown`, REST shutdown route, force-kill), so no
      entry point is left on the old behaviour.

## 2. Give tmux sessions a recoverable handle

- [ ] 2.1 L1: every strategy resolves a teardown path; an unhandled strategy
      fails loudly rather than no-opping (test-plan #T1). Exemplar for the
      decision-table shape: `scripts/__tests__/e2e-reap-core.test.mjs`.
- [ ] 2.2 Record the tmux session→window handle at spawn time, per the 1.1
      finding. Symmetry with `headlessPidRegistry` is preferred.
- [ ] 2.3 L1: the handle survives a server restart, or its absence is detected
      and reported — a handle the server forgets reproduces the original bug
      after any restart.

## 3. Terminate, using the shared ladder

- [ ] 3.1 L1: headless behaviour is unchanged by the refactor (test-plan #T3).
      Write this BEFORE touching the shared ladder — it is the regression net.
- [ ] 3.2 Route tmux teardown through the shared SIGTERM → grace → SIGKILL
      ladder: kill the window, then escalate on the pane process.
- [ ] 3.3 L1: the ladder escalates to SIGKILL against a process that ignores
      SIGTERM (test-plan #T4).
- [ ] 3.4 L1: double shutdown / shutdown-after-natural-exit is success, not error
      (test-plan #T5).
- [ ] 3.5 L1 **fails-on-revert**: an advisory gateway message alone is not
      accepted as termination — deleting the escalation MUST turn this red
      (test-plan #T6). Verify by actually reverting the escalation once and
      observing the failure.

## 4. Stop reporting unverified success

- [ ] 4.1 L1: `session_removed` is broadcast only after termination is confirmed,
      exactly once (test-plan #C1).
- [ ] 4.2 L1 **fails-on-revert**: a process surviving the full ladder produces a
      diagnostic naming the session id and the surviving process, and the
      shutdown is NOT reported clean (test-plan #C2).
- [ ] 4.3 Confirm the wait is bounded by the existing ladder grace and that a
      stuck session cannot stall a suite (design.md D3 risk).
- [ ] 4.4 L1: orphan comparison — resident processes with no live session are
      reportable (test-plan #C3).

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
