## Context

Evidence comes from the packed releases (`npm pack @earendil-works/{pi-coding-agent,pi-ai,pi-agent-core,pi-tui}@{1.5.0,1.6.0}`, plus `pi-coding-agent@1.5.1` to date the shutdown changes), diffed file by file, not from the changelog alone.

- `docs/settings.md` 1.5.0 → 1.6.0: one row, `cacheWarming` default `"streaming"` → `"idle"`.
- `dist/core/system-prompt.js`, `dist/core/project-trust.js`, `dist/core/trust-manager.js`: identical.
- `dist/core/exec.d.ts` (1.6.0): `code` = "Exit code, or 128 + signal number when a signal terminated the command (143 for SIGTERM)".
- RPC mode (`dist/modes/rpc/rpc-mode.js`), since 1.5.1: the extension `shutdownHandler` sets `shutdownRequested` and schedules `setImmediate(checkShutdownRequested)` (1.6.0 `:276-279`); `checkShutdownRequested` shuts down only when input is attached, no command is active and `session.isIdle` (`:609-612`); `shutdown()` awaits `runtimeHost.dispose()` before `process.exit` (`:590-602`); once shutting down, only a repeated signal forces exit. 1.5.0 checked the flag only after a command or on `agent_settled`, so an idle headless session never exited after `ctx.shutdown()` — the reason for the bridge's 500 ms fallback (`packages/extension/src/bridge.ts:1431-1433`).
- Interactive mode, same body in 1.5.0 and 1.6.0: `shutdownHandler` shuts down at once when idle, otherwise at `agent_settled` (1.5.0 `interactive-mode.js:1619-1623`; 1.6.0 `:1672-1676`, `:3117-3121`). The non-signal shutdown path stops the TUI first (`:3670-3677`), and `stop()` unregisters pi's signal handlers (`:6123-6140`), so a later SIGTERM is not handled by pi.
- Since 1.5.1, `AgentSessionRuntime.dispose()` waits for in-progress credential writes (#11692) and `ModelRuntime.settleCredentialWrites()` exists ("Call before the process exits so a rotated token is not lost", 1.6.0 `dist/core/model-runtime.d.ts:96-99`).
- Bridge `shutdown` callers: server WS `{type:"shutdown"}` (`command-handler.ts:1189-1192`, inside `switch (msg.type)`), and `/quit` / `/exit` parsed to `{type:"shutdown"}` (`command-handler.ts:385-387,737-741`). The handler is an inline closure in the `createCommandHandler` options (`bridge.ts:1366,1421-1434`); no test drives it today (`bridge-shutdown-reset.test.ts` tests a pure model).
- Server stop flow (`packages/server/src/browser-handlers/session-action-handler.ts:1016,1069-1088`): sends `{type:"shutdown"}`, then the shared terminator. Headless: the PID-registry rung SIGTERMs pi first and awaits it (`spawn-process/headless-pid-registry.ts:432-438`, `killProcess` `timeoutMs: 2000`), then the keeper group. tmux: SIGTERM after `SHUTDOWN_GRACE_MS` (1.5 s). SIGKILL 2 s after SIGTERM (`timeoutMs: 2000` literals at `session-terminator.ts:141,212`, `headless-pid-registry.ts:437,489`; `killProcess` itself defaults to 5000, `packages/shared/src/platform/process.ts:276`); win32 is `taskkill /F`. The registry rung runs before the grace window, so a headless ladder can last ~5.5 s in the worst case (`session-terminator.ts:224-231,253-260`). The ladder declines to signal for `not-local`, `no-identity` and (with `verifyIdentity`) `refused-identity`.
- Server exit paths (context for D4): idle-timer `stop()` (`packages/server/src/server.ts:5563`); `POST /api/shutdown` flushes and `setTimeout(() => process.exit(0), 100)` without `stop()` (`routes/system-routes.ts:1568-1589`), used by `pi-dashboard stop` (`cli.ts:707-713,777`), which waits 5 s (`cli.ts:704,802-807`) then SIGTERMs; SIGTERM/SIGINT handler flushes and `process.exit(0)` synchronously (`cli.ts:400-407`); `/api/restart`'s orchestrator SIGTERMs the old daemon and SIGKILLs after 3 s (`spawn-process/restart-helper.ts:193-198`).
- Server `ModelRuntime`: created once and memoized in `pending` (`server-model-runtime.ts:105-135`); `pending` can be an in-flight creation or a memoized rejection. `disposeServerModelRuntime()` (`:144`) only drops the memo and has no production caller.

## Goals / Non-Goals

**Goals:** lockstep floor at 1.6.0; settings default parity; the bridge no longer cuts off pi's clean exit.

**Non-Goals:** changing stop-after-turn semantics; consuming new pi APIs without a caller; changing the server's termination ladder; making Windows stops graceful; server-side `settleCredentialWrites()` (split out, D4).

## Decisions

### D1 — Pins move atomically, fixtures first
Same governed set and order as `update-pi-core-1-5-adopt-apis`: move pin-encoding tests to `1.6.0` (red), then every pin surface, then `pnpm install` and derive `minimumReleaseAgeExclude` from the lockfile. Pin importers to pi's exact version in `pnpm-lock.yaml` and verify with `pnpm install --frozen-lockfile`. The workspace sets no `minimumReleaseAge` value (only the exclude list), so diff newly added lockfile versions against their publish dates instead of relying on an age gate.

### D2 — `cacheWarming` default follows pi
`enumKey("cacheWarming", …, "idle", …)` with pi's new description. The schema default is display-only (the dashboard never writes defaults), so a stored value is untouched.

### D3 — Bridge shutdown: extracted module, 5 s unref'd fallback
New `packages/extension/src/bridge-shutdown.ts` exports `BRIDGE_SHUTDOWN_FALLBACK_MS = 5000` and `runBridgeShutdown(ctx, deps)` with `deps = { exit, setTimer }` defaulting to `process.exit` / `setTimeout`. It calls `ctx.shutdown()` when present (a throw is caught and logged), then always arms `setTimer(() => exit(0), BRIDGE_SHUTDOWN_FALLBACK_MS).unref()`. `bridge.ts`'s `shutdown` option calls it, so tests drive the real code instead of a mirror. The server constants stay where they are; the relation below is a design rationale, not a cross-package test.

Why 5 s: it is longer than the tmux ladder (1.5 s grace + 2 s = 3.5 s), so for a tmux session the ladder, not the bridge, decides. A headless session already got SIGTERM from the registry rung at ~0 s. A busy pi that still has its signal handlers runs its clean `dispose()` on that SIGTERM (RPC `shutdown(143)`, interactive `shutdown({fromSignal})`). An idle session starts its clean exit on its own in both modes; in interactive mode pi drops its signal handlers when it stops the TUI, so the ladder's SIGTERM can still end a slow dispose (residual). pi's exit also waits, since 1.5.1, for active tool aborts — inside 5 s.

Why `unref()`: a timer must not keep alive a process pi is already exiting; while pi runs, stdin and the WS keep the loop alive anyway.

Alternatives considered:
- *Idle-conditional fallback (keep 500 ms when busy).* Rejected: a busy stop already gets a SIGTERM-driven dispose from the ladder; a 500 ms hard exit there only adds the credential-loss race.
- *`abort()` then `shutdown()` when busy.* Rejected: changes visible run output (aborted-tool markers) and duplicates the ladder's SIGTERM.
- *Remove the fallback.* Rejected: `/quit` / `/exit` and a declining ladder have no other exit; a busy session would run until the agent settles.
- *Shared timing constants with a cross-package test.* Rejected: the ladder's real escalation values are `timeoutMs: 2000` literals at four call sites, so a test over copied constants would not catch drift.

### D4 — Server-side `settleCredentialWrites()` is split out
A one-shot settle on `stop()`, `POST /api/shutdown` and `POST /api/restart` was drafted and rejected in review: settling a snapshot (`runtime-credentials.js:44-45`) does not stop auth work that starts afterwards while Fastify and the gateway are still open; the Electron restart exits through its own branch (`system-routes.ts:1660-1663`); the route budget is the client's HTTP timeout (CLI 5 s, `cli.ts:717`; Electron 3 s, `electron/src/lib/server-lifecycle.ts:598`), not the exit wait; and the two SIGTERM listeners (`cli.ts:400-409`, `lifecycle/home-lock-release.ts:46-62`) race. A correct version needs an exit barrier — follow-up change `settle-server-credential-writes-on-exit`.

### D5 — No version gate
The floor is 1.6.0. The 5 s fallback is also safe on a below-floor pi (1.5.0 idle RPC: exits after 5 s instead of 0.5 s), which only shows the generic `piBelowFloor` warning (`pi-core-version-check`). The server's runtime is always the pinned pi.

## Risks / Trade-offs

- Stop via `/quit` / `/exit` or a declining ladder on a busy session takes up to 5 s instead of 0.5 s → acceptable.
- Residuals, recorded in the proposal: Windows `taskkill /F`; SIGKILL 2 s after SIGTERM; idle interactive dispose cut by the ladder's SIGTERM; headless ladder can outlast the fallback; unlinked keeper-hosted pi SIGKILLed by its keeper; server exits do not settle credential writes (D4).
- Lockfile may pull a fresh transitive release → D1 publish-date diff.
- pi 1.6's `@google/genai` / `openai` jumps affect only pi-internal providers; the dashboard imports neither.

## Migration Plan

Single commit on the change branch; release notes mark the floor raise **BREAKING** for publishable peers. Rollback = revert (pins and fallback return together); no persisted data changes.
