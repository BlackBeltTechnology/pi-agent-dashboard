# transcript-backfill.ts — index

`readTranscriptChunk(file, cursor, {maxBytes})` + `makeCursor()` — bounded resumable `.jsonl` reads for D12's lazy backfill. Cursor carries a length+hash witness for the last line, so a rewritten prefix or truncation RESTARTS instead of resuming into misaligned bytes; a partial trailing line is never emitted nor counted complete (#X18); oversized lines overshoot the budget rather than stall. See change: add-pi-gateway-transport-identity (tasks 11.5/11.6).
