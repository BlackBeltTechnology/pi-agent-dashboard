# Test Plan — update-pi-core-1-6-adopt-apis

Stage: design (plan-proposal; hard gate)   Generated: 2026-11-21

## Decisions

No spec gaps: every Triple fills from the deltas and design (floor `1.6.0`; fallback `5000` ms; `cacheWarming` default `"idle"`; pi's own reload/exec messages and codes). The server-side credential settle was split out in doubt review (design D4), so no scenario covers it.

Harness exemplar = the nearest existing test of the same category, verified on disk. `pi-1-5-floor-smoke.spec.ts` is the pre-rename name (task 2.5).

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable | harness exemplar |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|------------------|
| E1 | pi-core-version-check: floor and recommended move together | BVA | L1 | automated | `piCompatibility` from `packages/server/package.json`; running versions `1.5.9`, `1.6.0`, `1.6.1` | `computeCompatibility()` | `minimum === recommended === "1.6.0"`; `1.5.9` → `compatibility.error` naming `1.5.9` and `1.6.0`; `1.6.0` and `1.6.1` → no error | `packages/server/src/__tests__/pi-version-skew.test.ts` |
| E2 | pi-core-version-check: below-floor session flag | EP | L1 | automated | minimum `1.6.0`; sessions report `1.5.0`, `1.6.0`, `0.73.1` (`@mariozechner` fork), `0.87.1` with a hoisted `1.6.0` copy resolvable | server session update (X3) | `1.5.0`, `0.73.1`, `0.87.1` flagged naming the running version and `1.6.0`; `1.6.0` not flagged | `packages/server/src/__tests__/pi-version-update-handling.test.ts` |
| E3 | pi-core-version-check: Node floor row | EP | L1 | automated | `piCompatibility.minimum = "1.6.0"`; pi 1.6.0 engines `>=22.19.0` | `bundled-node-meets-pi-floor` lookup | row `"1.6.0": {major:22, minor:19}` found and satisfied by the bundled Node; removing the row fails the test | `packages/shared/src/__tests__/bundled-node-meets-pi-floor.test.ts` |
| E4 | pi-core-version-check: release-deps checker enforces coherence | decision-table | L1 | automated | coherent fixture at `1.6.0`; then one drift per fixture: a peer `>=1.5.0`, a devDep `^1.5.0`, Dockerfile `@1.5.0`, pi-tui override `1.5.0`, checker `minVersion` `1.5.0`; and `recommended 1.6.0` + `minimum 1.3.0` | `scripts/verify-release-deps.mjs` | coherent → pass; each drift → non-zero exit naming exactly the drifted location; the lagging-minimum fixture names `piCompatibility.minimum` | `scripts/__tests__/verify-release-deps-pi-coherence.test.mjs` |
| E5 | provider-auth-server: server pin is `^<minimum>` | EP | L1 | automated | real `packages/server/package.json` (`^1.6.0`, minimum `1.6.0`); fixture with `^1.5.0` and minimum `1.6.0` | coherence gate | real → pass; fixture → fail naming the server dependency | `scripts/__tests__/verify-release-deps-pi-coherence.test.mjs` |
| E6 | pi-core-version-check: CI e2e global pi equals the Dockerfile pin | EP | L1 | automated | `.github/workflows/ci-e2e-browser.yml` steps at `:504,:563` and `docker/Dockerfile:116` | E3 workflow contract | both steps install `@earendil-works/pi-coding-agent@1.6.0`, equal to the Dockerfile; a mismatched step fails | `packages/shared/src/__tests__/e2e-browser-workflow-contract.test.ts` |
| E7 | pi-api-feature-detection (adopted): `cacheWarming` default parity | EP | L1 | automated | installed pi 1.6.0 `docs/settings.md`; `pi-settings-schema.ts` | schema parity check | `cacheWarming` default `"idle"` in both; description matches pi's row; any other default drift still fails | `packages/server/src/__tests__/pi-settings-schema-parity.test.ts` |
| E8 | pi-api-feature-detection (adopted): stored `"streaming"` still accepted | EP | L1 | automated | typed PATCH bodies `{cacheWarming:"streaming"}`, `{cacheWarming:"idle"}`, `{cacheWarming:"off"}`, `{cacheWarming:"warm"}` | `PATCH` pi settings route | first three → 200 and written verbatim; `"warm"` → 400 naming `cacheWarming`; an unset key is not written by the form | `packages/server/src/routes/__tests__/pi-settings-routes.test.ts` |
| E9 | bridge-extension: fallback boundary | BVA | L1 | automated | `runBridgeShutdown` with a `ctx.shutdown` spy and injected fake `setTimer` / `exit` | advance fake time to 4999 ms, then 5000 ms | `ctx.shutdown` called exactly once at t=0; `exit` not called at 4999 ms; `exit(0)` called once at 5000 ms | `packages/extension/src/__tests__/bridge-shutdown-reset.test.ts` (new `bridge-shutdown.test.ts` beside it) |
| E10 | bridge-extension: fallback timer is unref'd | EP | L1 | automated | `runBridgeShutdown` with a `setTimer` returning a handle whose `unref` is a spy | call `runBridgeShutdown` | `unref` called exactly once on the fallback handle | `packages/extension/src/__tests__/bridge-shutdown-reset.test.ts` |
| E11 | bridge-extension: `/quit` and `/exit` take the same path | EP | L1 | automated | command handler with a `shutdown` option spy | `send_prompt` `/quit`, `/exit`, and a server `{type:"shutdown"}` message | the `shutdown` option is called once per input; `/quitx` and `/exit now` are not routed to shutdown | `packages/extension/src/__tests__/command-handler.test.ts` (`should route /quit to shutdown`, `:888`) |
| E12 | pi-api-feature-detection (no-op): pi-tui `readonly string[]` render | EP | L1 | automated | `packages/extension` sources against installed pi-tui 1.6.0 | `tsc --noEmit -p packages/extension` | exits 0; `MultiSelectList` still assignable to pi-tui `Component` | `packages/extension/tsconfig.json` (repo typecheck script) |

### Error-handling

| id | requirement | technique | level | disposition | input | trigger | expected observable | harness exemplar |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|------------------|
| X1 | bridge-extension: fallback with no `ctx.shutdown` | fault-injection (abort) | L1 | automated | `ctx` without `shutdown` (and `ctx` undefined) | `runBridgeShutdown`, advance 5000 ms | no throw; `exit(0)` called once at 5000 ms | `packages/extension/src/__tests__/bridge-shutdown-reset.test.ts` |
| X2 | bridge-extension: `ctx.shutdown` throws | fault-injection (abort) | L1 | automated | `ctx.shutdown` throws `Error("stale ctx")` | `runBridgeShutdown`, advance 5000 ms | the error does not escape; the fallback is still armed and `exit(0)` fires at 5000 ms | `packages/extension/src/__tests__/bridge-shutdown-reset.test.ts` |
| X3 | pi-api-feature-detection (no-op): reload refused while streaming | fault-injection | L1 | automated | `reload` option rejecting `Error("Wait for the current response to finish before reloading.")` | `send_prompt` `/reload` | one `command_feedback` event `{command:"/reload", status:"error"}` whose message contains `Wait for the current response to finish before reloading.`; no throw out of the handler | `packages/extension/src/__tests__/command-handler.test.ts` |
| X4 | pi-api-feature-detection (no-op): `!` timeout exit code (pi 1.6 shape) | fault-injection (delay) | L1 | automated | `pi.exec` mock resolving pi 1.6's documented timeout shape `{ code: 143, killed: true, truncated: false }` (`exec.d.ts`; pi's `execCommand` is not in its `exports` map) | `send_prompt` `!sleep 5` | one `bash_output` event with `exitCode: 143`; the client-facing status is a failure, not success | `packages/extension/src/__tests__/command-handler.test.ts` |
| X5 | pi-api-feature-detection (no-op): default prompt docs section unchanged | EP | L1 | automated | installed pi 1.6.0 default system prompt | claude-compat docs canary | the canary's pinned `<docs>` wording still matches; the claude-compat rewrite stays a no-op | `packages/extension/src/__tests__/claude-compat-pi-docs-canary.test.ts` |

### Process / runtime

| id | requirement | technique | level | disposition | input | trigger | expected observable | harness exemplar |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|------------------|
| P1 | pi-core-version-check: clean install resolves pi ≥ floor | EP | L2 | automated | clean VM, `npm install -g @blackbelt-technology/pi-dashboard` | `qa/tests/01-install.sh` | every resolved `pi-coding-agent` / `pi-ai` / `pi-tui` copy ≥ `1.6.0`; script prints the at-or-above line and exits 0 | `qa/tests/01-install.sh` |
| P2 | pi-core-version-check: floor smoke on the docker harness | state-transition | L3 | automated | docker harness built with the Dockerfile pin `1.6.0` | spawn a session from the UI | the session registers; `/api/health` reports running pi `1.6.0` with nothing flagged; the tool row shows a duration | `tests/e2e/pi-1-5-floor-smoke.spec.ts` (renamed `pi-1-6-floor-smoke.spec.ts`) |
| P3 | pi-core-version-check: lockfile pinned and reproducible | EP | ci | automated | `pnpm-lock.yaml` after task 2.4 | `pnpm install --frozen-lockfile` | exits 0; every importer resolves `@earendil-works/pi-coding-agent`, `pi-ai`, `pi-tui` to `1.6.0` | `.github/workflows/ci.yml` install step |

### Manual-only

| id | requirement | technique | level | disposition | input | trigger | expected observable | harness exemplar |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|------------------|
| M1 | bridge-extension: idle headless session exits through pi | state-transition | — | manual-only | an idle dashboard-spawned headless session on pi 1.6.0 | click Stop in the dashboard | the pi process is gone in well under 5 s and `server.log` shows the ladder found it already exiting/gone; no bridge fallback exit | — |
| M2 | pi-api-feature-detection (no-op): bulk reload with a busy session | state-transition | — | manual-only | one session streaming a long reply, one idle | `npm run reload` | the idle session reloads; the busy one shows the `/reload` error in its chat and keeps streaming | — |
