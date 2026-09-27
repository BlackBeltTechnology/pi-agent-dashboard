# __tests__/state-replay.test.ts — index

L1 for the persisted `compaction` → `session_compact` replay arm (change: replay-compaction-boundary, E1–E7 + X1): boundary index/timestamp between neighbours, no-compaction golden sequence, 0/1/2/3 multiplicity, first/last position, no fabricated `reason`/`willRetry`/`estimatedPostCompactionTokens`, 64 KB `summary` never emitted, schema drift, malformed entry does not abort.
