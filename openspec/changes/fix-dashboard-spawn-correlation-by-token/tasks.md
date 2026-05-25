## 1. Registry module

- [ ] 1.1 Create `packages/server/src/pending-dashboard-spawns.ts` exporting the `PendingDashboardSpawns` class with `add`, `consumeByToken`, `consumeByPid`, `consumeByCwd`, `size`, and an `armSweeper(intervalMs)` method.
- [ ] 1.2 Implement 60s TTL sweep using a timer that is `unref()`'d so it doesn't block process exit.
- [ ] 1.3 Add unit test `packages/server/src/__tests__/pending-dashboard-spawns.test.ts` covering add/consume by each tier, FIFO order in `consumeByCwd`, sweeper drop, double-consume returns `undefined`.

## 2. Wire registry into the server

- [ ] 2.1 In `packages/server/src/server.ts`, replace `const pendingDashboardSpawns = new Map<string, number>()` with `const pendingDashboardSpawns = new PendingDashboardSpawns()`. Arm the sweeper at 5s tick.
- [ ] 2.2 Update the `pendingDashboardSpawns` type on every passthrough: `browser-gateway.ts` (`createBrowserGateway` signature), `event-wiring.ts` (`EventWiringContext`), `browser-handlers/handler-context.ts` (`HandlerContext`).
- [ ] 2.3 Verify `tsc --noEmit` is clean across all affected modules.

## 3. Spawn-issuing handlers register entries

- [ ] 3.1 In `session-action-handler.ts:242` (resume), replace the counter bump with `pendingDashboardSpawns.add({ token: spawnToken, cwd, createdAt: Date.now() })`. Use the existing locally-minted `spawnToken`.
- [ ] 3.2 In `session-action-handler.ts:327` (fork), same substitution. Verify the same token is also passed to `pendingForkRegistry.recordFork(token, parentSessionId)` (existing).
- [ ] 3.3 In `session-action-handler.ts:379` (spawn-new), same substitution.
- [ ] 3.4 In `session-action-handler.ts:450` (attach-spawn), same substitution.
- [ ] 3.5 Audit `process-manager.ts` and `browser-handlers/*` for any remaining direct `.set(cwd, n+1)` writes; remove all.
- [ ] 3.6 Add the auto-resume-on-prompt path (currently in `session-action-handler.ts` or `handleSendPrompt`) to the registry the same way. Confirm via a new unit test.

## 4. Event-wiring matcher with three tiers + STRICT flag

- [ ] 4.1 In `event-wiring.ts`, replace the cwd-only matcher (lines ~492-503) with the three-tier consume order: `consumeByToken` → `consumeByPid` → `consumeByCwd`.
- [ ] 4.2 Add `const strictCorrelation = process.env.STRICT_SPAWN_CORRELATION === "1"` at module init.
- [ ] 4.3 When only `consumeByCwd` matches, log `[event-wiring] cwd-FIFO source-stamp fallback sessionId=... cwd=...` regardless of strict mode.
- [ ] 4.4 When only `consumeByCwd` matches AND `strictCorrelation === true`: do NOT consume; do NOT stamp; log additionally `[event-wiring] strict mode → ignored cwd-FIFO match`.
- [ ] 4.5 Move the existing `sessionManager.update`, `broadcastSessionUpdated`, and `writeSessionMeta` calls inside the success branch of the new matcher. They MUST run only on successful consume.

## 5. Event-wiring regression tests

- [ ] 5.1 Add `packages/server/src/__tests__/event-wiring-source-stamp.test.ts` (or extend an existing event-wiring test) covering:
  - 5.1.a Token match → stamp dashboard
  - 5.1.b PID match → stamp dashboard
  - 5.1.c CLI register in spawn-pending cwd with `strictCorrelation=true` → no stamp, no `.meta.json` write
  - 5.1.d CLI register in spawn-pending cwd with `strictCorrelation=false` → stamp + fallback log
  - 5.1.e No pending entry → no stamp regardless of register contents
  - 5.1.f Stale token → falls through to PID tier → still stamps
- [ ] 5.2 Mock `writeSessionMeta` so the test asserts both "called once with `dashboard`" and "never called" depending on tier.
- [ ] 5.3 Capture stdout/stderr in the test harness and assert the fallback log line shape.

## 6. Cleanup utility

- [ ] 6.1 Create `scripts/repair-meta-source.mjs` (pure Node, no deps). Walk `~/.pi/agent/sessions/**/*.meta.json`.
- [ ] 6.2 For each candidate, load adjacent `.jsonl`, scan the first ~50 entries for a `hasUI: true` marker; if found, remove `source` from the `.meta.json` and write back atomically (write to `*.tmp`, `rename`).
- [ ] 6.3 Print `kept N / cleaned M / errors E`; exit 0 on success; document return codes in the script header.
- [ ] 6.4 Add a unit test in `packages/shared/src/__tests__/repair-meta-source.test.ts` (or near the script) using a tmpdir + fixture session files. Cover: TUI evidence → cleaned, no evidence → kept, malformed → error counter, idempotent re-run.
- [ ] 6.5 Document the script in `docs/faq.md` under a new entry "Why does my CLI session show the headless robot icon?" linking to the script.

## 7. Verification

- [ ] 7.1 Run `npm test` — every new test green, no existing test regressed.
- [ ] 7.2 Run `npm run lint` (`tsc --noEmit`) — clean across server, shared, electron.
- [ ] 7.3 Manual smoke: launch a CLI `pi` from terminal in a cwd where the dashboard just clicked Spawn. Verify dashboard renders CLI/TUI icon (not robot), and the CLI session's `.meta.json` does NOT contain `source: "dashboard"`.
- [ ] 7.4 Manual smoke: legitimate dashboard Spawn → verify session card still renders the robot icon and `.meta.json` carries `source: "dashboard"`.
- [ ] 7.5 Run `node scripts/repair-meta-source.mjs` against the test home and confirm summary matches the seeded fixtures.

## 8. Docs & change-history

- [ ] 8.1 Update `docs/file-index-server.md` row for `event-wiring.ts` with a "See change: fix-dashboard-spawn-correlation-by-token" annotation.
- [ ] 8.2 Add new row in `docs/file-index-server.md` for `pending-dashboard-spawns.ts` (caveman style).
- [ ] 8.3 Add row in the appropriate file-index split for `scripts/repair-meta-source.mjs`.
- [ ] 8.4 Update the AGENTS.md "Key Files" backbone row for `src/server/event-wiring.ts` only if its one-line purpose changes (it should not).
