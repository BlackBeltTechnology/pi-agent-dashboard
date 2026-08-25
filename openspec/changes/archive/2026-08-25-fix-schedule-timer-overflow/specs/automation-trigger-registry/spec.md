# automation-trigger-registry Specification

## ADDED Requirements

### Requirement: Armed timer honors delays beyond the 32-bit ceiling

An armed trigger's timer SHALL fire at the intended occurrence even when the delay
to that occurrence exceeds Node's `setTimeout` maximum (`2^31 − 1 ms`, ≈ 24.855
days). The scheduler SHALL NOT allow such a delay to overflow to an immediate fire
or to a repeated firing loop. The timer SHALL compute the remaining wait against the
absolute target instant on each hop (not by naive subtraction), so long waits are
split into bounded hops that remain correct across GC pauses and OS suspend/resume
while the process stays alive.

This requirement covers every trigger `kind` armed through the shared scheduler
timer seam, not the `schedule` kind alone.

#### Scenario: Long-horizon cron fires once at its occurrence

- **WHEN** a `schedule` automation's next fire is more than 24.855 days away (e.g. a
  monthly `0 0 1 * *` or yearly `0 0 1 1 *`) and the process stays alive until then
- **THEN** the trigger SHALL fire exactly once, at that occurrence
- **AND** it SHALL NOT fire early, and SHALL NOT enter a repeated immediate-fire loop

#### Scenario: In-process late arrival fires once immediately

- **WHEN** a hop of a long wait wakes at or after the target instant (e.g. the
  machine was suspended across the target while the process remained alive)
- **THEN** the trigger SHALL fire exactly once, without further delay
- **AND** it SHALL NOT fire more than once for that occurrence

#### Scenario: Dispose during a long wait leaves no pending timer

- **WHEN** an armed long-wait trigger is disposed (config edit/delete) mid-hop
- **THEN** the currently pending hop timer SHALL be cleared
- **AND** no further fire SHALL occur for that automation

### Requirement: Restart-skip unaffected by chunked timing

The chunked long-timeout SHALL exist only in process memory and SHALL NOT change the
restart-catch-up policy. On server restart, arming SHALL recompute each automation's
next fire strictly forward from the current time and SHALL NOT backfill an occurrence
missed while the process was not running.

#### Scenario: Occurrence missed while process was down is still skipped

- **WHEN** the server process was not running across a scheduled occurrence and then
  starts again at a time past that occurrence
- **THEN** no run SHALL be created for the missed occurrence
- **AND** the next armed fire SHALL be the next future cron occurrence
