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
- Define an **explicit inbound back-pressure bound** (separate from the outgoing
  `maxBufferSize`) so a slow handler cannot grow the queue without limit.
- Define **failure isolation**: a throwing/rejecting handler is logged and the
  pump continues with the next message, never stalling the queue.
- Once landed, the client-side gate in `openspec-dialog-model-effort-selector`
  becomes a redundant belt-and-suspenders (kept, not removed, in that change).

## Impact

- Affected: `packages/extension/src/connection.ts` (message pump hot path).
- Risk: touches every inbound message; needs ordering + back-pressure tests
  before landing. This proposal is the **placeholder/follow-up filing** required
  by `openspec-dialog-model-effort-selector` task 1.5 — not yet planned or
  implemented.
