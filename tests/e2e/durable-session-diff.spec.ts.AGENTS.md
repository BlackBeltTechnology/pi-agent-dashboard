# durable-session-diff.spec.ts — index

L3 (change: fix-session-diff-durable-source, #F1): after `POST /api/restart` the RAM event store is empty, yet the Diff panel must list the Writes from the durable transcript. Drives `[[faux:tool-write-pair]]`.
