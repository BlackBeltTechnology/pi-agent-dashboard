## 1. Runtime cancellation contract

- [x] 1.1 Add a failing conformance test against exported `AgentSession.bindExtensions` that starts provider retry backoff, invokes the wrapped terminal abort handler, and asserts no later provider request starts.
- [x] 1.2 Add an idempotent dashboard runtime adapter that wraps `AgentSession.bindExtensions`, calls public `abortRetry()` before the original TUI abort handler, preserves non-TUI behavior, and never modifies installed pi files.
- [x] 1.3 Add a failing compatibility-adapter test whose tool ignores `AbortSignal` and whose parent turn must settle after an injected cleanup grace period.
- [x] 1.4 Wrap active session tools before `prompt()`/`continue()` with bounded post-abort settlement, late rejection handling, and late update suppression; keep normal tool duration unbounded.
- [x] 1.5 Verify active stream abort delegation, retry-backoff abort, cooperative tool abort, non-cooperative tool abort, and a subsequent prompt in one compatibility-adapter suite without network calls.

## 2. Terminal process identity

- [x] 2.1 Add failing protocol and bridge tests that require `session_register.pid === process.pid` on initial registration, reconnect, and in-process session switch.
- [x] 2.2 Add `pid` to every bridge registration and update the nearest source-tree `AGENTS.md` row.
- [x] 2.3 Add failing server tests that replace a stored session PID when the owning bridge reconnects from a new process.
- [x] 2.4 Persist the latest registered bridge PID in the in-memory session and broadcast state without changing older bridge compatibility.

## 3. Verified Force Stop

- [x] 3.1 Add failing tests for terminal PID success, no-safe-target failure, reused-PID refusal, surviving-target failure, and bridge preservation when target resolution fails.
- [x] 3.2 Reorder Force Stop to resolve and validate the target before closing the bridge, then reuse the existing process-tree kill and liveness verification.
- [x] 3.3 Keep command-line marker discovery only as an older dashboard-spawned-session fallback; never discover terminal sessions by cwd or broad process-name matching.
- [x] 3.4 Verify POSIX descendant process-group termination and Windows `taskkill /F /T` behavior with platform-specific tests.

## 4. Explicit-abort child watchdog

- [x] 4.1 Add failing bridge integration tests proving explicit Stop arms `AbortWatchdog`, turn settlement disarms it, and provider failure without user Stop does not arm it.
- [x] 4.2 Wire the existing watchdog to explicit dashboard abort and turn-settlement events using only PGIDs captured for the target session.
- [x] 4.3 Verify SIGTERM-to-SIGKILL escalation, dead-group handling, reconnect cleanup, and no signal after disarm.

## 5. Nested Agent and doubt isolation

- [x] 5.1 Add failing subagent supervisor tests for cooperative child abort, child tool ignoring cancellation, child event-loop blockage, concurrent run correlation, and late-event suppression.
- [x] 5.2 Add dashboard-owned foreground `Agent` and `doubt` adapters backed by separately identifiable worker processes while preserving parent session ID, agent ID, run ID, model, cwd, and event streaming; use exported pi SDK APIs only.
- [x] 5.3 Implement cooperative child-session abort followed by child-only process-tree termination after the injected grace period.
- [x] 5.4 Ensure child settlement publishes exactly one cooperative-cancel or forced-termination result and leaves the parent session able to accept another prompt.
- [x] 5.5 Register local adapters after third-party tool packages, assert active source precedence across terminal/Electron installs, and verify parent Force Stop also removes active child workers without external package publication or pins.

## 6. Honest Stop controls

- [x] 6.1 Add failing client tests for aborting, grace-expired Force Stop, killing, verified success, explicit failure, retry-state Stop visibility, and direct Stop reachability while static session details are collapsed.
- [x] 6.2 Make composer and tool-card Stop states depend on session and `force_kill_result` acknowledgements rather than click-only assumptions.
- [x] 6.3 Replace the activity-bar `Stop this tool (lets the agent continue)` copy with current-turn cancellation copy, keep PGID kill visually distinct, and keep live activity controls outside the default-collapsed static-details region.
- [ ] 6.4 Add a Playwright scenario that aborts a synthetic retrying terminal session, exercises failed then successful Force Stop, and verifies the UI never reports a failed kill as ended.

## 7. Validation and rollout

- [x] 7.1 Run focused extension, shared protocol, server, client, runtime conformance, and subagent supervisor tests using the project tee-once failure workflow.
- [ ] 7.2 Run `npm run quality:changed`, `npm test`, `npm run build`, and the local-change dashboard E2E harness; record any platform tests unavailable locally.
- [ ] 7.3 Use `node-inspect-debugger` to capture one retry-backoff abort and one nested-child forced termination, confirming controller and process state match the specification.
- [ ] 7.4 Run `doubt-driven-review` before the runtime compatibility adapter stands, then run `review-code` after all automated tests pass and fix every blocking finding.
- [ ] 7.5 Delegate `docs/architecture.md` cancellation-flow updates to DocScribe in caveman style, update affected directory `AGENTS.md` rows, and verify `kb dox lint` passes.
- [ ] 7.6 Rebuild and reload all affected extension, server, client, and packaged-runtime surfaces; verify dashboard health and terminal-origin Force Stop against a real pi session.
