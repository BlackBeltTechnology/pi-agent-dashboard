# Test Plan — cleanup-async-semantics-server-extension

Stage: proposal/design   Generated: 2026-08-06

HARD gate cleared — three unfillable slots resolved by decision: the test-teeth
check becomes an **automated scripted mutation harness** (new, reusable infra);
**all 13** production sites get a per-site assertion, creating test files where
none exist; and the load harness is **extended broadly** with `openspec_refresh`
and `shutdown` drives.

Scope note: these choices are the thorough end of each option. They add three
pieces of new infra (mutation harness, `directory-handler` and `keeper` test
files, harness message drives) on top of 61 site fixes.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | Lint fix vocabulary must match the site | state-transition (illegal edge) | L1 | automated | `withPiResolve` in `pi-resource-activation-timeout.test.ts:22`, annotated `: void` | `npx biome lint --only=lint/nursery/noFloatingPromises packages/server/src/__tests__/pi-resource-activation-timeout.test.ts` | zero diagnostics for that file; the source contains no `await withPiResolve(` anywhere |
| E2 | Lint fix vocabulary must match the site | decision-table | L1 | automated | the full post-change diff | scan for `await` applied to an expression whose static type is not a promise | no such site exists |
| E3 | Discards state their handling (bare `void` ban) | decision-table | L1 | automated | the full post-change diff across the 3 packages | scan for `void <expr>` not followed by `.catch(` | no bare `void` discard exists; every discard is `void p.catch(handler)` with a non-empty handler |
| E4 | Inherited electron guards narrow rather than await | decision-table | L1 (electron runner) | automated | `lib/server-lifecycle.ts:454` (`Promise<LaunchOutcome> \| null`) and `lib/doctor-window.ts:52` (`Promise<DoctorReport> \| null`), narrowed `!== null`; underlying work stubbed to resolve after 50ms | the guarded entrypoint invoked twice concurrently | underlying work runs exactly once; both callers observe the same result; `noMisusedPromises` reports zero for both files |
| E5 | Inherited electron callback mismatch | decision-table | L1 (electron runner) | automated | `createTray(() => mainWindow, quit, …)` wrapped per D4, with `quit` stubbed to reject | the tray Quit item is clicked | the rejection reaches the wrapper's handler; no bare `void`; `noMisusedPromises` reports zero for `main.ts` |
| E6 | Ratchet graduation — this change's claimed sites clear | BVA | L1 | automated | the post-change tree | `biome lint --only` for both rules over `packages/{server,extension,electron}` | `noFloatingPromises` reports 0 for extension and electron and exactly the 0 remaining for server; `noMisusedPromises` reports only the 2 sibling-owned `tunnel-core.ts:156,167` sites |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | A performance oracle must exercise the code it claims to cover | coverage-of-oracle | L1 | automated | the extended `browser-gateway-load.test.ts` driving `openspec_refresh`, `openspec_bulk_archive` and `shutdown` messages | `directory-handler.ts:226,247` and `browser-gateway.ts:621` are each executed at least once inside the measured window (assert via spy/counter, not coverage report) | the harness's existing scenario window |
| P2 | A performance oracle must exercise the code it claims to cover | tail-latency | L1 | automated | the extended harness, pre-change vs post-change | the harness's existing flush/backpressure budgets do not regress | as defined by the harness scenario matrix A–E |
| P3 | No added `await` serializes the replay path | tail-latency | L1 | automated | harness extended so `subscription-handler.ts:220,243,249` run **inside** the measured window rather than as empty-replay setup | subscribe with a non-empty replay backlog | replay drain latency does not regress vs the pre-change baseline |

### Frontend-quirk

*(none — this change touches no rendered UI. The 61 sites are server, extension test files, and electron main process.)*

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Per-site assertion — `subscription-handler.ts:220` | fault-injection (abort) | L1 | automated | the awaited/handled operation at `:220` rejects | a subscribe that reaches that path | the rejection is observed by the site's handler (or propagates deliberately); the gateway does not hang and no unhandled rejection escapes. See `packages/server/src/__tests__/subscription-handler.test.ts` |
| X2 | Per-site assertion — `subscription-handler.ts:243` | fault-injection (abort) | L1 | automated | the operation at `:243` rejects | replay path exercised | rejection observed; subscribe still settles. See `subscription-handler.test.ts` |
| X3 | Per-site assertion — `subscription-handler.ts:249` | fault-injection (abort) | L1 | automated | the operation at `:249` rejects | replay path exercised | rejection observed; subscribe still settles. See `subscription-handler.test.ts` |
| X4 | Per-site assertion — `server.ts:2144` (`cleanupStaleZrok`) | fault-injection (abort) | L1 | automated | zrok cleanup rejects during boot | server `start()` invoked | boot continues to a listening state; the rejection is logged, not swallowed silently |
| X5 | Per-site assertion — `server.ts:2180` (session discovery) | fault-injection (abort) | L1 | automated | session discovery rejects during boot | server `start()` invoked | boot completes; rejection logged; no unhandled rejection |
| X6 | Per-site assertion — `directory-handler.ts:226` | fault-injection (abort) | L1 | automated | the openspec refresh operation rejects | an `openspec_refresh` message is dispatched | rejection observed; the gateway remains responsive to a subsequent message. **New test file** — see sibling `browser-handlers/__tests__/session-action-handler.test.ts` for harness glue |
| X7 | Per-site assertion — `directory-handler.ts:247` | fault-injection (abort) | L1 | automated | the bulk-archive operation rejects | an `openspec_bulk_archive` message is dispatched | rejection observed; gateway remains responsive. **New test file**, same exemplar |
| X8 | Per-site assertion — `tunnel-core.ts:160` | fault-injection (abort) | L1 | automated | `createInner` rejects so the `promise.finally()` at `:160` runs on a rejected promise | `createTunnel(port)` called | `pendingCreate` is cleared, the rejection is observed, and a subsequent `createTunnel` starts a fresh attempt rather than returning the dead promise. See `packages/server/src/__tests__/tunnel.test.ts` |
| X9 | Per-site assertion — `session-load-worker-pool.ts:254` | fault-injection (abort) | L1 | automated | the pooled worker task rejects | a session load is dispatched to the pool | the rejection is observed by the pool; the worker slot is released rather than leaked. See `packages/server/src/__tests__/session-load-worker.test.ts` |
| X10 | Per-site assertion — `openspec-poll-worker-pool.ts:278` | fault-injection (abort) | L1 | automated | the poll worker task rejects | a poll cycle is dispatched | rejection observed; the slot is released and polling continues. See `packages/server/src/__tests__/openspec-poll-worker.test.ts` |
| X11 | Per-site assertion — `recovery-server.ts:370` | fault-injection (abort) | L1 | automated | the recovery operation rejects | the recovery path is triggered | rejection observed; the recovery server remains in a defined state. See `packages/server/src/__tests__/recovery-server.test.ts` |
| X12 | Per-site assertion — `browser-gateway.ts:621` (`handleShutdown`) | fault-injection (abort) | L1 | automated | `handleShutdown` rejects | a `shutdown` message is dispatched | the rejection is observed rather than floating; shutdown still reaches a terminal state. See `packages/server/src/__tests__/browser-gateway-load.test.ts` helpers for gateway construction |
| X13 | Per-site assertion — `keeper.cjs:141` retry path | fault-injection (abort) | L1 | automated | `startServer(true)` rejects on the backoff retry | the retry branch is entered after a failed first start | the rejection is observed and the outer promise settles rather than hanging. **New test file** — see `packages/server/src/__tests__/keeper-manager.test.ts` for harness glue; note the subject is `.cjs` |
| X14 | Per-site assertion — `electron main.ts:675` bootstrap | fault-injection (abort) | L1 (electron runner) | automated | `main()` rejects | the electron main entrypoint runs | the rejection is handled by the bootstrap handler and does not float. See `packages/electron/src/__tests__/server-lifecycle-spawn-options.test.ts` for harness glue |
| X15 | A promise fix in a test must not weaken the test | mutation | L1 | automated | the scripted mutation harness, applied to each of the 4 touched test files | a behaviour each touched test covers is temporarily flipped | every touched test file goes red under mutation; a file that stays green under mutation fails the harness |
| X16 | A promise fix in a test must not weaken the test | state-transition | L1 | automated | a deliberately-in-flight `bus.request(...)` that **resolves**, settled per D3 | the touched extension test runs | the test passes and still asserts the same adapter interaction; no `.rejects` assertion was applied to a resolving promise |

---

## Coverage summary

- Requirements covered: 3/3 spec requirements, plus the site-level implementation
  invariants (bare-`void` ban, electron vocabulary, graduation counts)
- Scenarios by class: edge 6 · perf 3 · frontend 0 · error 16 — **25 total**
- Scenarios by level: L1 22 · L1-electron 3 · L2 0 · L3 0 · manual-only 0
- Scenarios by disposition: automated **25** · manual-only **0**

## New infra needed

- **Scripted mutation harness** (X15) — no mutation tooling exists in the repo
  (no Stryker). Must flip a covered behaviour and assert the touched tests go
  red. Built to be reusable by later ladder rungs, not one-off.
- **New test file for `browser-handlers/directory-handler.ts`** (X6, X7) — no
  sibling test exists; nearest exemplar is
  `browser-handlers/__tests__/session-action-handler.test.ts`.
- **New test file for `rpc-keeper/keeper.cjs`** (X13) — subject is CommonJS;
  confirm the vitest project resolves `.cjs` before authoring.
- **Load-harness message drives** (P1, P3) — extend
  `browser-gateway-load.test.ts` to send `openspec_refresh`,
  `openspec_bulk_archive`, and `shutdown`, and to place the replay path inside
  the measured window.
- **CI must run the electron vitest project** (E4, E5, X14) —
  `packages/electron` is deliberately excluded from the root vitest projects and
  runs via `cd packages/electron && npm test`. Confirm CI invokes it, or these
  three scenarios never execute.
- No new *level* is required: L1 vitest (root projects) and the separate electron
  vitest project both exist.
