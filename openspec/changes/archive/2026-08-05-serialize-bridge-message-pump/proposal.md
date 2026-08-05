## Why

The bridge's WebSocket message pump dispatches handlers **concurrently**:
`packages/extension/src/connection.ts` invokes the async `onMessage` handler
**without `await`**, so every inbound message starts an independent task. A
`set_model` handler yields at its first `await` and a `send_prompt` arriving in
the next socket tick runs to completion during that yield — submitting the
prompt on the **old** model. The failure is silent and produces a run that looks
correct.

This race was proved by the Task 1 spike of the
`openspec-dialog-model-effort-selector` change (see that change's `design.md`,
Spike Findings). That change closed the race **only for its own OpenSpec launch
dialogs**, via a client-side confirm-before-send gate (Decision 7, option a). The
underlying bridge trap remains open for **every other caller** that emits
`set_model` (or any state-mutating message) immediately followed by a dependent
message.

## What Changes

- Serialize the bridge `onMessage` dispatch behind a promise queue so handlers
  run to completion in wire order, closing the race for all callers.
- Preserve ordering semantics for every existing message type on the hot path;
  add tests covering the `set_model` → `send_prompt` ordering.
- Bypass the queue for **`prompt_response` only** (a reply correlated by request
  id — queueing it behind the handler awaiting it would deadlock permanently).
  Cancellation stays serialized: bypassing `abort` would let it run *ahead* of
  the `send_prompt` it cancels and silently lose the cancellation.
- Define an **explicit inbound back-pressure bound** (separate from the outgoing
  `maxBufferSize`) so a slow handler cannot grow the queue without limit, with
  drop-newest + an observable dropped count.
- Define **failure isolation**: a throwing/rejecting handler is logged and the
  pump continues with the next message, never stalling the queue.
- **Discard pending inbound on disconnect** so a dead socket's backlog cannot
  head-of-line-block the reconnected one.
- Once landed, the client-side gate in `openspec-dialog-model-effort-selector`
  becomes a redundant belt-and-suspenders (kept, not removed, in that change).

## Discipline Skills

`doubt-driven-review` (ordering/lifecycle invariants the compiler cannot verify —
run in planning, 3 cycles), `scenario-design` (test-plan manifest),
`performance-optimization` (task 2.12 hot-path budget),
`systematic-debugging` (if a reconnect/epoch test goes red mid-implementation),
`review-code` (before commit).

## Impact

- Affected: `packages/extension/src/connection.ts` (message pump hot path);
  `packages/shared/src/protocol.ts` (one additive, optional `ProcessMetrics`
  field for the overflow-refusal count — bridge→server diagnostics, NOT a
  server→bridge wire-protocol change); the extension test files that assume
  synchronous dispatch.
- Risk: touches every inbound message; needs ordering + back-pressure tests
  before landing. This proposal is the **placeholder/follow-up filing** required
  by `openspec-dialog-model-effort-selector` task 1.5 — not yet planned or
  implemented.
