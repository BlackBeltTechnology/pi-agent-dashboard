## Purpose

A parent session SHALL survive its own subagent fan-out. This capability bounds
how many `Agent` children a session may have running at once, narrows that bound
when the host is under pressure, and guarantees that a child refused admission is
refused *visibly and terminally* rather than silently lost.

## ADDED Requirements

### Requirement: Concurrent `Agent` children SHALL be bounded per session

At most `N` `Agent` tool calls SHALL be executing concurrently in one session,
where `N` is the effective cap. A call arriving while `N` children are already
in flight SHALL be refused admission.

The bound is on **in-flight concurrency**, not on a batch: an admission decision
is reachable from a count the session maintains, without knowing how many
siblings the assistant message requested. This is forced by the platform — the
pre-execution event an extension receives carries only the tool name, call id and
input; the requesting assistant message is not exposed, so batch size and batch
identity are not knowable at decision time.

A child SHALL be counted as in flight from the moment it is admitted until its
**tool-execution-end** signal is observed. Counting from admission rather than
from execution is required: siblings are preflighted before any of them
executes, so a count that waited for execution would read zero for an entire
batch and admit all of it.

The release signal SHALL be the one the platform emits on **every** terminal
path, including cancellation. The post-execution result hook is NOT that signal:
an aborted call is finalized with an error result without running that hook, so a
count released on it would never release an aborted child. A capability that
leaks capacity on cancellation degrades into refusing all subagent work for the
rest of the session — the fail-closed mode this capability exists to avoid.

#### Scenario: Calls up to the cap are admitted untouched

- **GIVEN** an effective cap of `N` and no `Agent` children in flight
- **WHEN** `N` `Agent` calls are requested
- **THEN** all `N` SHALL execute
- **AND** their inputs SHALL be unmodified
- **AND** no refusal SHALL be reported

#### Scenario: Calls beyond the cap are refused

- **GIVEN** an effective cap of `N`
- **WHEN** `N + K` `Agent` calls are requested with none yet finished
- **THEN** exactly `N` SHALL execute
- **AND** the remaining `K` SHALL each be refused admission

#### Scenario: A cancelled child frees capacity

- **GIVEN** admitted children in flight
- **WHEN** the run is cancelled before those children produce results
- **THEN** the in-flight count SHALL return to zero
- **AND** a subsequent `Agent` call SHALL be admitted

#### Scenario: Finished children free capacity

- **GIVEN** `N` admitted children, of which `M` have produced tool results
- **WHEN** a further `Agent` call is requested
- **THEN** it SHALL be admitted while fewer than `N` children remain in flight


### Requirement: Admission SHALL NOT wait on any child

An admission decision SHALL be reached from the current in-flight count, the
current saturation reading and configuration alone. It SHALL NOT await the
result, terminal state or progress of any `Agent` call, and SHALL NOT delay a
call it intends to admit.

This is load-bearing rather than stylistic. Sibling tool calls are preflighted
sequentially and only then executed concurrently, so a decision that waits for a
child to finish waits for execution that cannot begin until that decision
returns: the session hangs permanently, which is worse than the crash this
capability addresses. For the same reason, delaying an admitted call cannot
spread start cost — execution begins only after every sibling has been
preflighted, so the batch still starts together after the accumulated delay.

#### Scenario: A saturated session still decides promptly

- **GIVEN** the in-flight count is at the effective cap
- **AND** no admitted child has produced any result
- **WHEN** a further `Agent` call is requested
- **THEN** it SHALL receive a refusal without observing any child's outcome
- **AND** the decision SHALL NOT be delayed pending any child

#### Scenario: Admission adds no delay

- **WHEN** a call is admitted
- **THEN** it SHALL proceed without an introduced wait

### Requirement: A refused call SHALL end terminally with an actionable reason

A refused `Agent` call SHALL yield a terminal, errored tool result carrying a
reason. It SHALL NOT be left without a result, because an unanswered tool call
renders as a card that spins forever, live and on every subsequent replay of the
transcript.

The reason SHALL state that the call was refused by host admission, how many
children are already running, and that the work should be re-issued **after**
running children finish — not immediately. It SHALL NOT terminate the agent:
refusal is "not now", not a task failure.

#### Scenario: Refusal closes the card

- **WHEN** a call is refused
- **THEN** it SHALL carry a terminal errored tool result
- **AND** it SHALL NOT remain in a running state
- **AND** a replay of the session transcript SHALL show it terminal

#### Scenario: The reason damps immediate retry

- **WHEN** a call is refused
- **THEN** the reason SHALL identify host admission as the cause
- **AND** SHALL state the in-flight count
- **AND** SHALL direct re-issue to after the running children complete
- **AND** the agent SHALL NOT be terminated by the refusal

### Requirement: Resource saturation SHALL narrow the effective cap without stalling progress

When the saturation reading exceeds the configured thresholds, the effective cap
SHALL fall to a single child rather than to zero. A session under saturation
SHALL still make progress, more slowly.

"Saturation" here means measured resource load. It is a distinct concept from the
bridge-silence health verdict the dashboard already publishes under the name host
pressure, and SHALL NOT be conflated with it: one is derived from how long a
session has been silent, this one from how loaded the machine is.

Each input SHALL declare the domain it measures — this process alone, or the
whole machine — because the observed failures occur on a machine loaded by *many*
sessions, where a parent's own process-local usage can read low while the machine
is saturated.

The reading SHALL be obtained without disturbing the session's existing
process-metrics telemetry, **and without inheriting that telemetry's sampling
window**. The established sampler is a destructive read — it resets the
event-loop-delay histogram and CPU delta on every call — so an admission path
that reuses it would corrupt the very measurements that evidence this failure
mode, and an admission path that merely reads that same histogram would see a
window whose length depends on when the last telemetry reset happened: near-zero
immediately after a reset even on a saturated host, causing the effective cap to
oscillate on the telemetry period.

Admission therefore SHALL derive its reading from sampling state it owns, over a
**fixed 5 s rolling window** — short enough that a session recovers from a spike
well within one telemetry heartbeat (15 s). Two simpler policies are excluded: a monitor that never
resets reports a maximum since process start, so one historical spike latches the
cap at 1 forever; and a monitor reset on each admission read makes the window
equal to the gap between two decisions, which inside a sequential preflight is
milliseconds — reading near-zero on a saturated machine.

The effective cap SHALL NOT oscillate while a reading hovers at a threshold:
entering the narrowed state requires a reading **at or above** its threshold, and
leaving it requires a reading **below 80 % of** that threshold. Between those two
points the current state persists, so consecutive decisions in one batch cannot
disagree.

The requirement names its inputs explicitly so it is testable: event-loop delay,
CPU share and system load average, each with its own configured threshold, and
each optional. When a metric is unavailable it SHALL be treated as "no signal
from that metric" rather than as saturation.

#### Scenario: Pressure serializes

- **GIVEN** a saturation reading above a configured threshold
- **AND** one `Agent` child in flight
- **WHEN** a further `Agent` call is requested
- **THEN** it SHALL be refused
- **AND** the reason SHALL name resource saturation

#### Scenario: Saturation does not latch

- **GIVEN** a reading that exceeded a threshold in the past
- **AND** readings sustained below that threshold since
- **WHEN** `Agent` calls are requested up to the configured cap
- **THEN** every one SHALL be admitted

#### Scenario: No saturation restores the configured cap

- **GIVEN** every reading below its threshold
- **WHEN** `Agent` calls are requested up to the configured cap
- **THEN** every one SHALL be admitted

#### Scenario: A reading at the threshold does not flap the cap

- **GIVEN** a reading hovering at a configured threshold
- **WHEN** several `Agent` calls are decided in quick succession
- **THEN** the effective cap SHALL NOT alternate between decisions

#### Scenario: Reading pressure does not disturb telemetry

- **GIVEN** a session reporting process metrics on its established cadence
- **WHEN** admission reads saturation between two telemetry reports
- **THEN** the reported event-loop-delay maximum SHALL cover the full interval
  between those reports
- **AND** the reported CPU share SHALL cover that same interval

#### Scenario: The saturation reading is independent of the telemetry cycle

- **GIVEN** a machine under sustained load
- **WHEN** admission reads saturation immediately after a telemetry report and
  again shortly before the next one
- **THEN** both readings SHALL report saturation
- **AND** the effective cap SHALL NOT change solely because of where the read
  fell in the telemetry cycle

#### Scenario: A missing metric is not pressure

- **GIVEN** the event-loop-delay reading is unavailable
- **AND** every other reading is below its threshold
- **WHEN** an `Agent` call is requested below the cap
- **THEN** it SHALL be admitted

### Requirement: A gate failure SHALL fail open

If the admission decision cannot be reached — a malformed configuration, an
unexpected error in the decision path — the call SHALL be admitted. Admission
SHALL NOT propagate an error into the tool-call path.

The platform turns a throwing pre-execution handler into a blocked tool call, so
a failing gate would refuse **every** `Agent` call in the session: one defect in
this capability would be strictly worse than the crash it mitigates.

#### Scenario: A broken decision path admits

- **GIVEN** an admission path that raises an unexpected error
- **WHEN** an `Agent` call is requested
- **THEN** it SHALL execute
- **AND** no error SHALL propagate out of the pre-execution handler

#### Scenario: Malformed configuration admits

- **GIVEN** a configured cap that is not a usable value
- **WHEN** an `Agent` call is requested
- **THEN** it SHALL execute

### Requirement: Refusals SHALL survive the parent's death

Every refusal, and whether it was caused by saturation or by the static cap,
SHALL be recorded such that it remains inspectable after the session's process
dies, as a durable session entry of type `subagent-admission-refused`. Admissions are NOT durably recorded — they ride the live channel only and
are lost when the process dies. The asymmetry is deliberate: it is what keeps the
admit path free of filesystem I/O.

Reporting only over the session's live telemetry channel is insufficient: the
failure this capability addresses ends with the process gone, so decisions
carried solely by that channel would be lost in exactly the case that matters.

The durable record SHALL be written when a call is refused. Admissions are the
hot path and SHALL NOT incur a durable write — a per-admission write would put
filesystem I/O in front of every subagent start, on a host that is by hypothesis
already struggling.

#### Scenario: Refusals are inspectable after process death

- **GIVEN** a session that refused at least one `Agent` call
- **WHEN** the session's process dies without a clean shutdown
- **THEN** every refusal recorded up to that point SHALL remain inspectable

#### Scenario: Admitting does not write

- **GIVEN** a session admitting `Agent` calls below the cap
- **WHEN** those calls are admitted
- **THEN** no durable record write SHALL occur for them

#### Scenario: Pressure refusals are distinguishable

- **GIVEN** refusals caused by saturation and refusals caused by the static cap
- **WHEN** the recorded decisions are inspected
- **THEN** the two causes SHALL be distinguishable

### Requirement: Admission SHALL be disableable to an exact no-op

A configured disabling value SHALL make admission a no-op: for any in-flight
count and any saturation reading, no `Agent` call is refused, delayed or
modified. This is the rollback path for a capability that sits in front of every
`Agent` call in every session.

When configuration is absent the capability SHALL be **active** at its default
cap. Absence means "not configured", not "disabled" — a mitigation that ships
inert protects no host until manually enabled.

#### Scenario: Disabled admits without bound

- **GIVEN** admission disabled by configuration
- **AND** a saturation reading above every threshold
- **WHEN** far more `Agent` calls are requested than any cap would allow
- **THEN** every one SHALL execute
- **AND** none SHALL be delayed or modified

#### Scenario: Absent configuration is active

- **GIVEN** no admission configuration
- **WHEN** more `Agent` calls are requested than the default cap
- **THEN** the excess SHALL be refused
- **AND** the default cap SHALL be defined, at least 2, and below 3 — stated as a
  property rather than a literal because the constant is fixed by measurement,
  and because a default of 3 would admit the census widths unchanged
