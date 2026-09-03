# Test Plan — surface-pi-runtime-on-general

Stage: design   Generated: 2026-08-28

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | settings-panel: Row present on General | state-transition | L1 | automated | health fixture: healthy pi, `piRuntime` present, no divergence, no skew (advisory renders nothing) | render Settings panel at `/settings/general` | pi runtime status row present in the General block with both consumer labels and the shared version; row present despite advisory absence |
| E2 | pi-runtime-selection: Consumers diverge | decision-table | L1 | automated | `piRuntime.consumerDiverged === true`, `consumerMessage` set, both consumer versions equal (same-version, different install) | render the status row | `consumerMessage` rendered verbatim as a warning beside both equal version strings; no contradiction suppressed |
| E3 | pi-runtime-selection: A consumer version is unresolved | BVA (null boundary) | L1 | automated | `spawnVersion: null` (moduleVersion present); second case `moduleVersion: null` | render the status row | unknown-version fallback text for that consumer; no crash; no fabricated version string |
| E4 | pi-runtime-selection: Server does not report piRuntime | fault-injection (missing field) | L1 | automated | health payload without `piRuntime`; second case `piRuntime: null` | render the status row | row renders nothing (no DOM); no error thrown or logged |
| E5 | pi-runtime-selection: Summary performs no writes | fault-injection | L1 | automated | row rendered; network mock recording all requests | activate every interactive element of the row incl. `Change…` | zero requests to `POST /api/pi/runtime`, `PUT /api/tools/:name`, `DELETE /api/tools/:name` |
| E6 | pi-runtime-selection: Single health poller | state-convergence | L1 | automated | panel mounted with fake timers; fetch spy on `/api/health` | advance 90s across two 60s poll ticks | exactly 2 `/api/health` fetches (initial + 1 refetch) from the panel-owned hook; the row component itself issues 0 fetches |
| E7 | pi-runtime-selection: Health shape is not widened | shape guard | L1 | automated | `GET /api/health` response from server route test | assert `piRuntime` key set | keys ⊆ {spawnVersion, moduleVersion, consumerDiverged, consumerMessage} — no filesystem path, no pinned/override indicator (extend `packages/server/src/__tests__/health-shape.test.ts`) |
| E8 | settings-panel: Navigation gating is exactly the rail helper's own | decision-table | L1 | automated | (a) dirty plugin page active; (b) built-in draft dirty on General | request rail navigation with scroll target in each state | (a) same confirmation round trip as Save Bar chips; (b) navigates immediately, no prompt — built-in drafts never block; no new gate in either path |
| E9 | settings-panel: Scroll target survives gated navigation | state-transition | L1 | automated | dirty plugin page; rail navigation with target deferred then confirmed | confirm the navigation dialog | deferred navigation completes AND the pending scroll-target ref is consumed — target section scrolled into view; route still `/settings/<page>` |
| E10 | pi-core-version-check + advisory affordance | decision-table | L1 | automated | `compatibility` prop: Soft warning (`upgradeRecommended`, no error) and Hard advisory (`error` set); `onChangeRuntime` provided | render `PiVersionAdvisory` | affordance rendered in both alert states; activating it invokes `onChangeRuntime` |
| E11 | advisory affordance additive | state-transition | L1 | automated | `compatibility` prop in an alert state; `onChangeRuntime` absent | render `PiVersionAdvisory` | renders exactly as before the change (no affordance, no crash) |
| E12 | settings-panel: Row contributes no dirty state | state-transition | L1 | automated | clean config, row rendered at `/settings/general` | render panel; inspect Save Bar + page chips | Save Bar absent; no dirty chip names General |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|--------------------------------|
| F1 | pi-runtime-selection: Healthy install + Navigating to the picker | state-transition | L3 | automated | docker harness; `/api/health` stubbed with healthy `piRuntime` fixture (pattern: spec's health-route stub); open `/settings/general` | row visible; click `Change…` | URL is exactly `/settings/developer` (no `#`-fragment, no extra query param); `[data-testid="pi-runtime-section"]` scrolled into view (bounding box within viewport); advisory absent while row present |
| F2 | settings-panel: Picker stays on Developer | state-transition | L3 | automated | docker harness; open `/settings/developer` directly | inspect DOM order | `PiRuntimeSection` rendered immediately above `ToolsSection`; existing picker behaviour intact |
| F3 | proposal risk: General grows another always-on element | visual/subjective | — | manual-only | General page with row rendered alongside (or without) the advisory | human reviews placement/copy | [judgment: the two-line read-only status reads as status, not a form field, and does not crowd the page] |

## Coverage summary

- Requirements covered: 5/5 delta requirements (pi-runtime-selection ×2, settings-panel ×2, pi-core-version-check modified ×1)
- Scenarios by class: edge 12 · perf 0 · frontend 3 · error 0
- Scenarios by level: L1 12 · L2 0 · L3 2 · manual-only 1
- Scenarios by disposition: automated 14 · manual-only 1

## New infra needed

- none — all L1 rows land in existing suites (`packages/client/src/components/settings/__tests__/`, `packages/client/src/components/__tests__/PiVersionAdvisory.test.tsx`, `packages/server/src/__tests__/health-shape.test.ts`); L3 rows extend `tests/e2e/pi-runtime-picker.spec.ts`.
