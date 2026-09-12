# compaction-boundary-replay.spec.ts — index

L3 for change replay-compaction-boundary (F1/F2). Real `/compact` (canned `session_before_compact` + harness-seeded low `keepRecentTokens`) persists a `compaction` entry; the `/reload` bridge replay rebuilds exactly ONE divider between the messages around it, and repeated reconnect replays never duplicate or drop it. Disk cold load is unreachable here (container respawn wipes the tmpfs session file) and is gated at L2 by `session-load-worker.test.ts`. → see `compaction-boundary-replay.spec.ts.AGENTS.md`
