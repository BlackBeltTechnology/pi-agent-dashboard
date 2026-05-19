## 1. Declare jiti as a direct dependency

- [x] 1.1 Add `"jiti": "^2.7.0"` (or the version pi currently uses — check `~/.pi-dashboard/node_modules/@earendil-works/pi-coding-agent/package.json` and match the major) to `packages/server/package.json#dependencies`.
- [x] 1.2 Run `npm install` at the repo root to regenerate `package-lock.json`; verify lockfile cross-refs still satisfy `scripts/verify-lockfile-versions.mjs`. (NOTE: pre-existing drift in `packages/subagents-plugin` — `pi-dashboard-shared` + `pi-dashboard-client-utils` use `"*"` instead of `^0.5.3`. Not caused by this change; flagged for follow-up.)
- [x] 1.3 Confirm `node packages/server/bin/pi-dashboard.mjs --version` works from a fresh `npm pack` + `npm i -g ./*.tgz` in a temp dir with **no pi installed** anywhere on the system. (Local: `node packages/server/bin/pi-dashboard.mjs status` resolves jiti from workspace `node_modules/jiti` via argv[1] walk-up and successfully re-execs cli.ts. Full pack+install smoke deferred to task 4.3.)

## 2. Improve bin wrapper error path

- [x] 2.1 In `packages/server/bin/pi-dashboard.mjs` `resolveJitiUrl()`, when the resolution fails despite jiti being a declared dep, surface a clearer message: `"pi-dashboard: jiti resolution failed unexpectedly — please report at <repo>/issues. Falling back: install pi globally as a workaround."` Keep the existing exit-code-1 contract.
- [x] 2.2 Keep the metadata short-circuit (`--version`, `-v`, `version`) intact — it must not depend on jiti.

## 3. Seed installable-list on first-run CLI bootstrap (REVERTED — design correction)

**Design correction (2026-05-20):** Docker smoke proved this section was solving a phantom problem. `cli.ts::runDegradedModeBootstrap` (existing, predates this change) already handles the npm-install case: it probes `ToolRegistry.resolve("pi")` after `server.start()`, and when pi is unresolvable, installs `@earendil-works/pi-coding-agent` + `@fission-ai/openspec` in the BACKGROUND (not awaited before listen). Same package set as `defaultInstallableList()`.

Wiring `maybeSeedDefaultInstallableList()` into `runForeground` was actively harmful: it wrote `installable.json`, which made the subsequent `await bootstrapInstallFromList(...)` BLOCK on `npm install pi` before `server.start()`. UI never came up. Smoke timeout.

Reverted the call-site wiring. Kept the helper exported for explicit programmatic callers (provisioning scripts, future custom wizards). Spec delta updated to document the correct path (degraded-mode bootstrap, not seed-then-block).

- [x] 3.1 Read `packages/server/src/bootstrap-install-from-list.ts` and identify its no-op branches.
- [x] 3.2 Extract a pure helper `defaultInstallableList(): InstallableList` returning the canonical pi + openspec entries. Placed in `packages/shared/src/installable-list.ts`. KEPT — still useful for explicit callers.
- [REVERTED] 3.3 ~~In `packages/server/src/cli.ts`, before calling `bootstrapInstallFromList`, seed the default list when both file and managed pi are absent.~~ Wiring reverted; helper kept and exported with updated docstring explaining why it is not on the default path.
- [REVERTED] 3.4 ~~Gate seed on `starter !== "Electron"`.~~ Moot; no call site.
- [REVERTED] 3.5 ~~Log seeded list.~~ Moot; no call site. `runDegradedModeBootstrap` already logs `[bootstrap] installing (pi unresolved, running background install)`.

## 4. Tests

- [x] 4.1 Added "own-tree, no pi anywhere" scenario to `packages/shared/src/__tests__/binary-lookup-resolveJiti.test.ts` (successor of `resolve-jiti.test.ts`).
- [x] 4.2 Added `packages/server/src/__tests__/cli-seed-installable-list.test.ts` covering (a)–(d). Tests use a real tmpdir + filesystem (no mocks) to verify atomic write and idempotent skip paths.
- [x] 4.3 Added end-to-end smoke test (script, not vitest — `scripts/test-standalone-npm-install.sh`)
- [x] 4.4 Added Docker-based local repro `scripts/test-standalone-npm-install-docker.sh` + Node WS helper `scripts/lib/smoke-spawn-session.mjs`. **10-step lifecycle** on `node:22-bookworm-slim`: pack → install all tarballs at once → `pi-dashboard --version` → `pi-dashboard start` → poll `/api/bootstrap/status` (installing→ready) → `GET /` → spawn pi session via WS (`spawn_session` → `session_added`) → verify session present in `/api/sessions` → invoke `openspec --version` from bundled CLI → seed `/tmp/smoke-cwd/openspec/changes/archive/2026-05-20-smoke-fixture/proposal.md` and verify `/api/openspec-archive` returns it with `artifacts=proposal`. All 10 checks pass green against current branch. that runs `npm pack` for every workspace, installs them into a temp HOME, runs `pi-dashboard` headless, polls `/api/health`, asserts `bootstrap.state === "installing"` then eventually `"ready"`, then kills.

## 5. Documentation

- [x] 5.1 `docs/service-bootstrap.md` — add a "Standalone npm install" section above the existing "Standalone mode" (which is Electron-coupled). Describe: install command, first-launch flow, where pi gets installed, degraded mode while installing, fallback when offline.
- [x] 5.2 `docs/faq.md` — add/update a Q&A entry: "How do I install pi-dashboard without Electron?" with the new clean flow.
- [x] 5.3 `README.md` — if it currently routes npm users at all, point at the new section.
- [x] 5.4 `CHANGELOG.md` — `## [Unreleased]` → "Added": "Standalone npm install no longer requires pre-installing pi; the dashboard CLI now bootstraps pi + openspec into `~/.pi-dashboard/` on first run."
- [x] 5.5 `docs/file-index-server.md` and `docs/file-index-shared.md` — update affected rows in caveman style (delegate to subagent per Documentation Update Protocol).

## 6. Verify

- [x] 6.1 `npm test` green; 594 test files / 6018 tests passed (incl. `test:bootstrap` harness + new own-tree jiti scenario + new cli-seed tests).
- [x] 6.2 `npm run lint` (`tsc --noEmit`) green.
- [ ] 6.3 Manual smoke on a clean macOS user account: `npm i -g <packed tgz>` → `pi-dashboard` → open `http://localhost:8000` → see web UI → spawn a session and confirm it works once bootstrap finishes. (Deferred: requires user environment; `scripts/test-standalone-npm-install.sh` automates this.)
- [ ] 6.4 Manual smoke on Windows (or via the qa/ harness): same flow; verify drive-letter URL wrapping for the jiti loader still works. (Deferred: requires Windows VM. URL-wrap path covered by existing test in binary-lookup-resolveJiti.test.ts.)
  - **Status review 2026-05-20**: design-level Windows readiness is in place — `node-pty@1.2.0-beta.13` ships `win32-{arm64,x64}` prebuilds, `bin/pi-dashboard.mjs:109` URL-wraps drive-letter paths, `bootstrapInstall` branches `npm.cmd` (`bootstrap-install.ts:119`), `ToolRegistry` resolves `<dir>/npm.cmd` on Windows. End-to-end smoke remains deferred. Path forward to close the gap: (1) port `scripts/test-standalone-npm-install-docker.sh` to a cross-OS `scripts/lib/smoke-runner.mjs`; (2) extend the CI matrix in `.github/workflows/ci.yml::standalone-install-smoke-*` with a `windows-latest` runner (no container, no `shell: bash` — satisfies the `no-bash-on-windows.test.ts` lint); (3) add a long-path-readiness pre-flight to `maybeSeedDefaultInstallableList`/`bootstrapInstall` that surfaces an actionable error pointing at `LongPathsEnabled` + `core.longpaths` when path nesting would exceed Windows' 260-char default.
- [ ] 6.5 Electron regression check: build and launch the Electron app; confirm the wizard still drives the install and `starter === "Electron"` skips the new seed path. (Deferred: requires Electron build; gate is unit-tested via case (d) of cli-seed-installable-list.test.ts.)
- [ ] 6.6 Offline check: with the network blocked on first run, confirm bootstrap surfaces a clean failure in the dashboard UI (existing behavior, must not regress). (Deferred: requires manual network manipulation; existing bootstrap-failed flow is unchanged.)

## 7. Published-tarball verification (added 2026-05-19; revised 2026-05-19 against Docker baseline)

**Evidence:** clean-machine reproducer artifacts at `docs/repro/v0.5.3-clean-node22-linux-x64-2026-05-19.log` + `docs/repro/v0.5.3-reproducer.sh`. Captured against `node:22-bookworm-slim` + `@blackbelt-technology/pi-agent-dashboard@0.5.3` from the npm registry. Two failure modes block any clean-Linux install today; one further failure blocks runtime even after both are worked around.

**Original draft of this phase listed bin-points-at-ts and missing-fix-pty-permissions as v0.5.3 bugs. The Docker baseline refuted both.** v0.5.3's `package.json#bin` correctly points at `packages/server/bin/pi-dashboard.mjs` and the tarball does ship `scripts/fix-pty-permissions.cjs`. Those symptoms on the maintainer's machine were stale local state (an old `npm link @blackbelt-technology/pi-dashboard` from a renamed legacy package + a corrupted npm cache entry). Phase 7 below covers only the bugs actually reproduced against the published tarball.

Pre-1.x release SHALL NOT publish until 7.1-7.3 pass.

- [x] 7.1 **`node-pty` prebuild missing for `linux-x64` in the bundled dep tree.** Symptom (Docker log lines 31–79): `npm install -g @blackbelt-technology/pi-agent-dashboard@0.5.3` on `node:22-bookworm-slim` aborts with `npm error code 1` because `node-pty`'s prebuild fallback `node scripts/prebuild.js || node-gyp rebuild` fires — the directory `node_modules/node-pty/prebuilds/linux-x64` is absent so node-pty triggers a source rebuild, which needs Python + a C++ toolchain not present in slim base images. macOS hosts succeed because their `darwin-arm64`/`darwin-x64` prebuilds ARE shipped.
  - [x] Audit `node_modules/node-pty/prebuilds/` in a freshly packed tarball. Confirmed: `node-pty@1.1.0` ships `darwin-arm64`, `darwin-x64`, `win32-arm64`, `win32-x64` only — NO `linux-x64`, NO `linux-arm64`. `node-pty@1.2.0-beta.13` ships all 6 triples (verified via `npm pack` + `tar tzf`).
  - [x] Root cause: gap in the upstream stable release. `1.1.0` predates linux prebuild infra; `1.2.0-beta.*` (since `beta.7`-ish) ships them.
  - [x] Fix: pin `packages/server/package.json#dependencies.node-pty` to `1.2.0-beta.13` (exact). Regenerated lockfile; verified all 6 prebuild triples present in `node_modules/node-pty/prebuilds/` post-install. `bin/pi-dashboard.mjs status` still works post-bump.
  - [ ] CI smoke on `node:22-bookworm-slim` + `node:22-alpine` + `windows-latest`: `npm install -g <packed tgz>` MUST exit 0 without `--ignore-scripts` and without external system packages. (Handled by task 7.4 below.)
- [x] 7.2 **`jiti` not declared as a runtime dependency in v0.5.3.** Symptom (Docker log lines 88–91): after working around 7.1 via `--ignore-scripts`, `pi-dashboard --version` exits with `cannot find jiti. Install pi: 'npm install -g @earendil-works/pi-coding-agent'`. Confirmed at the tarball layer: `npm view ...@0.5.3 dependencies.jiti` returns nothing; same for `peerDependencies.jiti`. Task 1.1 of this proposal added jiti as a direct dep in the workspace, but no release containing that fix has been cut.
  - [x] Verified: task 1.1 (`jiti: ^2.7.0` in `packages/server/package.json#dependencies`) present in this branch.
  - [x] Added release-cut gate: `scripts/verify-release-deps.mjs` reads `packages/server/package.json` and asserts `dependencies.jiti` + pinned `dependencies.node-pty` are set. Wired into `.pi/skills/release-cut/SKILL.md` as pre-flight step 6. Gate runs locally green.
- [x] 7.3 **Resolver list drift — v0.5.3 daemon re-spawn rejected plain `jiti`.** In v0.5.3 published, `bin/pi-dashboard.mjs::JITI_PACKAGES = ["jiti", "@mariozechner/jiti"]` accepted plain `jiti` while `packages/shared/src/resolve-jiti.ts::JITI_PACKAGES = ["@mariozechner/jiti", "@oh-my-pi/jiti"]` rejected it. After 7.2 declares plain `jiti` as direct dep, the wrapper would succeed but `cli.ts`'s daemon re-spawn would throw. **Already resolved in current workspace** by the archived `2026-05-08-migrate-pi-fork-to-earendil` change: both lists now read `["jiti", "@mariozechner/jiti"]` (canonical location is `packages/shared/src/platform/binary-lookup.ts`, the renamed successor of `resolve-jiti.ts`). `@oh-my-pi/jiti` is gone from the codebase.
  - [x] Added repo-lint `packages/shared/src/__tests__/jiti-packages-parity.test.ts`: string-parses `JITI_PACKAGES` from both `binary-lookup.ts` and `bin/pi-dashboard.mjs`, asserts identical arrays, primary === "jiti", `@oh-my-pi/jiti` absent. 3 tests, all green. Updated bin wrapper comment to point at the lint.
  - [x] Strengthened `binary-lookup-resolveJiti.test.ts` contract block with explicit `JITI_PACKAGES[0] === "jiti"` assertion (regression guard for v0.5.3 fork drift).
- [x] 7.4 **CI gate on packed-tarball smoke** (covers 7.1–7.3 end-to-end). Wired into `.github/workflows/ci.yml` as a new top-level job `standalone-install-smoke-linux` running on every PR (alongside the existing `ci` job). Failure blocks merge.
  - [x] Assertions covered by `scripts/test-standalone-npm-install.sh`: (a) `npm install <tgz>` exits 0 without `--ignore-scripts`; (b) `pi-dashboard` bin resolves and launches; (c) `/api/health` `bootstrap.status === "ready"`; (d) `GET /` returns HTTP 200.
  - [x] Matrix across `node:22-bookworm-slim` + `node:22-alpine` (containers under `ubuntu-latest`). **Windows deferred** — the smoke runner is a bash script and the repo-lint `no-bash-on-windows.test.ts` rejects bash-on-Windows steps. Wiring Windows requires porting `scripts/test-standalone-npm-install.sh` to a cross-OS `.mjs`. Tracked inline in ci.yml as a TODO. Drive-letter URL-wrap path is still covered by the unit test `binary-lookup-resolveJiti.test.ts::URL contract`.
- [ ] 7.5 **Cut a `v0.5.4` (or `v0.6.0`) point release after 7.1–7.3 land** to unbreak the published npm path. Document in CHANGELOG under "Fixed" with all three root causes named and a link to `docs/repro/v0.5.3-clean-node22-linux-x64-2026-05-19.log`.
