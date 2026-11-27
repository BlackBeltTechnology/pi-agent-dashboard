# modes.ts — index

`createModeRegistry(sessionDriver)`: `mode → {driver, available?(callerSessionId?)}`, `session` registered, `resolve()` → `mode_unavailable` reasons. `in-process` is registered from `modes-inproc.ts` (opt-in `RuntimeOptions.inProcess`). See change: add-agent-teams-in-process.
