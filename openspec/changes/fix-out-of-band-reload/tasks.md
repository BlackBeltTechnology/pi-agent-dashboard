## 1. Server-side dispatch core

- [ ] 1.1 Add a `listSessions()`-style enumeration to `headless-pid-registry.ts` (only `size()`
      exists today) so fan-outs can target keeper/PID-alive sessions
- [ ] 1.2 Implement `dispatchReload(sessionId)` with the D1 ladder (keeper+idle → keeper write;
      no keeper + PID → respawn; neither → forward to bridge), reusing `dispatch-router.ts`'s
      emitter with the label `/reload`
- [ ] 1.3 Add the compaction signal: bridge reports compaction start/end, shared protocol field,
      server tracks it on the session record and clears it on end and on session end

## 2. Tests — dispatch ladder and predicate (L1)

- [ ] 2.1 keeper+idle dispatches once, never kills · see
      `packages/server/src/__tests__/dispatch-extension-command-router.test.ts` · Triple: session
      with live keeper, status idle · `dispatchReload(sid)` · `writeRpc` called once with the
      `/__dashboard_reload` line, `killBySessionId` not called (test-plan #E1)
- [ ] 2.2 no keeper + PID + disconnected → respawn, no keeper write · see
      `packages/server/src/__tests__/session-action-handler-headless-reload.test.ts` · Triple: no
      keeper, PID present, `isSessionConnected=false` · `dispatchReload(sid)` · respawn invoked,
      `writeRpc` not called (test-plan #E2)
- [ ] 2.3 no keeper + no PID → forward to bridge only · see
      `packages/server/src/__tests__/session-action-handler-reload-predicate.test.ts` · Triple:
      tmux session · `dispatchReload(sid)` · `sendToSession` called, no kill, no spawn
      (test-plan #E3)
- [ ] 2.4 PID conjunct guard: tmux session with WS momentarily down is NEVER respawned · see
      `session-action-handler-reload-predicate.test.ts` · Triple: no keeper, no PID,
      `isSessionConnected=false` · `dispatchReload(sid)` · `spawnPiSession` not called, terminal
      `error` feedback (test-plan #E4)
- [ ] 2.5 argument forms: only bare `"/reload"` enters the reload path · see
      `session-action-handler-reload-predicate.test.ts` · Triple: `"/reload "`, `"/reload now"`,
      `"/reload"`+image, `"/reload"` · browser `send_prompt` · only the bare form routes, the
      other three forward unchanged (test-plan #E5)
- [ ] 2.6 idempotency on the keeper path · see `dispatch-extension-command-router.test.ts` ·
      Triple: two `dispatchReload` calls <50 ms apart · both fire · two RPC lines, two terminal
      feedbacks, zero spawns (test-plan #E7)
- [ ] 2.7 idempotency on the fallback path · see
      `session-action-handler-headless-reload.test.ts` · Triple: respawn in flight, second
      `/reload` before the new PID registers · second call · at most one new pi process
      (test-plan #E8)

## 3. Tests — feedback honesty (L1)

- [ ] 3.1 keeper feedback is keyed `/reload`, not `/__dashboard_reload` · see
      `dispatch-extension-command-router.test.ts` · Triple: keeper dispatch · write succeeds ·
      `command_feedback.command === "/reload"`, exactly one terminal event (test-plan #E6)
- [ ] 3.2 bridge with no available path emits `error` and NO `completed` · see
      `packages/extension/src/__tests__/command-handler.test.ts` · Triple: terminal-hosted
      bridge, `RELOAD_KEY` absent · `/reload` reaches `command-handler` · one `error`, zero
      `completed` (test-plan #X6)
- [ ] 3.3 `RELOAD_KEY` fast path is single-use: a stale captured ctx throws **synchronously** ·
      see `packages/extension/src/__tests__/command-handler.test.ts` · Triple: captured reload fn
      whose runner is invalidated · second `/reload` in the same process · error reported, no
      uncaught throw, one terminal `error` (test-plan #X7)

## 4. Bridge + command-handler changes

- [ ] 4.1 Change `BridgeCommandOptions.reload` to return an outcome; wrap the `RELOAD_KEY` call in
      try/catch (sync throw included); update call sites and existing tests
- [ ] 4.2 Remove the unconditional `command_feedback {status:"completed"}` at
      `command-handler.ts:487-495`; emit the real outcome

## 5. Fan-out routing

- [ ] 5.1 Route `server.ts:1224` (retry-policy save), `server.ts:1521` (package ops) and
      `resource-activation-routes.ts:209` through `dispatchReload`, targeting connected ∪
      keeper/PID-alive sessions
- [ ] 5.2 Route `server.ts:1546` (`piCoreUpdater.onAllComplete`) to the respawn path as a runtime
      swap, bypassing the streaming guard
- [ ] 5.3 Fan-out targets a bridge-dead keeper session · see
      `packages/server/src/__tests__/session-action-handler-headless-reload.test.ts` · Triple: 3
      sessions (connected+keeper, keeper-only, tmux) · fan-out · all three targeted, keeper-only
      not skipped (test-plan #E12)
- [ ] 5.4 pi-core update respawns a connected streaming headless session · see
      `session-action-handler-headless-reload.test.ts` · Triple: headless, connected,
      `status:"streaming"` · `onAllComplete` · respawn invoked, `writeRpc` not called
      (test-plan #E10)
- [ ] 5.5 pi-core update on an unswappable session reports error · see
      `session-action-handler-headless-reload.test.ts` · Triple: no `sessionFile`, or
      non-headless · `onAllComplete` · terminal `error`, no success (test-plan #E11)

## 6. Tests — busy-session refusal + compaction signal (L1)

- [ ] 6.1 compaction flag lifecycle · see `packages/server/src/__tests__/` session-manager suites ·
      Triple: session flagged compacting · compaction-end, then session end · flag cleared, later
      registration starts un-flagged (test-plan #E9)
- [ ] 6.2 compacting session refuses the reload · see
      `session-action-handler-reload-predicate.test.ts` · Triple: session flagged compacting ·
      `dispatchReload` · no keeper write, no respawn, `error` with the wait wording
      (test-plan #X8)
- [ ] 6.3 fallback refuses a connected streaming session · see
      `session-action-handler-headless-reload.test.ts` · Triple: connected + streaming, fallback
      branch · `dispatchReload` · no respawn, `error` feedback (test-plan #X5)
- [ ] 6.4 bridge-dead session stuck at `streaming` is still respawnable · see
      `session-action-handler-headless-reload.test.ts` · Triple: PID present, no keeper, not
      connected, `status:"streaming"` · `dispatchReload` · respawn proceeds, stale status does not
      refuse (test-plan #X4)

## 7. Tests — fault injection (L1)

- [ ] 7.1 keeper write returns `false` → respawn fallback · see
      `dispatch-extension-command-router.test.ts` · Triple: `writeRpc` false, PID present ·
      `dispatchReload` · respawn taken, one terminal feedback (test-plan #X1)
- [ ] 7.2 keeper write throws on a PID-less session → `error` with reason, no spawn · see
      `dispatch-extension-command-router.test.ts` · Triple: `writeRpc` rejects, no PID ·
      `dispatchReload` · terminal `error` carrying the reason (test-plan #X2)
- [ ] 7.3 connection drops between probe and send → fallback, not a silent drop · see
      `session-action-handler-reload-predicate.test.ts` · Triple: `isSessionConnected=true` but
      `sendToSession` returns `false`, PID present · `dispatchReload` · respawn taken
      (test-plan #X3)

## 8. Tests — harness smoke (L2)

- [ ] 8.1 reload with the dashboard extension disabled degrades documented-ly · see
      `qa/tests/09-image-fit-extension.sh` · Triple: headless pi spawned with the extension
      disabled · `dispatchReload` · line becomes a user message, server still emits exactly one
      terminal event, no crash/duplicate (test-plan #X9)
- [ ] 8.2 version skew: new server + OLD extension still reloads via keeper · see
      `qa/tests/02-server-start.sh` · Triple: new server, session on the old extension ·
      `dispatchReload` · reload succeeds (keeper path independent of new extension code)
      (test-plan #X10)
- [ ] 8.3 fan-out scale · see `qa/tests/03-websocket.sh` · Triple: 20 connected headless sessions ·
      one package-install fan-out · all 20 dispatched, zero respawns, fan-out returns within 5 s
      (test-plan #P1)

## 9. Tests — browser e2e (L3)

- [ ] 9.1 exactly one terminal `/reload` pill, card not permanently `ended` · see
      `tests/e2e/worktree-init-feedback.spec.ts` · Triple: dashboard on a headless session ·
      reload button · chat converges to one terminal pill, never stuck `in progress`
      (test-plan #F1)
- [ ] 9.2 reload does not terminate the process · see
      `tests/e2e/replay-delta-on-reload.spec.ts` · Triple: headless session in the harness, PID
      recorded · reload button · PID unchanged, session answers a follow-up prompt
      (test-plan #F2)
- [ ] 9.3 session-record flap converges and preserves accumulated state · see
      `tests/e2e/replay-delta-on-reload.spec.ts` · Triple: session visible on the board · reload ·
      card converges to `active`, token/cost fields survive the re-register (test-plan #F3)
- [ ] 9.4 streaming session refuses with the wait wording, stream completes · see
      `tests/e2e/chat-render-fx.spec.ts` · Triple: session mid-stream · reload button · one
      `/reload` pill with `error`, stream finishes normally (test-plan #F4)
- [ ] 9.5 fan-out toasts coalesce within 2000 ms · see
      `tests/e2e/package-queue-visible.spec.ts` · Triple: 5 connected sessions · package-install
      fan-out · ≤1 `/reload` toast in the window while 5 per-session feedback events exist
      (test-plan #F5)

## 10. Manual verification (test-plan: manual-only)

- [ ] 10.1 Read the busy-session refusal text as an operator — is it actionable rather than
      alarming? (test-plan: manual-only, #M1)
- [ ] 10.2 Watch a ~10-session board through a fan-out reload — is the card flicker tolerable?
      (test-plan: manual-only, #M2)

## 11. Docs and close-out

- [ ] 11.1 Hand-rewrite the `## Purpose` block of `openspec/specs/headless-reload/spec.md` at
      sync/archive time — an OpenSpec delta cannot modify Purpose, and the current text
      ("unreachable from headless/RPC mode", "via kill-and-respawn") is falsified by this change
- [ ] 11.2 Delegate to DocScribe: rewrite `docs/architecture.md` "`/reload` Flow" (currently at
      `:1121`) for the new ladder; apply the returned directory-`AGENTS.md` rows
- [ ] 11.3 `npm test` green; `npm run quality:changed` clean
- [ ] 11.4 Run `review-code` on the full diff before commit
