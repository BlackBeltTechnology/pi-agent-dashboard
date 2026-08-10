# rehydrate-session.ts — index

rehydrateSession(sessionId,cache). Cache hit → re-reduce raw payload via reduceEvent into provisional SessionState; returns {lastSeq:maxSeq,state,events}. Miss → null. Per-entry re-reduce fault-isolated: any throw discards the poisoned cache entry and returns a miss so the caller degrades to full replay (no app crash). See change: reduce-session-replay-traffic. See change: fix-reducer-crash-undefined-toolname.
