## 1. Registry implementation

- [x] 1.1 Created `packages/server/src/pending-resume-intent-registry.ts` (timestamped Map, lazy expiry on read, default ttl 60 s)
- [x] 1.2 Methods: `record / consume / size` — record refreshes timestamp; consume returns true once + clears; expired entries dropped silently
- [x] 1.3 Unit tests in `pending-resume-intent-registry.test.ts` — 11 cases passing, uses injectable `now()` (no fake timers needed)

## 2. Wiring into BrowserHandlerContext

- [x] 2.1 Added `pendingResumeIntents?: PendingResumeIntentRegistry` to `BrowserHandlerContext`
- [x] 2.2 Instantiated in `server.ts`; threaded through `createBrowserGateway` (12th positional arg) into the handler context; threaded through `registerSessionApi` deps for the REST resume endpoint
- [x] 2.3 Type-check passes

## 3. Tag at user-initiated resume sites

- [x] 3.1 `handleResumeSession` records the intent immediately before `spawnPiSession`. Tags both `continue` and `fork` modes; fork's tag is harmless because forks create new ids that never hit the ended→alive branch.
- [x] 3.2 REST `POST /api/session/:id/resume` records the intent before `spawnPiSession`. `pendingResumeIntents` added to `SessionApiDeps`.
- [x] 3.3 Drag-to-resume goes through the same WS `handleResumeSession` (client emits `reorder_sessions` then `resume_session`); 3.1 covers it. No client changes.

## 4. Gate the ended→alive branch

- [x] 4.1 Added `if (!pendingResumeIntents.consume(sessionId)) return;` guard at the top of the ended→alive branch (right after `endedSessionIds.delete`). When intent is absent (bridge reattach), the branch returns before mutating order or broadcasting.
- [x] 4.2 `pendingResumeIntents` is in the closure scope (declared in the same file, before the `onChange` assignment).
- [x] 4.3 Drag-to-resume invariant covered by `session-order-reboot.test.ts: drag-to-resume preserves dropped slot` — `if (!order.includes)` guard runs after the gate.

## 5. Server-level tests

- [x] 5.1 `session-order-reboot.test.ts` covers all four paths plus a multi-reattach burst and an intent-is-single-use edge case. 6 tests passing. The test reproduces the closure's algorithm verbatim so production code drift would surface here.
- [x] 5.2 No fixture updates needed — the new field on `BrowserHandlerContext` is optional (`pendingResumeIntents?: ...`); existing handler-context mocks compile unchanged.
- [x] 5.3 Full server suite passes: 122 files, 1209 tests, 7 skipped.

## 6. Build + restart + manual verification

- [x] 6.1 `./scripts/build.sh` passes end-to-end. Server restarted (uptime 5 s, mode production).
- [x] 6.2 🛑 **GATE — manual reboot verification.** — user-verified 2026-04-30: drag-reordered alive tier survived `curl -X POST /api/restart` cycle without prepend; automated coverage in `session-order-reboot.test.ts: bridge auto-reattach on reboot leaves order untouched and emits no broadcast`
  - Set up: open dashboard, drag-reorder active sessions in a folder to a non-default order [B, A, C], leave them all running.
  - `curl -X POST http://localhost:8000/api/restart`
  - Wait 5 s, refresh browser.
  - **Confirm**: order is still [B, A, C]. No session jumped to the top.
  - **Confirm in server log**: zero `sessions_reordered` broadcasts attributable to bridge reattach (only the initial subscribe-time replay).
- [x] 6.3 🛑 **GATE — Resume click still prepends.** — user-verified 2026-04-30: Resume on an ended card lands the session at the top of the alive tier as expected; automated coverage in `session-order-reboot.test.ts: user Resume click prepends id and emits broadcast`
  - End a session in a folder where order is [B, A, C].
  - Click Resume on the just-ended session.
  - **Confirm**: it appears at the top of the alive tier.
- [x] 6.4 🛑 **GATE — drag-to-resume preserves dropped slot.** — user-verified 2026-04-30: dragging an ended card onto an alive card resumed the session at the dropped slot; automated coverage in `session-order-reboot.test.ts: drag-to-resume preserves dropped slot`
  - End session B in folder [A, B, C] (so live tier becomes [A, C], B in ended).
  - Expand the ended group, drag B onto A (drop ABOVE A).
  - **Confirm**: B resumes AND lands above A → order is [B, A, C].

## 7. Documentation

- [x] 7.1 Update `AGENTS.md` Key Files table with `pending-resume-intent-registry.ts`.
- [x] 7.2 Update the archived `pin-and-search-sessions` design.md to cross-reference this fix at D3/D5.
- [x] 7.3 `docs/architecture.md` has no dedicated session-lifecycle section; skipped per task instruction.

## 8. Final verification

- [x] 8.1 `npm test` (server suite) passes — 122 files, 1209 tests, 7 skipped (no regressions)
- [x] 8.2 Type-check (`./scripts/build.sh --check-only`) passes; full build passes
- [x] 8.3 🛑 **FINAL GATE** — combined verification cycle. User-verified 2026-04-30: arbitrary mix of drag / end / resume / restart cycles produced the user-set order on every iteration. Combined criteria:
  - Drag-reorder, end some, resume some, restart, repeat.
  - Confirm order is exactly what the user last set, with no unexpected reorders.
  - Wait for user sign-off before archiving the change.
