# Tasks — upgrade the Electron runtime to 43.4.1

Test tasks below are folded from `test-plan.md` (20 automated rows, 2 manual-only). The
manifest is the source of truth for automated-vs-manual; each folded task names its
harness exemplar and carries the scenario Triple.

Ordering note: this change is deliberately sequenced **before**
`electron-platform-extraction` and `harden-electron-renderer-boundary` (both touch
`packages/electron` and collide in `package.json` / build config). Do not start those
while this is in flight.

## 1. Setup and baseline

- [ ] 1.1 Create a worktree + branch. Do NOT work in the main checkout.
- [ ] 1.2 Record the green baseline BEFORE any edit: `npm test`, plus
      `npm run -w packages/electron package` and the Electron-E2E suite run **locally**
      (`npm run test:e2e:electron`). Do not plan on dispatching the CI workflow for this —
      `ci-e2e-electron.yml` is `workflow_dispatch` and dispatch requires the default
      branch, which a worktree branch is not. A pre-existing red here is not this change's
      regression — establish that now, not after the bump.
- [ ] 1.3 Re-derive the Electron API surface from the **import sites**
      (`grep -rn 'from "electron"' packages/electron/src`), NOT from a `Symbol.method`
      grep — a method-shaped regex misses constructor uses like `new Tray(...)` and
      silently under-reports the surface. Check the result against Electron's
      `breaking-changes.md` for majors 33–43. Expected: zero hits. A hit re-scopes the
      change — stop and update `proposal.md` before continuing.

## 2. Doubt-driven review of the irreversible decision (gate)

Invoke `doubt-driven-review` before any code lands. This is the checkpoint the proposal
names, and it runs while course-correction is still cheap.

- [ ] 2.1 Stress-test the floor decision: is there ANY evidence of installed users on
      macOS 10.15 / 11? Record the answer (including "no telemetry exists") in
      `design.md`'s open question.
- [ ] 2.2 Confirm the update-stream gate (group 6) is treated as a **blocking** requirement,
      not a nice-to-have. Without it the release-notes promise is false and dropped users
      get a repeating failed-install loop (`design.md` Decision 5).
- [ ] 2.3 Confirm nothing in the target release relaxes a security default we rely on
      (`contextIsolation: true`, `nodeIntegration: false`, `sandbox`). Invoke
      `security-hardening` for this item — the change's justification is a security claim,
      so a security regression inside it would be self-defeating.

## 3. Shared infrastructure the scenarios need

`test-plan.md` → New infra needed. These come first because the folded tests depend on them.

- [ ] 3.1 Introduce a **single-source-of-truth constant** for the update-gate value
      (`21.0.0`), read by BOTH the CI injection step and the L1 tests. Resolves
      clarification G1: without it, tests U2–U4 assert a duplicated literal and stay green
      while CI injects something else.
- [ ] 3.2 Make the macOS floor check **unit-testable**. The `minos` comparison and
      extractor currently exist only as inline shell in `_electron-build.yml`. Extract the
      predicate into a script (or capture `otool` fixtures) so scenarios E4/E5/X3 can drive
      it directly. Do not restructure the workflow beyond what this needs.

## 4. The pin

- [ ] 4.1 Set `packages/electron/package.json > devDependencies.electron` (line 32) to the
      literal `"43.4.1"` (no `^`, no `~` — `app-builder-lib` regex constraint).
- [ ] 4.2 `pnpm install` (pnpm ONLY — `npm install` drifts the hoisted tree).
- [ ] 4.3 Verify the toolchain resolved to Electron-43-capable versions:
      `@electron-forge/*` ≥ 7.11.x and `electron-builder` ≥ 26.15.x from the existing
      ranges. If either resolves lower and the build fails, raise ONLY the affected range
      floor and record the failing version in `design.md` (Decision 4).
- [ ] 4.4 Assert the diff so far touches **only** `package.json` + the lockfile. Any change
      under `packages/electron/src/` at this point contradicts task 1.3.
- [ ] 4.5 Observe the **Electron 43.4.1 prebuilt's own** declared macOS floor, now that it
      is installed:
      `otool -l node_modules/electron/dist/Electron.app/Contents/MacOS/Electron | grep -A3 LC_BUILD_VERSION`.
      This value — not our build flags — is what the CI otool check actually measures
      (`design.md` Decision 2), so it is the input to task 5.4's expected constant. Expected
      `12.x`; anything else re-scopes the floor decision. Record the observed value here.

## 5. Author the floor scenarios (red first), then move the floor

Exemplar for the L1 tasks in this section:
`packages/electron/src/__tests__/forge-config-windows-version.test.ts` (textual assertion
against a build config) and `packages/electron/src/__tests__/build-config-parity.test.ts`.

- [ ] 5.1 Pin the literal-version guard (test-plan #E1). Input: `package.json` with
      `devDependencies.electron = "43.4.1"` · Trigger: apply regex
      `^\d+\.\d+\.\d+(-[A-Za-z0-9.-]+)?$` · Observable: matches, **and** the same assertion
      fails for fixture values `"^43.0.0"` / `"~43.0.0"` so the guard is not vacuous.
      See `forge-config-windows-version.test.ts`.
- [ ] 5.2 Pin the supported-line floor (test-plan #E2). Input: the pinned version string ·
      Trigger: assert major `>= 43` · Observable: `43.4.1` and `44.0.0` pass; fixtures
      `32.3.3` and `42.9.3` fail. See `forge-config-windows-version.test.ts`.
- [ ] 5.3 Pin the declared floor (test-plan #E3). Input: `forge.config.ts`
      `packagerConfig.extendInfo` · Trigger: read `LSMinimumSystemVersion` · Observable:
      exactly `"12.0"`; a `"10.15"` fixture fails. See `forge-config-windows-version.test.ts`.
- [ ] 5.4 Pin the comparison operator (test-plan #E4). Input: `minos` major ∈ {11, 12, 13}
      against expected 12 · Trigger: evaluate the floor predicate from task 3.2 ·
      Observable: `11` **fails**, `12` passes, `13` **fails** — the `11` case is what the
      old `-gt` wrongly accepted. See `build-config-parity.test.ts`.
- [ ] 5.5 Pin multi-slice safety (test-plan #E5). Input: `otool -l` fixture with **two**
      `LC_BUILD_VERSION` blocks (`minos 12.0` + `minos 11.0`) · Trigger: run the extractor ·
      Observable: both slices checked (fails on `11.0`) or an explicit multi-slice error; a
      first-match-and-exit extractor returning `12.0` is a defect.
      See `build-config-parity.test.ts`.
- [ ] 5.6 Pin the upstream-tripwire diagnostic (test-plan #X3). Input: fixture `otool`
      output with `minos 13.0` · Trigger: run the floor check with expected `12` ·
      Observable: fails, and the message names an **upstream Electron floor change**, not
      `MACOSX_DEPLOYMENT_TARGET`. See `build-config-parity.test.ts`.
- [ ] 5.7 Verify 5.1–5.6 are RED before implementing, then move the floor. Tasks 5.8–5.11
      MUST land in one commit — a partial move fails CI in a confusing way.
- [ ] 5.8 `packages/electron/forge.config.ts:82`: `extendInfo.LSMinimumSystemVersion`
      `"10.15"` → `"12.0"`. Rewrite the surrounding rationale comment — it documents the
      Catalina decision and the three enforcement points; it must now document the Monterey
      decision and cite this change.
- [ ] 5.9 `.github/workflows/_electron-build.yml:407`: `MACOSX_DEPLOYMENT_TARGET: "10.15"`
      → `"12.0"`.
- [ ] 5.10 `_electron-build.yml:454+` verify step: expected plist value → `12.0`; step title
      and final `✓` echo updated. Also update the launch-smoke comment at `:556` ("runner OS
      … above the 10.15 floor"), which sits in a **later** step and is easy to miss.
- [ ] 5.11 Same step, lines ~529–539: replace the per-arch `case` (`x64→10`, `arm64→11`)
      with the single expected major observed in task 4.5, **and** change the comparison
      from `-gt` to equality, **and** make the extractor multi-slice-safe. Rewrite the
      remediation text at `:537` — it currently blames `MACOSX_DEPLOYMENT_TARGET`, which
      does not set this binary's `minos` (`design.md` Decision 2). Preserve both
      `::warning::` fall-throughs (non-numeric major, unextractable minos).
- [ ] 5.12 Confirm 5.1–5.6 now pass.

## 6. Author the update-gate scenarios (red first), then wire the gate

Exemplar for the L1 tasks in this section:
`packages/electron/src/__tests__/app-updater.test.ts`.

- [ ] 6.1 Confirm the shipped client implements the gate (test-plan #U7). Input:
      `git show v0.7.0:pnpm-lock.yaml` · Trigger: resolve `electron-updater` · Observable:
      `6.8.9`, a version that implements **and invokes** `checkIfUpdateSupported`. Fails if
      a release in the support window resolves a version without it.
      See `app-updater.test.ts`.
- [ ] 6.2 Below-floor clients are blocked (test-plan #U2). Input: the task-3.1 constant ·
      Trigger: `semver.lt(os, value)` for os ∈ {`19.6.0`, `20.6.0`} · Observable: both
      `true` — Catalina (Darwin 19) and Big Sur (Darwin 20) blocked.
      See `app-updater.test.ts`.
- [ ] 6.3 At/above-floor clients are admitted (test-plan #U3). Input: same constant ·
      Trigger: `semver.lt(os, value)` for os ∈ {`21.0.0`, `21.6.0`, `25.0.0`} · Observable:
      all `false` — macOS 12.0 exactly, 12.7, and macOS 26 (Darwin 25) allowed. The
      `21.0.0` boundary is what a naive `<=` gets wrong. See `app-updater.test.ts`.
- [ ] 6.4 Both inert spellings are rejected (test-plan #U4). Input: candidate values
      `"12.0"` and `"21"` · Trigger: `semver.lt("19.6.0", v)` · Observable: **throws** for
      both — the fail-open trap, since `checkIfUpdateSupported` catches the throw and
      returns `true`. A string-equality test would pass on these while the gate is dead.
      See `app-updater.test.ts`.
- [ ] 6.5 Verify 6.2–6.4 are RED against a deliberately wrong constant, then wire the gate.
- [ ] 6.6 Inject `minimumSystemVersion` (value from task 3.1) into the emitted
      `packages/electron/out/make/latest-mac.yml` as an explicit post-build step, slotted
      between the electron-builder step (`_electron-build.yml:402-431`) and the artifact
      upload (`:633`). Do **NOT** set `mac.minimumSystemVersion` in `electron-builder.yml`
      and assume it propagates — `app-builder-lib`'s update-info builder never writes the
      field, and its only consumer (`macPackager`) is skipped under `--prepackaged` (`:428`).
- [ ] 6.7 Assert the emitted metadata carries the field (test-plan #U1). Input: the emitted
      `latest-mac.yml` from a darwin leg · Trigger: parse the YAML · Observable: root key
      `minimumSystemVersion` equals the task-3.1 constant. Assert against the **emitted
      file**, never the config key. Extend the darwin leg of `_electron-build.yml`.
- [ ] 6.8 Scope the injection to macOS only (test-plan #U5). Input: emitted
      `latest-mac.yml`, `latest-linux.yml`, `latest.yml` · Trigger: inspect each for the
      field · Observable: present **only** in `latest-mac.yml`. This is the fail-**closed**
      hazard — the field elsewhere compares kernel `6.5.0` / `10.0.19045` against `21.0.0`
      and denies updates to every client. Extend `_electron-build.yml`.
- [ ] 6.9 Assert the field survives the merge (test-plan #U6). Input: both per-leg
      `latest-mac.yml` files carrying the field · Trigger: run the merge at
      `publish.yml:576-597` · Observable: merged output retains it; and a fixture where only
      the **x64** leg carries it exposes the glob-order dependency (the merge seeds from the
      arm64 file). Record the forward-compat caveat: if a future `electron-updater` switches
      to marketing-version comparison, `21.0.0` would block Monterey instead of admitting it.

## 7. Runtime verification on the real packaged app

The risk materialises at package time, and **there is no CI gate on the darwin boot path**
(`dmg-build-launch` is darwin-skipped; `ci-e2e-electron.yml` runs ubuntu+windows only).
Group 7 is therefore run **locally on macOS** and is the real gate.
Exemplar: `tests/e2e-electron/electron-lifecycle.ts`.

- [ ] 7.1 `npm run -w packages/electron package` on macOS, then assert on the bundle:
      `plutil -extract LSMinimumSystemVersion raw` returns `12.0`, and `otool -l` on the
      inner `pi-dashboard` Mach-O reports the `minos` major recorded in task 4.5.
- [ ] 7.2 App boots on the new runtime (test-plan #F1). Input: the packaged app on macOS ·
      Trigger: launch and wait for convergence · Observable: dashboard renders,
      `/api/health` 200, no `FATAL` in Electron stdout. See `electron-lifecycle.ts`.
- [ ] 7.3 Native surfaces survive 11 majors (test-plan #F2). Input: packaged app · Trigger:
      drive tray + dialog flows · Observable: `tray-ownership`, `zombie-adoption`,
      `doctor-version-skew` pass unchanged. See `tests/e2e-electron/tray-ownership.electron.spec.ts`.
- [ ] 7.4 DMG launch path (test-plan #F3). Input: built DMG on **macOS** · Trigger: mount,
      copy out, exec the inner Mach-O · Observable: app boots. Only satisfiable by a local
      macOS run — this spec is darwin-skipped and has no CI leg.
      See `tests/e2e-electron/dmg-build-launch.electron.spec.ts`.
- [ ] 7.5 node-pty under the execpath fallback (test-plan #X1). Input: packaged app with
      `resources/node` renamed away · Trigger: launch, open a terminal session · Observable:
      server starts under `ELECTRON_RUN_AS_NODE=1` and the PTY works — node-pty loaded
      against **Electron's** Node ABI, the one path where the bundled-Node isolation claim
      does not hold. See `electron-lifecycle.ts`.
- [ ] 7.6 Build-config parity still holds (test-plan #E6). Input: the three build configs
      post-change · Trigger: run the parity test · Observable: appId / productName /
      executableName still agree. See `build-config-parity.test.ts`.
- [ ] 7.7 `npm test` — full unit suite green.

## 8. Cross-platform CI legs

- [ ] 8.1 Windows NSIS resolves the electron version (test-plan #X2). Input: `package.json`
      with the literal pin · Trigger: `electron-forge make` → NSIS maker → `app-builder-lib`
      · Observable: `getElectronVersionFromInstalled` returns without throwing
      `Cannot compute electron version from installed node modules`. Existing windows leg of
      `_electron-build.yml`.
- [ ] 8.2 Linux glibc floor not silently raised (test-plan #X4). Input: Electron 43 runtime
      on **Ubuntu 22.04 / glibc 2.35** (the floor set by clarification G3) · Trigger: launch
      the AppImage / `.deb` headless · Observable: starts and reaches `/api/health`. The
      current-image smoke would pass regardless, so the older image is the point.
      See `qa/tests/08-electron-real-launch.sh`.
- [ ] 8.3 macOS arm64 **and** x64 legs both green — the x64 leg is retained by this change
      and is the one most likely to surface a floor-check mistake.
- [ ] 8.4 Confirm `latest-mac.yml` / `latest-linux.yml` / `latest.yml` are still emitted for
      every artifact, and that the **merged** published `latest-mac.yml` carries the gate
      field — inspect the published artifact, not the per-leg intermediate.

## 9. Docs, stale constants, and release communication

`docs/` prose is written by the DocScribe subagent in caveman style — the main agent
orchestrates and applies returned tree rows, and never edits `docs/` directly.

- [ ] 9.1 Sweep for stale `10.15` / `Catalina` constants **beyond** `docs/`:
      `grep -rn '10\.15\|Catalina' docs/ README.md qa/ packages/electron/ .github/`.
      Known hits: `qa/tests/09-electron-mac-launch.sh:32,38` (its "boot-proof not
      floor-proof" header is pinned by the `electron-qa-coverage` spec, so a stale number
      there is spec drift, not a comment typo), `packages/electron/AGENTS.md`,
      `qa/tests/AGENTS.md`.
- [ ] 9.2 Distinguish **live constants** from **historical records**. `docs/electron-session.md`
      and `docs/research/browser-provider-registry.md` record past decisions — those get a
      *superseded-by* note pointing at this change, NOT a rewrite. Rewriting a decision
      record to match present state destroys the trail. Delegate to DocScribe.
- [ ] 9.3 Delegate to DocScribe: update docs stating the macOS floor as a live user-facing
      promise (README prerequisites, install/setup docs).
- [ ] 9.4 Apply the directory `AGENTS.md` rows for every touched file whose purpose row
      carries a version fact or a `See change:` trail — `packages/electron/AGENTS.md` (its
      `forge.config.ts` row states the 10.15 floor as fact), `.github/workflows/AGENTS.md`,
      `qa/tests/AGENTS.md`.

## 10. Manual verification (deferred post-merge)

- [ ] 10.1 Below-floor macOS actually refuses the build (test-plan: manual-only). On real
      macOS 11 (or 10.15) hardware/VM: the signed DMG is refused by launchd, and the 32.x
      client on that OS is not offered the update. **No automatable signal exists** — no
      such VM or runner is available, as `qa/tests/09-electron-mac-launch.sh` already
      documents. Automated coverage stops at the *declared* floor and the *updater* gate;
      enforcement itself stays unverified.
- [ ] 10.2 Release notes state the dropped platforms (test-plan: manual-only). CHANGELOG
      `## [Unreleased]` breaking-change entry names macOS 10.15 and 11 explicitly, states
      affected users remain on the last 32.x build, describes the update-gate behaviour, and
      gives the security reason. Editorial judgment — no automatable observable.

## 11. Review and land

- [ ] 11.1 Invoke `review-code` on the full diff. Small but spans a build config, a CI
      workflow, update metadata and a version pin, where a wrong constant fails only on a
      runner — or, for the gate, does not fail at all and silently does nothing.
- [ ] 11.2 Re-read the final diff against `proposal.md` → What Changes. Every changed line
      must trace to a listed item; anything under `packages/electron/src/` beyond the new
      tests and the task-3.1 constant is out of scope.
- [ ] 11.3 Close [#529](https://github.com/BlackBeltTechnology/pi-agent-dashboard/issues/529)
      with the landed version, the macOS floor decision, and the update-gate outcome.
