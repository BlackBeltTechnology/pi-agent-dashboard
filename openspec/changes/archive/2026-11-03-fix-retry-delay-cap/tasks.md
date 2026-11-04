# Tasks

## 1. Bridge: read the cap

- [x] 1.1 Write failing tests in `packages/extension/src/__tests__/pi-retry-settings.test.ts` (extend the existing file; exemplar is the file itself). Cover E7: temp global `maxAgentDelayMs:60000` plus project `10000` · `readPiRetrySettings({home,cwd})` · returns 10000; global-only → 60000; neither → 60000 (test-plan #E7). Cover E8: global `retry.maxAgentDelayMs` ∈ {"abc", null, 1.5, -1} · read · "abc"/null → 60000, 1.5 → 1.5, -1 → -1 (test-plan #E8). Verify they fail.
- [x] 1.2 In `packages/extension/src/pi-retry-settings.ts`, extend `PiRetrySettings`, `PI_RETRY_DEFAULTS` and `extract()` with `maxAgentDelayMs` (any finite number accepted; default 60000). Verify 1.1 passes.

## 2. Bridge: capped delay in RetryTracker

- [x] 2.1 Write failing tests in `packages/extension/src/__tests__/retry-tracker.test.ts` (exemplar: the existing waiting-signal tests in that file, with fake timers):
  - E1: `{baseDelayMs:2700,maxRetries:11}` · 10 error `agent_end`s · 10th `delayMs===60000`, `nextAttemptAt===now+60000` (test-plan #E1).
  - E2: `{2000, cap 5000}` · attempts 1..4 · `[2000,4000,5000,5000]` (test-plan #E2).
  - E3: cap -1 · attempt 1 · `delayMs 0`, no `nextAttemptAt` (test-plan #E3).
  - E4: base 0 plus a `delayFn` returning 999 · attempt 1 · `delayMs 0` and `delayFn` not called (test-plan #E4).
  - E5: cap 0 · attempt 3 · `delayMs 0` (test-plan #E5).
  - X1: a throwing `delayFn` · attempt 3 · `delayMs 8000`, nothing thrown (test-plan #X1).
  - X2: `delayFn` returns NaN / "5" / -5 · attempt 2 · 4000 / 4000 / 0 (test-plan #X2).

  Verify they fail.
- [x] 2.2 Write a failing parity test, new file `packages/extension/src/__tests__/retry-delay-parity.test.ts` (exemplar: the dynamic import in `packages/extension/src/bridge.ts` `loadStreamSimple`). Grid base∈{1,2000,2700} × cap∈{0,5000,60000,undefined} × attempt∈{0,1,2,10,64,2000} · exported raw `cappedDelay` vs `(await import("@earendil-works/pi-ai")).retryDelayMs` · strictly equal for every pair (test-plan #E6). Verify it fails (no `cappedDelay` export yet).
- [x] 2.3 In `packages/extension/src/retry-tracker.ts`, add `maxAgentDelayMs` to `RetrySettings`. Export `cappedDelay` (a pi-ai mirror with a cite comment). Add `setDelayFn()` and route `delayFor()` through the design-D1 guarded wrapper (pre-guard, then try/fallback, then post-guard). Update the header doc comment. Verify 2.1 and 2.2 pass along with the existing tracker tests.
- [x] 2.4 Write failing tests for a new `installPiAiDelayFn(tracker, importer = () => import("@earendil-works/pi-ai"))` in `retry-tracker.test.ts` (exemplar: the `vi.mock("@earendil-works/pi-ai")` setup in `packages/extension/src/__tests__/ask-user-tool.test.ts`):
  - X3: importer rejects · install, then attempt 1 · no unhandled rejection (vitest `unhandledRejection` listener sees none) and `delayMs 2000` (test-plan #X3).
  - X4: importer resolves `{retryDelayMs: spy}` after one tick · install, flush, attempt 1 · spy called with `({baseDelayMs:2000,maxAgentDelayMs:60000},1)` (test-plan #X4).

  Then implement the helper and call it in `packages/extension/src/bridge.ts` right after `new RetryTracker(...)` (~line 379). Verify the tests pass.
- [x] 2.5 Update the `retry-tracker.ts.AGENTS.md` and `pi-retry-settings.ts.AGENTS.md` sidecars in `packages/extension/src/` with the capped formula, `cappedDelay`/`setDelayFn`/`installPiAiDelayFn`, and `See change: fix-retry-delay-cap`. Verify with `kb_search "retry-tracker maxAgentDelayMs"`, which should return the updated row.

## 3. Server: typed retry policy field

- [x] 3.1 Write failing tests in `packages/server/src/routes/__tests__/pi-retry-routes.test.ts` (exemplar: its existing PUT/GET inject cases):
  - E9: PUT `maxAgentDelayMs` ∈ {-1, 1.5, "x"} · `PUT /api/pi-retry` · 400 with field `maxAgentDelayMs`, file byte-identical, `reloadConnectedSessions` not called (test-plan #E9).
  - E10: file holds `retry.someFutureKnob:1` and `packages:[…]` · PUT valid policy with cap 0, then GET · `retry.maxAgentDelayMs:0` written, the other keys deep-equal to before, GET returns 0 (test-plan #E10).
  - E11: no `retry` block · GET · `policy.maxAgentDelayMs===60000` (test-plan #E11).

  Verify they fail.
- [x] 3.2 Add `maxAgentDelayMs` to the typed policy in `packages/server/src/pi-agent-settings.ts`: `PI_RETRY_DEFAULTS` (~67), reader (~445), validator (~469, non-negative integer), and writer (~529-535, inside the `existingRetry` spread). Verify 3.1 passes, and that the `pi-agent-settings*.test.ts` suites still pass.
- [x] 3.3 Update the `pi-agent-settings.ts` / `pi-retry-routes.ts` rows in the `packages/server/src/` AGENTS records with `See change: fix-retry-delay-cap`. Verify the row text is present.

## 4. Client: field, capped preview, clamp notice

- [x] 4.1 Write failing tests in `packages/client/src/components/__tests__/RetrySettingsSection.test.tsx` (exemplar: its existing render/preview/save cases):
  - E12: form 11/2700/60000 · render · every step ≤ "60 s" and total 443.7 s (test-plan #E12).
  - E13: same input · cap notice names attempt 6 (test-plan #E13).
  - E14: form 3/2000/60000 · render · no cap notice (test-plan #E14).
  - E15: form 30/2000/60000 · render · tail "… → 60 s" (test-plan #E15).
  - E16: loaded policy without the key · edit cap to 5000, unified Save · control has an accessible name and an `ms` unit; payload `maxAgentDelayMs:5000` (test-plan #E16).
  - E17: `enabled:false` · render · cap control disabled (test-plan #E17).
  - P1: `computeSchedule(1e9, 2000, 60000)` · timed call · < 50 ms with a finite closed-form total (test-plan #P1).

  Verify they fail.
- [x] 4.2 In `packages/client/src/lib/api/pi-retry-api.ts`, add `maxAgentDelayMs` to the `PiRetryPolicy` type and the defaults. In `RetrySettingsSection.tsx`, add the field (the section's existing `NumField`), plus validation, a bounded capped `computeSchedule(maxRetries, base, cap)` returning `capFromAttempt` (with pinned vectors and a cite comment), the capped tail step, the clamp notice (i18n key with English fallback), and a capped long-tail total. Verify 4.1 passes.
- [x] 4.3 Update the turn-level field list in the `SettingsPanel.tsx` copy (~2505) to include `maxAgentDelayMs`. Update the `RetrySettingsSection.tsx` / `pi-retry-api.ts` AGENTS rows with `See change: fix-retry-delay-cap`. Verify the existing SettingsPanel tests still pass.

## 5. Integration

- [x] 5.1 Run the full suite: `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log`. Verify that all change-touched suites pass. The remaining failures (TLS IP servername on Node 26, localStorage/drag timing, perf thresholds) reproduce identically on unmodified `develop` and are pre-existing.
- [x] 5.2 Build: `npm run build` exits 0 in the worktree. The API shape is verified by `pi-retry-routes.test.ts` (fastify inject). Live-instance redeploy (`npm run reload` + `restart-server.ts`, then `curl /api/pi-retry` includes `maxAgentDelayMs`) runs from the main checkout after merge.
- [x] 5.3 Manual check: with `baseDelayMs 2700` and `maxRetries 11`, trigger a 429 chain to attempt ≥ 7. Verify the banner countdown never shows > 60 s and that the next attempt starts when the countdown reaches about 0 (test-plan #F1, manual-only). Deferred to post-merge verification: not yet performed at ship time.
- [x] 5.4 Delegate the `docs/architecture.md` "Retry Lifecycle" formula update to DocScribe (caveman rule). Verify the doc states the capped formula.

## Workflow follow-up

- Run `review-code` before commit.
- Ship via `ship-change` (archive syncs the deltas into `bridge-retry-observability` and `pi-retry-settings`).
