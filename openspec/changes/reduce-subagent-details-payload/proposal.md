## Why

Deferred follow-up #2 from `collapse-superseded-tool-execution-updates`.

That change bounded how many `tool_execution_update` events the store RETAINS
(measured: 36 → 2 per `toolCallId`, a 94 % cut in the retained tick
population). It deliberately did NOT touch how FAT each event is.

The fat is the `subagent_*` `details` payload. Each `tool_execution_update` from
`pi-dashboard-subagents` carries the **cumulative** subagent timeline — every
entry re-sent on every tick. A ~55 MB buffer was measured in the field, and the
collapse's own A/B
(`openspec/changes/archive/2026-08-11-collapse-superseded-tool-execution-updates/heap-evidence.md`)
shows why retention alone cannot reach it: average bytes/event actually ROSE
(1240 → 1350 B) once the small ticks were shed, because the cost is concentrated
in the surviving payloads, not in their count.

So the two levers are independent, and only one has been pulled.

## What Changes

- Stop re-sending the whole cumulative timeline on every tick. Candidate shapes,
  to be decided in design: an incremental/delta `entries` payload, or a
  content-addressed reference the client folds against state it already holds.
- Preserve the reducer contract the collapse change documented and depends on:
  the `subagents` merge is ACCUMULATIVE and field-conditional, `entries` has an
  empty-array overwrite guard, and `type`/`description` are FIRST-wins. Any
  delta encoding must keep a late joiner and a replay reaching the same fold.
- Keep `/api/health` observability: report payload bytes so the win is
  measurable rather than asserted.

## Impact

- Affected specs: subagent event payload; event-store retention (interaction
  with the existing collapse gate).
- Affected code: `pi-dashboard-subagents` (`extensions/agent.ts`,
  `createProgressEmitter`), the client subagent reducer, replay/fold equivalence
  tests.
- **Cross-package**: the producer is a separately published npm package, so this
  needs a version-gated rollout — the dashboard must stay correct against BOTH
  the old full-payload producer and a new delta producer.

## Discipline Skills

- `performance-optimization` — measure-first; the ~55 MB figure must be
  re-measured against the post-collapse baseline before any encoding work.
- `doubt-driven-review` — a delta encoding is an irreversible wire-format
  decision affecting a published package.
