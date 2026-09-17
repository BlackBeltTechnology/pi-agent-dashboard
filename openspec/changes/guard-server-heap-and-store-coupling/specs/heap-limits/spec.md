# heap-limits — delta

## ADDED Requirements

### Requirement: The server ceiling and the store budget SHALL be guarded as a pair

The system SHALL warn when the store budget converted to heap, plus the
baseline, exceeds the server ceiling's effective crash point — that is, when
`budgetMiB × 1.33 + 112 > ceilingMB × 0.82`, where
`budgetMiB = maxTotalEventBytes / 1024²`. `maxTotalEventBytes` of `0` means
unlimited and SHALL always warn, at any ceiling. The warning SHALL NOT block the
save.

The guard SHALL accept the budget in the byte denomination `MemoryLimitsConfig`
stores and perform the MiB conversion internally, so no call site can pass a raw
byte count into a MiB-denominated term.

The three factors SHALL be exported as named shared constants so the guard, its
tests and any future re-derivation read one source. The multiplier's name SHALL
carry its MiB denomination.

#### Scenario: Unlimited store budget under a bounded ceiling
- **WHEN** `maxTotalEventBytes` is `0` and `serverHeap.maxOldSpaceMb` is `1536`
- **THEN** a non-blocking warning SHALL state that the store is unbounded under a bounded ceiling
- **AND** the value SHALL remain saveable

#### Scenario: Budget raised past what the ceiling can hold
- **WHEN** the operator raises `maxTotalEventBytes` to `2048` MiB against a `1536` MB ceiling
- **THEN** the guard SHALL warn, reporting the budget's heap-equivalent against the ceiling

#### Scenario: Default pairing is silent
- **WHEN** `maxTotalEventBytes` is the default `768` MiB and the ceiling is the default `1536`
- **THEN** no warning SHALL be shown

#### Scenario: The byte-denominated default does not warn spuriously
- **WHEN** the guard is given `maxTotalEventBytes` as the stored byte value `805306368` against a `1536` MB ceiling
- **THEN** no warning SHALL be shown, because the guard converts bytes to MiB before applying the multiplier

### Requirement: The lowered server default SHALL NOT ship without a bounded store

A build-time assertion SHALL fail when the shared server-heap default is below
`8192` while the shared memory-limits default carries no `maxTotalEventBytes` or
carries a `0`. The assertion SHALL read the same shared server-heap default the
launchers stamp, and that default SHALL be importable as a value from the
browser bundle so the panel guard and the assertion cannot diverge.

The assertion SHALL fail the CI gate rather than throwing at module scope, so a
mispairing cannot brick the browser bundle at runtime.

#### Scenario: Missing budget default fails the assertion
- **WHEN** the shared server-heap default is below `8192` and the shared memory-limits default carries no `maxTotalEventBytes`
- **THEN** the assertion SHALL fail

#### Scenario: Unlimited budget default fails the assertion
- **WHEN** the shared server-heap default is below `8192` and the shared memory-limits default carries `maxTotalEventBytes` of `0`
- **THEN** the assertion SHALL fail

#### Scenario: Bounded pairing passes
- **WHEN** the shared server-heap default is below `8192` and the shared memory-limits default carries a non-zero `maxTotalEventBytes`
- **THEN** the assertion SHALL pass

### Requirement: The dashboard's heap flag SHALL NOT reach dashboard terminals

A dashboard terminal's environment SHALL NOT carry the dashboard's own
old-space flag, and an operator-set heap flag SHALL be preserved. The dashboard's
own token SHALL be identified by the provenance marker naming it, NOT by testing
for the flag's presence.

#### Scenario: Terminal environment carries no inherited ceiling
- **WHEN** a dashboard terminal is created while the server runs under a stamped ceiling
- **THEN** the terminal's environment SHALL NOT carry the server's old-space flag

#### Scenario: An operator-set flag survives the strip
- **WHEN** the environment carries an operator-set heap flag distinct from the dashboard's stamp
- **THEN** that flag SHALL be preserved in the terminal environment

#### Scenario: An operator flag identical to the stamp's value survives
- **WHEN** the environment carries an operator-set heap flag whose value equals the dashboard's stamped value but no marker names it
- **THEN** that flag SHALL be preserved in the terminal environment

#### Scenario: The provenance marker does not leak into the terminal
- **WHEN** a dashboard terminal is created while the server runs under a stamped ceiling
- **THEN** the terminal's environment SHALL NOT carry the provenance marker variable
