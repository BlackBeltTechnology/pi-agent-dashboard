# pending-resume-registry.ts — index

Tracks pending auto-resume operations: prompts queued for ended sessions being resumed. Per-cwd keyed; entries expire after 30s. Exports `createPendingResumeRegistry`, `PendingResumeRegistry` (`record`/`consume`/`dispose`), `PendingResumeEntry` (`text`, `images?`, `oldSessionId`, `sessionFile`), `PendingResumeRegistryOptions` (`onTimeout`).
