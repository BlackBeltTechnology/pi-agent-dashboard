# pending-prompt-recovery.spec.ts — index

L3 for fix-pending-prompt-lost-on-replay (F1–F7, X5): refresh/replay/resync recovery of an unanswered `ask_user` dialog. Helpers: `parkOnAsk`, `dropPromptFrames`, `stallAndRecord`, `restartDashboardStable`, `forceKillSession`.

Adds `pending-question stack — restart durability` describe, X5 (add-pending-question-stack): park `ask-select-brief` (≥240-char `message` → brief `provided`); `restartDashboardStable`; assert same question id re-listed via `GET /api/questions`, same `brief`/`briefLabel`/`briefStatus` via `GET /api/questions/:id`, `/api/health#questions.briefs` outcome counters 0 on the new process.
Limitation: no model-call counter survives a restart (in-memory) — "unchanged" = 0 outcomes after restart + identical stored brief. Strict 0-extra-calls proof is L1 (X1/E23).
See change: add-pending-question-stack.
