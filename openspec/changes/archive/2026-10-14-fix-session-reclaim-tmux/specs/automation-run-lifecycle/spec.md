## MODIFIED Requirements

### Requirement: A completed run SHALL terminate its spawned session

Automation runs are spawned as persistent `--mode rpc` pi sessions that do not self-exit when a turn ends. When a run completes normally (its session emits `agent_end`) and the result has been captured, the run's spawned session SHALL be terminated so no idle pi process is left running. Termination on completion SHALL send a graceful clean-exit hint (session shutdown) AND SHALL always escalate to a hard process kill, unconditionally — not gated on whether the hint succeeds, because the hint is undeliverable when the bridge WebSocket is not open. This SHALL reuse the same host-provided, trust-gated termination capability used by user-initiated Stop.

That escalation SHALL terminate the run's `pi` process for ANY spawn strategy, keyed on the
process identity the server holds for the session, not only for runs tracked in the headless
PID registry, wherever that identity can be verified. On a Windows server a non-headless
run's identity cannot be verified; its termination SHALL then be reported as not confirmed
rather than signalling a guessed process, and that `pi` MAY remain resident.

A termination is "reported as not confirmed" when the termination capability returns a
not-terminated result (`false`), logs ONE warning naming the run's session (or its spawn
token when no session is known), the termination outcome and the process id when held, and
increments the embed-lifecycle failed-reclaim count. A termination whose process is
verified gone returns `true` and reports nothing further. Automation runs are spawned without requesting a strategy and therefore take
the host's default, so a registry-only kill leaves the run's `pi` resident on every default
host. The graceful (hint-first) path and the hard path SHALL use the same escalation; the
graceful path SHALL NOT stop at the registry.

When the run was spawned but its session has not yet registered — there is no session
record and therefore no recorded process identity — the escalation SHALL still attempt
reclamation by the server-minted spawn correlation token, using the token-keyed lookup the
spawn-register watchdog uses. On a host where that lookup is unavailable, no termination
SHALL be claimed.

#### Scenario: Completed run's session is ended

- **WHEN** a run's session emits `agent_end` and its result is captured
- **THEN** the run's spawned session SHALL be terminated
- **AND** no idle pi process for that run SHALL remain after finalization, except on a
  Windows server for a non-headless run, where the unverifiable termination SHALL be
  reported instead.

#### Scenario: A non-headless run on a Windows server is reported, not guessed

- **WHEN** a run of a non-headless session completes or is stopped on a Windows server
- **THEN** no signal SHALL be sent to the session's recorded process identity
- **AND** the termination capability SHALL return `false`
- **AND** one warning naming the session and the refused outcome SHALL be logged
- **AND** the failed-reclaim count SHALL increment

#### Scenario: Termination is idempotent with finalization

- **WHEN** terminating a completed run's session causes a further session-end signal
- **THEN** the run SHALL NOT be finalized a second time and no duplicate run record SHALL be produced.

#### Scenario: Stop during the spawn-to-register window reclaims by token

- **WHEN** a run is stopped after its session was spawned but before it registered
- **THEN** the server SHALL attempt to terminate the run's process by its spawn
  correlation token
- **AND** a registry lookup returning no entry SHALL NOT by itself end the attempt
- **AND** when no process can be resolved by token, no termination SHALL be reported: the
  termination capability SHALL return `false`, log one warning naming the spawn token and the
  `no-identity` outcome, and increment the failed-reclaim count

#### Scenario: A run spawned by a non-headless mechanism is terminated

- **WHEN** a run completes or is stopped and its session was spawned by a mechanism the
  headless PID registry does not track, on a host where its recorded process identity can
  be verified
- **THEN** its `pi` process SHALL no longer be resident after finalization
- **AND** the hard kill SHALL have been attempted on the session's recorded process
  identity, not only on the registry entry.
