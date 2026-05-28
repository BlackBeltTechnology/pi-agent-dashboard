## Context

The keeper sidecar architecture (introduced by `add-rpc-stdin-dispatch-with-keeper-sidecar`, made default by `enable-rpc-keeper-by-default`) split the pi lifecycle across two processes: the keeper owns the UDS and pi's stdin; pi owns the session state. Killing a session therefore requires terminating both. The kill ladder as it stands:

| Action | Path | Escalation |
|---|---|---|
| Stop / abort (chat input) | bridge WS → `pi.abort()` | None — cooperative |
| Shutdown (menu) | bridge WS → `pi.shutdown()` THEN `killBySessionId` | SIGTERM only on both pi + keeper |
| Force kill (red ✕) | `killProcess(session.pid)` THEN `killBySessionId` | SIGTERM → 2 s → SIGKILL on pi only; SIGTERM on keeper |

The 2026-05-28 investigation found two gaps:

**Gap 1 — `killBySessionId` is SIGTERM-only.** A pi process hung in a CPU loop, a non-cancellable native syscall, or a deadlocked tool ignores SIGTERM. The 200 ms timer that follows SIGTERMs the keeper. The keeper's SIGTERM handler exits cleanly. Pi survives, orphaned, until next server restart. This makes the "Shutdown" menu action effectively useless for hung sessions.

**Gap 2 — Keeper `shutdown()` does not kill `piChild`.** From `keeper.cjs:87-101`, shutdown closes the UDS, unlinks bookkeeping files, and `process.exit()`. The implicit contract: "pi reads stdin EOF when its end of the parent's pipe closes, observes EOF, calls voluntary shutdown". This contract holds for a healthy pi. For a hung pi whose event loop is blocked, the EOF is never observed; pi is orphaned (POSIX) or stranded (Windows, depending on Job Object membership) and continues running.

Together: even when a user clicks Shutdown explicitly, a hung pi survives both the SIGTERM and the keeper's death.

## Goals / Non-Goals

**Goals:**

- "Shutdown" reliably terminates a hung pi within ~2 s (matches the existing `handleForceKill` ladder).
- Keeper SIGTERM propagates as SIGKILL to its pi child, closing the orphan-pi gap when the dashboard server's kill arrives at the keeper before pi.
- No new browser-protocol message types. No new UI surfaces.

**Non-Goals:**

- Abort-path escalation (e.g. "abort timeout → SIGTERM"). The abort path is cooperative by design and changing it touches the bridge-side `command-handler.ts:382` case-arm; out of scope for a kernel kill-ladder fix.
- "Closing the card kills the process" UX change. `hide_session` is documented as metadata-only; if users want a kill-on-close affordance, that's a separate UX proposal.
- Changes to `handleForceKill`. It already escalates correctly; no modification needed.
- Changes to the keeper's normal-exit path (when pi exits first, the keeper observes `c.on("exit")` and follows). That path is unchanged — only the keeper's own-shutdown path needs the additional `piChild.kill`.

## Decisions

### Decision 1 — Reuse `killProcess` from `platform/process.ts`, do not introduce a new primitive

**What:** `killBySessionId`'s keeper-branch pi-kill becomes `await killProcess(piPid, { timeoutMs: 2000 })` instead of `killPidWithGroup(piPid, "SIGTERM")`.

**Rationale:**
- `killProcess` already implements the cross-platform ladder (POSIX SIGTERM → 2 s grace → SIGKILL with tree kill; Windows `taskkill /F /T /PID`). It's the same primitive `handleForceKill` uses.
- Adding a new "kill with escalation" helper inside `headless-pid-registry.ts` would duplicate platform logic and create a second source of truth.
- The 2 s timeout matches the existing `handleForceKill` contract — operators have one consistent expectation for how long a kill takes.

**Alternative considered — escalate inside `killBySessionId` directly via `killPidWithGroup(SIGTERM)` + `setTimeout(killPidWithGroup(SIGKILL), 2000)`:**
- Pros: keeps the function synchronous.
- Cons: re-implements `killProcess`'s ladder inline; misses the Windows `taskkill /F /T` tree-kill semantics; introduces a second deferred-kill timer alongside the keeper's 200 ms one.

**Decision:** reuse `killProcess`. Accept the signature change to `Promise<boolean>`.

### Decision 2 — Make `killBySessionId` async

**What:** The function signature changes from `(sessionId: string): boolean` to `(sessionId: string): Promise<boolean>`. All call sites (currently three in `session-action-handler.ts`: `handleShutdown`, `handleForceKill`, `handleKillProcess`) gain an `await`.

**Rationale:**
- `killProcess` is async (it `await`s its own grace timer). Making the wrapper async is the natural shape.
- All three callers are already in `async` handler functions registered with `browser-gateway.ts` (the gateway's dispatch `await`s the handler). No further propagation is needed.
- The keeper-fallback 200 ms SIGTERM stays as a fire-and-forget `setTimeout` — there's no value in awaiting it from the caller's perspective; it's defence-in-depth that runs after the function returns.

**Alternative considered — keep `killBySessionId` synchronous, fire `killProcess` as a detached promise:**
- Cons: the caller `handleShutdown` then has to `await` something else to know when the kill completed. The asynchrony has to live somewhere; pushing it inside the registry hides it from callers and breaks tests that rely on "after killBySessionId returns, pi is dead".

**Decision:** make it async. Three caller updates. No protocol change.

### Decision 3 — Keeper SIGKILLs piChild in its own `shutdown()`, in addition to the registry-side escalation

**What:** In `keeper.cjs::shutdown`, before `process.exit(exitCode)`, add:
```javascript
try {
  if (piChild && piChild.exitCode === null && piChild.signalCode === null) {
    piChild.kill("SIGKILL");
  }
} catch (_e) { /* ignore */ }
```

**Rationale:**
- Defence in depth. Decision 1 escalates pi from the dashboard server's side. Decision 3 closes the gap if the keeper's own SIGTERM (from `killBySessionId`'s 200 ms fallback) arrives before pi has died.
- The current contract — "keeper exits → pi reads stdin EOF → pi shuts down voluntarily" — assumes pi's event loop is responsive. For a hung pi, the assumption breaks. Explicit SIGKILL on `piChild` bypasses the assumption.
- Cheap (3 LOC); the only failure mode is `piChild.kill` on an already-dead PID, which the try/catch absorbs.

**Alternative considered — leave keeper.cjs unchanged, rely solely on Decision 1:**
- Pros: smaller surface change; keeper logic stays simple.
- Cons: doesn't help the legitimate case where the keeper is being killed for a non-server-shutdown reason (e.g. system OOM kills the keeper, or a future `killKeeper`-only API exists). The pi orphan reappears in any of those scenarios.

**Decision:** keep both fixes. They are independent and together close the gap from both ends.

### Decision 4 — Tests cover both POSIX and Windows where feasible

**What:**
- `headless-pid-registry-kill-escalation.test.ts` is platform-agnostic — it injects a fake `killProcess` and asserts on call shape. No real OS signals.
- `keeper-shutdown-kills-pi.test.ts` is Unix-only via `describe.runIf(process.platform !== "win32")`. Spawns a real keeper.cjs against a fake pi script (`tools/test-fixtures/fake-hung-pi.cjs`) that traps SIGTERM via `process.on("SIGTERM", () => {})` and busy-loops. Sends `keeper.kill("SIGTERM")`, polls `isProcessAlive(fakePiPid)` until false or 1 s elapsed.
- Windows path: the equivalent `piChild.kill("SIGKILL")` maps to `TerminateProcess` via libuv. Verified manually by the operator running the §6 manual verification steps on Windows. CI does not currently have a hung-pi spawn fixture under Windows; adding one is out of scope.

**Rationale:**
- The registry-level test (mock-based) is fast and reliable, gives high coverage of the dispatch shape.
- The keeper-level test (real subprocess) is the only way to verify the actual signal-handling on POSIX, where the failure mode is signal-handler-blocks-on-SIGTERM. Mocking the keeper subprocess defeats the purpose.
- Windows-side coverage via the existing manual verification step is acceptable given the well-defined `TerminateProcess` semantics; the surface is the 3-line keeper.cjs change, which mirrors a pattern already widely used in `process-manager.ts` for the Windows headless-detached path before its removal.

**Decision:** ship platform-agnostic unit + Unix integration tests. Windows manual.

## Risks / Trade-offs

**Risk: SIGKILL loses in-flight pi state.** Same risk as `handleForceKill` today. Mitigated by always sending bridge `pi.shutdown()` first in `handleShutdown` — cooperative pi processes still get a clean exit window before the SIGTERM/SIGKILL ladder begins. Only hung pi's are escalated.

**Risk: 2 s grace inside `killBySessionId` slows down the happy-path Shutdown.** Mitigated by `killProcess`'s implementation: it sends SIGTERM, then `await`s a Promise that resolves on either child-exit OR the 2 s timeout. A cooperative pi exits in ~100 ms; the function returns then. The 2 s is the worst-case, not the typical-case.

**Risk: Keeper's `piChild.kill` race vs. pi voluntarily exiting first.** If pi has already exited when the keeper's shutdown runs, `piChild.exitCode` is non-null and the conditional `piChild.exitCode === null` guard prevents the kill. If pi exits between the guard and the `.kill` call, `piChild.kill` throws (EPERM or no-such-process), caught by the try/catch. Net effect: no double-kill, no exception leak.

**Risk: Tests for keeper subprocess flake on slow CI.** Mitigated by 1 s timeout (vs. the 100-200 ms typical kill latency) and explicit poll loop instead of fixed sleep. If flakes appear, the timeout can be raised without changing the assertion shape.
