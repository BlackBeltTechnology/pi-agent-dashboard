# Collapse streaming replay snapshots

## Why

Subscribing while an assistant is still answering replays every accumulated text snapshot in the unfinished response.
The existing finalized-message compaction does not reduce this tail, so catch-up can transfer and reduce the same text repeatedly.

## What Changes

- Retain only the final event of each adjacent run of eligible assistant text snapshots during replay, including unfinished responses.
- Keep thinking updates, mixed-content updates, lifecycle events, and every other run boundary unchanged.
- Preserve the existing replay projection, including state at each unfinished-tail run boundary, stored sequence numbers, and pre-compaction replay cursors.
- Extend the existing compactor and its equivalence tests, including generated properties; do not change live delivery, persistence, replay limits, or batch size.
- Require the shared four-way performance comparison: baseline, collapse-only, copy-on-write-only, and both.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `replay-stream-compaction`: permit adjacent unfinished text snapshots to collapse while preserving streaming state and existing finalized-message exemptions.

## Impact

- Server: `packages/server/src/session/replay-compaction.ts`; verify subscribe and history-backfill callers in `packages/server/src/browser-handlers/subscription-handler.ts`.
- Tests: existing compactor, cross-package reducer-equivalence, subscription, and replay browser suites.
- No protocol, persisted-format, configuration, dependency, or plugin API change.
- Runtime-independent of `copy-tool-state-on-write`; both source candidates are required for the shared performance comparison before either plan's performance acceptance closes.

## Discipline Skills

- `performance-optimization`: measure event and serialized-byte reductions on a reproducible workload.
- `doubt-driven-review`: verify that removed updates have no observable reducer effect at retained boundaries.
- `review-code`: review implementation before landing it.

## Expected Benefit and Limits

The benefit depends on how much of the replay consists of eligible unfinished snapshots.
The deterministic acceptance case is a 100-snapshot run becoming one snapshot, not a promised percentage improvement for an entire session.
Require the comparison defined in [test-plan.md](test-plan.md#shared-four-way-comparison-p2), including every variant's measurements and state-equivalence result.
No phone, network, or end-to-end catch-up speedup has been measured for this proposal.
