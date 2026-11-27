# persistence.ts — index

`TeamPersistence`: per-team JSON (`teams/<id>.json`, temp+rename, 100 ms coalescing, write-through, `flushSync`), append-only `<id>.mail.jsonl` (ack tombstones, `selectCompaction` keeps unacked + newest until ≤50 % cap), load with quarantine (`.corrupt`/`.future`), closed-team pruning, `degraded` flag, injectable `PersistFs`.
