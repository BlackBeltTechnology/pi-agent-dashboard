# runtime-switch-ownership.ts — index

Leaf module: PID-scoped exit ownership during a switch. `expectExit`, `claimCandidate`, `releaseRuntimeSwitchOwnership`, `takeExitOwnership(pid)` → `candidate\|planned\|watchdog` (consumes planned). Global graceful flag untouched (X8). See change: electron-runtime-overlay-updates. `releaseCandidate(pid)` at commit: committed runtime's exit goes to watchdog before switch `finally` (X8).
