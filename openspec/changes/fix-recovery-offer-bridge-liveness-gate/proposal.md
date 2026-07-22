## Why

The cold-start "reopen sessions after shutdown" recovery offer classifies candidates from **on-disk liveness markers alone** (`live:true ∧ status≠"ended" ∧ ¬manual ∧ kind≠automation`). It never consults whether the pi process that carried the session is actually gone. Two real signals are ignored:

1. **Keeper / headless sessions** — pi liveness IS synchronously probeable at cold start via the `<sid>.rpc.sock.pid` scan + `isProcessAlive` (`rpc-keeper-sidecar` / `headless-spawn`). The server reclaims these at `start()` **before** the offer is broadcast, yet the offer is built from the disk-only candidate list and does not subtract them.
2. **Non-keeper sessions (tmux / TUI / mDNS-discovery bridges)** — pi liveness is revealed only when the bridge re-discovers the server and **reattaches**, asynchronously, *after* the offer already fired. Nothing retracts an offer when a candidate's bridge reattaches.

A plain server restart (`POST /api/restart` → `process.exit(0)` **without** `server.stop()`) leaves every running session `live:true` + non-`ended` on disk — indistinguishable from a crash to the disk-only classifier. So a restart phantom-offers sessions whose keeper survived or whose bridge reattaches. Worse, clicking **Reopen** on such a still-alive session runs `resume_session` `continue`, defeating the only guards (`resume.already_active` / `resume.already_resuming`) via the cold-start `ended`-normalization + reattach race, and **double-spawns pi for one sessionId**. The gateway session→connection map is last-write-wins, so message sends route to a zombie — the user's observed *"reopened sessions can't receive messages; I have to stop and resume each one."*

Evidence: `packages/server/src/__tests__/recovery-reattach-retraction.spike.test.ts` — a red spike asserting the correct end state (offer ONLY a genuinely-dead candidate; exclude keeper-alive and bridge-reattached). It fails against current code because all three are offered.

## What Changes

- Recovery-offer classification becomes **liveness-gated**, not disk-only. A candidate is offered ONLY when no process-carrier proves it alive:
  - **Synchronous (Class 1, keeper):** at offer-broadcast time (after `cleanupKeeperOrphans` / `cleanupOrphans` at `start()`), subtract any candidate whose keeper+pi the reclaim found alive (keyed by sessionId via the reclaimed keeper socket / headless PID registry).
  - **Asynchronous (Class 2, bridge):** defer the offer by a short reattach grace window and/or retract an already-broadcast candidate when its bridge re-registers (`registerReason:"reattach"`), consuming its liveness marker so it is not re-offered.
- A retracted candidate's on-disk marker is consumed (`setLiveness {live:false}`) exactly like dismiss/clean-stop, so a later cold boot does not re-offer it.
- A genuinely-lost session (no live keeper, no reattaching bridge within the window) is STILL offered — the feature keeps working for real crashes / full reboots.
- Because Reopen can then never target a live session, the double-spawn / "can't send messages" symptom is eliminated by construction. (Optional defense-in-depth: make `handleResumeSession` `continue` re-check keeper/bridge liveness, not just in-memory `status`.)

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `shutdown-session-recovery`: cold-start candidate classification SHALL be gated by process liveness — a session with a live reclaimed keeper (Class 1) or a bridge that reattaches within a grace window (Class 2) SHALL NOT be offered, and an already-broadcast offer SHALL be retracted (marker consumed) on reattach.

## Discipline Skills

- `systematic-debugging` — the keeper/bridge reattach race is timing-dependent; changes gated on an evidence-first repro (the red spike), not guesswork.
- `node-inspect-debugger` — opaque runtime state across jiti/keeper-UDS/WS reattach; runtime inspection may be needed to confirm ordering (`cleanupKeeperOrphans` at 1617 vs offer at 2074).
- `observability-instrumentation` — reopen resumes a real pi (spawns a process / spends tokens); log/counter the classify→retract decisions and reopen spawns so a false offer is diagnosable in prod.
- `doubt-driven-review` — the grace-window duration and the sync/async union are load-bearing; stress-test before it stands.

## Impact

- `packages/server/src/server.ts` — recovery classification/broadcast (~307, ~2074): subtract keeper-alive candidates (consult `headlessPidRegistry` / keeper reclaim); defer offer + retract on reattach; consume markers on retract. The ended→alive reattach branch (~365) must retract the pending offer + candidate.
- `packages/server/src/browser-handlers/session-action-handler.ts` — optional: `handleResumeSession` `continue` liveness re-check (defense-in-depth against double-spawn).
- `packages/server/src/spawn-process/headless-pid-registry.ts` / `rpc-keeper/keeper-manager.ts` — expose reclaimed live sessionIds for the classifier (read-only; discovery already yields `{sessionId, keeperPid, sockPath}`).
- Tests: promote `recovery-reattach-retraction.spike.test.ts` to the acceptance test; extend `recovery-offer.test.ts` / `recovery-e2e.test.ts`.
- No new setting; `ask`/`auto`/`off` contract unchanged. `/api/restart` itself is NOT modified (keeper durability already makes restart transparent); the fix is entirely in offer gating.
