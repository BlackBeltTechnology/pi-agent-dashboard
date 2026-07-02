## 1. Shared types & sidecar schema

- [ ] 1.1 Add optional `live?: boolean`, `liveEpoch?: number`, `closedReason?: string` to `SessionMeta` in `packages/shared/src/session-meta.ts`; verify existing minimal-sidecar tests still pass.
- [ ] 1.2 Add `reopenSessionsAfterShutdown: "off" | "ask" | "auto"` (default `"ask"`) to the dashboard settings type and the recovery-offer message to the browser/server protocol in `packages/shared/src`.

## 2. Eager liveness persistence (meta-json-session-cache)

- [ ] 2.1 Add an immediate atomic-write path in `packages/server/src/meta-persistence.ts` for the liveness marker, distinct from the debounced field-write queue; reuse the existing tmp+rename primitive. → verify: unit test asserts liveness write hits disk without waiting for the debounce window, and a simulated mid-write crash leaves the prior sidecar intact.
- [ ] 2.2 Establish a stable per-boot server id (`liveEpoch`) at server start; fall back to "treat any `live:true` as candidate" when absent. → verify: unit test for fallback path.
- [ ] 2.3 Stamp `{ live:true, liveEpoch }` once per session activation at the turn boundary (event wiring), guarded so an unchanged marker is not rewritten per event. → verify: test confirms exactly one eager write per activation, none on subsequent same-epoch events.

## 3. Intentional-close clears the marker

- [ ] 3.1 In `handleShutdown` + `handleForceKill` (`packages/server/src/browser-handlers/session-action-handler.ts`) persist `{ live:false, closedReason:"manual" }` durably to `.meta.json`. → verify: test asserts sidecar shows `live:false` + `closedReason:"manual"` after a manual close.
- [ ] 3.2 In clean server `stop()` (`packages/server/src/server.ts`) persist `{ live:false }` (no `closedReason`) for each torn-down session before `metaPersistence.flushAll()`. → verify: test asserts idle/app-quit teardown clears `live` without setting `closedReason`.

## 4. Cold-start classification & restore exemption

- [ ] 4.1 Add a recovery-candidate classifier (`live===true && closedReason!=="manual"`) consumed during cold-start session restore; surface `live`/`liveEpoch`/`closedReason` through `packages/server/src/session-scanner.ts`. → verify: unit tests for the three classification scenarios (interrupted=candidate, cleanly-closed=not, no-marker=not).
- [ ] 4.2 Exempt recovery candidates from the force-`ended` status normalization at `packages/server/src/server.ts:239-240`; leave non-candidate normalization unchanged. → verify: test asserts candidate status preserved, non-candidate still rewritten to `ended`.

## 5. Recovery offer & reopen flow

- [ ] 5.1 On cold start with ≥1 candidate, branch on `reopenSessionsAfterShutdown`: `off` → no-op; `ask` → broadcast one recovery offer; `auto` → resume all candidates via existing `resume_session`. → verify: tests for all three modes + the zero-candidate no-offer case.
- [ ] 5.2 Route reopen acceptances through the existing `resume_session` handler; confirm `pendingResumeIntents` dedupes concurrent multi-device acceptances to at-most-once spawn. → verify: test simulating two acceptances for one session asserts a single spawn.
- [ ] 5.3 Assert classification reads ONLY per-session `.meta.json` and never the home-lock. → verify: test varies home-lock state (present/absent/stale) and asserts identical candidate results.

## 6. Client UI

- [ ] 6.1 Add the reopen-prompt UI reacting to the recovery-offer broadcast (reopen all / choose / dismiss); dismiss is non-destructive. → verify: component test for render + accept/dismiss actions.
- [ ] 6.2 Add the `reopenSessionsAfterShutdown` control (`off`/`ask`/`auto`) to the settings panel, wired to persistence. → verify: setting round-trips and gates the prompt.

## 7. Integration & docs

- [ ] 7.1 End-to-end test: spawn → stamp live → simulate unclean exit (no clean stop) → cold start → candidate detected → reopen succeeds; contrast with manual-close and clean-stop paths yielding no candidate.
- [ ] 7.2 Run `npm test`; add per-file rows to the matching `docs/file-index-<area>.md` splits for changed/added files per the Documentation Update Protocol.
