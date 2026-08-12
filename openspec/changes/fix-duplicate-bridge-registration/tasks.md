## 1. Red reproduction — author before any production change

- [ ] 1.1 Create `packages/server/src/__tests__/pi-gateway-duplicate-register.test.ts`; copy harness glue from `packages/server/src/__tests__/bridge-register-nondestructive.test.ts` (real `wss` + client sockets) and confirm the suite runs empty-green before adding cases.
- [ ] 1.2 Author E1: socket A registered for `S` and pongs · socket B sends `session_register` for `S` · `connections.get(S) === A`, B closed, `sendToSession(S,…)` arrives on A only — see `bridge-register-nondestructive.test.ts`. Expect RED (test-plan #E1).
- [ ] 1.3 Author E13: B refused for `S` · inspect gateway state after refusal · B is `CLOSED` and present under no session id — see `bridge-register-nondestructive.test.ts`. Expect RED (test-plan #E13).
- [ ] 1.4 Author E14: a socket accepted by `wss` but absent from the routing table · `stop()` · that socket is terminated — see `packages/server/src/__tests__/pi-gateway-bind-host.test.ts` for gateway start/stop glue. Expect RED (test-plan #E14).
- [ ] 1.5 Author E15: A owns entry for `S`, a different socket previously referenced `S` · that socket closes · entry for `S` still resolves to A — see `bridge-register-nondestructive.test.ts`. Expect RED (test-plan #E15).

## 2. D3 — identity-scoped cleanup and teardown

- [ ] 2.1 Author E16: same input as E15 · that socket closes · no disconnect signalled for `S`, heartbeat and reconnect-grace timers unchanged — see `bridge-register-nondestructive.test.ts` (test-plan #E16).
- [ ] 2.2 Author E17: automation session `S` served by socket A, a different socket previously referenced `S` · that socket closes · `S` neither unregistered nor finalized — see `packages/server/src/__tests__/finalize-automation-run.test.ts` if present, else `bridge-register-nondestructive.test.ts` (test-plan #E17).
- [ ] 2.3 Author E18: socket A owns entry for `S` · A closes · cleanup proceeds as today for that session kind — see `bridge-register-nondestructive.test.ts` (test-plan #E18).
- [ ] 2.4 Guard every id-keyed cleanup in `ws.on("close")` with `connections.get(id) === ws`: the map delete, `onDisconnect`, `sessionManager.unregister`, the automation finalize, and the `heartbeatTimers` / `heartbeatMeta` deletes.
- [ ] 2.5 Change `stop()` to terminate `wss.clients` instead of `connections.values()`, then clear the routing table.
- [ ] 2.6 Verify 1.4, 1.5, 2.1, 2.2, 2.3 GREEN; 1.2 and 1.3 still RED.

## 3. D0 — single contention-checked claim point, no side effects before the decision

- [ ] 3.1 Author E2: socket A owns `S` and is live · socket B's first message is `event_forward` carrying `sessionId: S` · B never becomes the routing entry for `S` — see `bridge-register-nondestructive.test.ts` (test-plan #E2).
- [ ] 3.2 Author E5: A owns `S1`, no socket holds `S2` · A registers `S2` · accepted, placeholder cleanup for `S1` applies unchanged — see `bridge-register-nondestructive.test.ts` (test-plan #E5).
- [ ] 3.3 Author E12: entry for `S` held by an auto-created placeholder with no pid · a socket sends `session_register` for `S` · accepted and becomes the entry, never refused — see `bridge-register-nondestructive.test.ts` (test-plan #E12).
- [ ] 3.4 Author X6: socket owns `S1`, a different live socket owns `S2` · it registers `S2` · decision taken before `clearByToken/Pid/Cwd`, no pending spawn watchdog disarmed — see `packages/server/src/__tests__/spawn-register-watchdog.test.ts` (test-plan #X6).
- [ ] 3.5 Move the contention check into the first-message identity block (`pi-gateway.ts:262`) and hoist the id-change decision above the watchdog clear at `:285`.
- [ ] 3.6 Make the refusal path short-circuit before the watchdog clear, placeholder cleanup, `resetHeartbeat`, the connection/created callbacks, and `onEvent`.
- [ ] 3.7 Verify 3.1–3.4 GREEN.

## 4. D1/D2 — two-factor probe, same-pid exemption, terminal refusal

- [ ] 4.1 Author E6: A owns `S` and pongs at t=4.9 s · B registers `S`, probe window 5 s · A keeps the entry, not terminated, B refused — use fake timers as in `packages/server/src/__tests__/auto-resume.test.ts` (test-plan #E6).
- [ ] 4.2 Author E7: A owns `S`, never pongs, `_socket.writable === true` · B registers `S`, 5 s elapses · A keeps the entry and is NOT terminated, B refused — see `auto-resume.test.ts` for timer glue (test-plan #E7).
- [ ] 4.3 Author E8: A owns `S`, never pongs, socket destroyed/not writable · B registers `S`, 5 s elapses · A terminated, entry cleared, B accepted (test-plan #E8).
- [ ] 4.4 Author E3: incumbent socket for `S` is `CLOSED` · another socket registers `S` · newcomer accepted, no probe issued (test-plan #E3).
- [ ] 4.5 Author E4: socket A owns `S` · A re-registers `S` · accepted, remains the entry, no probe issued (test-plan #E4).
- [ ] 4.6 Author E9: A owns `S` and is live · B registers with `isNew:true` / `registerReason:"resume"` · outcome identical to E6 (test-plan #E9).
- [ ] 4.7 Author E10: A owns `S`, gateway recorded `pid=4242` · B registers `S` reporting `pid=4242` · B becomes the entry, not refused, no probe required (test-plan #E10).
- [ ] 4.8 Author E11: A owns `S` recorded `pid=4242` and pongs · B registers reporting `pid=9999` · resolved by probe alone, B refused (test-plan #E11).
- [ ] 4.9 Author E19: two sockets have claimed `S` and contention resolved · inspect routing · exactly one socket routable, the other closed (test-plan #E19).
- [ ] 4.10 Add the 5 s probe-window constant next to `WS_PING_INTERVAL` in `pi-gateway.ts` and implement the two-factor rule: pong → incumbent keeps; no pong but `_socket.writable` → incumbent keeps; neither → terminate incumbent and accept the newcomer.
- [ ] 4.11 Implement the same-pid reconnect exemption (replace, do not refuse) and the placeholder-is-never-protected rule.
- [ ] 4.12 Author X7: B refused for `S` · observe the wire · rejection message naming `S` and the reason sent before the close (test-plan #X7).
- [ ] 4.13 Author X8: bridge receives a contention rejection for `S` · its reconnect logic runs · no reconnect/re-register for `S`, reason surfaced — see `packages/extension/src/__tests__/` connection tests for bridge-side glue (test-plan #X8).
- [ ] 4.14 Add the rejection message type to `packages/shared/src/protocol.ts` and send it before closing the loser.
- [ ] 4.15 Handle the rejection in `packages/extension/src/connection.ts`: stop retrying for that session id and surface the reason.
- [ ] 4.16 Verify 1.2, 1.3 and 4.1–4.13 GREEN.

## 5. D0/D2 — refused register has no side effects; the duplicate spawn is reclaimed

- [ ] 5.1 Author X1: refused register carries `sessionFile: F` · B refused for `S` · incumbent's `sessionFile` is still `F` — see `packages/server/src/__tests__/event-wiring-resume-clear.test.ts` (test-plan #X1).
- [ ] 5.2 Author X2: refused register carries a spawn token · B refused · watchdog for that token still armed — see `spawn-register-watchdog.test.ts` (test-plan #X2).
- [ ] 5.3 Author X3: refused register · B refused · no session-registered event emitted, no ghost/placeholder cleanup ran (test-plan #X3).
- [ ] 5.4 Author X4: refused register · B refused · incumbent's heartbeat and reconnect-grace timers unchanged (test-plan #X4).
- [ ] 5.5 Author X5: socket that does not own `S` sends `session_heartbeat` / `model_update` naming `S` · message dropped, incumbent's timer and `processMetrics` unchanged (test-plan #X5).
- [ ] 5.6 Drop messages from a socket that does not own the id (covers the probe window and in-flight messages from a refused socket).
- [ ] 5.7 Author X11: spawn armed from a caller with no browser WebSocket · that spawn never registers · reclaim still performed — see `spawn-register-watchdog.test.ts` (test-plan #X11).
- [ ] 5.8 Make the watchdog's browser transport optional so the reclaim runs without a `ws`, and arm it on every spawn entry point: REST resume, WebSocket resume, zombie reopen, headless reload.
- [ ] 5.9 Author X10: server-spawned duplicate refused for `S` · wait past `spawnRegisterTimeoutMs` · duplicate pi gone, single writer on the incumbent's `.jsonl` — add to `qa/tests/`, copy process/CLI glue from `qa/tests/03-websocket.sh` (+ `.ps1` twin) (test-plan #X10).
- [ ] 5.10 Verify 5.1–5.9 GREEN.

## 6. D4/D6 — prompt honesty, contention record, observability

- [ ] 6.1 Author F1: session `S` with a live contention record · `POST /api/session/S/prompt` · not a plain success, names the bridge state, and states the prompt was delivered — see `packages/server/src/__tests__/session-api.test.ts` (test-plan #F1).
- [ ] 6.2 Author F2: session with no live bridge · prompt · existing no-bridge failure unchanged and distinguishable from F1 — see `session-api.test.ts` (test-plan #F2).
- [ ] 6.3 Author F3: session with exactly one live bridge and no record · prompt · plain success as today — see `session-api.test.ts` (test-plan #F3).
- [ ] 6.4 Author F4: `S` has a live record, incumbent stays connected · refused spawn reclaimed or 60 s expiry elapses · record cleared while incumbent connected, next prompt succeeds (test-plan #F4).
- [ ] 6.5 Author F5: `S` has a live record · incumbent disconnects by clean close or `terminate()` · record cleared on both paths (test-plan #F5).
- [ ] 6.6 Implement the contention record with a 60 s expiry, cleared by whichever comes first: reclaim, expiry, incumbent disconnect, session end.
- [ ] 6.7 Change `POST /api/session/:id/prompt` to annotate rather than fail when a record is live, including the delivered flag.
- [ ] 6.8 Author F7: ≥1 refusal recorded · `GET /api/health` · cumulative refusal count and contended id list present — extend `packages/server/src/__tests__/health-shape.test.ts` (test-plan #F7).
- [ ] 6.9 Author F8: a contended session ends or disconnects · `GET /api/health` · id no longer listed, cumulative count unchanged — extend `health-shape.test.ts` (test-plan #F8).
- [ ] 6.10 Author F6: dashboard open on the harness port from `.pi-test-harness.json#dashboardPort`, one refusal provoked · client polls `/api/health` · contended id appears then disappears after expiry, no stuck badge — copy harness glue from `tests/e2e/anthropic-bridge-activation.spec.ts` (test-plan #F6).
- [ ] 6.11 Surface the counter and the contended id list on `/api/health`.
- [ ] 6.12 Author L1a: incumbent pid 37660, newcomer pid 17579 · refusal for `S` · one stderr line with `S` and both pids, not matching `[gateway] session registered: <id> cwd=<cwd>` (test-plan #L1a).
- [ ] 6.13 Author L2a: incumbent or newcomer has `pid: undefined` · refusal · line still emitted with an explicit unknown placeholder, never omitted, never throws (test-plan #L2a).
- [ ] 6.14 Author L3a: ordinary accepted re-register · register accepted · existing registration line logged, no contention line (test-plan #L3a).
- [ ] 6.15 Author X9: a bridge that ignores the rejection re-registers repeatedly for 30 s · refused each time, log and health entry emitted at most once per 5 s for `S` (test-plan #X9).
- [ ] 6.16 Implement the contention log line and the per-session-id 5 s rate limit for both the log and the health entry.
- [ ] 6.17 Verify 6.1–6.15 GREEN.

## 7. D5 — resume guard keyed on the session file

- [ ] 7.1 Author X12: session `A`'s `sessionFile` `F` served by a live bridge under a different id `B` · `POST /api/session/A/resume` continue · refused naming the already-live session, no pi spawned — see `packages/server/src/__tests__/session-api.test.ts` (test-plan #X12).
- [ ] 7.2 Author X13: the same resume via the WebSocket session-action path · identically refused — see `packages/server/src/__tests__/auto-resume.test.ts` for the WS action glue (test-plan #X13).
- [ ] 7.3 Author X14: `F` recorded against a session whose bridge is gone · resume continue · proceeds, zombie behaviour preserved (test-plan #X14).
- [ ] 7.4 Author X15: `F` served by a bridge that neither pongs nor is writable · resume continue · not live, resume proceeds (test-plan #X15).
- [ ] 7.5 Author X16: `F` served by a bridge that does not pong but is writable · resume continue · refused, consistent with E7 (test-plan #X16).
- [ ] 7.6 Author X17: a live session with `sessionFile: undefined` · any resume · causes no refusal (test-plan #X17).
- [ ] 7.7 Author X18: `F` served by a live bridge · fork the session · fork proceeds, guard does not apply (test-plan #X18).
- [ ] 7.8 Add a "is this `sessionFile` served by a live bridge under any session id" lookup that runs before the register-time `sessionFile` mutation and uses D1's liveness definition.
- [ ] 7.9 Extend the 409 at both guard sites — `session/session-api.ts` and `browser-handlers/session-action-handler.ts` — to hard-refuse a `continue` whose target `sessionFile` is already live.
- [ ] 7.10 Verify 7.1–7.7 GREEN.

## 8. Performance

- [ ] 8.1 Author P1: 200 sequential uncontended registers · p95 added latency < 5 ms vs. the pre-change baseline · single run — see `packages/server/src/__tests__/browser-gateway-load.test.ts` for the timing harness (test-plan #P1).
- [ ] 8.2 Author P2: one contended register against a silent-but-writable incumbent · resolves in ≥ 5 s and < 6 s, never hangs the connection handler · single run (test-plan #P2).
- [ ] 8.3 Author P3: an old bridge looping refused registers for 5 min · ≤ 60 refusal log lines and a flat `/api/health` payload · 5 min soak — see `browser-gateway-load.test.ts` (test-plan #P3).

## 9. Verification

- [ ] 9.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then grep the summary pattern; full suite green.
- [ ] 9.2 Revert-check: temporarily restore the unconditional `connections.set(...)` at the claim point and confirm E1 goes red again (proves the test has teeth, not vacuous).
- [ ] 9.3 Restart per the rebuild matrix (server change → `curl -X POST http://localhost:8000/api/restart`) and confirm `activeBridgeCount` plus one registration per id in `server.log`.
- [ ] 9.4 M1 manual: on the live dashboard, resume the same `.jsonl` from a second keeper, then prompt the original session; confirm the refusal is logged with both pids, the duplicate pi is reclaimed, the original transcript grows, and exactly one `session registered` per id (test-plan: manual-only).
- [ ] 9.5 Restore `keeperLog.capturePiOutput=false` in `~/.pi/dashboard/config.json` if still enabled from the incident (backup at `/tmp/config.json.bak`).

## 10. Documentation

- [ ] 10.1 Delegate to DocScribe (caveman style): document the one-live-bridge-per-session-id invariant, the two-factor contention rule and its 5 s probe window, the terminal-refusal protocol message, and the session-file resume guard in `docs/architecture.md`.
- [ ] 10.2 Apply the returned tree rows to `packages/server/src/pi/AGENTS.md`, `packages/shared/src/AGENTS.md`, and `packages/extension/src/AGENTS.md`, including `See change: fix-duplicate-bridge-registration`.
