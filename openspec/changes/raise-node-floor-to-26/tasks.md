## 0. Gate (draft → ready)

- [x] 0.1 `strip-only-native-ts-loader` is shipped (archived 2026-10-12)
- [ ] 0.2 Node 26 is Active LTS (on or after 2026-10-28)
- [x] 0.3 Resolve design Open Questions 1–6 and record the decisions in `design.md`
- [x] 0.4 Write the spec deltas listed in `proposal.md` and pass `openspec validate raise-node-floor-to-26 --strict`
- [x] 0.5 Run `plan-proposal` (doubt-review, scenario-design, test fold)

## 1. Floors and guard

- [ ] 1.0 Update every test that pins the old range or matrix: `node-version.test.ts`, `node-cap-single-source.test.ts`, `smoke-node-matrix.test.ts`, `bundled-node-meets-pi-floor.test.ts`, `native-ts-loader.test.ts`, `spawn-runtime.test.ts` (floor fixtures), `node-guard.test.ts`, `scripts/__tests__/claude-plugin-ensure-dashboard.test.mjs`
- [ ] 1.1 Split `MIN_SUPPORTED_NODE` in `packages/shared/src/node-version.ts` into a dashboard server floor `26.0.0` and a pi spawn floor `22.19.0`; `isOutOfEnginesRange` uses the server floor, `isUsableNodeVersion` = engines range only, `isAffectedNode` stays exported; update the module doc comment and the single-defining-occurrence lint
- [ ] 1.2 `packages/shared/src/platform/spawn-runtime.ts` pi-session ladder: fallback floor = pi spawn floor (no behaviour change)
- [ ] 1.3 `packages/server/src/auth/node-guard.ts`: remove the `isAffectedNode` startup check and `buildNodeUpgradeMessage`; `buildEnginesRangeMessage` names `>=26.0.0 <27`, `nvm install 26`, `brew install node`; managed hint only when `<managedDir>/node/.version` meets the floor (marker read, no spawn); keep `node-cap-message-matches-engines` green
- [ ] 1.4 Root `engines.node` → `>=26.0.0 <27`; `packages/server/package.json` → `>=26.0.0`
- [ ] 1.5 Repo-lints: dashboard floor ≥ pi's `engines.node` lower bound; `BUNDLED_NODE_VERSION` ≥ both floors

## 2. Server-spawn runtime resolution

- [ ] 2.1 `spawn-runtime.ts`: add the server-gated, non-total mode (override → `PATH` → version-manager FS probe → managed → own runtime, all gated; own-runtime version from the running process; no shell; unresolved result lists skipped candidates)
- [ ] 2.2 `packages/extension/src/server-auto-start.ts`: inside the single-flight lock (`autostart-lock.ts`), resolve and pass `nodeBin` through `launchServer` (`server-launcher.ts`); success → `appendAutoStartLog` selection line; unresolved → no spawn, `appendAutoStartLog` refusal line, one `ui.notify` per session with range, pi version, remediation and `server.log` path
- [ ] 2.3 `packages/electron/src/lib/pick-node.ts` stays pure: add inputs for a pre-resolved system candidate and the embedded Node version; order bundled → system → Electron executable only if embedded Node qualifies → unavailable. `launch-source.ts` runs the async server-mode resolver only when the bundled binary is missing and surfaces the unavailable reason as a user-facing error
- [ ] 2.4 `packages/electron/src/lib/dependency-detector.ts` `detectSystemNode` / on-disk scan follow the narrowed `isUsableNodeVersion`

## 3. Build, CI, Docker, plugin

- [ ] 3.1 `_node-version.sh` `BUNDLED_NODE_VERSION` → latest v26.x LTS; sync `packages/electron/scripts/Dockerfile.build`, `test-server-launch.sh`, `test-electron-install.sh`; fix stale `v22.18.0` comments in `_electron-build.yml`
- [ ] 3.2 Verify `node-pty` prebuilds load on `node:26-bookworm-slim`; then switch `docker/Dockerfile` and `scripts/test-standalone-npm-install-docker.sh`
- [ ] 3.3 Workflow `node-version` → 26 in `ci.yml`, `publish.yml` (including the bundled-Node-major legs, in lockstep with `BUNDLED_NODE_VERSION`), `_electron-build.yml`, `ci-e2e-browser.yml`, `ci-e2e-electron.yml`, `ci-gateway-platform.yml`, `nightly.yml`, `nightly-tests.yml`; leave `deploy-site.yml` / `sync-release-version.yml`; fix the `publish` job's skipped-`tag-and-push` wording only if the YAML disagrees with the spec
- [ ] 3.4 `_smoke.yml`: Linux matrix Node 26 × bookworm-slim/alpine plus a Node `26.0.0` floor leg, Windows leg Node 26; remove `standalone-install-smoke-eol-node23`
- [ ] 3.5 `ensure-dashboard.sh`: range constants → 26.0.0 / cap 27, drop the 24.x affected bounds and the "Install Node.js >= 22.19" text

## 4. Tests (folded from test-plan.md)

- [ ] 4.1 L1 test (see packages/shared/src/__tests__/node-version.test.ts): versions 22.19.0/24.15.0/25.9.0/26.0.0/26.11.1/27.0.0 · isOutOfEnginesRange / isUsableNodeVersion · out-of-range true except 26.x; isUsableNodeVersion("garbage") false (test-plan #E1)
- [ ] 4.2 L1 test (see packages/shared/src/__tests__/node-version.test.ts): the two floor constants · read from node-version.ts · server floor 26.0.0, pi spawn floor 22.19.0, node-guard re-exports the same isOutOfEnginesRange reference (test-plan #E2)
- [ ] 4.3 L1 test (see packages/server/src/__tests__/node-guard.test.ts): process.version v24.15.0 then v26.0.0 · assertNodeVersionSupported() · 24.15.0 exits 1 with `Required: >=26.0.0 <27` and no 58515 text; 26.0.0 returns (test-plan #E3)
- [ ] 4.4 L1 test (see packages/server/src/__tests__/node-guard.test.ts): managed .version marker absent / v24.15.0 / unreadable / v26.1.0 · buildEnginesRangeMessage · managed hint only for v26.1.0; always `nvm install 26` + `brew install node`, never `node@24`; no Node spawned (test-plan #E4)
- [ ] 4.5 L1 test (see packages/shared/src/__tests__/spawn-runtime.test.ts): pi engines.node unreadable, only user Node v24.15.0 · pi-session ladder · selects v24.15.0 (pi floor 22.19.0) (test-plan #E5)
- [ ] 4.6 L1 test (see packages/shared/src/__tests__/spawn-runtime.test.ts): PATH Node v26.1.0, own runtime v24.15.0 · server-mode resolve · PATH Node selected, step path (test-plan #E6)
- [ ] 4.7 L1 test (see packages/shared/src/__tests__/spawn-runtime.test.ts): nvm default v24.15.0, volta shim v26.0.0 · server-mode resolve · volta selected, nvm skipped with reason (test-plan #E7)
- [ ] 4.8 L1 test (see packages/shared/src/__tests__/spawn-runtime.test.ts): earlier candidates fail, own runtime v26.2.0 then v24.18.1 · server-mode resolve · own runtime selected / unresolved with own runtime skipped (test-plan #E8)
- [ ] 4.9 L1 test (see packages/shared/src/__tests__/spawn-runtime.test.ts): pi v22.19.0, PATH v24.15.0, no managed, no VM 26 · server-mode resolve · unresolved listing every candidate with version + reason (test-plan #E9)
- [ ] 4.10 L1 test (see packages/shared/src/__tests__/spawn-runtime.test.ts): PATH candidate prints `node-nightly-xyz` · server-mode resolve · candidate skipped with reason, resolution continues (test-plan #E10)
- [ ] 4.11 L1 test (see packages/shared/src/__tests__/spawn-runtime.test.ts): all candidates present and failing · server-mode resolve with spawn spy · no shell spawned; node --version spawns ≤ 5 distinct paths, 0 for own runtime (test-plan #E11)
- [ ] 4.12 L1 test (see packages/electron/src/lib/__tests__/pick-node.test.ts): bundled present / missing+system v26.1.0 / missing+embedded 26.0.0 / missing+embedded 24.18.1 · pickNodeForServer · bundled / system without ELECTRON_RUN_AS_NODE / execpath-fallback with flag / unavailable naming 24.18.1 and >=26.0.0 <27 (test-plan #E12)
- [ ] 4.13 L1 test (see packages/electron/src/__tests__/dependency-detector.test.ts): system Node v24.15.0/v25.9.0/v26.0.0/v27.0.0 and nvm dir with v24.15.0+v26.0.0 · detectSystemNode · found only for v26.0.0; on-disk scan returns v26.0.0 (test-plan #E13)
- [ ] 4.14 L1 test (see packages/shared/src/__tests__/bundled-node-meets-pi-floor.test.ts): root/server package.json + installed pi engines.node · repo-lint · root `>=26.0.0 <27`, server `>=26.0.0`; fails when a fixture floor is below pi 22.19.0 (test-plan #E14)
- [ ] 4.15 L1 test (see packages/shared/src/__tests__/bundled-node-meets-pi-floor.test.ts): BUNDLED_NODE_VERSION v26.x vs fixture v24.15.0 · repo-lint · passes for v26.x, fails for v24.15.0 naming both versions and _node-version.sh (test-plan #E15)
- [ ] 4.16 L1 test (see packages/shared/src/__tests__/node-cap-single-source.test.ts): packages/*/src TS + non-TS mirrors · single-source scan · only node-version.ts defines the range; each mirror (engines, ensure-dashboard.sh, BUNDLED_NODE_VERSION, workflows, Docker base) lint-pinned (test-plan #E16)
- [ ] 4.17 L1 test (see packages/shared/src/__tests__/workflow-token-cache-contract.test.ts): .github/workflows/*.yml except deploy-site.yml + sync-release-version.yml · node-version repo-lint · every value 26 or 26.x (test-plan #E17)
- [ ] 4.18 L1 test (see packages/shared/src/__tests__/smoke-node-matrix.test.ts): _smoke.yml · smoke-node-matrix lint · Linux majors [26], Windows leg 26, no standalone-install-smoke-eol-node23 job (test-plan #E18)
- [ ] 4.19 L1 test (see scripts/__tests__/claude-plugin-ensure-dashboard.test.mjs): resolved Node v24.15.0/v25.9.0/v26.0.0/v27.0.0 · ensure-dashboard.sh --install (PIDB_TEST=1) · STATUS=failed exit 1 with no npm/npx except 26.0.0; constants pinned to engines.node (test-plan #E19)
- [ ] 4.20 L1 test (see packages/shared/src/__tests__/native-ts-loader.test.ts): stubbed node:module API without registerHooks (with/without stripTypeScriptTypes) · import register module · tier 3 module.register + amaro; tier 2 module.register + native strip; no PI_DASHBOARD_TS_LOADER/jiti in errors (test-plan #E20)
- [ ] 4.21 L1 test (see packages/electron/src/lib/__tests__/launch-source-shared-primitive.test.ts): unavailable pick + no-electron-execpath-spawn lint · spawnFromSource / requestServerLaunch · lint green (allowlist pick-node.ts); launchDashboardServer not called; `{ kind: "failed" }` reason names >=26.0.0 <27 (test-plan #E21)
- [ ] 4.22 electron test (see .github/workflows/_electron-build.yml (existing packaged-app smoke step)): packaged app · run resources/node/bin/node --version and start server · version in >=26.0.0 <27; server reaches serving state (test-plan #E22)
- [ ] 4.23 ci test (see .github/workflows/ci.yml (existing Docker plugin-load job)): docker compose build · node --version + node-pty PTY spawn in image · reports v26.x; PTY echoes shell I/O (test-plan #E23)
- [ ] 4.24 L1 test (see packages/extension/src/__tests__/server-auto-start.test.ts): dashboard answering on resolved port · autoStartServer · resolver spy called 0 times; bridge connects (test-plan #F1)
- [ ] 4.25 L1 test (see packages/extension/src/__tests__/server-auto-start.test.ts): no server; resolver returns nvm v26.0.0 · autoStartServer · one appendAutoStartLog line with path, v26.0.0, version-manager step; launch gets that nodeBin (test-plan #F2)
- [ ] 4.26 L1 test (see packages/extension/src/__tests__/server-auto-start.test.ts): auto-start refused · server later reachable via discovery · session usable; bridge connects (test-plan #F3)
- [ ] 4.27 L1 test (see packages/extension/src/__tests__/server-auto-start.test.ts): resolver unresolved, pi v22.19.0 · autoStartServer with no server · no spawn; one auto-start log line (port, range, candidates); ui.notify contains `Node >=26.0.0 <27`, v22.19.0, Node 26/desktop-app hint, absolute server.log path (test-plan #X1)
- [ ] 4.28 L1 test (see packages/extension/src/__tests__/server-auto-start.test.ts): resolver stays unresolved · auto-start path invoked 3× in one session · ui.notify called once (test-plan #X2)
- [ ] 4.29 L1 test (see packages/extension/src/__tests__/server-auto-start.test.ts): resolver delayed, port starts answering mid-resolution · autoStartServer · connects, no refusal notify (test-plan #X3)
- [ ] 4.30 L1 test (see packages/extension/src/__tests__/autostart-lock.test.ts): two sessions, no server, shared lock dir · concurrent autoStartServer · resolver runs once; one log line (test-plan #X4)
- [ ] 4.31 ci test (see .github/workflows/_smoke.yml (standalone-install-smoke-linux)): packed tarballs on node:26-bookworm-slim, node:26-alpine, Windows Node 26, and Node 26.0.0 exactly · _smoke.yml boot · /api/health 200 on every leg, no EBADENGINE (test-plan #X5)
- [ ] 4.32 electron test (see .github/workflows/_electron-build.yml (existing packaged-app smoke step)): packaged app with bundled Node 26 · start server + run doctor · node-pty loads; doctor native-ABI check reports no mismatch (test-plan #X6)
- [ ] 4.33 Measure worst-case server-mode resolution wall time (5 failing candidates, 20 runs) on macOS and Linux; record p95 in design.md (test-plan: manual-only, #P1)

## 5. Docs and release

- [ ] 5.1 At archive: update the `server-startup-node-version-guard` main-spec Purpose (drop the dual-predicate wording)
- [ ] 5.2 Via DocScribe: remove stale `preload-fastify.cjs` mentions in `docs/architecture.md`, `docs/architecture.agent.md`, `docs/faq.md`, `.github/workflows/AGENTS.md` (and the comment in `packages/server/src/rpc-keeper/keeper.cjs`); README / `docs/faq.md` Node 26 requirement, auto-start notice, desktop-app alternative, Electron dev prerequisite
- [ ] 5.3 CHANGELOG `## [Unreleased]`: **BREAKING** — Node ≥26 required for npm installs; major version bump
- [ ] 5.4 Update `AGENTS.md` rows for touched files
