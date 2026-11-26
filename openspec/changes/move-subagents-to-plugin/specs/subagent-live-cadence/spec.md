# Spec Delta

## REMOVED Requirements

### Requirement: The Agent-tick throttle SHALL be on by default
**Reason**: The producer batches `onUpdate` to 250 ms since 0.2.5, and every producer that can run on pi ≥ 1.6.0 has that batching. The bridge throttle on top only halved an already-bounded rate. It is removed along with `subagentTickThrottleMs`.
**Migration**: None needed. An existing `subagentTickThrottleMs` value in the config file is ignored and dropped on the next settings save. The tick cadence becomes the producer's 250 ms window.

### Requirement: A one-shot migration SHALL move a materialized zero to the new default
**Reason**: The config key it migrated no longer exists.
**Migration**: None; the migration code is deleted with the key.
