## 1. Shared types & sidecar schema

- [x] 1.1 Add optional `live?: boolean`, `liveEpoch?: number`, `closedReason?: string` to `SessionMeta` in `packages/shared/src/session-meta.ts`; verify existing minimal-sidecar tests still pass.
- [x] 1.2 Add `reopenSessionsAfterShutdown: "off" | "ask" | "auto"` (default `"ask"`) to the dashboard settings type and the recovery-offer message to the browser/server protocol in `packages/shared/src`.

## 2. Eager liveness persistence (meta-json-session-cache)

- [x] 2.1 Add an immediate atomic-write path in `packages/server/src/meta-persistence.ts` for the liveness marker, distinct from the debounced field-write queue; reuse the existing tmp+rename primitive. → verify: unit test asserts liveness write hits disk without waiting for the debounce window, and a simulated mid-write crash leaves the prior sidecar intact.
- [x] 2.2 Establish a stable per-boot server id (`liveEpoch`) at server start; fall back to "treat any `live:true` as candidate" when absent. → verify: unit test for fallback path.
- [x] 2.3 Stamp `{ live:true, liveEpoch }` once per session activation at the turn boundary (event wiring), guarded so an unchanged marker is not rewritten per event. → verify: test confirms exactly one eager write per activation, none on subsequent same-epoch events.

## 3. Intentional-close clears the marker

- [x] 3.1 In `handleShutdown` + `handleForceKill` (`packages/server/src/browser-handlers/session-action-handler.ts`) persist `{ live:false, closedReason:"manual" }` durably to `.meta.json`. → verify: test asserts sidecar shows `live:false` + `closedReason:"manual"` after a manual close.
- [x] 3.2 In clean server `stop()` (`packages/server/src/server.ts`) persist `{ live:false }` (no `closedReason`) for each torn-down session before `metaPersistence.flushAll()`. → verify: test asserts idle/app-quit teardown clears `live` without setting `closedReason`.

## 4. Cold-start classification & restore exemption

- [x] 4.1 Add a recovery-candidate classifier (`live===true && status!=="ended" && closedReason!=="manual"`) consumed during cold-start session restore; surface `live`/`liveEpoch`/`closedReason` through `packages/server/src/session-scanner.ts`. → verify: unit tests for the three classification scenarios (interrupted=candidate, cleanly-closed=not, no-marker=not).
- [x] 4.2 Exempt recovery candidates from the force-`ended` status normalization at `packages/server/src/server.ts:239-240`; leave non-candidate normalization unchanged. → verify: test asserts candidate status preserved, non-candidate still rewritten to `ended`.

## 5. Recovery offer & reopen flow

- [x] 5.1 On cold start with ≥1 candidate, branch on `reopenSessionsAfterShutdown`: `off` → normalize interrupted sessions to `ended` (no zombie state); `ask` → broadcast one recovery offer; `auto` → resume all candidates via existing `resume_session`. → verify: tests for all three modes + the zero-candidate no-offer case.
- [x] 5.2 Route reopen acceptances through the existing `resume_session` handler; confirm `pendingResumeIntents` dedupes concurrent multi-device acceptances to at-most-once spawn. → verify: test simulating two acceptances for one session asserts a single spawn.
- [x] 5.3 Assert classification reads ONLY per-session `.meta.json` and never the home-lock. → verify: test varies home-lock state (present/absent/stale) and asserts identical candidate results.

## 6. Client UI

- [x] 6.1 Render the recovery offer as a sticky notification in the existing top-right toast stack (`Toast.tsx` / `SpawnErrorToastHost`): single Reopen action + non-destructive dismiss; NO auto-timeout; auto-dismiss when the user resumes any session; shown once per dirty boot. → verify: component test for render, reopen/dismiss actions, no-timeout, and auto-dismiss-on-resume.
- [x] 6.2 Add the `reopenSessionsAfterShutdown` control (`off`/`ask`/`auto`) to the settings panel, wired to persistence. → verify: setting round-trips and gates the prompt.

## 7. Integration & docs

- [x] 7.1 End-to-end test: spawn → stamp live → simulate unclean exit (no clean stop) → cold start → candidate detected → reopen succeeds; contrast with manual-close and clean-stop paths yielding no candidate.
- [x] 7.2 Run `npm test`; add per-file rows to the matching `docs/file-index-<area>.md` splits for changed/added files per the Documentation Update Protocol.

## 8. CodeRabbit review fixes (PR #210)

- [x] 8.1 `off`-mode zombie state: read recovery mode once before the classify loop; in `off` do NOT exempt candidates — normalize them to `ended` like any other non-`ended` restored session (`packages/server/src/server.ts`). → verify: `cold-start-recovery-exempt` + off-mode normalization test.
- [x] 8.2 Desktop mount gap: `<RecoveryOfferHost>` was mounted only in the mobile tree; mount it in the desktop tree too (after `{connectionBanner}`) so `ask` mode surfaces on desktop (`packages/client/src/App.tsx`).
- [x] 8.3 Server-switch stale offer: call `clearRecoveryOffer()` from `App.handleServerSwitch()`'s `clearInMemoryState` so an offer from server A can't reopen stale IDs on server B.
- [x] 8.4 Stale liveness carry-forward: `meta-persistence.setLiveness()` now clears `liveEpoch`/`closedReason` when omitted from the payload, so a prior `closedReason:"manual"` cannot survive a later `{ live:true }` re-activation.
- [x] 8.5 Spec alignment: home-lock requirement now lists (`live`, `status`, `closedReason`); eager-write contract now covers `closedReason` + pending-merge + omitted-field clearing; off-mode normalization scenario added (`openspec/specs/`).
- [x] 8.6 Docs lint: escape `\|` in `docs/file-index-shared.md` union type; add `text` language tags to archived `design.md` fences; correct classifier formula in both.
- [ ] 8.7 SKIPPED — CodeRabbit "move change bundle out of `archive/`": false positive. This repo's `openspec-archive-change` skill archives to `openspec/changes/archive/<date>-<name>/` by design; location is correct.
- [ ] 8.8 DEFERRED — 6 CodeRabbit Major comments target the unrelated `register-plugin-automation-events` change bundled into this PR. Recommend splitting that change into its own PR rather than fixing here.

## 9. CodeRabbit re-review fixes (PR #210, round 2)

- [x] 9.1 Auto-resume loop stability: wrap the per-candidate `spawnPiSession` in try/catch (`server.ts`) so one failure logs + continues instead of aborting startup after `fastify.listen()` succeeded.
- [x] 9.2 Stale-offer replay: rebuild `pendingRecoveryOffer` from live session state in `onConnect` — drop candidates already resumed (`dataUnavailable` false), ended, or removed; clear when none remain, so a late-joining tab never sees a stale candidate list. → verify: test asserts a resumed candidate is dropped from the replay to a later client.
- [x] 9.3 Off-mode spec wording: reworded `off` to "keep interrupted sessions on the normal restore path → normalize to `ended`; no offer, no auto-resume" to remove the contradiction with the exemption requirement (`openspec/specs/shutdown-session-recovery/spec.md`).
- [x] 9.4 Filled the archived-spec `Purpose` (was `TBD`).
- [x] 9.5 `types.ts` comment accuracy: liveness fields ARE broadcast via `session_added`/`session_updated` (session broadcast as-is); comment corrected + classifier formula updated to include `status`.
- [x] 9.6 Resolved merge conflict with `develop` in the three `docs/file-index-*.md` splits (prefix/suffix union merge — both develop's and this change's annotations retained).
- [ ] 9.7 DEFERRED — 2 new CodeRabbit minors on the bundled `register-plugin-automation-events` mocks (`flows.list`); belongs with the recommended PR split.

## 10. CodeRabbit round-3 (validated before fixing)

- [x] 10.1 a11y (VALID, in-scope): `RecoveryOfferHost` had no live region — added `role="status"` / `aria-live="polite"` / `aria-atomic="true"` so screen readers announce the async offer. Test asserts the live region.
- [ ] 10.2 SKIP (pre-existing on develop): duplicated block in the `App.tsx` file-index row — `render-file-previews` appears 2× on develop's row too, NOT introduced by this PR. De-duping here would diverge from develop; fix separately on develop.
- [ ] 10.3 SKIP (pre-existing on develop): `SettingsPanel.tsx` row keyed `src/client/…` — same on develop; the file already mixes `packages/` and `src/` prefixes. Not introduced here.
- [ ] 10.4 SKIP (false positive): recovery-e2e writing `~/.pi/dashboard/config.json` cannot hit real home — global `setup-home.ts` overrides HOME to a tmp dir and hard-throws if HOME==real home; `os.homedir()` follows `$HOME` on POSIX. Identical pattern already used by recovery-offer.test.ts.

## 11. Doubt-driven review (post-archive, C3 gap)

- [x] 11.1 Fix C3: reset the once-per-activation liveness guard on every `session_register` (`event-wiring.ts`) — `stampedLiveEpoch.delete(sessionId)`. Without it, a session manually closed (`{live:false, closedReason:"manual"}`) then resumed via `pi --continue` in the SAME server run (same epoch, same sessionId) kept the guard entry, so `setLiveness` never re-fired and its `closedReason`-clear was unreachable → a resumed-then-crashed session was wrongly excluded from recovery. Verified: `liveness-stamp-wiring.test.ts` green.
- [x] 11.2 Document the bounded clean-close-then-shutdown false-positive window + the guard-reset in `design.md` Risks/Trade-offs.
