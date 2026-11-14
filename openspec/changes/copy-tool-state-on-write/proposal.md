# Copy tool-call state only when it changes

## Why

The client reducer copies the complete `toolCalls` map for every event, including text and thinking updates that do not write tool-call state.
Large sessions therefore pay work proportional to historical tool count while catching up or streaming text.

## What Changes

- Reuse the input tool-call map in core paths that do not write it; plugins may still return their own immutable maps.
- Copy before mutating a shared map, covering indirect helpers, nested calls, revive paths, and plugin finalizer re-entry.
- Preserve previous-state immutability, tool rows, map contents, replay/live behavior, and plugin callback contracts.
- Measure avoided map copies separately from overall render or network time.
- Require generated snapshot-isolation checks and the shared four-way comparison: baseline, collapse-only, copy-on-write-only, and both.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None.
This is an allocation-only refactor of the existing `event-reducer` implementation, so `.openspec.yaml` sets `skip_specs: true`.
Map sharing is an internal mechanism and test oracle, not a new public identity guarantee for plugins or UI consumers.
The design and test plan specify the optimization and its preservation checks without adding normative event behavior.

## Impact

- Client: `packages/client/src/lib/chat/event-reducer.ts` and its direct map-writing helpers.
- Verify the existing finalizer and slice boundaries in `packages/dashboard-plugin-runtime/src/session-event-reducers.ts` and the subagents plugin.
- Tests: reducer lifecycle, nested tools, revive/backfill, plugin finalizers, and replay/render integration.
- No new state-management library, protocol, dependency, configuration, or public plugin API change.
- Runtime-independent of `collapse-streaming-replay-snapshots`; both source candidates are required for the shared performance comparison before either plan's performance acceptance closes.

## Discipline Skills

- `performance-optimization`: measure reducer map-copy work against historical tool count.
- `doubt-driven-review`: examine escaped snapshots and synchronous callback re-entry before choosing ownership logic.
- `review-code`: review implementation before landing it.

## Expected Benefit and Limits

The deterministic improvement is zero full-map copies attributable to core ownership on paths that do not write tool-call state.
Plugin callbacks retain their existing allocation behavior.
Tool events still pay for immutable updates, and other reducer/render work remains.
Require the comparison owned by [the replay test plan](../../streaming-performance-comparison.md#shared-four-way-comparison-p2); reuse its result rather than defining another benchmark.
No browser or phone speedup is claimed before measurement.
