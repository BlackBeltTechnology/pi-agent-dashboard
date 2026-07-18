# pending-resume-intent-registry.ts — index

In-memory tracker tagging user-initiated session-resume intents as `ResumeIntent` `"front"` | `"keep"`. `server.ts` ended→alive branch consumes: `front`→moveToFront+broadcast, `keep`→no-op, `null`→bridge reattach (leave order). Drag-to-resume tags `"keep"`; button/REST/auto-resume tag `"front"`. Exports `createPendingResumeIntentRegistry`, `PendingResumeIntentRegistry`, `PENDING_RESUME_INTENT_TTL_MS` (60s). Stale entries dropped on read. See changes: preserve-session-order-on-reboot, differentiate-resume-intent-by-trigger.
