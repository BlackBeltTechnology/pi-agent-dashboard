## 1. Lock the repro (red tests first)

- [x] 1.1 Red test `packages/server/src/__tests__/recovery-exit-intent.test.ts`: cold start after a
      boot that recorded `exitIntent:"restart"` MUST yield zero candidates and no broadcast offer.
      Confirm RED against current code (today it offers).
- [x] 1.2 Red test in the same file: cold start after `exitIntent:"idle"` MUST yield candidates
      (today `stop()` cleared the markers, so it yields none).
- [x] 1.3 Red invariant test: `RECOVERY_REATTACH_GRACE_MS > RESTART_QUIESCE_MS`. Confirm RED
      (2500 vs 5000).
- [x] 1.4 Red test: in `ask` mode no `recovery_offer` frame is broadcast before the grace window
      closes (today it broadcasts immediately with a non-actionable button).
- [x] 1.5 Red test: `resume_session continue` on a candidate whose keeper+pi are alive returns
      `resume.already_active` and spawns nothing (today unimplemented — 07-22 §4).

## 2. Boot record persistence

- [x] 2.1 Add `packages/shared/src/boot-state.ts` (or extend `config.ts`): `ExitIntent` union +
      `isRecoveryAllowed(intent)` mapping per design D2. Single source of truth for server + tests.
- [x] 2.2 Add `packages/server/src/persistence/boot-state.ts`: atomic (tmp+rename) read/write of
      `~/.pi/dashboard/boot-state.json`; `bootId`, `exitIntent`, `at`, plus an 8-entry ring of
      prior boots. Write failures logged, never thrown.
- [x] 2.3 `recordExitIntent(intent)` is write-once per boot (first writer wins) and idempotent.
- [x] 2.4 `resolveExitIntent(liveEpoch)` matches against the ring; unresolvable ⇒ `null`.
- [x] 2.5 Test `boot-state.test.ts`: atomic write, ring eviction at 8, write-once semantics,
      corrupt/absent file ⇒ `null`, write-failure is non-fatal.

## 3. Record intent on every deliberate exit

- [x] 3.1 `server.ts` startup: stamp `{ bootId: liveEpoch, exitIntent: null }` after reading the
      prior record, before classification.
- [x] 3.2 `system-routes.ts` `/api/restart`: record `"restart"` before `spawnRestart` /
      `process.exit`.
- [x] 3.3 `system-routes.ts` `/api/shutdown`: record `"shutdown"`, or `"user-quit"` when the
      request body declares a user-initiated quit.
- [x] 3.4 `server.ts` `stop()`: record `"idle"`; **remove** the loop that clears `live` markers for
      still-running sessions (design D3). Marker consumption on dismiss/retract/broadcast stays.
- [x] 3.5 `cli.ts` `runForeground()`: install idempotent SIGTERM/SIGINT handlers recording
      `"signal"`, then `flushAll()` + exit. Must not fight `restart-helper`'s SIGTERM→SIGKILL
      ladder (write-once guarantees `"restart"` wins).
- [x] 3.6 `packages/electron/src/lib/server-lifecycle.ts`: declare the user quit so
      `before-quit` → `/api/shutdown` records `"user-quit"`.
- [x] 3.7 Test: each path records exactly its intent; a signal after a restart announcement does
      not overwrite `"restart"`.

## 4. Classification consults exit intent

- [x] 4.1 `server.ts` classification (~303): add the `isRecoveryAllowed(resolveExitIntent(meta.liveEpoch))`
      conjunct. Suppressed sessions normalize to `ended` exactly like non-candidates.
- [x] 4.2 Apply the same suppression to `auto` mode (it must not silently resume a suppressed boot's
      sessions).
- [x] 4.3 Verify 1.1 and 1.2 now pass.
- [x] 4.4 Test: two consecutive dirty boots still offer the first boot's candidate (ring lookup).
- [x] 4.5 Test: `user-quit` suppresses; `signal` allows; absent record allows (back-compat).

## 5. Constants + deferred broadcast

- [x] 5.1 Move `RESTART_QUIESCE_MS` and `RECOVERY_REATTACH_GRACE_MS` into one shared module;
      derive `GRACE = QUIESCE + RECONNECT_HEADROOM_MS`. Verify 1.3 passes.
- [x] 5.2 Defer the `ask` broadcast until the grace window closes; broadcast once with only the
      surviving candidates. Keep `graceUntil` + the "verifying" resume state for mid-window
      connects. Verify 1.4 passes.
- [x] 5.3 Test: retracted candidate never appears in any broadcast or `onConnect` replay.
- [x] 5.4 Confirm the existing dirty-boot / dismiss "shown once" invariants still hold
      (`recovery-offer.test.ts`, `recovery-e2e.test.ts`).

## 6. Resume-time liveness re-check (07-22 §4, now required)

- [x] 6.1 `session-action-handler.ts` `handleResumeSession` `continue`: probe keeper socket / pi PID
      and bridge attachment; refuse with `resume.already_active` when alive. Verify 1.5 passes.
- [x] 6.2 Test: a genuinely dead candidate still resumes successfully (no over-blocking).

## 7. Observability

- [x] 7.1 Log one line per classification decision: sessionId, resolved `exitIntent`, verdict
      (`candidate` / `suppressed-by-intent` / `retracted-keeper` / `retracted-bridge`), remaining count.
- [x] 7.2 Log the recorded exit intent on every deliberate exit path, so `server.log` alone explains
      a subsequent boot's decision.

## 8. Verify

- [x] 8.1 `npm test` green: shared 1424/1424; server 3446 tests, only 6 pre-existing failures
      (file-raw-render, file-watch-manager, folder-head-watcher, office-preview,
      openspec-change-watcher-fs, spa-fallback) — each verified red on a stashed tree too.
- [x] 8.2 Biome clean on every new file; on the 6 modified files the finding count is
      IDENTICAL before/after the change (4 errors / 54 warnings, all pre-existing).
      (`quality:changed` sees no source files in a fresh worktree — ran biome directly.)
- [x] 8.3 VERIFIED LIVE (real server from this worktree, isolated HOME, ports 8123/9123, 3 real
      faux-backed pi sessions each having streamed a turn ⇒ `live:true` + `liveEpoch` on disk):
      exiting server wrote `exitIntent:"restart"`; replacement server broadcast **zero** offers
      over an 11 s window (grace = 7 s); all 3 sessions reattached (`status:"active"`); a new
      prompt streamed a second response ⇒ messages send.
- [x] 8.4 VERIFIED LIVE (same harness): `kill -9` of both wrapper + server child left
      `exitIntent:null` and the `live:true` marker intact; relaunch logged
      `1 candidate(s) after the exit-intent gate` → `grace window closed; offering 1` and the
      offer carried that sessionId; Reopen returned `success:true` and produced exactly ONE
      spawn, which registered (`status:"active"`).
      PARTIAL: "messages send" after Reopen needs a credentialed model — the reopened pi is
      spawned by the dashboard without the key-free faux fixture, so the turn itself is
      post-merge on a real instance.
- [ ] 8.5 NOT CHECKED — the scenario's PREMISE is unreachable, not the mechanism. Qualified in
      this change's OWN docker harness (`docker/test-up.sh`, TEST_COPY_MODE=1 — overlay mount is
      refused on this host; dashboard port 18891), with a real bridge-carried faux-backed pi
      session that streamed a real turn (`live:true` + `liveEpoch` on disk). Measured timeline
      after killing the bridge (30 s polling, full log in the harness run):
        t+0        pi SIGKILLed, browser closed
        t+30…330s  sidecar still `{status:"idle", live:true}`; server still serving
        t+330…360s gateway reconnect grace expires → `sessionManager.unregister()` →
                   sidecar becomes `{status:"ended", live:false}` (pre-existing eager clear
                   from `reopen-sessions-after-shutdown`), then `checkEmpty()` → `onEmpty`
        t+~360s    `No pi sessions for 15s, shutting down...` →
                   `[boot-state] exit intent recorded: idle (boot 1785848546761)`
        relaunch   boot record ring = `[{bootId:…, exitIntent:"idle"}]`; offers = `[]`
      VERIFIED by this run: `exitIntent:"idle"` IS recorded by a real idle stop, and the ring
      resolves the prior boot on the next cold start.
      BLOCKER (structural, in pre-existing code): the idle timer only arms when
      `piGateway.connectionCount() === 0` (`idle-timer.ts:39`), and for a non-ended session the
      ONLY route to that is heartbeat timeout (`HEARTBEAT_TIMEOUT` 180 s) + reconnect grace
      (another 180 s) → `sessionManager.unregister()`, which eagerly clears the `live` marker.
      So an idle stop can never coincide with a `live:true` session: "idle timer stops the
      server WITH live sessions" cannot happen. The empty offer above is CORRECT — that session
      was cleanly unregistered 15 s before the stop, so nothing was lost.
      NOT DONE, deliberately: reaching a green here would require shortening `HEARTBEAT_TIMEOUT`,
      the reconnect grace, or the idle window, or suppressing the unregister-time marker clear.
      All four are production liveness semantics and changing them to satisfy a test is how the
      double-offer bug returns. See design.md D3 addendum.
- [x] 8.6 VERIFIED LIVE (same harness): SIGTERM → `[dashboard] SIGTERM received — flushing and
      exiting` → boot record `exitIntent:"signal"`, `live:true` marker SURVIVED, relaunch
      broadcast an offer containing the sessionId.
      Uncovered a prerequisite bug and fixed it: `bin/pi-dashboard.mjs` did not forward signals
      to the server child it spawns, so `kill <cli-pid>` killed the wrapper and left the server
      orphaned — the handler from 3.5 never ran on the standalone path. Wrapper now forwards
      SIGTERM/SIGINT/SIGHUP; regression test `cli-signal-forwarding.test.ts` drives the real
      wrapper end-to-end and asserts the recorded intent.
