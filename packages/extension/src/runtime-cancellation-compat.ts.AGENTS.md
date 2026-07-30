# runtime-cancellation-compat.ts — index

Dashboard-owned pi runtime compatibility adapter. `installRuntimeCancellationCompat(AgentSession, options?)` idempotently wraps exported `AgentSession.bindExtensions`: TUI abort calls public `abortRetry()` before the original handler; active tools wrap before `prompt()`/`continue()` and detach only after abort plus `TOOL_ABORT_GRACE_MS`, suppressing late updates/rejections. Never modifies installed pi files. Exports `TOOL_ABORT_GRACE_MS`, `RuntimeCancellationCompatOptions`. See change: fix-terminal-session-cancellation-boundaries.
