# README.md — index

Pull-only condensed map. Source: tests/e2e/README.md. Run command → lifecycle → spec → env var → convention.

## Overview
- Purpose — browser E2E; real Chromium vs docker/ test harness at `http://localhost:18000`; isolated ephemeral dashboard, state discarded each run.
- Additive layer — complements qa/ VM smoke + site/ Playwright; owns rendered-UI behaviour assertions.

## Prerequisites
- Docker running — suite boots `docker/` test container.
- Chromium auto-installed — `npm run test:e2e` / `test:e2e:ui` run `playwright install chromium` first (sub-second no-op once installed); browsers NOT vendored.
- Bypass npm scripts (`npx playwright test`, IDE, `PW_E2E_USE_RUNNING=1`) → globalSetup fails fast before container boots; fix `npx playwright install chromium`.
- CDN timeout escape — `Download failure, code=1` / `TLSSocket … emitRequestTimeout`: `npm run test:e2e:chrome` (system Chrome) or `PLAYWRIGHT_DOWNLOAD_HOST=<mirror> npx playwright install chromium`.

## Run
- `npm run test:e2e` — boot container, run specs, tear down.
- `npm run test:e2e:ui` — same, Playwright UI mode.
- `npm run test:e2e:chrome` — same, system Google Chrome (= `PW_CHANNEL=chrome playwright test`).
- Lifecycle — globalSetup spawns `docker/test-up.sh` from throwaway workspace dir, polls `/api/health` → 200 (≤180s; first run builds image) → specs vs `:18000` → globalTeardown `docker/test-down.sh` (`compose down -v`); host `~/.pi` byte-identical.
- Crash-safe — marker `test-results/.e2e-managed` records setup booted container so teardown runs across crash/retry.

## Fast path — attach to running container
- `docker/test-up.sh` then `PW_E2E_USE_RUNNING=1 npm run test:e2e` — attach, health-only verify, NO teardown; you own container lifecycle.
- Scenario specs need seed — `PI_E2E_SEED=1 docker/test-up.sh` then `PW_E2E_USE_RUNNING=1 npm run test:e2e`.
- `PI_E2E_SEED=1` — test-entrypoint seeds fake anthropic credential (flips `providersReady`, unlocks LandingPage CTAs) + `trustedNetworks` (clears network guard). Spawned session registers over bridge before model call. Without flag → UI-only, scenario specs fail at pin step.
- `trustedNetworks` default `0.0.0.0/0`; narrow via `PI_E2E_TRUSTED_NETWORKS` (comma-separated CIDRs). VPN/secure-DNS (Cloudflare WARP) → peer appears PUBLIC → 403 "Network not allowed" — trust boundary is container: `compose.test.yml` publishes `127.0.0.1` only, state throwaway tmpfs.

## System browser (PW_CHANNEL)
- `PW_CHANNEL=<chrome|msedge|chromium|chrome-beta|...>` — drives system browser instead of bundled Chromium.
- Effect — config swaps project to `{ channel }`, renames spec label (`[chrome]`); `pretest:e2e` self-skips install; global-setup skips bundled preflight.
- Caveats — Chromium-family only (WebKit/Firefox need `playwright install`); same Blink engine. Combine: `PW_CHANNEL=chrome PW_E2E_USE_RUNNING=1 npm run test:e2e`.

## Layout
- `playwright.config.ts` (repo root) — `testDir: tests/e2e`, `baseURL :18000`, global setup/teardown.
- `tests/e2e/global-setup.ts` — boot container (or verify health fast path), poll `/api/health`.
- `tests/e2e/global-teardown.ts` — tear down when managed; no-op fast path.
- `tests/e2e/lifecycle.ts` — shared paths, health poll, marker, `PW_E2E_USE_RUNNING`.
- Specs — `smoke.spec.ts` (wiring proof: shell renders, no disconnect banner); `session-spawn.spec.ts` (5.1 pin→spawn→card, seed); `faux-text.spec.ts` / `faux-tool.spec.ts` / `faux-ask.spec.ts` (faux round-trips, seed); `tool-output-links.spec.ts` (diff-linkify + FilePreviewOverlay stale message); `tool-output-selection.spec.ts` (user-select, drag extends selection); `inline-screenshot.spec.ts` (`inlineToolResultImages` → `data:image/png` img); `editor-pane.spec.ts` (fixtures README.md/hello.txt/logo.png/doc.pdf from `docker/fixtures/sample-git/`); `optimistic-prompt.spec.ts` (`pending-prompt-card`, `queue-chip-followup`, `page.routeWebSocket`); `flow-roundtrip.spec.ts` (L3, seed + `PI_TEST_PEERS=both`); `anthropic-bridge-activation.spec.ts` (L3); `subagent-inspector.spec.ts` (L3); `real-flow-regression.spec.ts` (opt-in `PI_E2E_REAL_FLOW=<flow-name>`).
- `tests/e2e/helpers/` — `gotoDashboard`, `ensureGitSession`, `sendPrompt` + testid→locator map.

## Conventions
- Import `test` from `./fixtures.js`, NEVER `@playwright/test` — enforced, `npm run lint:e2e` names the file; raw import silently opts out of session reaping.
- Select existing `data-testid`s (693 shipped), never CSS classes/translated text/DOM; map in `helpers/index.ts`; do NOT add app testids for E2E.
- Fresh-container determinism — fixtures unpinned, ephemeral `~/.pi`; workspace specs start with pin-fixture arrange step.
- New browser scenarios → Playwright specs here, NOT `qa/tests/*.sh,*.ps1`.

## Session reaping (why `./fixtures.js`)
- Problem — one container, 4 GiB cap; spawned pi session = 150–280 MB. Issue #433: ~70 fake "failures" when harness died.
- Reap — `fixtures.ts` exports `test` wrapping every test: 1 snapshot live session ids → 2 run body → 3 settle list (poll stable 1s, cap 5s) → 4 shut down only delta.
- Consequences — don't rely on leftover session cards; harness-created sessions untouched (`PI_E2E_INDEPENDENT_SESSION` for faux-ask); `afterEach` sees live session, `afterAll` runs after reap; liveness = liveness fields, not list presence.
- Residual budget — live ≤ `RESIDUAL_SESSION_BUDGET` (8, in `reap-core.ts`); tripwire on leftovers; breach lists offending ids + cwds.
- Harness-down — liveness probe before each test; declared down only after 3 consecutive failures; then fail naming harness, skip rest.
- Known limitation — `PI_SPAWN_STRATEGY=tmux` (docker default): record released, process NOT terminated → memory climbs. Issue #452 / `fix-tmux-session-shutdown-leak`. Probe: `node scripts/probe-harness-memory.mjs`.

## Faux model round-trip (key-free)
- No LLM credential — real prompt→model→streamed events→rendered DOM. `PI_E2E_SEED=1` stages pi-ai faux provider as global auto-discovered extension, seeds `defaultModel: faux/faux-1`.
- Sentinel — `[[faux:<scenario-id>]]` prefix per prompt, e.g. `sendPrompt(page, "[[faux:tool-read]] go")`. Fixture `qa/fixtures/faux-provider.ext.ts` reads sentinel, replays from catalog `qa/fixtures/faux-scenarios.ts`; step = assistant-turn count since message. No sentinel → `FAUX_SCRIPT` env fallback. Assert on scripted reply, never echoed prompt.

## Flow-plugin L3 specs + PI_TEST_PEERS (needs seed)
- `both` — pi-flows in `packages[]` + scoped anthropic peer → `active`, `bridgeLoadedFrom: packages[]`. Managed default.
- `no-am` — pi-flows only, peer absent → `waiting_peers`.
- `legacy` — peer under `@pi/anthropic-messages` name only → `active` via legacy fallback.
- `bad-registration` — `PI_DASHBOARD_DISABLE_PLUGIN_BRIDGE_PACKAGES_WRITE=1` → not loaded from `packages[]` ("no sessions reporting").
- Opt-in variants — `PI_E2E_SEED=1 PI_TEST_PEERS=no-am docker/test-up.sh -d --build`; verify `curl -s http://localhost:<port>/api/flows-anthropic-bridge/status | jq`; or `PW_E2E_USE_RUNNING=1 PI_TEST_PEERS=no-am npm run test:e2e -- anthropic-bridge-activation`.
- Engine + peer BAKED into image — Dockerfile `npm install -g @blackbelt-technology/pi-flows @blackbelt-technology/pi-anthropic-messages`; `PI_TEST_PEERS` only selects wiring. Faux role-preset `qa/fixtures/faux-roles.json` seeded so `model: @role` → `faux/faux-1`.

## L1/L2 vs L3
- L1/L2 in `npm test` — `packages/flows-anthropic-bridge-plugin/src/__tests__/peer-probe.test.ts`, `packages/flows-plugin/src/__tests__/flow-reducer-*.test.ts`: plain vitest, NO Docker/browser/pi-flows (design D2). Only L3 needs harness.
- Not run by `npm test` — E2E opt-in; `tests/e2e/` outside every vitest project glob.
