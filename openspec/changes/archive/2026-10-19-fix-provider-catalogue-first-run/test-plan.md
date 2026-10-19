# Test Plan — fix-provider-catalogue-first-run

Stage: design   Generated: 2026-10-19

No clarification markers. Every Triple resolves from `specs/**` and `design.md`. The perf threshold, 50 ms p95, comes from design Risks.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | server "API key provider registry" › Catalogue not yet received | state (cold) | L1 | automated | no bridge catalogue; absent `auth.json`; fake runtime loaded via `initOAuthRegistry` exposing `deepseek` (apiKey) + `anthropic` (oauth+apiKey), `checkAuth`→`undefined`; one connected bridge | `GET /api/provider-auth/status` | 200 array contains api-key rows `deepseek` (`authenticated:false`) and `anthropic-api` (`authJsonKey:"anthropic"`) plus OAuth row `anthropic`; `request_providers` sent to the bridge |
| E2 | server › Catalogue not yet received (real runtime) | integration | L1 | automated | real pi-coding-agent runtime (wired as in `provider-auth-storage.test.ts:54`); temp `HOME`, no `auth.json`, no bridge | `await getAuthStatus()` | contains api-key rows `deepseek` and `openrouter-api`; every api-key row `authenticated:false` unless an env var is set in the test env |
| E3 | server › fallback `configured/source/authLabel` mapping | decision table | L1 | automated | `checkAuth` returns (a) `undefined`, (b) `{type:"oauth",source:"OAuth"}`, (c) `{type:"api_key",source:"stored credential"}` with `authData[id]` present, (d) `{type:"api_key",source:"DEEPSEEK_API_KEY"}` with no `authData[id]` | `buildRuntimeCatalogue` | (a) `configured:false`, no source; (b) `configured:false`; (c) `configured:true, source:"stored"`; (d) `configured:true, source:"environment", authLabel:"DEEPSEEK_API_KEY"` |
| E4 | server › fallback `envVar` derivation | EP+BVA | L1 | automated | labels: `"OPENAI_API_KEY"` (set), `"OPENAI_API_KEY"` (unset), `"A_KEY, B_KEY"` (only `B_KEY` set), `"AWS access keys"`, `"9KEY"` (set), `""` | `buildRuntimeCatalogue` with an injected `env` | `envVar` = `OPENAI_API_KEY`, absent, `B_KEY`, absent, absent, absent; `authLabel` absent for `""` |
| E5 | server › Fallback env-var hint derives from the auth label (D7 interplay) | decision table | L1 | automated | fallback rows: env-var row (`envVar` set, source environment); labelled ambient row (`authLabel:"AWS access keys"`, no `envVar`) | `await getAuthStatus()` | env-var row `configured:true, authenticated:false, envVar:"OPENAI_API_KEY"`; ambient-label row `authenticated:true, authLabel` present |
| E6 | server › Custom providers are excluded from fallback API-key rows | EP | L1 | automated | `providers.json` (temp `HOME`) defines `my-llm` and `deepseek`; runtime exposes both | `await getAuthStatus()` | no api-key row `my-llm` and no api-key row `deepseek`; other built-ins present |
| E7 | server › custom flag fail-open on corrupt `providers.json` | EP (invalid) | L1 | automated | `providers.json` = `{` (unparseable); runtime exposes `my-llm` | `await getAuthStatus()` | api-key row `my-llm` present (no id marked custom); response 200 |
| E8 | server › Bridge catalogue takes precedence; Last bridge disconnects | state-transition | L1 | automated | fallback serving (runtime has `deepseek`, not `custom-llm`) | (1) non-empty push `[custom-llm]` → status; (2) `invalidateCatalogue()` → status | (1) rows = bridge set only: `custom-llm` present, `deepseek` absent; (2) `deepseek` back, `custom-llm` absent |
| E9 | server › Empty bridge push does not mask the fallback; arrival delta | state-transition | L1 | automated | (a) nothing held; (b) held `[deepseek]` | push `providers_list` with `[]` (twice, same session) | (a) `isCatalogueReady()===false`, status from fallback, next status re-sends `request_providers`; (b) snapshot still `[deepseek]`, ready true; debug log emitted exactly once for that session |
| E10 | server › Key saved against a fallback row is reported | state | L1 | automated | fallback serving, no `auth.json` | `PUT /api/provider-auth/api-key` `{provider:"deepseek", key:"sk-test-1234567890"}` then `GET /status` | `deepseek` row `authenticated:true, configured:true, source:"stored", maskedKey:"sk-te...890"` |
| E11 | server › Catalogue availability signal (all branches) | decision table | L1 | automated | (a) non-empty bridge held; (b) none held + runtime with ≥1 non-custom; (c) none held + runtime exposing only custom ids; (d) none held + runtime failed | `GET /api/provider-auth/catalogue-ready` | (a) `{ready:true,fallback:false}`; (b) `{ready:false,fallback:true}`; (c) `{ready:false,fallback:false}`; (d) `{ready:false,fallback:false}` |
| E12 | design D3 retention + generation guard | state-transition | L1 | automated | fake sources: (a) runtime with zero OAuth providers; (b) `getRuntime` rejects; (c) init in flight, then `setOAuthRegistryRuntimeSource(other)` | `initOAuthRegistry` / `getRegistryRuntime()` | (a) runtime retained, `getRegistryError()` non-null; (b) `undefined`; (c) the stale init resolves and writes neither runtime nor snapshot |
| E13 | design D1 typed surface | EP (invalid) | L1 | automated | retained handle whose runtime lacks `checkAuth` | `await getAuthStatus()`; `GET catalogue-ready` | api-key portion `[]`; `fallback:false` |

### Performance

| id | requirement | technique | level | disposition | workload | metric + threshold | window |
|----|-------------|-----------|-------|-------------|----------|--------------------|--------|
| P1 | design Risks "Per-request cost" | tail-latency | L1 | automated | real runtime, cold temp `HOME`, no session; `/status` and `/catalogue-ready` fired concurrently, 50 iterations each (bench test gated behind `PI_BENCH=1`) | p95 < 50 ms per endpoint; p50/p95 printed for the PR | 50 iterations after 1 discarded warm request |

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | ui › Fallback catalogue on first run | state | L1 | automated | `catalogue-ready` → `{ready:false,fallback:true}`; `/status` → OAuth rows + unconfigured `deepseek`; `/api/providers` empty | render `ProviderAuthSection`, open the Add picker | `providers-empty` and `catalogue-fallback-notice` rendered; no `catalogue-unavailable-notice`; picker lists `deepseek` and the Custom endpoint entry |
| F2 | ui › No catalogue with stored keys | state | L1 | automated | `{ready:false,fallback:false}`; `auth.json`-backed rows unavailable | render | `catalogue-unavailable-notice` rendered; `providers-empty` absent; Add control present |
| F3 | ui › Older server without the fallback field | EP (missing field) | L1 | automated | `catalogue-ready` → `{ready:false}` | render | `catalogue-unavailable-notice` rendered; no `catalogue-fallback-notice` |
| F4 | landing › Skipping unlocks the next step | state-transition | L1 | automated | `providersReady=false`, `pinnedCount=0`, `sessionsCount=0`, clean localStorage | click `onboarding-step-1-skip` | `onboarding-step-1-skipped` row with `onboarding-step-1-resume`; `onboarding-step-2-create` visible and primary; `onboarding-progress` text "0 of 3 done"; localStorage `pi-dashboard.onboarding.providersSkipped`=`"true"` |
| F5 | landing › Skipped step lets a session be started | state | L1 | automated | skipped; `pinnedCount=1`, `firstPinnedCwd="/p"`; `sessionsCount=0` | click the Step ③ CTA | `onSpawnSession` called once with `"/p"` |
| F6 | landing › Skip survives a reload | state | L1 | automated | localStorage key `"true"` before mount; no credentials | mount `LandingPage` | `onboarding-step-1-skipped` rendered; no `onboarding-step-1-skip` |
| F7 | landing › Done wins over a previous skip; Skip control absent once done | decision table | L1 | automated | localStorage key `"true"`; `providersReady=true` | mount | `onboarding-step-1-done` rendered; neither `onboarding-step-1-skip` nor `onboarding-step-1-resume` in the DOM |
| F8 | landing › Resume setup from the skipped row | state | L1 | automated | skipped | click `onboarding-step-1-resume` | `navigate("/settings/providers")` called once |
| F9 | landing › at most one primary control | decision table | L1 | automated | all reachable combos of {pending, skipped, done} × pinned {0,1} × sessions {0,1} | render each | primary-styled buttons count ≤ 1 in every combo; = 1 iff a pending step exists |
| F10 | landing › storage unavailable keeps skip while mounted | fault-injection | L1 | automated | `localStorage.setItem`/`getItem` throw | click skip, rerender the same instance | skipped row stays rendered; no uncaught error |
| F11 | landing › a11y of new controls and state | state | L1 | automated | pending, then skipped | query by role | `getByRole("button",{name:/skip for now/i})` and `getByRole("button",{name:/set up now/i})` exist; the skipped row has a marker element plus visible text |
| F12 | landing › skipped-row copy | state | L1 | automated | skipped | render | text states setup skipped, sessions need a provider to run prompts, and a session lists every provider it knows |
| F13 | landing › Skipping unlocks the next step + survives reload (rendered app) | state-transition | L3 | automated | docker harness; `page.route` mocks `/api/provider-auth/status` (all unauthenticated) and `/api/providers` (empty); pins unpinned as in the exemplar | click `onboarding-step-1-skip`, reload page | `onboarding-step-2-create` visible after the click and again after the reload |
| F14 | ui/landing visual polish | visual/subjective | — | manual-only | clean profile (temp `HOME`, no `auth.json`, no session) | human looks at Settings → Providers and Landing | [judgment: info notice and skip glyph read as non-alarming and match `ui-contract.md`; screenshots attached to the PR] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | server › Fallback derivation failure degrades | fault-injection (abort) | L1 | automated | runtime `getProviders()` throws | `GET /api/provider-auth/status` | 200; OAuth rows present; zero `flowType:"api_key"` rows |
| X2 | design D1 per-row degrade | fault-injection (abort) | L1 | automated | `checkAuth("deepseek")` rejects; others resolve | `buildRuntimeCatalogue` | `deepseek` entry `configured:false`; all other entries present and mapped |
| X3 | server › `auth.json` cannot be parsed | fault-injection (corrupt) | L1 | automated | `auth.json` contents `{` | `await getAuthStatus()` | api-key portion `[]`; `checkAuth` spy called 0 times; `proper-lockfile` lock spy called 0 times from the fallback path |
| X4 | security: no OAuth refresh / no write | fault-injection (expired) | L1 | automated | `auth.json` holds `anthropic` OAuth with `expires` in the past | `await getAuthStatus()` via the real runtime | `auth.json` bytes identical before and after; no request to the token endpoint (fetch spy count 0) |
| X5 | server › Request during runtime start-up | fault-injection (delay) | L1 | automated | `getRuntime` returns a deferred promise | `GET catalogue-ready`, then resolve the deferred | the response is not sent before resolution; then `{ready:false,fallback:true}` |
| X6 | server › Neither source available | fault-injection (abort) | L1 | automated | runtime create rejects (`ModelRuntimeUnavailableError`) | `GET /status`; `GET catalogue-ready` | `/status` 200 with no api-key rows; `catalogue-ready` `{ready:false,fallback:false}` |
| X7 | server › Api-key rows disappear while the catalogue is unavailable (NOTE branch; rewrite of `catalogue-invalidation.test.ts` X14) | state | L1 | automated | `createServer` with the real runtime; stored `openrouter` api key; no bridge | `GET /status` | `openrouter-api` api-key row present, `source:"stored"` (emitted by the fallback) |

---

## Coverage summary

- Requirements covered: 8/8 delta requirements, plus design D1–D6 invariants
  - server: API key provider registry, Catalogue availability signal, Credentials-updated arrival;
  - ui: Catalogue-unavailable;
  - landing: Empty-state surface, Step ①, Step ②, Step ① can be skipped.
- Scenarios by class: edge 13 · perf 1 · frontend 14 · error 7
- Scenarios by level: L1 33 · L3 1 · manual 1
- Scenarios by disposition: automated 34 · manual-only 1

## New infra needed

- none. P1 runs as a vitest bench-style test gated by `PI_BENCH=1`; it is not a new harness.
