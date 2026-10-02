# Tasks — guard-server-heap-and-store-coupling

Ordering note: this change depends on `bound-event-store-by-bytes` (provides
`maxTotalEventBytes`) and `bound-session-heap-and-gc-telemetry` (provides the
lowered default). Both have merged to `develop`.

Reconciled at implementation time (ship-it, user-approved) against design.md
and the delta specs: section 1 became verify-only (D2 — the sibling owns the
consolidation), the restart re-stamp (D5) gained a section, and spec scenarios
without a task gained one.

## 1. Server-heap default — verify the sibling's single source (D2)

- [x] 1.1 Confirm `DEFAULT_SERVER_HEAP` lives in browser-safe `packages/shared/src/heap-limits.ts`, re-exported by `config.ts`, and that the wrapper literal is pinned against it by the sibling's test — no new consolidation in this change (design D2)
- [x] 1.2 Test single source for the server default — the shared `DEFAULT_SERVER_HEAP` · resolve it on the wrapper, bridge and Electron paths · all three resolve to the same constant · see `packages/electron/src/lib/__tests__/launch-source-heap.test.ts` (Electron fallback), wrapper + bridge already pinned in `packages/server/src/__tests__/process-manager-heap-args.test.ts` and `packages/extension/src/__tests__/server-launcher.test.ts` (test-plan #E8)

## 2. Shared constants + guard predicate

- [x] 2.1 Test constants come from one source — the shared constants module · read `HEAP_MB_PER_BUDGET_MIB`, `BASELINE_MB`, `CRASH_RATIO` · all three exported, guard reads them rather than inlining literals · see `packages/shared/src/__tests__/heap-store-coupling.test.ts` (test-plan #E2)
- [x] 2.2 Test guard predicate across the range — budgets `0`, `384`, `768`, `1024`, `2048` MiB against a `1536` MB ceiling · evaluate `budgetMiB × 1.33 + 112 > ceiling × 0.82` · `0`/`1024`/`2048` warn, `384`/`768` silent · see the same file (test-plan #E1)
- [x] 2.3 Test byte-denominated default does not warn — `805306368` bytes against `1536` · evaluate · silent · see the same file (test-plan #E9)
- [x] 2.4 Implement `HEAP_MB_PER_BUDGET_MIB` (1.33), `BASELINE_MB` (112), `CRASH_RATIO` (0.82) and the pure byte-accepting guard helper in `packages/shared/src/heap-limits.ts`, mirroring `subagentHeapBudget`'s shape (design D1)

## 3. Ordering invariant

- [x] 3.1 Test invariant catches a missing budget default — server default below `8192`, memory-limits default with no `maxTotalEventBytes` · evaluate the assertion · it fails and names both defaults · see `packages/shared/src/__tests__/heap-store-coupling.test.ts` (test-plan #X1)
- [x] 3.2 Test invariant catches an unlimited budget default — server default below `8192`, `maxTotalEventBytes` of `0` · evaluate the assertion · it fails · see the same file (test-plan #X2)
- [x] 3.3 Test invariant passes on a bounded pairing — server default below `8192`, non-zero `maxTotalEventBytes` · evaluate the assertion · it passes · see the same file (test-plan #E3)
- [x] 3.4 Implement the invariant as a vitest assertion over the REAL shared defaults (not a module-scope throw), checking boundedness rather than presence, with a failure message naming both defaults and the fix (design D2)

## 4. Settings panel

- [x] 4.1 Test unlimited budget described as unbounded — `maxTotalEventBytes` `0` against the default `1536` ceiling · edit · warning describes the store as unbounded, reports no heap figure, value stays saveable · see `packages/client/src/components/settings/__tests__/settings-bespoke-validation.test.tsx` (test-plan #E4)
- [x] 4.2 Test finite budget names the heap-equivalent — `maxTotalEventBytes` raised to `2048` MiB against `1536` · edit · warning reports the heap-equivalent not the raw budget · see the same file (test-plan #E5)
- [x] 4.3 Test warning appears on both fields — an unsafe pairing · render the Server settings page · warning surfaced on the server heap field and the memory-limits budget field · see `packages/client/src/components/settings/__tests__/settings-field-contract.test.tsx` (test-plan #E6)
- [x] 4.4 Implement the warning on both fields with translated text plus English fallback, following the sibling coupling warning's conventions, and add the i18n keys to every locale file
- [x] 4.5 Retire cold-start-only (user-approved widening): `config-api` reports `serverHeap` as `restartRequired`, `coldStartRequired` + `settings.coldStartRequired` removed, spec deltas REMOVE/replace the cold-start requirements in `heap-limits`, `server-restart`, `settings-panel`; correct the Server-heap copy (`settings.serverHeapDescription`, `settings.heap.serverDivergence`, `ServerHeapConfig` doc) — a restart now applies a changed ceiling (design D5)

## 5. Electron launch path

- [x] 5.1 Test the Electron launch environment carries the ceiling — configured ceiling in `config.json` · build the launch env · it carries the configured ceiling and the provenance marker · see `packages/electron/src/lib/__tests__/launch-source-heap.test.ts` (test-plan #E7)
- [x] 5.2 Test unreadable config falls back to the shared default — `config.json` absent / unparseable · build the launch env · shared default stamped, no throw · see the same file (test-plan #E10)
- [x] 5.3 Test operator pin wins on the Electron path — env already carrying an operator heap flag · build the launch env · flag untouched, no flag added · see the same file (test-plan #X5)
- [x] 5.4 Implement the heap stamp in `packages/electron/src/lib/launch-source.ts` (`spawnFromSource`), reading `config.json` with the wrapper's `JSON.parse`-in-`try` shape and stamping via the shared `stampHeapFlag` (design D3)

## 6. Restart re-stamp

- [x] 6.1 Test restart preserves the ceiling — dashboard-stamped env, unchanged config · build the respawn env · ceiling carried · see `packages/server/src/__tests__/restart-helper.test.ts` (test-plan #E11)
- [x] 6.2 Test restart picks up an edited ceiling — env stamped `1536`, config `2048` · build the respawn env · `2048`, no duplicate token · see the same file (test-plan #E12)
- [x] 6.3 Test restart does not shadow an operator pin — env with operator pin · build the respawn env · pin untouched, nothing added · see the same file (test-plan #X9)
- [x] 6.4 Implement the re-stamp in `packages/server/src/spawn-process/restart-helper.ts`, re-reading the configured ceiling at restart time (design D5)

## 7. Terminal environment strip

- [x] 7.1 Test terminal environment carries no inherited ceiling — server under a stamped ceiling · build a dashboard terminal environment · the server's old-space flag is absent · see `packages/server/src/__tests__/terminal-manager.test.ts` (test-plan #X3)
- [x] 7.2 Test operator-set flag survives the strip — distinct operator heap flag · build the environment · preserved · see the same file (test-plan #X4)
- [x] 7.3 Test operator flag identical to the stamp survives — no marker · build the environment · preserved · see the same file (test-plan #X7)
- [x] 7.4 Test provenance marker does not leak — stamped server · build the environment · marker absent · see the same file (test-plan #X8)
- [x] 7.5 Apply the shared `stripDashboardHeapFlag` to `packages/server/src/terminal/terminal-manager.ts`, which currently spreads `process.env` wholesale (design D4)

## 8. Manual verification (deferred post-merge)

- [ ] 8.1 Run a heavy Node build inside a dashboard terminal after the strip and confirm it completes under the runtime default, or record the regression with the host's memory size (test-plan: manual-only)

## 9. Documentation

- [x] 9.1 Delegate to DocScribe (subagent returned empty; written inline in caveman style, `docs/heap-limits.md` + sidecar): document the coupling guard, the three shared constants and their origin, the ordering invariant, the restart re-stamp, and the terminal headroom regression (inherited `8192` → runtime default, lower on small-memory hosts)
- [x] 9.2 Update the directory `AGENTS.md` rows for every file this change touches
