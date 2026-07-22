## 1. Lock the repro (done in explore)

- [x] 1.1 Red spike: `packages/server/src/__tests__/recovery-reattach-retraction.spike.test.ts` asserts offer excludes keeper-alive + bridge-reattached, keeps genuinely-dead. Confirmed RED against current code.

## 2. Class 1 — keeper/headless liveness gate (synchronous)

- [x] 2.1 Expose the reclaimed-live sessionId set at broadcast time (`cleanupKeeperOrphans` now returns the live keeper sessionIds).
- [x] 2.2 In `server.ts` offer path, subtract candidates whose keeper+pi were reclaimed alive; consume their liveness markers (`setLiveness {live:false}`).
- [x] 2.3 Apply the same subtraction to `auto` mode (keeper exclusion runs before the mode branch; auto never re-spawns a live session).
- [x] 2.4 Test: keeper-alive candidate is excluded from the offer AND from auto-resume.

## 3. Class 2 — bridge reattach gate (asynchronous)

- [x] 3.1 Hold candidates in `liveRecoveryCandidates`; `ask` broadcasts immediately (existing shown-once contract) and retracts on reattach within `T`; `auto` defers the resume by `T`.
- [x] 3.2 Retract a candidate that comes alive (ended→alive) within `T` + consume its marker. Keyed on the transition, not `registerReason` (tmux/TUI/mDNS bridges re-register without one).
- [x] 3.3 Retract from an already-sent offer (rebuild + rebroadcast the held `pendingRecoveryOffer` so onConnect replay omits it); finalize the map after `T`.
- [x] 3.4 `T` = `RECOVERY_REATTACH_GRACE_MS = 2500` ms, documented at the constant.
- [x] 3.5 Test: bridge-reattach candidate is excluded; dead candidate still offered (acceptance test).

## 4. Defense-in-depth (optional)

- [ ] 4.1 (OPTIONAL — deferred) `handleResumeSession` `continue` liveness re-check. The Class 1/2 gate now guarantees a reopen never targets a live session, so this belt-and-suspenders guard is not required to close the symptom; left for a follow-up if a stale offer path is ever found.
- [ ] 4.2 (OPTIONAL — deferred) Test for the above.

## 5. Promote + regress

- [x] 5.1 Promoted the spike to `recovery-reattach-retraction.test.ts` (both classes + control) and added an auto-mode keeper-skip case.
- [x] 5.2 Existing `recovery-offer.test.ts` / `recovery-e2e.test.ts` dirty-boot / dismiss invariants still pass; `headless-pid-registry.test.ts` updated for the new return contract.
- [x] 5.3 Observability: `console.info` logs the keeper/bridge retract decision (candidate id + reason + remaining count).

## 6. Verify

- [x] 6.1 `npm test` green (server + shared).
- [ ] 6.2 Manual: restart with a live keeper session + a tmux session → NO offer; kill pi then restart → offer appears; Reopen → single clean spawn → messages send. (Manual — verify post-merge.)
- [x] 6.3 `openspec validate fix-recovery-offer-bridge-liveness-gate --strict`.
