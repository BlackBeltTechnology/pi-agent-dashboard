# pending-prompt-emitter.ts — index

ONE emitter for re-sending every PromptBus prompt still awaiting an answer — shared by `onReconnect` replay (no token) and the `prompt_resync_request` handler (echoes `__resyncRequestId` on every frame). `emitPendingPrompts(bus, send, sessionId, token?)` → count; empty pending set → zero frames, no error. See change: fix-pending-prompt-lost-on-replay (D6/D7).
