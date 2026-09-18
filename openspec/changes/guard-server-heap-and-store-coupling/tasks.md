# Tasks — guard-server-heap-and-store-coupling

Ordering note: this change depends on `bound-event-store-by-bytes` (provides
`maxTotalEventBytes`) and `bound-session-heap-and-gc-telemetry` (provides the
lowered default). Task 1.1 must land before the invariant is meaningful.

## 1. Consolidate the server-heap default

- [ ] 1.1 Move `DEFAULT_SERVER_MAX_OLD_SPACE_MB` from `packages/extension/src/server-launcher.ts` into shared, and replace the hardcoded literal in `packages/server/bin/pi-dashboard.mjs` so every launch path resolves one constant (design D2 — without this the invariant guards one of three literals)
- [ ] 1.2 Test single source for the server default — the consolidated shared default · resolve it on the wrapper, bridge and Electron paths · all three resolve to the same constant, no path carries its own literal · see `packages/extension/src/__tests__/server-launcher.test.ts` (test-plan #E8)

## 2. Shared constants + guard predicate

- [ ] 2.1 Test constants come from one source — the shared constants module · read `HEAP_PER_BUDGET_BYTE`, `BASELINE_MB`, `CRASH_RATIO` · all three exported, guard reads them rather than inlining literals · see `packages/shared/src/__tests__/` (test-plan #E2)
- [ ] 2.2 Test guard predicate across the range — budgets `0`, `384`, `768`, `1024`, `2048` MiB against a `1536` MB ceiling · evaluate `budget × 1.33 + 112 > ceiling × 0.82` · `0`/`2048` warn, `384`/`768` silent, `1024` resolves per the pinned formula · see `packages/shared/src/__tests__/` (test-plan #E1)
- [ ] 2.3 Implement `HEAP_PER_BUDGET_BYTE` (1.33), `BASELINE_MB` (112), `CRASH_RATIO` (0.82) and the pure guard helper in shared, mirroring the fan-out guard helper's shape (design D1)

## 3. Ordering invariant

- [ ] 3.1 Test invariant catches a missing budget default — server default below `8192`, memory-limits default with no `maxTotalEventBytes` · evaluate the assertion · it fails and names both defaults · see `packages/shared/src/__tests__/` (test-plan #X1)
- [ ] 3.2 Test invariant catches an unlimited budget default — server default below `8192`, memory-limits default with `maxTotalEventBytes` of `0` · evaluate the assertion · it fails · see the same file (test-plan #X2)
- [ ] 3.3 Test invariant passes on a bounded pairing — server default below `8192`, non-zero `maxTotalEventBytes` · evaluate the assertion · it passes · see the same file (test-plan #E3)
- [ ] 3.4 Implement the invariant in shared, checking boundedness rather than presence, with a failure message naming both defaults and the fix (design D2)

## 4. Settings panel

- [ ] 4.1 Test unlimited budget described as unbounded — `maxTotalEventBytes` `0` against the default `1536` ceiling · blur · warning describes the store as unbounded, reports no heap figure, value stays saveable · see `packages/client/src/components/settings/__tests__/settings-bespoke-validation.test.tsx` (test-plan #E4)
- [ ] 4.2 Test finite budget names the heap-equivalent — `maxTotalEventBytes` raised to `2048` MiB against a `1536` MB ceiling · blur · warning reports the heap-equivalent not the raw budget · see the same file (test-plan #E5)
- [ ] 4.3 Test warning appears on both fields — an unsafe pairing · render the Server settings page · warning surfaced on the server heap field and the memory-limits budget field · see `packages/client/src/components/settings/__tests__/settings-field-contract.test.tsx` (test-plan #E6)
- [ ] 4.4 Implement the warning on both fields with translated label and hint plus English fallback, following the sibling coupling warning's conventions, and add the i18n keys to every locale file

## 5. Electron launch path

- [ ] 5.1 Test the Electron launch invocation carries the ceiling — Electron shell launching via `launchDashboardServer` · build the invocation · it carries the configured ceiling, no runtime-default fallback · see `packages/extension/src/__tests__/server-launcher.test.ts` for the stamp-assertion shape (test-plan #E7)
- [ ] 5.2 Test operator pin wins on the Electron path — Electron launch env already carrying an operator-set heap flag · build the invocation · the launcher does not override it · see the same file (test-plan #X5)
- [ ] 5.3 Implement the heap stamp in `packages/electron/src/lib/launch-source.ts`, which today passes a hand-built env with no heap flag (design D3)

## 6. Terminal environment strip

- [ ] 6.1 Test terminal environment carries no inherited ceiling — server under a stamped ceiling · build a dashboard terminal environment · the server's old-space flag is absent · see the `buildSpawnEnv` strip tests for the assertion shape (test-plan #X3)
- [ ] 6.2 Test operator-set flag survives the strip — an operator-set heap flag distinct from the dashboard stamp · build a dashboard terminal environment · the flag is preserved · see the same file (test-plan #X4)
- [ ] 6.3 Apply the session-spawn surgical strip to `packages/server/src/terminal/terminal-manager.ts`, which currently spreads `process.env` wholesale (design D4)

## 7. Manual verification (deferred post-merge)

- [ ] 7.1 Run a heavy Node build inside a dashboard terminal after the strip and confirm it completes under the runtime default, or record the regression with the host's memory size (test-plan: manual-only)

## 8. Documentation

- [ ] 8.1 Delegate to DocScribe: document the coupling guard, the three shared constants and their origin, the ordering invariant, and the terminal headroom regression (inherited `8192` → runtime default, lower on small-memory hosts)
- [ ] 8.2 Update the directory `AGENTS.md` rows for every file this change touches
