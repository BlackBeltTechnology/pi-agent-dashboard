# replay-persist.ts — index

Debounced replay-cache writer. createReplayPersister(cache,debounceMs). Owns per-session raw-event buffer (monotonic by seq, dedup append). record/seed/drop/flush. drop clears buffer + deletes cache entry. See change: reduce-session-replay-traffic.
