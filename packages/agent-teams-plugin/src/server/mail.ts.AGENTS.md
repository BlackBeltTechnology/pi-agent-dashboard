# mail.ts — index

`createMailEngine`: `flush` (emit unacked, not-yet-handed-over mail via the driver, grouped by wake; recipient must be connected: lead active+connected, member idle/busy/shutdown_pending), provisional `busy` after a waking mail with `wakeConfirmMs` revert (+ `suspect` flag), `noteHello`/`unhand` re-emit, idempotent `ack`, urgent hold (`holdUrgent`/`releaseOnSettle`, `urgentSettleWaitMs`), `forget`. Logs ids/sizes only. In-process member (no `sessionId`, has `childId`) is a valid delivery target; session members unchanged.
