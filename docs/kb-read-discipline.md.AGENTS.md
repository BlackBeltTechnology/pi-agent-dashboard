# kb-read-discipline.md — index

Trust verdicts on `kb_search` agents hits (FRESH/STALE/MOVED/GONE/UNVERIFIED, cap 8, ack sidecar v2) + search guard arm B (fire 3, off/warn/block, KB_GUARD_MODE, kb_guard_pause). Code: verdict.ts, guard.ts. File-read segments (cat/head/tail/sed/less/more/bat on kb-indexed files) count; per-cwd `indexedPathPredicate`. See change: fix-kb-get-roots-and-guard.
