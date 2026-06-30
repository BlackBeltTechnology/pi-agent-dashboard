## MODIFIED Requirements

### Requirement: Bridge persistent-abort scheduler closes retry race

On receipt of `abort`, after invoking the full bridge wrapper-abort once synchronously (which calls `cachedCtx.abort()` and resets shadow queues — see `mid-turn-prompt-queue`), the bridge SHALL ensure pi's in-flight retry is stopped even when the provider backoff is longer than the persistent-abort window. The bridge SHALL combine two mechanisms:

1. **Persistent-abort scheduler (fast path).** The bridge SHALL schedule raw `cachedCtx.abort()` calls at 200 ms intervals for up to 2 seconds, stopping on ANY of: `cachedCtx.isIdle?.()` returns `true`; `isAgentStreaming` transitions from `true` (at start) to `false` (`agent_end` processed); or 2 seconds elapsed. The scheduled tick SHALL invoke `cachedCtx.abort()` directly (via the `rawAbort` option), NOT the full wrapper, so the wrapper's recurring side-effects do not clobber a user prompt that lands within the window.

2. **Abort latch (covers long backoff).** The bridge SHALL set a per-session `abortRequested` latch when the abort command is received. Whenever pi re-enters its retry continuation after a backoff sleep (i.e. the bridge observes the agent attempting to continue the same aborted turn — a fresh `agent_start`/`message_start` for a turn that has NOT seen an intervening user prompt), the bridge SHALL call `cachedCtx.abort()` again to honor the latch. The latch SHALL be cleared when the aborted turn settles (`agent_end` / `isIdle`) OR when a new user prompt is sent for the session. This closes the gap where a 5–60 s provider backoff outlives the 2 s scheduler and pi resumes the retry with a fresh `_retryAbortController` that never saw the abort signal.

The scheduler and latch SHALL both cancel/clear if the bridge is unloaded or a new session takes over.

#### Scenario: Persistent abort fires repeatedly until agent is idle, using rawAbort
- **GIVEN** the bridge receives `abort` while the agent is mid-retry
- **AND** `cachedCtx.isIdle()` returns false initially AND `isAgentStreaming` is `true` at scheduler start
- **THEN** the bridge SHALL call `cachedCtx.abort()` again at ~200 ms intervals
- **AND** the bridge SHALL NOT re-run the wrapper's queue-clearing logic on each tick
- **AND** SHALL stop once `isIdle()` returns true OR `isAgentStreaming` flips to false OR after 2 s elapsed

#### Scenario: Abort latch stops a retry that wakes after the 2 s scheduler window
- **GIVEN** the bridge received `abort` while pi was sleeping on a 30 s provider backoff
- **AND** the persistent-abort scheduler has already stopped after 2 s
- **AND** the `abortRequested` latch is set for the session
- **WHEN** pi wakes from backoff and attempts to continue the same aborted turn (no intervening user prompt)
- **THEN** the bridge SHALL call `cachedCtx.abort()` again to honor the latch
- **AND** pi SHALL NOT proceed with the retry continuation

#### Scenario: Latch cleared by a new user prompt does not kill the new turn
- **GIVEN** the `abortRequested` latch is set
- **WHEN** the user sends a NEW prompt for the session
- **THEN** the latch SHALL be cleared
- **AND** the new prompt's resulting `agent_start` SHALL NOT be aborted by the latch

#### Scenario: Latch cleared on settle
- **GIVEN** the `abortRequested` latch is set
- **WHEN** the aborted turn settles (`agent_end` fired OR `cachedCtx.isIdle()` returns true)
- **THEN** the latch SHALL be cleared
- **AND** no further latch-driven `cachedCtx.abort()` calls SHALL be made

#### Scenario: Persistent abort stops on streaming-false transition
- **GIVEN** the bridge has begun the persistent-abort schedule with `isAgentStreaming === true` at start
- **WHEN** `agent_end` arrives and the bridge flips `isAgentStreaming` to `false`
- **THEN** the next scheduler tick SHALL observe the transition AND clear the interval
- **AND** no further scheduler-driven `cachedCtx.abort()` calls SHALL be made
