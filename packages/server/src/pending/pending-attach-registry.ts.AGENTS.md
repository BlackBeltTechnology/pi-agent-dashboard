# pending-attach-registry.ts — index

In-memory FIFO queue of pending `attachProposal` intents per cwd. Exports `PendingAttachRegistry`, `createPendingAttachRegistry`, `PENDING_ATTACH_TTL_MS` (60s), `PENDING_ATTACH_QUEUE_CAP` (8). `enqueue`/`consume`/`size`; cwd normalized via `safeRealpathSync`; stale entries dropped on read/write; silent drop + warn on overflow. Not persisted.
