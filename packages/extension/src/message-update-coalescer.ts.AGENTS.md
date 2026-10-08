# message-update-coalescer.ts — index

Bridge-side coalescer for streaming text snapshots. Exports `COALESCE_WINDOW_MS` (50), class `MessageUpdateCoalescer<M>` (single slot, last wins, FIXED window; `text_*` parks, every other/unknown sub-event flushes then forwards; closed-identity-only drop, fail-open lazy open), `flushesParkedText`, `isTextSubEvent`. See change: coalesce-bridge-message-update-snapshots. → see `message-update-coalescer.ts.AGENTS.md`
