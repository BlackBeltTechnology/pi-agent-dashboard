## 1. Host kill primitive (headless-pid-registry)

- [x] 1.1 Add `killByToken(spawnToken: string): Promise<boolean>` to `HeadlessPidRegistry` in `packages/server/src/headless-pid-registry.ts` — resolve the entry by stored `spawnToken`, then run the same SIGTERM→2s→SIGKILL ladder as `killBySessionId` (keeper-aware: kill pi first). Return true iff a live PID was targeted. → verify: unit test kills a spawned-but-unlinked (no sessionId) entry by token; returns false for unknown token and for an already-dead pid.

## 2. Host hook (server.ts + plugin runtime types)

- [x] 2.1 Add `abortAutomationRun(args: { sessionId?: string; spawnToken?: string; graceful?: boolean }): Promise<boolean>` to the plugin `ServerPluginContext` type in `packages/dashboard-plugin-runtime/src/server/server-context.ts` (+ passthrough field). → verify: type-checks; untrusted-plugin variant typed as always-false.
- [x] 2.2 Implement the hook in `packages/server/src/server.ts` next to `abortSession`/`spawnSession`, trust-gated `priority <= 100`: `graceful && sessionId` → `sendToSession(sessionId, {type:"shutdown"})` **then MANDATORY** `killBySessionId(sessionId)` (mirror the host's `handleShutdown`; the shutdown hint is dropped when the bridge WS is not OPEN, so the kill ladder is the guarantee); else if `sessionId` linked → `killBySessionId(sessionId)`; else if `spawnToken` → `killByToken(spawnToken)`; else `false`. Untrusted plugins get a no-op returning `false`. → verify: unit/integration test asserts graceful routes to BOTH `{type:"shutdown"}` AND `killBySessionId`, hard routes to the right registry method, and untrusted path returns false without touching the registry.

## 3. Automation engine wiring

- [x] 3.1 Add `spawnToken?: string` to `RunContext` and `abortAutomationRun?: (args) => Promise<boolean>` to `EngineDeps` in `packages/automation-plugin/src/server/engine.ts`. → verify: type-checks.
- [x] 3.2 In `startRunFor`, capture `spawnToken` from the `spawnSession` result (`.then((res) => …)`) onto the pending `ctx`. → verify: unit test asserts a run's ctx carries the token returned by a stubbed spawn.
- [x] 3.3 Rework `engine.stopRun(runId)` to be async (`Promise<boolean>`) — update the `Engine` interface signature + its doc comment, the `stopRun?` hook type it's wired through, and any caller/test that treats the return synchronously. Body: locate the pending ctx; call `deps.abortAutomationRun({ sessionId: ctx.sessionId, spawnToken: ctx.spawnToken })`; THEN `finishAndRelease(...)`. Immediate hard-kill — no soft `{type:"abort"}` precedes it. Keep the "unknown/finalized run → return false" contract. → verify: unit tests — (a) registered run stops via sessionId; (b) pre-register run (no sessionId, has token) stops via token and leaves no undelivered pending entry; (c) unknown runId returns false.
- [x] 3.4 Terminate on normal completion: in `engine.onSessionEnded`, after `finishAndRelease` captures the result, call `deps.abortAutomationRun({ sessionId, spawnToken: found.spawnToken, graceful: true })` so the persistent `--mode rpc` session exits instead of idling. → verify: unit test asserts a completed run's session is sent a graceful terminate exactly once, and a subsequent end signal does not re-finalize.
- [x] 3.5 In `packages/automation-plugin/src/server/index.ts`, pass `abortAutomationRun: (args) => ctx.abortAutomationRun(args)` into `createEngine`. Remove the now-unused `abortSession` dep from `EngineDeps` + its wiring (Stop is immediate hard-kill via `abortAutomationRun`; nothing else in the engine uses `abortSession`). → verify: plugin wiring test / boot smoke; type-check confirms no remaining `abortSession` reference in the engine.

## 4. Route + regression tests

- [x] 4.1 Update `packages/automation-plugin/src/server/routes.ts` POST `/stop` handler if needed so it `await`s the now-async `stopRun` hook; preserve 400 (missing runId / not running), 503 (no engine). → verify: `routes-stop.test.ts` green, plus a new case for a pre-register run stop returning ok.
- [x] 4.2 Add an `engine.test.ts` regression asserting the pre-register zombie is closed: stop a run before `onSessionRegisteredForRun`, then simulate the late register → assert no prompt delivery and no lingering pending ctx. → verify: test passes.
- [x] 4.3 Add an `engine.test.ts` regression for the completion path: drive a run to `agent_end` → assert `abortAutomationRun({graceful:true})` invoked once for that session and the run finalized exactly once (no idle-session leak). → verify: test passes.

## 5. Docs & gates

- [x] 5.1 Update the `engine.ts`, `headless-pid-registry.ts`, and `server.ts` rows in their directory `AGENTS.md` files with the new `killByToken` / `abortAutomationRun` / `RunContext.spawnToken` / completion-termination facts + `See change: fix-automation-stop-zombie-runs`. (Non-`docs/` tree rows — edit directly.)
- [x] 5.2 `npm test 2>&1 | tee /tmp/pi-test.log` green; `openspec validate fix-automation-stop-zombie-runs --strict` passes.
- [x] 5.3 Run the code-review + code-quality gates on the diff before commit.
