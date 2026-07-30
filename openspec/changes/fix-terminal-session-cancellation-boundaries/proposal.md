# Fix terminal session cancellation boundaries

## Why

Dashboard Stop reaches pi, but terminal sessions can remain blocked during provider retry backoff or a non-cooperative tool because the active abort path does not cancel every awaited operation. Force Stop is also unreliable for terminal-origin sessions because the bridge declares a PID field but does not register `process.pid`, leaving the server unable to identify the process tree.

## What Changes

- Make terminal-session Stop cancel both the active agent run and any provider auto-retry wait instead of taking effect only when the next retry starts.
- Register the pi process PID on every bridge registration and reconnect so Force Stop can terminate terminal-origin sessions without command-line marker discovery.
- Preserve the bridge control channel until the server resolves a verified kill target; return explicit failure without pretending the session stopped.
- Add a bounded cancellation contract for nested `Agent`, `doubt`, MCP, and other tool executions so an aborted child cannot keep its parent turn awaiting forever.
- Add a dashboard-owned runtime compatibility layer around public pi session/agent APIs; do not fork or patch installed pi source files.
- Define the hard-isolation boundary: cooperative in-process children get bounded abort; children requiring guaranteed independent termination run behind a process boundary.
- Replace misleading per-tool Stop copy and behavior until a real `toolCallId` cancellation protocol exists; distinguish turn abort, process kill, and background PGID kill.
- Keep live turn-cancellation controls directly reachable when static session details are collapsed.
- Add regression coverage for retry backoff abort, terminal PID registration, PID reuse protection, unresolved tool promises, nested-agent abort, late tool completion, and Stop-to-Force-Stop state transitions.
- Leave `fix-stuck-session-stop-escalation` unchanged; this change supersedes its incomplete diagnosis but may reuse already-landed tree-kill primitives.

## Capabilities

### New Capabilities

- `session-cancellation-boundary`: Defines immediate turn cancellation across active provider streams, provider retry waits, cooperative tools, bridge reconnects, and verified process-level escalation.
- `nested-agent-cancellation`: Defines bounded parent-child cancellation for `Agent`, `doubt`, MCP-backed, and other nested tool executions, including the process-isolation requirement for independently killable children.

### Modified Capabilities

- `play-stop-controls`: Make Stop state reflect acknowledged turn cancellation and expose Force Stop only as process-level escalation with explicit success or failure.
- `session-activity-bar`: Remove the false claim that the current session-level abort stops only one tool and lets the agent continue.

## Impact

- Bridge and protocol: `packages/extension/src/bridge.ts`, `packages/extension/src/command-handler.ts`, `packages/shared/src/protocol.ts`.
- Server process control: `packages/server/src/browser-handlers/session-action-handler.ts`, session PID persistence, process-tree verification.
- Client controls: composer Stop state, tool cards, `SessionActivityBar`, force-kill result handling.
- Runtime compatibility: `packages/extension` wraps `AgentSession.bindExtensions` so TUI abort also cancels retry backoff, and wraps active tool execution so an aborted signal-ignoring Promise detaches after a bounded grace period. The adapter uses exported pi classes and mutates no installed package files.
- Nested tools: dashboard-owned `Agent` and `doubt` adapters run child sessions behind worker processes. Existing third-party tool packages remain inputs/reference implementations, not modified dependencies.
- Tests: extension, server, client, protocol, provider-retry, tool cancellation, and POSIX/Windows process-control suites.

## Discipline Skills

`systematic-debugging`, `node-inspect-debugger`, `doubt-driven-review`, `review-code`
