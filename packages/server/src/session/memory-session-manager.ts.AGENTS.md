# memory-session-manager.ts — index

Pure in-memory session registry; replaces SQLite-backed session-manager. Exports `RegisterSessionParams`, `OnChangeContext`, `SessionManager`, `createMemorySessionManager`. `register` carries over accumulated tokens/cost/context on reattach, auto-hides headless non-dashboard workers, resets `pendingQueues`. Hooks `onChange` (with `registerReason`/`priorStatus`), `onUnregister` — the transport-independent death signal fanned to plugin `onSessionEnded`. See change: finalize-automation-run-on-session-death.
