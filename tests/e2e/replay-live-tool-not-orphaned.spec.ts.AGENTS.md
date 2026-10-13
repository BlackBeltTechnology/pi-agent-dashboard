# replay-live-tool-not-orphaned.spec.ts — index

L3 #F8: `POST /api/restart` while `faux:session-death-open-tool` `sleep 120` runs; replayed tool burst stays `data-running=true`, no `1 failed`/`parent session ended`, no `session_ended` heal frame; real end finalizes it. See change: fix-replay-fabricates-orphan-end-for-live-calls.
