## Why

Deferred follow-up #2 from `collapse-superseded-tool-execution-updates`.

That change bounded how many `tool_execution_update` events the store RETAINS
(measured: 36 → 2 per `toolCallId`, a 94 % cut in the retained tick
population). It deliberately did NOT touch how FAT each event is.

The fat is the `subagent_*` `details.entries` timeline. Every progress tick
carries the **cumulative** subagent timeline — every entry re-sent on every
tick, through every hop, into every stored event. A ~55 MB buffer was measured
in the field, and the collapse's own A/B
(`openspec/changes/archive/2026-08-11-collapse-superseded-tool-execution-updates/heap-evidence.md`)
shows why retention alone cannot reach it: average bytes/event actually ROSE
(1240 → 1350 B) once the small ticks were shed, because the cost is
concentrated in the surviving payloads, not in their count.

**The root cause is not the encoding — it is the delivery model.** The timeline
is a PULL-consumed resource: it renders only when a user expands a subagent
inspector, which is a small fraction of subagent runtime. Yet it is PUSH-fanned
out to every connected browser on every tick regardless of whether any inspector
is open.

A pull path for that resource **already exists end to end**:
`subagent_resync_request` (browser → server → bridge), answered from
`SubagentFrameBuffer`, which already retains the latest full snapshot of every
RUNNING subagent "regardless of ready state so a resync can always return
current state". The push channel is redundant with it.

That pull path has one broken hop, discovered while reviewing this change: the
reply is a `subagent_started` frame, which `locateSubagentTimeline` does not
match, so its timeline takes the generic truncation pass and any `entries` array
past 20 items is clobbered to the string `"[array truncated]"` — which the
reducer silently ignores. **A resync for a run past 20 entries returns no
timeline at all today.** Fixing that type gate is a standalone bug fix and a
prerequisite for this change.

An earlier draft of this change proposed a delta/incremental `entries` encoding.
Two doubt-review cycles killed it: the pipeline has a documented, load-bearing
invariant — **every subagent frame is an idempotent FULL snapshot,
latest-supersedes** — and four independent hops depend on it (producer throttle,
bridge frame buffer, server collapse predicate, WS back-pressure drops). A delta
converts one channel to event-sourcing semantics on a lossy, coalescing
transport. Separately, head-tail truncation REWRITES `entries`, so any
producer-side count anchor is invalid downstream the moment a ceiling fires.

## What Changes

- **Stop pushing the timeline on intermediate ticks.** The bridge strips
  `details.entries` from forwarded `running`/`queued` progress frames, on BOTH
  carriers (`subagents:*` `event_forward` and `tool_execution_update`), while
  retaining the full snapshot in the `SubagentFrameBuffer` it already maintains.
- **Keep the timeline on the anchors that already carry it**: terminal frames
  (`completed` / `failed` / `aborted` / early-error) and resync replies are
  forwarded unchanged, fat.
- **Fix the pull path's truncation type gate first** so a resync reply actually
  delivers a (head-tail bounded) timeline instead of a clobbered string.
- **Serve the timeline on demand** via the existing `subagent_resync_request`
  path — no new route, no new wire keys, no protocol version.
- **Add the one genuinely missing piece**: liveness while an inspector is OPEN.
  Today the open inspector is fed by the push firehose. v1 re-fires the existing
  resync request on a low cadence while the detail view is mounted; a watch
  signal is the v2 escalation if polling proves too coarse.
- Keep `/api/health` observability: report payload bytes so the win is
  measurable rather than asserted.

**Every frame stays an idempotent full snapshot.** Nothing about
latest-supersedes changes; the hot frame simply describes less. The producer
throttle, frame buffer, collapse predicate, and truncation ceilings all keep
working unchanged.

## Impact

- Affected specs: subagent event payload; subagent live-detail reliability
  (the resync path gains a second trigger).
- Affected code: `packages/extension/` (`bridge.ts` forward path,
  `subagent-frame-buffer.ts`), the client inspector's resync trigger
  (`AgentToolRenderer.tsx`), one truncation type predicate plus health counters
  in `packages/server/`.
- **No cross-package coordination.** The producer
  (`@blackbelt-technology/pi-dashboard-subagents`) is NOT modified, so there is
  no version gate, no producer capability flag, and no multi-party compatibility
  matrix. The reduction happens downstream of every producer version in the
  wild, which satisfies the old-producer requirement by construction.
- Server heap: mid-run timelines stop entering the event store **while no
  inspector is open** — which is most of the time, and is what D1 measures. An
  open inspector still pulls fat snapshots at cadence, so the win is bounded by
  the inspector-open share rather than absolute.

## Discipline Skills

- `performance-optimization` — measure-first; the ~55 MB figure must be
  re-measured against the post-collapse baseline before any work, and the
  inspector-open share must be measured because it bounds the achievable win.
- `doubt-driven-review` — the delivery-model change alters what a mid-run
  replay contains; that is a durable behavioural contract worth adversarial
  review before it stands. (Two cycles already ran and rejected the prior
  delta design; this proposal is their output.)
- `observability-instrumentation` — the win must be visible in `/api/health`,
  and the new pull cadence needs a counter to prove it is not a new firehose.
