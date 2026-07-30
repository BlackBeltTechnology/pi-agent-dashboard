## Context

Dashboard cancellation crosses client, server, bridge, pi TUI, pi agent session, provider, tool, and child-process boundaries. Current Stop reaches `cachedCtx.abort()`, but the TUI override calls only `agent.abort()`. Provider retry backoff uses `AgentSession._retryAbortController` after the active agent run has ended, so Stop becomes a no-op until the retry starts another run and the bridge abort latch fires again.

Force Stop already uses a verified process-tree kill. Its target resolution remains unreliable for terminal-origin sessions: `SessionRegisterMessage` declares `pid`, but the bridge omits `process.pid`. Command-line marker discovery covers dashboard-spawned processes, not ordinary terminal `pi` commands.

Tool execution remains cooperative. Agent-core directly awaits `tool.execute(...)`; a tool that ignores its signal keeps the turn pending. `Agent` and `doubt` forward abort into an in-process child session but await that child without a deadline, placing parent and child in one failure domain. `AbortWatchdog` exists but is not connected to the bridge and can kill only tracked OS process groups.

The installed pi runtime exports `AgentSession`, and `AgentSession.bindExtensions(...)` receives the TUI-specific `abortHandler`. The dashboard extension loads before that binding occurs. This gives the dashboard a narrow compatibility seam: wrap the binding once, call the public `abortRetry()` before the original TUI handler, and leave pi package files untouched. The same session exposes its active `Agent`; wrapping active tools immediately before `prompt()`/`continue()` gives the dashboard a bounded asynchronous settlement boundary without changing agent-core source.

This change stays inside the dashboard monorepo. It SHALL NOT fork pi, rewrite `node_modules`, or require coordinated pi runtime publication.

## Goals / Non-Goals

**Goals:**

- Make Stop cancel active provider work and provider retry backoff without waiting for another agent step.
- Make Force Stop reliable for terminal-origin sessions through registered process identity and verified tree termination.
- Bound parent wait time after aborting a non-cooperative tool or nested agent.
- Give `Agent` and `doubt` an independently terminable child boundary without terminating the parent pi process.
- Keep abort completion, force-kill success, and force-kill failure observable and honest in the client.
- Preserve existing process-tree and PID-reuse safeguards.

**Non-Goals:**

- Add arbitrary remote process administration.
- Infer terminal process identity from cwd, process name, or broad `pgrep` matches.
- Claim JavaScript can preempt synchronous code inside the same event loop.
- Add true per-tool continuation before pi exposes a tool-call cancellation protocol and agent-loop continuation contract.
- Treat network silence alone as proof that an LLM request is stuck.

## Decisions

### D1. Install a dashboard-owned session abort compatibility adapter

At extension activation, the dashboard SHALL idempotently wrap exported `AgentSession.bindExtensions(...)`. When pi supplies a TUI `abortHandler`, the wrapper SHALL call public `AgentSession.abortRetry()` before delegating to the original handler. Active provider/tool cancellation remains owned by the original handler. Modes without a custom handler retain pi's native `AgentSession.abort()` path.

The adapter SHALL use a global symbol marker, preserve `this`, arguments, return values, and errors, and tolerate future runtimes that already cancel retry (double `abortRetry()` is idempotent). It SHALL never modify installed pi files. A conformance test against the installed runtime export SHALL prove retry sleep ends without another provider request.

Alternative: fork or patch `@earendil-works/pi-coding-agent`. Rejected because the exported session binding provides the required narrow seam. Alternative: extend the bridge retry loop. Rejected because repeated `ctx.abort()` calls enter the same TUI handler and cannot reach retry sleep until it wakes.

### D2. Register PID as authoritative bridge process identity

Every `session_register` SHALL carry `pid: process.pid`, including reconnect and in-process session switches. The server SHALL refresh the session PID from each owning bridge registration. Marker discovery remains a compatibility fallback for older dashboard-spawned sessions only.

Force Stop SHALL resolve and validate the target before closing the bridge connection. A live PID must still look like a pi process before signaling. The existing descendant process-group kill, Windows `taskkill /F /T`, liveness verification, and honest failure result remain authoritative.

Alternative: discover terminal pi with `pgrep`, cwd, or command matching. Rejected because multiple sessions can share cwd and executable name; a false positive would kill an unrelated session.

### D3. Model cancellation as three distinct operations

- `abort`: cancel the current turn, active provider request, retry wait, and cooperative tools.
- `kill_process`: terminate one tracked background PGID.
- `force_kill`: terminate the owning pi process tree and end the session only after verified death.

The activity bar SHALL describe its current fallback as stopping the turn. It SHALL NOT claim that the agent continues after one tool stops. A future `abort_tool { toolCallId }` requires a separate protocol and continuation design.

Live activity and its cancellation control SHALL remain outside a default-collapsed static-details region, or the region SHALL automatically expose the control while work is active. Static information may collapse; an active safety control may not require an extra disclosure action.

Alternative: keep one generic Stop label. Rejected because the current controls already invoke materially different failure domains.

### D4. Wrap active tool Promises at the dashboard runtime boundary

The compatibility adapter SHALL wrap each active tool immediately before the session agent enters `prompt()` or `continue()`. The wrapper SHALL pass the original signal and update callback unchanged during normal execution. After abort it SHALL allow a short cleanup grace period, then reject the wrapped execution as aborted if the original Promise remains pending. The original Promise SHALL retain fulfillment and rejection handlers, and the wrapper SHALL suppress late progress/results after detachment.

Wrapping occurs per tool-definition identity and is idempotent. Tool activation changes between turns are picked up before the next run. No normal wall-clock timeout is introduced; the grace timer starts only after `AbortSignal` aborts.

The bound releases the parent await; it does not claim to terminate arbitrary in-process code. Synchronous event-loop blocking remains recoverable only through process-level Force Stop.

Alternative: unbounded cooperative wait. Rejected because one signal-ignoring tool can permanently wedge the session. Alternative: immediate Promise race with no grace. Rejected because cooperative tools need time to close subprocesses, streams, and temporary resources.

### D5. Own process-isolated `Agent` and `doubt` adapters in dashboard packages

Foreground `Agent` and `doubt` executions SHALL retain synchronous tool semantics from the parent's perspective, but dashboard-owned adapters SHALL run child inference and child tools in separately identifiable worker processes. The dashboard distribution SHALL register these adapters after third-party tools so the local definitions are authoritative without editing the installed packages. Parent abort first requests cooperative child-session abort. If the child does not exit within its grace period, the tool supervisor terminates only that child process tree and returns an aborted tool result to the parent.

Subagent events SHALL retain parent session ID, agent ID, and run ID correlation. Events arriving after terminal child settlement SHALL be discarded. Parent process termination remains the final fallback only when the parent event loop itself is blocked.

The worker entry SHALL use exported pi SDK factories and dashboard-owned agent/auditor prompt resolution. It SHALL not import private files from the published subagent/auditor packages. Existing packages remain compatibility fallbacks when the local adapters are disabled or unavailable.

Alternative: wrap the existing in-process child Promise only. Rejected because the child would continue consuming quota and resources inside the parent failure domain. Alternative: import non-exported files from installed tool packages. Rejected because package layout is not an API. Alternative: kill the parent pi process for every stuck child. Rejected because child failure must not destroy the parent session.

### D6. Arm the bridge watchdog only for explicit user abort

The existing `AbortWatchdog` SHALL be wired to explicit dashboard abort acknowledgements. It snapshots tracked child PGIDs, sends SIGTERM after the configured delay, and escalates surviving groups to SIGKILL. It SHALL disarm when the turn settles and SHALL never arm for ordinary provider errors or inactivity.

This watchdog complements D4 and D5. It cannot cancel an in-process Promise or provider request and SHALL not be presented as general cancellation.

### D7. Acknowledge outcomes instead of inferring success from button clicks

Stop SHALL enter an aborting state until the session reports quiescence or the grace period exposes Force Stop. Force Stop SHALL enter killing state until `force_kill_result` arrives. A failed result SHALL restore an actionable Force Stop state and display the server reason; it SHALL not stamp the session ended.

## Risks / Trade-offs

- [Runtime prototype compatibility] → Patch only exported `AgentSession.bindExtensions`, mark the wrapper idempotently, preserve the original contract, and run conformance tests against the installed floor and current pi versions.
- [Late tool Promise keeps resources alive] → Ignore late output, attach rejection handling, log the detached operation, and use process isolation for supported nested agents.
- [PID reuse could target another process] → Keep pi-command validation and verify liveness before and after kill; never use cwd-only discovery.
- [Process-isolated subagents change startup cost] → Spawn only `Agent` and `doubt` workers on demand; do not add a pool until measurements prove repeated spawn cost is material.
- [Third-party tool name collision] → Register local adapters last, assert the active definition source in tests, and fail closed to the existing tool rather than loading private package internals.
- [Watchdog can kill user background work] → Arm only after explicit Stop and only for PGIDs captured as descendants of that session.
- [Mixed-version bridges omit PID] → Retain marker fallback for dashboard-spawned sessions and return explicit `not_found` for unsafe targets.
- [Windows process semantics differ] → Preserve `taskkill /F /T`; keep POSIX PGID behavior behind platform-specific tests.

## Migration Plan

1. Add conformance tests for the installed pi session binding and tool execution lifecycle.
2. Install the idempotent session-abort and bounded-tool compatibility adapter from the dashboard extension.
3. Keep the completed bridge PID, verified Force Stop, watchdog, and honest UI changes.
4. Add dashboard-owned process workers and local `Agent`/`doubt` adapters; assert local tool-source precedence.
5. Run unit, integration, local dashboard E2E, POSIX process-tree, and injected Windows `taskkill` coverage.

Rollback disables the compatibility adapter and local nested-tool adapters while retaining PID registration, because adding PID is backward compatible. No external package rollback is required.

## Open Questions

- Select the shortest cleanup grace from measured cooperative tool shutdowns; tests SHALL use injected timers rather than wall-clock sleeps.
- Confirm local `Agent`/`doubt` registration order across npm-only, dashboard-local, and packaged Electron installs before enabling the override by default.
