## 1. Serialize the message pump

- [ ] 1.1 Chain `onMessage` dispatch in `packages/extension/src/connection.ts` behind a promise queue so each handler runs to completion before the next inbound message is dispatched, preserving wire order.
- [ ] 1.2 Verify back-pressure: a slow handler must not drop or reorder subsequent messages, and must not unbounded-buffer beyond the existing `maxBufferSize` policy.

## 2. Tests

- [ ] 2.1 Add a test proving a `set_model` immediately followed by a `send_prompt` submits the prompt on the NEW model (the race the `openspec-dialog-model-effort-selector` spike found).
- [ ] 2.2 Add a test proving ordering holds for a burst of mixed message types.

## 3. Reconcile

- [ ] 3.1 Confirm the client-side confirm-before-send gate in `openspec-dialog-model-effort-selector` remains correct as belt-and-suspenders (do not remove it in this change).
