# Design: adjacent replay text snapshots

## Context

See [proposal.md](proposal.md) for motivation and scope.
The current compactor returns an unmodified copy when no supersession boundary exists and otherwise retains the entire unfinished tail (`packages/server/src/session/replay-compaction.ts:104–124`).
It exempts thinking events and the last update seeding a tool-start text flush (`packages/server/src/session/replay-compaction.ts:17–39,91–112`).
The client consumes assistant text updates by replacing `streamingText` with the snapshot's text, unless that message has already flushed (`packages/client/src/lib/chat/event-reducer.ts:2244–2262`).
Thinking updates instead accumulate deltas and timestamps (`packages/client/src/lib/chat/event-reducer.ts:2203–2241`).
Subscribe computes its high-water mark before compaction; history-backfill supplies a slice-relative external boundary (`packages/server/src/browser-handlers/subscription-handler.ts:397–402,768`).

## Goals / Non-Goals

Reduce redundant unfinished text snapshots without changing the reducer's state at the end of a run or at any intervening retained event.
Do not generalize finalized-message deletion, compact live traffic, change the wire format, or alter thinking reconstruction.
Do not change the meaning of an explicit supersession boundary.

## Decisions

### D1. Collapse only adjacent eligible snapshots

For example, snapshots `a`, `ab`, and `abc` with no intervening event can replay as `abc`.
With `a`, `tool_execution_start`, and `ab`, retain both snapshots: the tool start observes the preceding text.

An eligible event is `message_update` with `data.message.role === "assistant"` and content that is a string or an array containing only text blocks with string `text`.
`data.assistantMessageEvent` must be absent (`undefined`) or a non-null object whose `type` is exactly `text_start`, `text_delta`, or `text_end`.
Present null, malformed metadata, thinking metadata, and all other metadata types break a run.
An empty text string or empty content array is eligible because it represents replacement with empty text.
Mixed-content arrays, delta-only events lacking a full message snapshot, and non-assistant messages break a run and pass through this new rule.
The text need not grow monotonically: replacement with shorter or empty text is still replacement.
Message lifecycle events delimit messages; do not invent identifier fields or compare opaque metadata that the text reducer does not consume.

This conservative fragment deliberately leaves mixed-content snapshots unoptimized.
Their frequency affects the benefit, not correctness; measure the eligible fraction rather than claiming the entire streaming tail shrinks.

### D2. Preserve original adjacency and existing exemptions

Compute the active supersession boundary and existing exemptions using original input positions.
Leave every update before that boundary to the existing finalized-message policy; the new rule makes no additional removals there.
Recognize adjacent eligible runs only at or after the active boundary, using adjacency in the original input.
With no boundary, the whole input is eligible for run recognition.
Retain the final event of each such run and preserve every intervening ineligible event.
An external whole-slice boundary therefore leaves no new tail to collapse.
Since finalized-message filtering cannot delete a separator within this non-superseded region, it cannot create a new eligible tail run on a second pass.
Preserve the original event object and `seq` of every survivor and never mutate input arrays or events.
The implementation remains linear in input events and introduces no cross-call state.

### D3. Retain cursors and window semantics

Keep the existing ordering: calculate the raw high-water mark, compact, apply the replay window, then batch.
An omitted boundary retains its existing finalized-message policy, with the newly permitted adjacent-run collapse added.
An explicit boundary is interpreted against the original array, not an array shortened by run collapse.
Thinking and pre-tool-flush exemptions continue to apply in both modes.
No changes are required to the client's sequence-gap tolerance or suppression catch-up protocol.
The new rule does not promise identical history coverage when a count-based window can now fit more useful events; compare state before window selection or over matching logical history.

### D4. Prove the additional collapse at the consumer

Extend `packages/server/src/__tests__/replay-compaction-equivalence.test.ts` using the real client reducer.
For the new rule, the reference replay is the existing finalized-message policy with unfinished snapshots retained.
Compare complete states after each collapsed tail run, at each intervening tail event, and after subsequent live events, from the same initial state.
Include unfinished text, thinking timestamps, message ids/order, tools, and plugin-owned state; do not normalize fields away.
Exercise nonempty initial states and text-already-flushed states, not only `createInitialState()`.
Keep existing raw-versus-compacted finalized-message tests and add coherent unfinished-stream fixtures that also compare directly against raw input.
Generate bounded input families for structural invariants and coherent consumer equivalence using the seed-based Vitest approach in `packages/electron/src/lib/__tests__/peer-address-properties.test.ts`.
The generator, coverage partitions and independent oracles are specified in [test-plan.md](test-plan.md#generated-case-contract-e9e10).

Existing finalized-message equivalence requirements remain in force; the new tail rule does not waive or broaden them.
Its acceptance must not claim raw-window equivalence for arbitrary finalized prefixes or isolated backfill slices solely from the new tail tests.
The current global last-`message_end` rule can remove text before a retained thinking event, and an external boundary intentionally removes updates finalized outside the slice (`packages/server/src/session/replay-compaction.ts:80–124`).
Backfill acceptance compares the new and reference projections under the same explicit boundary, then exercises the existing splice into loaded history.
Correcting the existing global finalized-message rule is outside this change.

### D5. Use deterministic performance acceptance

A fixture of 100 adjacent eligible snapshots with text lengths 1 through 100 KiB must retain exactly the final update.
Record serialized input/output bytes and update counts; require fewer serialized bytes and identical final reducer state.
This measures the removed work directly without a machine-dependent millisecond threshold.
Require the shared [four-way comparison](test-plan.md#shared-four-way-comparison-p2) before closing either optimization's performance acceptance.
Compare baseline, collapse-only, copy-on-write-only, and both on identical raw workloads and initial states.
Both candidate revisions must be available; neither must merge first, and no runtime feature flags are needed.
Real-device catch-up measurements remain separate from this in-process comparison.

## Alternatives

- Keep all unfinished snapshots: least risk, but leaves the identified repeated transfer and reduction intact.
- Drop every unfinished update except the last: crosses tool, thinking, and lifecycle boundaries and can change row ids, timestamps, and text flushes.
- Send deltas or a dedicated state snapshot: requires a protocol/client redesign and independently deployed compatibility work; unnecessary for this local reduction.

## Risks / Trade-offs

- Eligibility is narrower than every assistant update → report eligible versus total events in measurements.
- Reducer changes can invalidate replacement semantics → retain raw-versus-compacted equivalence tests alongside the compactor.
- Backfill boundaries can shift when filtering changes indices → keep all boundary decisions in original input coordinates.

## Migration Plan

No migration or coordinated client upgrade is needed.
A later authorized implementation can roll out as a server change; rollback restores the old replay compactor without changing stored events.
This planning change does not implement or deploy anything.
