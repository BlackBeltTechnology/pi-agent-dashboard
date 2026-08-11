## 1. Reproduction (red first)

- [ ] 1.1 Add `packages/server/src/__tests__/pi-gateway-duplicate-register.test.ts`: connect socket A, `session_register` for `S`, then connect socket B and `session_register` for the same `S`; assert `sendToSession(S, …)` is received by A and NOT by B. Expect RED against current `pi-gateway.ts`.
- [ ] 1.2 Extend the repro with the leak assertion: after B's register, assert B is closed and appears under no session id. Expect RED.
- [ ] 1.3 Add the survives-teardown case: accept a socket that is not in the routing table, call `stop()`, assert it is terminated. Expect RED (today `stop()` walks `connections.values()`).
- [ ] 1.4 Add the misdirected-cleanup case: A owns `S`, a different socket that previously referenced `S` closes, assert `S` still routes to A. Expect RED for the automation branch.

## 2. Identity-scoped cleanup and teardown (D3)

- [ ] 2.1 In `pi-gateway.ts` `ws.on("close")`, guard every routing-table removal with `connections.get(id) === ws` (covers the automation branch at the `connections.delete(currentSessionId)` call).
- [ ] 2.2 Change `stop()` to terminate `wss.clients` instead of `connections.values()`, then clear the routing table.
- [ ] 2.3 Verify 1.3 and 1.4 go GREEN; 1.1/1.2 still RED.

## 3. Contention rule (D1/D2)

- [ ] 3.1 In the `session_register` handler, before `connections.set(...)`, detect contention: an existing entry for `msg.sessionId` that is a **different** socket AND `readyState === OPEN`.
- [ ] 3.2 On contention: leave the incumbent entry untouched, refuse the newcomer, close its socket, and return without registering, without `sessionManager.register`, and without firing `onSessionRegistered`/`onConnection`.
- [ ] 3.3 Confirm the non-contention paths are untouched: closed incumbent, same socket re-registering, and a socket changing its `sessionId` (existing placeholder cleanup must still run).
- [ ] 3.4 Confirm the refusal predicate reads socket state ONLY — no heartbeat age, no ping-miss count, no `isNew`/`registerReason` from the register payload.
- [ ] 3.5 Verify 1.1 and 1.2 go GREEN.
- [ ] 3.6 Add the reaper-recovery test: terminate the incumbent as TCP-dead, assert the routing entry clears and a following register from another socket is ACCEPTED.

## 4. Contention observability

- [ ] 4.1 Log a distinct contention line on refusal carrying session id, incumbent pid, and newcomer pid; assert it does NOT match the accepted-register line `[gateway] session registered: <sessionId> cwd=<cwd>`.
- [ ] 4.2 Assert an ordinary accepted re-register logs the existing registration line and NO contention line.
- [ ] 4.3 Surface contention on `/api/health` (affected session ids + a cumulative counter — resolves the design's second Open Question); extend `health-shape.test.ts`.

## 5. Prompt API honesty (D4)

- [ ] 5.1 In `session-api.ts`, make `POST /api/session/:id/prompt` distinguish a contended/ambiguous bridge from a healthy one instead of returning plain `{"success":true}`.
- [ ] 5.2 Assert the existing no-bridge failure is unchanged, and a healthy single-bridge session still returns success.

## 6. Resume guard keyed on session file (D5)

- [ ] 6.1 Add a lookup for "is this `sessionFile` served by a live bridge under any session id".
- [ ] 6.2 In `/api/session/:id/resume`, extend the existing 409 so a `continue` whose target `sessionFile` is already live is hard-refused with an error naming the already-live session; no silent reuse, no force flag.
- [ ] 6.3 Assert the zombie path still resumes (`isSessionProcessGone`) and that `fork` is unaffected.
- [ ] 6.4 Add the regression matching the incident: session file `F` live under id `B`, resume card `A` (also backed by `F`) → refused, no pi spawned.

## 7. Verification

- [ ] 7.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` then grep the summary pattern; full suite green.
- [ ] 7.2 Revert-check the rule: temporarily restore the unconditional `connections.set(...)` and confirm 1.1 goes red again (proves the test has teeth, not vacuous).
- [ ] 7.3 Restart the dashboard per the rebuild matrix (server change → `curl -X POST http://localhost:8000/api/restart`) and confirm `activeBridgeCount` and one-registration-per-id in `server.log`.
- [ ] 7.4 Manual: spawn a session, force a second keeper against the same session file, confirm it is refused, logged with both pids, visible in `/api/health`, and that the original session still answers a prompt with transcript growth.
- [ ] 7.5 Restore `keeperLog.capturePiOutput=false` in `~/.pi/dashboard/config.json` if it is still enabled from the incident (backup at `/tmp/config.json.bak`).

## 8. Documentation

- [ ] 8.1 Delegate to DocScribe (caveman style): document the one-live-bridge-per-session-id invariant, the contention rule, and the session-file resume guard in `docs/architecture.md`.
- [ ] 8.2 Apply the returned tree rows to `packages/server/src/pi/AGENTS.md` (and `docs/AGENTS.md` if a docs file is added), including `See change: fix-duplicate-bridge-registration`.
