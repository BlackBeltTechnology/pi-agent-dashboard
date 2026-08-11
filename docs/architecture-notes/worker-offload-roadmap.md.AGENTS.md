# architecture-notes/worker-offload-roadmap.md — index

Worker offload roadmap. Main-loop CPU + sync-fs work → worker_threads. Proven pattern `offload-openspec-poll-to-worker` (fixed pool, FIFO, in-process fallback). Candidates: `scanAllSessions`, `loadSessionEvents`, `scanPiResources`. 4-change sequence. Rule of three before generic pool extraction.
