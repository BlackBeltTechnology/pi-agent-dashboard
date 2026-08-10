# pending-initial-prompt-registry.ts — index

In-memory FIFO queue of pending initial-prompt intents per cwd. Browser `spawn_session` enqueues `initialPrompt`; `session_register` consumes head → dispatches first `send_prompt` (e.g. `/skill:project-init` from the no-hook Initialize button). Exports `createPendingInitialPromptRegistry`, `PendingInitialPromptRegistry`, `PENDING_INITIAL_PROMPT_TTL_MS` (60s), `PENDING_INITIAL_PROMPT_QUEUE_CAP` (8). Cwd-normalized via `safeRealpathSync`. Sibling to `pending-attach-registry.ts`. See change: project-init-skill-and-profiles.
