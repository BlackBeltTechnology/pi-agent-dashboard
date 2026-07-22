## 1. Lock the repro (done in explore)

- [x] 1.1 Red spike: `packages/server/src/__tests__/recovery-reattach-retraction.spike.test.ts` asserts offer excludes keeper-alive + bridge-reattached, keeps genuinely-dead. Confirmed RED against current code.

## 2. Class 1 — keeper/headless liveness gate (synchronous)

- [ ] 2.1 Expose the reclaimed-live sessionId set at broadcast time (from `cleanupKeeperOrphans` / `discoverExistingKeepers` + `headlessPidRegistry`).
- [ ] 2.2 In `server.ts` offer path (~2074), subtract candidates whose keeper+pi were reclaimed alive; consume their liveness markers (`setLiveness {live:false}`).
- [ ] 2.3 Apply the same subtraction to `auto` mode (do NOT silently re-spawn a live session).
- [ ] 2.4 Test: keeper-alive candidate is excluded from the offer AND from auto-resume.

## 3. Class 2 — bridge reattach gate (asynchronous)

- [ ] 3.1 Defer the offer broadcast by grace window `T` after `start()`; hold `recoveryCandidates` pending.
- [ ] 3.2 On `registerReason:"reattach"` (ended→alive branch, ~365) within `T`, drop that candidate + consume its marker.
- [ ] 3.3 After `T`, broadcast survivors; retract from an already-sent offer if a late reattach arrives (replay/onConnect path).
- [ ] 3.4 Pick + document `T` (measure reattach latency; default ~1500–2500 ms).
- [ ] 3.5 Test: bridge-reattach candidate is excluded; dead candidate still offered after `T`.

## 4. Defense-in-depth (optional)

- [ ] 4.1 `handleResumeSession` `continue`: re-check keeper/bridge liveness, not just in-memory `status`; refuse double-spawn with `resume.already_active`.
- [ ] 4.2 Test: reopen of a still-alive session never spawns a second pi (one keeper+pi per sessionId).

## 5. Promote + regress

- [ ] 5.1 Promote the spike to the acceptance test (rename off `.spike`, keep both classes + control).
- [ ] 5.2 Extend `recovery-offer.test.ts` / `recovery-e2e.test.ts` for the gate; ensure existing dirty-boot / dismiss invariants still pass.
- [ ] 5.3 Observability: log the classify→retract decision + reopen spawn (per `observability-instrumentation`).

## 6. Verify

- [ ] 6.1 `npm test` green (server + shared).
- [ ] 6.2 Manual: restart with a live keeper session + a tmux session → NO offer; kill pi then restart → offer appears; Reopen → single clean spawn → messages send.
- [ ] 6.3 `openspec validate fix-recovery-offer-bridge-liveness-gate --strict`.
