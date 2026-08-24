# retry-tracker.ts — index

Pure `RetryTracker` observes pi events and synthesizes `auto_retry_start` / `auto_retry_waiting` / `auto_retry_end`; no transcript JSON and no provider-error regex. Pi ExtensionAPI hides native retry events from extensions.

State model: assistant `message_end(error)` opens/refreshes chain. Error `agent_end` advances attempt, arms next `agent_start`, emits waiting while within configured budget. Armed `agent_start` emits in-flight start. First assistant completion whose stop is neither `error` nor `aborted` closes immediately with success, including pi-owned continuation with no user message. `agent_settled` closes unresolved native chains with retained disposition/error. Missing assistant disposition never implies success.

Abort installs per-session cancellation tombstone before pi abort runs. Delayed start/message/end/settle events cannot reopen chain. Observed user `message_start` calls `noteExplicitRun`, clearing cancelled or stale floor chain. `isAwaitingRetry(sessionId,attempt)` supports floor-pi deadline reconciliation; matching start, newer attempt, abort, or explicit run makes old fallback no-op.

Settings injected read-only: `{enabled,maxRetries,baseDelayMs}`. Delay = `baseDelayMs * 2^(attempt-1)`; unknown, non-positive, or overflowing/non-finite values yield 0. Exports `RetryTracker`, `SyntheticRetryEvent`, `ObservedAssistantMessage`, `RetrySettings`. API: `observeAgentStart`, `observeMessageEnd`, `observeAgentEnd`, `observeAgentSettled`, `noteAbort`, `noteExplicitRun`, `isRetrying`, `isAwaitingRetry`. See changes: retry-forever-with-stop-control, fix-retry-error-lifecycle.
