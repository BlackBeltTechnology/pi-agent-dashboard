# usePendingPromptTimeout.ts — index

Calls `onTimeout` after 30s if `hasPendingPrompt` stays true and `paused` is false. Timer restarts when `paused` flips false→true→false (resume after queue drain). `onTimeout` kept in ref. Callers arm it on `pendingPrompt.status === "sending"` (never `!!pendingPrompt`), so a settled `failed` bubble never re-arms the timer and is never wiped. See change: fix-optimistic-prompt-stuck-sending.
