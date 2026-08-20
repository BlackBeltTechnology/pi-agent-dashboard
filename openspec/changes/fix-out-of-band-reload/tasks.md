> **Rev 2.** The keeper-dispatch mechanism this plan was built on was measured and falsified in
> the docker harness (pi's RPC `{type:"prompt"}` performs no slash-command dispatch). Tasks that
> asserted a keeper write are re-pointed at the respawn path, which is now the default. See
> `proposal.md` § "The mechanism that does not exist".

## 1. Server-side dispatch core

- [x] 1.1 Add a `listSessions()`-style enumeration to `headless-pid-registry.ts` (only `size()`
      exists today) so fan-outs can target keeper/PID-alive sessions
- [x] 1.2 Implement `dispatchReload(sessionId)` with the ladder (busy → refuse; PID → respawn;
      connected → forward to bridge; neither → honest error), emitting terminal feedback keyed
      `/reload`
- [x] 1.3 Add the compaction signal: bridge reports compaction start/end, shared protocol field,
      server tracks it on the session record and clears it on end and on session end

## 2. Tests — dispatch ladder and predicate (L1)

- [x] 2.1 a headless session respawns and never forwards to the bridge · see
      `packages/server/src/__tests__/session-action-handler-headless-reload.test.ts` · Triple:
      PID present, connected, status idle · `/reload` · `spawnPiSession` once, `killBySessionId`
      called, `sendToSession` not called (test-plan #E1)
- [x] 2.2 PID + disconnected → respawn · see
      `packages/server/src/__tests__/session-action-handler-headless-reload.test.ts` · Triple:
      PID present, `isSessionConnected=false` · `dispatchReload(sid)` · respawn invoked, no
      bridge forward (test-plan #E2)
- [x] 2.3 no PID + connected → forward to bridge only · see
      `packages/server/src/__tests__/session-action-handler-reload-predicate.test.ts` · Triple:
      tmux session · `dispatchReload(sid)` · `sendToSession` called, no kill, no spawn
      (test-plan #E3)
- [x] 2.4 PID guard: tmux session with WS momentarily down is NEVER respawned · see
      `session-action-handler-reload-predicate.test.ts` · Triple: no PID,
      `isSessionConnected=false` · `dispatchReload(sid)` · respawn not called, terminal
      `error` feedback (test-plan #E4)
- [x] 2.5 argument forms: only bare `"/reload"` enters the reload path · see
      `session-action-handler-reload-predicate.test.ts` · Triple: `"/reload "`, `"/reload now"`,
      `"/reload"`+image, `"/reload"` · browser `send_prompt` · only the bare form routes, the
      other three forward unchanged (test-plan #E5)
- [x] 2.6 DROPPED with the keeper path — there is no non-respawn dispatch left to double-fire;
      concurrency is covered by 2.7 (was test-plan #E7)
- [x] 2.7 idempotency on the respawn path · see
      `session-action-handler-headless-reload.test.ts` · Triple: respawn in flight, second
      `/reload` before the new PID registers · second call · at most one new pi process
      (test-plan #E8)

## 3. Tests — feedback honesty (L1)

- [x] 3.1 exactly one TERMINAL feedback per respawn, keyed `/reload` · see
      `session-action-handler-headless-reload.test.ts` · Triple: respawn path · `dispatchReload` ·
      one terminal event (the `started` opener is not terminal), `command === "/reload"`
      (test-plan #E6)
- [x] 3.2 bridge with no available path emits `error` and NO `completed` · see
      `packages/extension/src/__tests__/command-handler.test.ts` · Triple: terminal-hosted
      bridge, `RELOAD_KEY` absent · `/reload` reaches `command-handler` · one `error`, zero
      `completed` (test-plan #X6)
- [x] 3.3 `RELOAD_KEY` fast path is single-use: a stale captured ctx throws **synchronously** ·
      see `packages/extension/src/__tests__/command-handler.test.ts` · Triple: captured reload fn
      whose runner is invalidated · second `/reload` in the same process · error reported, no
      uncaught throw, one terminal `error` (test-plan #X7)

## 4. Bridge + command-handler changes

- [x] 4.1 Change `BridgeCommandOptions.reload` to return an outcome; wrap the `RELOAD_KEY` call in
      try/catch (sync throw included); update call sites and existing tests
- [x] 4.2 Remove the unconditional `command_feedback {status:"completed"}` at
      `command-handler.ts:487-495`; emit the real outcome

## 5. Fan-out routing

- [x] 5.1 Route the retry-policy save, package ops and `resource-activation-routes.ts` through
      `dispatchReload`, targeting connected ∪ registry-known sessions
- [x] 5.2 Route `server.ts:1546` (`piCoreUpdater.onAllComplete`) to the respawn path as a runtime
      swap, bypassing the streaming guard
- [x] 5.3 Fan-out targets a bridge-dead registry-known session · see
      `packages/server/src/__tests__/session-action-handler-headless-reload.test.ts` · Triple: 3
      sessions (connected+registry, registry-only, tmux) · fan-out · all three targeted,
      registry-only not skipped (test-plan #E12)
- [x] 5.4 pi-core update respawns a connected streaming headless session · see
      `session-action-handler-headless-reload.test.ts` · Triple: headless, connected,
      `status:"streaming"` · `onAllComplete` · respawn invoked, busy refusal not applied
      (test-plan #E10)
- [x] 5.5 pi-core update on an unswappable session reports error · see
      `session-action-handler-headless-reload.test.ts` · Triple: no `sessionFile`, or
      non-headless · `onAllComplete` · terminal `error`, no success (test-plan #E11)

## 6. Tests — busy-session refusal + compaction signal (L1)

- [x] 6.1 compaction flag lifecycle · see `packages/server/src/__tests__/` session-manager suites ·
      Triple: session flagged compacting · compaction-end, then session end · flag cleared, later
      registration starts un-flagged (test-plan #E9)
- [x] 6.2 compacting session refuses the reload · see
      `session-action-handler-reload-predicate.test.ts` · Triple: session flagged compacting ·
      `dispatchReload` · no respawn, `error` with the wait wording (test-plan #X8)
- [x] 6.3 refuses a connected streaming session · see
      `session-action-handler-reload-predicate.test.ts` · Triple: connected + streaming ·
      `dispatchReload` · no respawn, `error` feedback (test-plan #X5)
- [x] 6.4 bridge-dead session stuck at `streaming` is still respawnable · see
      `session-action-handler-headless-reload.test.ts` · Triple: PID present, not connected,
      `status:"streaming"` · `dispatchReload` · respawn proceeds, stale status does not refuse
      (test-plan #X4)

## 7. Tests — fault injection (L1)

- [x] 7.1 respawn emits exactly ONE terminal feedback · see
      `session-action-handler-headless-reload.test.ts` · Triple: respawn path · `dispatchReload` ·
      one terminal event, `completed`, keyed `/reload` (was the keeper-write fallback,
      test-plan #X1)
- [x] 7.2 DROPPED with the keeper path — no keeper write remains to throw. The PID-less
      no-path case is covered by 2.4 (was test-plan #X2)
- [x] 7.3 connection drops between probe and send → honest error, not a silent drop · see
      `session-action-handler-reload-predicate.test.ts` · Triple: `isSessionConnected=true` but
      `sendToSession` returns `false`, no PID · `dispatchReload` · terminal `error`, never a
      silent drop (test-plan #X3)

## 8. Tests — rollout + scale (re-routed L2 → L1)

Re-routed at implementation time: `qa/tests/*.sh` is clean-install/runtime VM smoke with no
dashboard, keeper or pi session to dispatch into, so these could not have observed what they
assert. Every observable named is server-side. Implemented in
`packages/server/src/__tests__/dispatch-reload-rollout.test.ts`. See test-plan.md § "Level
re-routing at implementation time".

- [x] 8.1 reload with the dashboard extension disabled still reloads · see
      `dispatch-reload-rollout.test.ts` · Triple: headless session, extension disabled/crashed ·
      `dispatchReload` · respawn taken (a process-level op needs nothing from the old process's
      extension) (test-plan #X9)
- [x] 8.2 version skew: new server + OLD extension still reloads · see
      `dispatch-reload-rollout.test.ts` · Triple: new server, session on the old extension ·
      `dispatchReload` · respawn taken (resolution is server-side, no dependence on the old
      extension's `/reload` handling) (test-plan #X10)
- [x] 8.3 fan-out scale · see `dispatch-reload-rollout.test.ts` · Triple: 20 headless sessions ·
      one fan-out · all 20 reloaded exactly once each, returns within 5 s (test-plan #P1)

## 9. Tests — browser e2e (L3)

- [x] 9.1 exactly one terminal `/reload` pill, card not permanently `ended` · see
      `tests/e2e/headless-reload-dispatch.spec.ts` · Triple: harness headless session · bare
      `/reload` in the composer · exactly one terminal pill, `completed`, never a false success
      (test-plan #F1)
- [x] 9.2 the process is REPLACED, not orphaned · see
      `tests/e2e/headless-reload-dispatch.spec.ts` · Triple: harness headless session, PID
      recorded · `/reload` · a NEW pid is registered and the session answers a follow-up prompt
      (test-plan #F2)
- [x] 9.3 session-record flap converges and preserves accumulated state · see
      `tests/e2e/headless-reload-dispatch.spec.ts` · Triple: session visible on the board ·
      `/reload` · status converges off `ended`, token fields survive the re-register
      (test-plan #F3)
- [ ] 9.4 DEFERRED to a follow-up e2e change (timing-shaped against a live harness stream; the
      server-side half is covered at L1 by #X5/#X8). streaming session refuses with the wait
      wording, stream completes · see
      `tests/e2e/chat-render-fx.spec.ts` · Triple: session mid-stream · reload button · one
      `/reload` pill with `error`, stream finishes normally (test-plan #F4)
- [ ] 9.5 DEFERRED to a follow-up e2e change (client-side toast coalescing, not part of the
      server ladder; fan-out target set is covered at L1 by #E12). fan-out toasts coalesce
      within 2000 ms · see
      `tests/e2e/package-queue-visible.spec.ts` · Triple: 5 connected sessions · package-install
      fan-out · ≤1 `/reload` toast in the window while 5 per-session feedback events exist
      (test-plan #F5)

## 10. Manual verification (test-plan: manual-only)

- [ ] 10.1 Read the busy-session refusal text as an operator — is it actionable rather than
      alarming? (test-plan: manual-only, #M1)
- [ ] 10.2 Watch a ~10-session board through a fan-out reload — is the card flicker tolerable?
      (test-plan: manual-only, #M2)

## 11. Docs and close-out

- [x] 11.1 Hand-rewrite the `## Purpose` block of `openspec/specs/headless-reload/spec.md` at
      sync/archive time — an OpenSpec delta cannot modify Purpose, and the current text
      ("unreachable from headless/RPC mode", "via kill-and-respawn") is falsified by this change
- [x] 11.2 Delegate to DocScribe: rewrite `docs/architecture.md` "`/reload` Flow" for the new
      ladder (done twice — rev 1 ladder, then corrected for rev 2); apply the returned
      directory-`AGENTS.md` rows; also corrected the stale connected-only fan-out claim at
      `docs/architecture.md` § Retry
- [ ] 11.3 `npm test` green; `npm run quality:changed` clean
- [ ] 11.4 Run `review-code` on the full diff before commit

## 12. Rev-2 fallout (added after the harness measurement)

- [x] 12.1 Remove the keeper dispatch from `dispatchReload`; drop `hasKeeper()` from
      `headless-pid-registry.ts` (added for it, now unused)
- [x] 12.2 Rewrite `proposal.md`, the spec delta and the `## Purpose` block for respawn-as-default
- [ ] 12.3 File a follow-up change for the `dispatch_extension_command` false-success bug in
      `rpc-keeper/dispatch-router.ts` — same `writeRpc` + `{type:"prompt"}` mechanism, live on
      `develop`, and `docs/architecture.md` § RPC keeper sidecar still asserts it dispatches
      slash commands
- [ ] 12.4 File a follow-up for `POST /api/session/:id/prompt` bypassing the ladder (a `/reload`
      sent over REST forwards straight to the bridge)
