# Test Plan — cleanup-client-plugin-promises

Stage: proposal/design   Generated: 2026-08-06

HARD gate cleared — all four unfillable slots resolved by decision:
E2E coverage = targeted specs for the 4 densest client surfaces; empty-`.catch`
enforcement = review-only (manual row F7); client logging path = a new shared
`reportError()` helper; perf budget = p95 regression ≤ 10% vs pre-change
baseline.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | tunnel-core async-executor defect (`tunnel-core.ts:167`) | state-transition (illegal edge) | L1 | automated | `TunnelCore` whose `spec.detectBinary()` throws synchronously inside the executor | `createTunnel(8000)` is called and awaited with a 2s timeout | the returned promise **settles** — rejects with the thrown error (or resolves `null`); it MUST NOT remain pending past the timeout, which is the current behaviour |
| E2 | D6 narrowing preserves inflight memoization (`undefined` variant) | decision-table | L1 | automated | `ghAvailablePromise === undefined`, `ghAvailableCache === undefined`, `fetchTool` stubbed to resolve after 50ms | `probeGhAvailable()` invoked twice within the same tick | `fetchTool` called exactly **once**; both calls resolve to the same value; second call returns the identical promise reference |
| E3 | D6 narrowing preserves inflight memoization (`null` variant) | decision-table | L1 | automated | `inflight === null` in `useHostPlatform` / `useLaunchSource`, and `pendingCreate === null` in `tunnel-core.ts:156`; underlying fetch stubbed to resolve after 50ms | the probe / `createTunnel` invoked twice concurrently | underlying fetch or `createInner` invoked exactly **once**; both callers observe the same result |
| E4 | D6 guard precedence across cache/inflight states | decision-table | L1 | automated | the 3 reachable states: (cache set, inflight null) · (cache unset, inflight set) · (cache unset, inflight null) | probe invoked once per state | state 1 returns cached value with zero fetches; state 2 returns the in-flight promise with zero new fetches; state 3 performs exactly one fetch |
| E5 | Ratchet graduation — extraction covers every linted extension | BVA (off-by-one on the site set) | L1 | automated | Biome floating-promise output containing `packages/server/src/rpc-keeper/keeper.cjs:141` | the site-enumeration used for graduation accounting is run over that output | the enumerated site count equals Biome's reported diagnostic total; the `.cjs` site is present in the enumeration |
| E6 | Every lint diagnostic site has exactly one owning change | decision-table | L1 | automated | the claimed-site counts declared by `cleanup-client-plugin-promises` (88 floating / 5 misused) and `cleanup-async-semantics-server-extension` (55 floating / 6 misused) | the ledger sum is computed and compared to a live repo-root Biome run | floating sum **143** and misused sum **11**, each equal to the live repo-root totals; no site appears in two changes' claimed sets |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | design.md Risks — an `await` added to a render/event hot path | tail-latency vs baseline | L3 | automated | the interaction exercised by `tests/e2e/chat-render-perf.spec.ts`, run against the pre-change commit and the post-change commit | p95 interaction latency regresses by **≤ 10%** vs the pre-change baseline | the spec's existing sample count / measurement window |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | Global unhandled-rejection observability + discard convention, `UnifiedPackagesSection` (7 sites) | state-convergence | L3 | automated | the packages surface loaded against the docker harness | each async action on the surface is exercised (search, install-toggle, refresh) | zero `unhandledrejection` events and zero `pageerror` for the duration; the surface converges to a settled rendered state |
| F2 | same, `ProviderAuthSection` (5 sites) | state-convergence | L3 | automated | the provider-auth settings surface loaded | each async auth action is exercised | zero `unhandledrejection` / `pageerror`; surface converges to a settled state |
| F3 | same, `EmlPreview` (3 sites) | state-convergence | L3 | automated | an `.eml` artifact opened in preview (extend existing `tests/e2e/eml-preview.spec.ts`) | the preview loads and its async parse/render actions run | zero `unhandledrejection` / `pageerror`; preview renders content |
| F4 | same, `NetworkDiscoverySection` (3 sites) | state-convergence | L3 | automated | the connectivity/network-discovery surface loaded | discovery scan is triggered and allowed to settle | zero `unhandledrejection` / `pageerror`; discovery reaches a terminal state (results or empty-state) |
| F5 | D1 React guidance — a `useEffect` fix must not break the cleanup contract | state-transition (illegal edge) | L1 | automated | a component whose `useEffect` performs the touched async work, with the underlying fetch stubbed to resolve after 100ms | the component is unmounted **before** the promise settles | no state update occurs after unmount (no act/`setState`-after-unmount warning); the effect's cleanup ran; the effect callback returned `undefined` or a function — never a promise |
| F6 | Global handler is installed before any application work | state-transition | L3 | automated | client bundle loaded with an injected promise rejection fired at the earliest script execution point | page load | the rejection is captured by the global handler and reported; it is not lost to a not-yet-installed listener |
| F7 | `.catch` handler bodies are non-empty and meaningful | code review | — | manual-only | the change's full diff | reviewer reads every `.catch` handler body introduced | [judgment: each handler reports meaningfully rather than swallowing — no automatable observable; enforcement deliberately left to `review-code`, since a Biome severity flip belongs to `add-typeaware-lint-gate`] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | Discards state their handling — rejection is reported, not swallowed | fault-injection (abort) | L3 | automated | the network request behind a touched client action is aborted mid-flight | the action is invoked on one of the F1–F4 surfaces | zero `unhandledrejection`; the failure is reported through `reportError` (observable as a console error record); the surface degrades to a visible error/empty state rather than hanging |
| X2 | Global unhandled-rejection observability — Electron main | fault-injection (abort) | electron | **manual-only** (downgraded during implementation) | a promise rejected in the Electron main process with no local handler | the main process runs the rejecting path | the `process.on("unhandledRejection", …)` handler fires and the reason reaches the existing `log()` path in `packages/electron/src/main.ts` — **verified by launching a packaged build and reading `pi-dashboard-electron.log`**. Downgraded per task 5.15's own fallback: `ci-electron.yml` is a dispatch-only installer BUILD matrix and never launches the app, so it cannot assert main-process log output. A static wiring guard (`packages/electron/src/__tests__/unhandled-rejection-wiring.test.ts`) keeps the handler from silently disappearing. |
| X3 | The global handler does not swallow | fault-injection (abort) | L1 | automated | a rejection whose reason is a distinctive `Error` with a known message and stack | the handler processes it | the emitted record contains that message; the reason is not replaced by a generic placeholder and the reporting path is not silently short-circuited |
| X4 | `reportError()` helper is the client's logging path | fault-injection (abort) | L1 | automated | a rejecting promise handled by a site handler written per D1 | the handler runs | `reportError` is invoked exactly once with the rejection reason, and forwards to the client's console-error path |

---

## Coverage summary

- Requirements covered: 4/4 spec requirements (3 ADDED + 1 MODIFIED), plus the 2 implementation invariants (D6 narrowing, `tunnel-core:167` defect)
- Scenarios by class: edge 6 · perf 1 · frontend 7 · error 4 — **18 total**
- Scenarios by level: L1 9 · L2 0 · L3 7 · electron 1 · manual-only 1
- Scenarios by disposition (as planned): automated **17** · manual-only **1**
- Scenarios by disposition (as implemented): automated **16** · manual-only **2** —
  X2 downgraded to manual-only, see its row.

## New infra needed

- **`reportError()` helper** in `packages/client/src/lib/` — the client has no
  central logging module today (files call `console.error` directly). This is a
  second new instrument beyond the global handler; the proposal's amended
  Non-Goal must cover it.
- **Three new E2E specs** (F1, F2, F4). F3 extends the existing
  `tests/e2e/eml-preview.spec.ts`.
- **Electron-level rejection assertion (X2)** — verify an electron test job can
  assert main-process log output before authoring; if not, this row degrades to
  manual-only rather than being silently dropped.
- No new *level* or harness is required: L1 vitest, L3 Playwright vs the docker
  harness, and the electron workflow all exist.
