# spawn-new-session.ts — index

`buildSpawnNewSessionMessage(sessionId, cwd, readBc)` → `spawn_new_session` frame + current `model` (`getCurrentModelString`) / `thinkingLevel` (`pi.getThinkingLevel`). Unknown model → no keys; any throw → plain frame. Used by `bridge.ts spawnNew`. See change: add-spawn-model-choice.
