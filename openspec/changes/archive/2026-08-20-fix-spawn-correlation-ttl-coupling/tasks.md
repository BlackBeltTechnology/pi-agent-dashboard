Test tasks are folded from `test-plan.md`; each carries its scenario id, its
Triple, and the nearest existing test to copy harness glue from. 58 automated
rows, 0 manual-only.

## 1. Shared constants and the derived TTL

- [x] 1.1 Create the shared module exporting `RECOVERY_GRACE_MS = 60_000` and `ORDERING_MARGIN_MS = 5_000`, imported by both the watchdog and every TTL derivation, so no literal survives at either site
- [x] 1.2 Test: timeout 30_000, correlation recorded · read the TTL used · TTL === 95_000 not 60_000 (test-plan #E1; see packages/server/src/__tests__/pending-client-correlations.test.ts or the nearest pending-*-registry test)
- [x] 1.3 Test: timeout at lower bound 5_000 · correlation recorded · TTL === 70_000 and the recovery window stays 60_000 (test-plan #E2; see #E1's file)
- [x] 1.4 Test: timeout at upper bound 120_000 · correlation recorded · TTL === 185_000 (test-plan #E3; see #E1's file)
- [x] 1.5 Test: timeout 90_000, recorded at t=0 · consume at t+89_999ms on fake timers · resolves to the recorded requestId (test-plan #E4; see #E1's file)
- [x] 1.6 Test: timeout 90_000, recorded at t=0 · consume at t+155_001ms · returns undefined (test-plan #E5; see #E1's file)
- [x] 1.7 Test: inspect pending-client-correlations source · assert no hardcoded constant governs entry expiry (test-plan #E6; see packages/server/src/__tests__/spawn-correlation-token-integration.test.ts)
- [x] 1.8 Change `createPendingClientCorrelations` to take the TTL per `record()` call rather than at construction, and delete `DEFAULT_TTL_MS` plus the stale "60s TTL aligned with…" comment

## 2. One configuration read per spawn

- [x] 2.1 Test: armed from a read of 120_000, config lowered to 30_000 before record · record the correlation · TTL derived from 120_000 (test-plan #E7; see packages/server/src/__tests__/spawn-correlation-token-integration.test.ts)
- [x] 2.2 Test: armed from 30_000, config raised to 120_000 before record · record · TTL derived from 30_000 so arm and TTL agree (test-plan #E8; see #E7's file)
- [x] 2.3 Test: timeout 90_000, correlation recorded on the resume/fork path and on the degrade path · consume at t+70s · both resolve with no 60_000 literal (test-plan #E9; see #E7's file)
- [x] 2.4 Thread the handler's config value into the arm so `armSpawnWatchdog` no longer performs its own `loadConfig()` on the resume and degrade paths — signature change, not a constant swap
- [x] 2.5 Apply the derived TTL at all three `pendingClientCorrelations.record` sites in browser-handlers/session-action-handler.ts (spawn, resume/fork, degrade)

## 3. Fork registry, and the registries deliberately left alone

- [x] 3.1 Test: default timeout 30_000, fork entry recorded · consume at t+29_000ms · entry still consumable (test-plan #E10; see packages/server/src/__tests__/pending-fork-registry.test.ts)
- [x] 3.2 Test: timeout 90_000, fork entry recorded · consume at t+70_000ms · still consumable (test-plan #E11; see #E10's file)
- [x] 3.3 Derive `pendingForkRegistry`'s per-entry expiry from the same read, replacing `EXPIRY_MS = 30_000`
- [x] 3.4 Test: timeout raised to 120_000 · inspect the pending-attach expiry · unchanged at 60_000, its anti-strand bound intact (test-plan #E12; see packages/server/src/__tests__/pending-attach-registry.test.ts)
- [x] 3.5 Test: timeout raised to 120_000 · inspect the pending-resume-intent expiry · unchanged at 60_000, its anti-poison bound intact (test-plan #E13; see packages/server/src/__tests__/pending-resume-intent-registry.test.ts)

## 4. Correlation survives the fire and is consumed once

- [x] 4.1 Test: armed spawn with a recorded correlation · watchdog timer fires · correlation entry still present afterwards (test-plan #E14; see packages/server/src/__tests__/spawn-register-watchdog.test.ts)
- [x] 4.2 Stop fire handling from deleting the `pendingClientCorrelations` entry; leave the other registry clears untouched
- [x] 4.3 Test: fired entry with token and correlation · clearByToken then the register broadcast path · watchdog does not consume, broadcast does, session_added carries spawnRequestId (test-plan #E15; see #E1's integration file)
- [x] 4.4 Test: fired token-bearing entry with a recorded requestId · late clearByToken · emitted message carries no requestId field (test-plan #E19; see packages/server/src/__tests__/spawn-register-watchdog.test.ts)

## 5. Watchdog indices, clears and cwd normalization

- [x] 5.1 Test: two same-cwd spawns with distinct tokens both fire · clearByToken for the first · one recovery, second entry intact (test-plan #E16; see packages/server/src/__tests__/spawn-register-watchdog.test.ts)
- [x] 5.2 Test: fired entry that has a token · clearByCwd for its cwd · no recovery, token entry survives (test-plan #E17; see #E16's file)
- [x] 5.3 Test: fired entry reachable by token · clearByToken then clearByCwd · exactly one spawn_register_recovered (test-plan #E18; see #E16's file)
- [x] 5.4 Key `recentlyFired` by token when present and by cwd only otherwise — one index per entry
- [x] 5.5 Test: arm with /tmp/x symlinked to /private/tmp/x · clear with /private/tmp/x · watchdog cancelled (test-plan #E20; see #E16's file)
- [x] 5.6 Test: arm with a non-existent path · clear with the identical raw string · cancelled, no throw (test-plan #E21; see #E16's file)
- [x] 5.7 Extract the shared realpath-based cwd normalizer and apply it at arm and at every clear, raw-string fallback on any error
- [x] 5.8 Test: spawns A and B armed for the same cwd with distinct tokens · A registers with its token · A cancelled and B still armed and still fires (test-plan #E22; see packages/server/src/__tests__/pi-gateway-duplicate-register.test.ts)
- [x] 5.9 Test: token-less tmux spawn armed by cwd · register with cwd only · cancelled via the cwd tier (test-plan #E23; see #E22's file)
- [x] 5.10 Make the pi-gateway clear cascade tier-aware so a successful token clear does not go on to cancel a different spawn's cwd-indexed arm

## 6. `hidden` decided from the dashboard-spawn signal

- [x] 6.1 Test: hasUI false, source "tui", dashboardSpawned true, first register, no intent · register · stored hidden === false (test-plan #E24; see packages/server/src/__tests__/memory-session-manager.test.ts)
- [x] 6.2 Test: hasUI false, no dashboardSpawned, first register, no intent · register · stored hidden === true (test-plan #E25; see #E24's file)
- [x] 6.3 Test: hasUI false, no signal, visibilityIntent "visible" · register · hidden === false, intent wins (test-plan #E26; see #E24's file)
- [x] 6.4 Test: prior record hidden true, registerReason "reattach", hasUI undefined · register · hidden stays true and the heuristic is not consulted (test-plan #E27; see #E24's file)
- [x] 6.5 Test: dashboardSpawned arriving as "yes" / 1 / {} · register · coerced to a strict boolean and a non-true value does not un-hide (test-plan #E28; see packages/server/src/__tests__/pi-gateway-duplicate-register.test.ts)
- [x] 6.6 Test: session_register carrying dashboardSpawned true · gateway forwards to register · the value reaches register params rather than undefined (test-plan #E29; see #E28's file)
- [x] 6.7 Plumb `dashboardSpawned` through the pi-gateway register call with the same normalization `hasUI` and `visibilityIntent` already get
- [x] 6.8 Change the `hidden` expression to read the normalized signal instead of `params.source`, preserving the reattach and visibilityIntent precedence exactly
- [x] 6.9 Invoke the `doubt-driven-review` discipline skill on the visibility change before it stands

## 7. Watchdog observability

- [x] 7.1 Test: token-bearing entry fires · inspect the appended REGISTER_TIMEOUT · entry includes that spawnToken (test-plan #E36; see packages/server/src/__tests__/spawn-register-watchdog.test.ts)
- [x] 7.2 Test: watchdog constructed with 30_000, entry armed with 90_000 · entry fires · logged line and persisted entry both name 90_000 (test-plan #E37; see #E36's file)
- [x] 7.3 Add fire and recovery log lines naming cwd, pid and token where known, with the matched tier on recovery
- [x] 7.4 Add `spawnToken` to the appended failure entry and switch its message to the per-entry effective timeout instead of `this.timeoutMs`
- [x] 7.5 Append a recovery record joined by token, preserving the append-only rotating shape of the log
- [x] 7.6 Invoke the `observability-instrumentation` discipline skill for this group

## 8. Prompt transmitted vs delivered

- [x] 8.1 Test: live bridge with a contention record · POST /api/session/:id/prompt · no delivered true, reports transmitted, contention warning retained (test-plan #E30; see packages/server/src/__tests__/contention-resume-guard-api.test.ts — UPDATE its existing delivered assertion)
- [x] 8.2 Test: live bridge, no contention · same POST · reports transmitted, success true (test-plan #E31; see packages/server/src/__tests__/session-api.test.ts)
- [x] 8.3 Test: no OPEN socket · same POST · not transmitted, success false, HTTP 502 as today (test-plan #E32; see #8.2's file)
- [x] 8.4 Remove the unconditional `delivered: true` from the contended branch and report transmission explicitly on every branch including the bare-success path
- [x] 8.5 Test: timeout 30_000, prompt transmitted and never acknowledged · advance fake timers past 95_000ms · pending entry evicted (test-plan #E34; see #8.2's file)
- [x] 8.6 Test: prompt pending acknowledgement · session unregisters · pending entry evicted immediately (test-plan #E35; see #8.2's file)
- [x] 8.7 Test: ack arrives from a displaced connection while a second bridge owns the id · prompt not marked delivered (test-plan #X9; see packages/server/src/__tests__/bridge-contention.test.ts)
- [x] 8.8 Test: bridge that sends no ack · prompt transmitted · stays transmitted, request does not fail, state still evicted (test-plan #X10; see #8.2's file)
- [x] 8.9 Add the per-prompt handle to the outbound prompt message and the optional bridge→server acknowledgement, accepted only from the current owner connection, published on the session event stream
- [x] 8.10 Bound pending-ack state on the same derived window as the correlations plus eviction on unregister

## 9. Dropped inbound message reporting

- [x] 9.1 Test: connected bridge, 100 drops inside one 60_000ms window · flood the pump · at most 10 reports emitted with suppression conveyed (test-plan #E33; see packages/extension/src/__tests__/ nearest connection/pump test)
- [x] 9.2 Test: socket down at drop time · reportable drop occurs · no report attempted and nothing queued for reconnect (test-plan #X5; see #9.1's file)
- [x] 9.3 Test: socket closes between the liveness check and the send · reportable drop · no report buffered for post-reconnect delivery (test-plan #X6; see #9.1's file)
- [x] 9.4 Test: bridge reports a drop naming a session it does not own · report sent · reaches the server handler and is not discarded by session-ownership routing (test-plan #X7; see packages/server/src/__tests__/pi-gateway-duplicate-register.test.ts)
- [x] 9.5 Test: capturePiOutput false, force a session-id-mismatch drop on a live bridge · the drop appears in server.log (test-plan #X8; see qa/tests/03-websocket.sh)
- [x] 9.6 Add the drop report from both drop sites — the mismatch guard in command-handler and the overflow path in connection — carrying the dropped session id as payload, never as the routing field
- [x] 9.7 Gate reporting on a live connection with no buffering fallback, and bound it at 10 per session per 60_000ms
- [x] 9.8 Record the reported drop in server.log naming session id, message type and class

## 10. Error-handling and boundary tests

- [x] 10.1 Test: no clear at all · 60_001ms after the fire · entry evicted and no recovery emitted (test-plan #X1; see packages/server/src/__tests__/spawn-register-watchdog.test.ts)
- [x] 10.2 Test: ws.readyState not OPEN · late clear inside the window · send skipped silently, entry deleted, no throw (test-plan #X2; see #10.1's file)
- [x] 10.3 Test: realpath throws EACCES rather than ENOENT · arm and clear · falls back to the raw string with no throw (test-plan #X3; see #10.1's file)
- [x] 10.4 Test: arm-before-record resume path · register in the final 1ms of the recovery window · correlation still resolvable so no recovery is emitted without spawnRequestId (test-plan #X4; see packages/server/src/__tests__/spawn-correlation-token-integration.test.ts)
- [x] 10.5 Test: fire-time reclaim succeeds and no register ever arrives · no recovery and the REGISTER_TIMEOUT entry carries no recovery record (test-plan #X11; see #10.1's file)

## 11. Performance

- [x] 11.1 Test: 1 000 arm+clear pairs · added wall-clock per pair p95 under 2ms (test-plan #P1; see packages/server/src/__tests__/contention-performance.test.ts)
- [x] 11.2 Test: 10 000 inbound messages overflowing the queue · inbound dispatch p95 within 10 percent of a no-report baseline (test-plan #P2; see #11.1's file)
- [x] 11.3 Test: 5 000 spawns at timeout 120_000 none registering · correlation map returns to 0 entries after TTL and RSS delta under 10MB (test-plan #P3; see #11.1's file)
- [x] 11.4 Invoke the `performance-optimization` discipline skill if any of 11.1-11.3 goes red

## 12. Browser end-to-end

- [x] 12.1 L1-PINNED (not re-run live): the >60s register boundary is pinned deterministically by E4/E5 (89_999ms resolves / 155_001ms evicted), E7/E8 and X4; a live variant costs a 70s wall-clock wait to re-assert the same arithmetic more flakily. Rationale recorded in `tests/e2e/spawn-correlation-recovery.spec.ts`. Original: Test: dashboard spawn at spawnRegisterTimeoutMs 90_000 · bridge registers at t+70s · UI converges to the session opened and the placeholder cleared (test-plan #F1; see tests/e2e/project-trust-headless-spawn.spec.ts)
- [x] 12.2 Test: spawn whose watchdog fired and whose reclaim missed · bridge registers inside the recovery window · banner clears and the card appears, never one without the other (test-plan #F2; see #12.1's file)
- [x] 12.3 Test: dashboard-spawned session reporting hasUI false · it registers · present in the sidebar and not filtered into Hidden (test-plan #F3; see tests/e2e/session-reap.spec.ts)
- [x] 12.4 Test: headless worker in the same cwd with no dashboard signal · it registers · stays in the Hidden tier and does not steal focus from a pending spawn (test-plan #F4; see #12.3's file)
- [x] 12.5 Test: two dashboard spawns into one cwd · the first registers · the second's placeholder persists and resolves on its own register (test-plan #F5; see #12.1's file)
- [x] 12.6 Test: prompt sent to a live bridge · bridge hands it to pi · the acknowledged state becomes observable on the session event stream keyed to that prompt (test-plan #F6; see tests/e2e/bridge-contention-health.spec.ts)
- [x] 12.7 L1-PINNED with 12.1 (same >60s boundary); fork-side TTL derivation covered by E10/E11 + the session-api fork arm. Original: Test: fork at timeout 90_000 · forked bridge registers at t+70s · forked session placed after its parent rather than appended at the tier end (test-plan #X12; see #12.1's file)

## 13. Verification and documentation

- [x] 13.1 Run the full suite with pipefail into a tmp log and grep for failures, per the repo's test discipline
- [x] 13.2 PARTIAL, deliberately: Trial A/B need a REAL slow pi, because the correlation is keyed by a server-minted token that only reaches the spawned process's env — no synthetic bridge can hold it before the watchdog fires. Verified instead against the live docker harness: `POST /api/restart` + a spawn at `spawnRegisterTimeoutMs: 90_000` armed and fired at 90000ms (not the constructor default), `server.log` carries `[watchdog] FIRE/RECOVERED` with cwd/pid/token/tier, `spawn-failures.log` carries `REGISTER_TIMEOUT` + a token-joined `REGISTER_RECOVERED`, and `[bridge-drop]` records a reported drop. The TTL arithmetic itself is pinned by E1-E5/E7/E8/X4.
- [x] 13.3 Restart the server via POST /api/restart and spawn a real session end-to-end at spawnRegisterTimeoutMs 90_000
- [x] 13.4 Update the directory AGENTS.md row for every touched file with `See change: fix-spawn-correlation-ttl-coupling`
- [x] 13.5 Invoke the `review-code` discipline skill on the full diff before committing — run as an isolated `@review` subagent (deepseek-v4-pro) on `git diff origin/develop...`; no blocking findings. Fixed from it: the `recentlyFired` evict timer now guards on ENTRY IDENTITY (two token-less same-cwd fires shared a key, so the first fire's timer truncated the second's recovery window), `pendingPromptAcks` gained a per-session in-flight CAP (the TTL bounded each entry's lifetime, not the count), and `REGISTER_RECOVERED` names the real mechanism instead of `"unknown"`. All three are pinned by tests verified to fail on revert. Recorded, not fixed: a REST prompt whose text is a slash command is dispatched by a bridge path that never echoes the handle, so its delivery stays unobservable (noted at the record site).
