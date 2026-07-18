# message-queue.ts — index

Offline outgoing message queue. Exports `MessageQueue` class — `setSendFunction`, `enqueue` (caps at 10, drops oldest), `flush` (drains on reconnect), `size`, `clear`. Buffers `BrowserToServerMessage` while disconnected.
