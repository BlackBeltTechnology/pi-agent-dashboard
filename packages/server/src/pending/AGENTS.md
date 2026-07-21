# DOX — packages/server/src/pending

Files in this directory. One row per source file. See change: fold-oversized-agents-directories.

| File | Purpose |
|------|---------|
| `pending-attach-registry.ts` | In-memory FIFO queue of pending `attachProposal` intents per cwd. → see `pending-attach-registry.ts.AGENTS.md` |
| `pending-automation-run-registry.ts` | FIFO-per-cwd registry of automation-run stamps {name,runId,visibility}. → see `pending-automation-run-registry.ts.AGENTS.md` |
| `pending-client-correlations.ts` | Maps server-minted `spawnToken` → client-minted `requestId`. → see `pending-client-correlations.ts.AGENTS.md` |
| `pending-fork-registry.ts` | Tracks pending fork operations keyed by `spawnToken` to place forked sessions after parent. → see `pending-fork-registry.ts.AGENTS.md` |
| `pending-goal-link-registry.ts` | In-memory FIFO queue of pending `goalId` link intents per cwd. → see `pending-goal-link-registry.ts.AGENTS.md` |
| `pending-initial-prompt-registry.ts` | In-memory FIFO queue of pending initial-prompt intents per cwd. → see `pending-initial-prompt-registry.ts.AGENTS.md` |
| `pending-load-manager.ts` | Tracks in-flight on-demand session-load requests from bridge extensions. → see `pending-load-manager.ts.AGENTS.md` |
| `pending-resume-intent-registry.ts` | In-memory tracker tagging user-initiated session-resume intents as `ResumeIntent` `"front"` | `"keep"`. → see `pending-resume-intent-registry.ts.AGENTS.md` |
| `pending-resume-registry.ts` | Tracks pending auto-resume operations: prompts queued for ended sessions being resumed. → see `pending-resume-registry.ts.AGENTS.md` |
| `pending-worktree-base-registry.ts` | In-memory FIFO queue of pending `gitWorktreeBase` intents per cwd. → see `pending-worktree-base-registry.ts.AGENTS.md` |
