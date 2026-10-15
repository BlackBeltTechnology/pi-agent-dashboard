## ADDED Requirements

### Requirement: A reap SHALL be counted only when termination is confirmed

Reaps SHALL be counted under two explicit rules.

Kill gears (`idle`, `phantom`): a reap SHALL be counted only when the session's
process is verified gone after the kill, not when a kill was merely issued. When
termination is not confirmed, the sweep SHALL report a FAILED reclaim: it SHALL
log a diagnostic naming the session, the reap reason and the surviving process,
SHALL increment a failed-reclaim counter, and SHALL NOT increment the
reaped-by-reason counters.

Latch gear (`stop-after-turn`): it terminates no process, so it SHALL be counted
on DELIVERY of its latch to the session's bridge. An undeliverable latch SHALL be
reported as a failed reclaim with reason `stop-after-turn`, SHALL NOT increment
the `stop-after-turn` reaped counter, and SHALL be re-attempted on later sweeps
while the session stays eligible; it SHALL NOT be subject to the give-up bound
below.

Both counters count attempts per sweep.

A failed reclaim SHALL NOT remove the session record, which distinguishes an
unattended reclaim from an operator shutdown — the latter deliberately releases
the record so the UI is not wedged.

Retry of a failed KILL reclaim SHALL be bounded. After a configured small number
of consecutive failures, or immediately when the failure cannot change by
retrying (no process identity is held, or the recorded identity is reused or
unverifiable), the session SHALL be marked given-up: the server SHALL emit ONE
error-level diagnostic naming the session, the reason, the outcome and the
process, and neither the reaper nor the caps reclaim SHALL attempt that session
again. A given-up session remains listed. Clearing it is an operator action.

"Consecutive" counts failed kill ATTEMPTS: the count SHALL reset only when a reclaim of
that session is confirmed or the session is no longer listed. A sweep that makes no
attempt for the session (it is temporarily ineligible) SHALL NOT reset the count, and a
`stop-after-turn` latch outcome SHALL NOT affect it. Once given up, the session SHALL
receive no further kill attempt from the reaper or the caps reclaim; no latency bound is
otherwise imposed on a sweep or an acquire.

#### Scenario: A confirmed reap is counted

- **WHEN** a reap gear terminates a session and its process is confirmed gone
- **THEN** the reaped-by-reason counter for that reason SHALL increment
- **AND** no failed-reclaim diagnostic SHALL be emitted

#### Scenario: A failed reap is loud, not counted

- **WHEN** a reap gear cannot terminate the session's process
- **THEN** the server SHALL log a diagnostic naming the session id, the reap
  reason and the surviving process id
- **AND** the failed-reclaim counter SHALL increment
- **AND** the reaped-by-reason counters SHALL be unchanged

#### Scenario: A failed reap is retried on the next sweep

- **WHEN** a reclaim fails and the session still satisfies the reap predicate
- **THEN** the session SHALL remain listed
- **AND** the next sweep SHALL attempt the reclaim again

#### Scenario: Retrying stops after repeated failure

- **WHEN** a session's reclaim has failed on several consecutive sweeps
- **THEN** the server SHALL emit one error-level diagnostic for that session
- **AND** later sweeps SHALL NOT attempt to reclaim it again
- **AND** the session SHALL remain listed

#### Scenario: An ineligible sweep does not reset the give-up count

- **WHEN** a session's kill reclaim has failed, a later sweep makes no attempt because the
  session is temporarily ineligible, and subsequent attempts fail again
- **THEN** the failures before and after the ineligible sweep SHALL count toward the same
  give-up bound
- **AND** only a confirmed reclaim of that session, or the session no longer being listed,
  SHALL reset the count

#### Scenario: An undeliverable stop-after-turn latch is a failed reclaim

- **WHEN** the `stop-after-turn` gear selects a session whose bridge connection
  cannot receive the latch
- **THEN** the `stop-after-turn` reaped counter SHALL NOT increment
- **AND** the failed-reclaim counter SHALL increment
- **AND** a later sweep SHALL attempt the latch again once the session is still
  eligible, regardless of how many earlier latches failed

## MODIFIED Requirements

### Requirement: Phantom-liveness escape hatch

The reaper SHALL reclaim a session that reports `streaming` but is wedged. A session SHALL be
force-reaped, with a distinct reason, ONLY when ALL hold: it has emitted no run-terminal
`agent_settled` for longer than a configured hard ceiling (far larger than any real turn);
its pi process tree shows no live children and negligible CPU (via a liveness probe); no
browser is subscribed; **there is no pending `ask_user` interaction**; and
`pendingQueues.followUp`/`steering` are empty. The pending-ask and empty-queue conditions
SHALL be mandatory so a session merely blocked awaiting human input or holding queued work
is NEVER force-reaped. A phantom force-reap SHALL use the shared graceful
SIGTERM→grace→SIGKILL ladder, NOT a bare SIGKILL, to bound the append-only session-file
mid-write window and keep the reaped session resumable. That ladder SHALL reach the
session's `pi` process for every spawn strategy, not only for sessions tracked in the headless
PID registry, wherever the recorded process identity can be verified; on a Windows server a
non-headless session's identity cannot be verified, and its phantom reap SHALL be reported as
a failed reclaim instead of signalling the process. This SHALL be the mechanism that
clears accumulated stuck sessions that a pure quiescence gate would never touch.

#### Scenario: Wedged streaming session is force-reaped
- **WHEN** an `ephemeral` session has been `streaming` past the hard ceiling with a
  ~0-CPU pi tree, no live children, and no subscriber
- **THEN** the reaper SHALL force-reap it with reason `"phantom"`
- **AND** the reap reason SHALL be distinguishable from an ordinary idle reap in diagnostics

#### Scenario: ask_user-blocked session is never phantom-reaped
- **WHEN** an `ephemeral` session is `streaming` past the hard ceiling, ~0-CPU, no children,
  and no subscriber, BUT has an unanswered `ask_user` (or a non-empty follow-up queue)
- **THEN** the reaper SHALL NOT force-reap it

#### Scenario: A wedged non-headless session is force-reaped too
- **WHEN** a phantom-eligible session was spawned by a mechanism the headless PID registry
  does not track, on a host where its recorded process identity can be verified
- **THEN** its `pi` process SHALL be terminated by the shared ladder
- **AND** the reap SHALL be counted as a `"phantom"` reap

### Requirement: Active-session caps with graceful reclaim

The server SHALL enforce configurable `maxActiveEmbedSessionsPerVisitor` and
`maxActiveEmbedSessionsGlobal`, counting ONLY `ephemeral` sessions. When a limit would be
exceeded on acquire, the server SHALL first reclaim the oldest safely-quiescent `ephemeral`
session. Reclaiming SHALL terminate that session's `pi` process through the same shared,
strategy-agnostic ladder the reaper uses (subject to the same identity verification, so on a
Windows server a non-headless victim is refused rather than signalled), and an acquire SHALL NOT be admitted on the
strength of a reclaim whose termination was not confirmed: an unconfirmed reclaim SHALL
be refused with the SAME structured capacity error as the all-busy case, and the acquire
SHALL NOT fall through to a second victim in the same attempt. A session whose reclaim has been given
up SHALL NOT be selected as a victim, but SHALL still count toward the caps because its
process is still resident; when every quiescent candidate is given up, the acquire SHALL
take the all-busy path. If no quiescent candidate
exists (every candidate is busy), the server SHALL
return a structured capacity error and SHALL NOT terminate active work. Interactive/durable
sessions SHALL never be counted or reclaimed. The GLOBAL cap SHALL be the hard security
bound against untrusted or spoofable identities (a caller controlling `visitorId`/`cwd` can
mint many `identityKey`s), and the per-visitor cap SHALL be treated as a fairness bound for
trusted identities only, not an adversarial control.

#### Scenario: Oldest idle session reclaimed at the cap
- **WHEN** an acquire would exceed a per-visitor or global embedded cap and at least one
  quiescent `ephemeral` session exists
- **THEN** the server SHALL reap the oldest quiescent session before spawning
- **AND** the new acquire SHALL succeed

#### Scenario: Capacity error when all candidates are busy
- **WHEN** an acquire would exceed a cap and every `ephemeral` candidate is busy (not
  quiescent)
- **THEN** the server SHALL return a structured capacity error
- **AND** no active session SHALL be terminated

#### Scenario: Unconfirmed reclaim refuses the acquire
- **WHEN** the victim selected at the cap cannot be confirmed terminated
- **THEN** the server SHALL return the structured capacity error
- **AND** it SHALL NOT admit the acquire
- **AND** it SHALL NOT select a further victim within the same acquire

#### Scenario: A given-up session is never re-picked as a victim
- **WHEN** an acquire would exceed a cap and the oldest quiescent candidate's reclaim has
  been given up
- **THEN** the server SHALL NOT signal or select that session
- **AND** it SHALL select the next eligible quiescent candidate, or return the structured
  capacity error when none remains
- **AND** the given-up session SHALL still count toward the cap

#### Scenario: Reclaim at the cap frees a non-headless session
- **WHEN** the victim selected at the cap was spawned by a mechanism the headless PID
  registry does not track, on a host where its recorded process identity can be verified
- **THEN** its `pi` process SHALL be terminated before the new session is spawned
- **AND** the host SHALL NOT end up running more session processes than the cap allows

### Requirement: Lifecycle observability

The server SHALL expose lifecycle metrics for embedded/`ephemeral` sessions: active count,
idle count, reaped count with reason (`idle` / `stop-after-turn` / `phantom`),
failed-reclaim count, capacity-rejection count, acquire reuse hit/miss counts, and
per-session last-activity timestamp. The failed-reclaim count SHALL cover reclaims whose
termination could not be confirmed, whose target identity was refused as reused or unverifiable, whose
session held no process identity, and `stop-after-turn` latches that could not be
delivered, and automation-run terminations that were not confirmed — so a
silently-ineffective reaper is detectable from the diagnostics surface alone. The
failed-reclaim count SHALL be a single number, not broken down by reason (the diagnostic
log carries the reason). Given-up sessions SHALL be reported by their error-level
diagnostic only; the diagnostics surface SHALL NOT list them. One consistent term SHALL be
used for this counter across diagnostics, logs and code. Metrics SHALL be reachable via `/api/health` and/or a JWT-gated
diagnostics endpoint.

#### Scenario: Diagnostics surface embedded-session growth
- **WHEN** an operator queries the health/diagnostics surface
- **THEN** it SHALL report the active and idle embedded-session counts and the reaped count
  broken down by reason

#### Scenario: Reuse hit/miss is observable
- **WHEN** an `acquire` reuses an existing session versus spawning a new one
- **THEN** the corresponding reuse hit or miss counter SHALL increment

#### Scenario: An ineffective reaper is visible in diagnostics
- **WHEN** reclaims have failed to terminate their target processes
- **THEN** the diagnostics surface SHALL report a non-zero failed-reclaim count as a
  single number
- **AND** the reaped counts SHALL NOT include those attempts
- **AND** the diagnostics surface SHALL NOT carry a per-session list of given-up sessions
