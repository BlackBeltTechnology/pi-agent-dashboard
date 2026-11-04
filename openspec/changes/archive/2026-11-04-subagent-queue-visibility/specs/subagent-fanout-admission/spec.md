# Spec Delta

## REMOVED Requirements

### Requirement: Concurrent `Agent` children SHALL be bounded per session
**Reason**: Duplicate concurrency limit. The subagents producer's `maxConcurrent` already bounds running children, and it queues the excess instead of refusing it. The dashboard-side `maxConcurrentSubagents` cap overrode it: with equal values the producer never queues, and the extra call fails.
**Migration**: Set the limit in the subagents plugin settings ("Max parallel subagents"), which writes the producer's `maxConcurrent`. An existing `maxConcurrentSubagents` key in the dashboard config is ignored.

### Requirement: Admission SHALL NOT wait on any child
**Reason**: The admission gate is removed (see above).
**Migration**: None. The producer's semaphore waits inside the tool's execution, not in pre-execution, so it does not deadlock the batch.

### Requirement: A refused call SHALL end terminally with an actionable reason
**Reason**: Calls are no longer refused. Excess calls wait as `queued`.
**Migration**: None.

### Requirement: Resource saturation SHALL narrow the effective cap without stalling progress
**Reason**: The saturation narrowing only exists as a modifier of the removed admission cap.
**Migration**: Lower "Max parallel subagents" on hosts that saturate.

### Requirement: A gate failure SHALL fail open
**Reason**: The admission gate is removed.
**Migration**: None.

### Requirement: Refusals SHALL survive the parent's death
**Reason**: There are no refusals. The `subagent-admission-refused` entry type is no longer written. Existing entries in old transcripts keep resolving to the `diagnostics` group and stay hidden by default.
**Migration**: None.

### Requirement: Admission SHALL be disableable to an exact no-op
**Reason**: The admission gate is removed. Setting the producer limit to `0` (unlimited) is the equivalent "off" position.
**Migration**: None.
