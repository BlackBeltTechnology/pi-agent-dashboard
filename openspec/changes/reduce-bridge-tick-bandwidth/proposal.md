## Why

Deferred follow-up #1 from `collapse-superseded-tool-execution-updates`.

The collapse is **retention-only** — a deliberate, tested property: the parent
change's F4 scenario asserts the browser still receives the full
`tool_execution_update` frame stream while collapse is active. So every tick a
subagent produces still crosses the bridge and the WebSocket; only the stored
copy is bounded.

That leaves the wire cost untouched. Reducing it is a genuinely different
trade-off from reducing storage, because it is **user-visible**: the tick cadence
is what makes a running subagent look alive. Any throttling trades smoothness
for bandwidth, which is a UX decision, not purely an engineering one.

## What Changes

- Reduce bridge-side tick bandwidth for sustained subagent runs (candidates:
  adaptive throttle on the producer's existing `createProgressEmitter` schedule,
  coalescing in the bridge, or client-driven backpressure).
- Make the UX trade explicit and measured, not incidental: define the minimum
  cadence at which a running subagent still reads as live, and hold the change
  to it.
- Must NOT weaken the parent change's F4 guarantee into vacuity. F4 asserts
  ≥ 2 received `tool_execution_update` frames in the window; a throttle tuned
  below that would make the scenario pass while the UI stalls. Re-derive the
  threshold if the cadence changes.

## Impact

- Affected specs: bridge event forwarding; subagent live-cadence guarantee.
- Affected code: `packages/extension/` (bridge forwarding),
  `pi-dashboard-subagents` (`createProgressEmitter` throttle),
  `tests/e2e/subagent-detail-dialog.spec.ts` (F4 threshold).
- Interacts with `reduce-subagent-details-payload`: shrinking each tick and
  sending fewer ticks are multiplicative. Sequence them so the second is
  measured against the first, not against the pre-collapse baseline.

## Discipline Skills

- `performance-optimization` — measure bandwidth before throttling; the win must
  be demonstrated, not assumed.
- `observability-instrumentation` — without a cadence metric the UX regression is
  invisible until a user reports a stalled-looking subagent.
