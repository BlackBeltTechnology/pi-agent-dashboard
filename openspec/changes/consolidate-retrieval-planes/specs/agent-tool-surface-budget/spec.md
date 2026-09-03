# agent-tool-surface-budget — delta

## ADDED Requirements

### Requirement: A replaced third-party tool surface leaves the wire

When a consolidated tool replaces third-party tools, the replaced tools SHALL be
removed from the session's active tool set so their schemas are absent from the
provider payload. Registering a replacement while leaving the originals active
SHALL NOT be considered a replacement, because it increases the surface it was
meant to reduce.

#### Scenario: Replaced tools are absent from the payload
- **GIVEN** a consolidated tool replaces a set of third-party tools
- **WHEN** a provider request is built for that session
- **THEN** none of the replaced tool names SHALL appear in the payload's tool list
- **AND** the consolidated tool SHALL appear exactly once

#### Scenario: Replacement is byte-positive
- **GIVEN** a payload captured before the replacement
- **AND** a payload captured after it
- **WHEN** the two are compared
- **THEN** the tools-block size SHALL be smaller after the replacement

### Requirement: A trim is verified against a captured payload, not asserted

A change claiming to reduce per-turn context SHALL be verified by comparing a
provider payload captured before it against one captured after it. The
verification SHALL fail when a name the change claimed to remove is still
present in the captured payload.

#### Scenario: An unmet removal fails the check
- **GIVEN** a change claims to remove a named tool or skill
- **WHEN** the after-capture still contains that name
- **THEN** the verification SHALL fail
- **AND** SHALL name the entry that is still on the wire

#### Scenario: A satisfied removal passes
- **GIVEN** a change claims to remove a named tool or skill
- **WHEN** the after-capture does not contain that name
- **THEN** the verification SHALL pass
- **AND** SHALL report the bytes reclaimed

### Requirement: A surface change justified by a usage hypothesis carries a pre-registered decision rule

Where a further phase is justified by a hypothesis about how the agent's tool
surface affects usage, the decision rule SHALL be recorded before the measured
phase ships, and SHALL state a single metric, a single direction, a numeric
threshold, a minimum sample size, and how the baseline is computed. The rule
SHALL identify any concurrent change that mechanically shifts the metric and
SHALL exclude it from the baseline. An outcome of "no change" SHALL resolve to
stop, never to proceed. The rule SHALL state the effect size its sample can
detect, so an underpowered comparison is not read as evidence of absence.

#### Scenario: The rule is fixed before the measurement
- **GIVEN** a phase whose result gates a further phase
- **WHEN** that phase ships
- **THEN** the metric, direction, threshold, sample size and baseline definition SHALL already be recorded

#### Scenario: A mechanically shifted baseline is excluded
- **GIVEN** a concurrent change that removes a tool counted in the metric
- **WHEN** the baseline is computed
- **THEN** that tool's calls SHALL be excluded from both baseline and result

#### Scenario: No change stops the next phase
- **GIVEN** a recorded decision rule
- **WHEN** the measured result does not reach the threshold
- **THEN** the further phase SHALL NOT proceed

#### Scenario: The detectable effect size is stated
- **GIVEN** a recorded decision rule with a sample size
- **WHEN** the rule is read
- **THEN** it SHALL state the smallest effect that sample can detect
- **AND** SHALL state that smaller effects are not distinguishable from no effect

### Requirement: Deactivation is reversible by configuration

Deactivating a third-party tool surface SHALL be reversible without restoring
data or reinstalling a package. The originals SHALL remain installed and their
stores SHALL remain intact, so re-enabling them is a configuration change.

#### Scenario: Originals are restored by configuration alone
- **GIVEN** a third-party tool surface has been deactivated
- **WHEN** the deactivation is switched off
- **THEN** the original tools SHALL appear in the active tool set again
- **AND** their store contents SHALL be unchanged
