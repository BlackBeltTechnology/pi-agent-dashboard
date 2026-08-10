# replay-cache.ts — index

Durable per-session replay cache. IndexedDB. createReplayCache({factory,maxEntries,maxBytesPerSession,schemaVersion}). Entry {sessionId,schemaVersion,maxSeq,payload:CachedEvent[],lastAccess}. get purges schemaVersion mismatch. put enforces per-session byte cap + LRU evict by monotonic lastAccess stamp (Date.now ties bumped +1 for strict order). Singleton replayCache. Strategy A: reload delta-subscribes lastSeq=maxSeq. Miss/error → full replay. See change: reduce-session-replay-traffic.
