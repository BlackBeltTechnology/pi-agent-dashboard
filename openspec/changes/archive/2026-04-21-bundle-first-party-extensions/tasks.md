## 1. Spike: verify pi's DefaultPackageManager supports local install

- [x] 1.1 Read `installAndPersist` in pi-coding-agent's package manager source; identify whether it accepts a `local:` / file-path source. **Finding**: no `local:` scheme; local paths are accepted but persisted verbatim as the source string.
- [x] 1.2 Write a throwaway script in `packages/electron/scripts/spike-local-install.mjs` that clones `pi-anthropic-messages` into a tmp dir, calls `installAndPersist(localPath)`, and dumps the resulting `~/.pi/agent/settings.json` + `~/.pi/agent/packages/pi-anthropic-messages/` layout.
- [x] 1.3 Decide: does pi persist the git URL or the local path? Record the answer in `design.md` "Open Questions" and, if needed, update the spec's "Use local source, persist git URL" scenario. **Decision**: local path; adopted 2-step workaround (copy into pi's git cache + `addSourceToSettings(gitUrl)`). design.md + spec updated.

## 2. Shared manifest

- [x] 2.1 Add `BUNDLED_EXTENSION_IDS: readonly string[]` exported from `packages/shared/src/recommended-extensions.ts` with value `["pi-anthropic-messages", "pi-flows"]`.
- [x] 2.2 Add `packages/shared/src/__tests__/recommended-extensions.test.ts` asserting every id in `BUNDLED_EXTENSION_IDS` appears in `RECOMMENDED_EXTENSIONS` and has a git-based `source`.

## 3. Build-time bundling script

- [x] 3.1 Create `packages/electron/scripts/bundle-recommended-extensions.sh`:
  - early-exit when `BUNDLE_RECOMMENDED_EXTENSIONS` != `1`
  - read ids via `node --import tsx/esm` from the shared module
  - `git clone --depth=1` each into `packages/electron/resources/bundled-extensions/<id>/`, then strip `.git`
  - write `.bundled-sha` per id
  - reject non-git sources with a clear error
- [x] 3.2 Implement SPDX license check: parse `package.json` `license` first, fall back to LICENSE-file heuristic; fail on anything outside the allowlist (MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC). **Verified live**: `pi-anthropic-messages` detected as MIT; `pi-flows` correctly rejected (no license declared — blocker recorded in design.md).
- [x] 3.3 Implement size-budget check: `du -sk` per id + totals, fail at > 15 MB with per-id breakdown.
- [x] 3.4 Add shellcheck-clean guard rails (`set -euo pipefail`, quoted vars).

## 4. Forge config

- [x] 4.1 In `packages/electron/forge.config.ts`, conditionally append `"./resources/bundled-extensions"` to `extraResource` when the directory exists (mirror the existing `resources/server` conditional).

## 5. Runtime activation in dependency-installer

- [x] 5.1 Add `installBundledExtensions(onProgress?: ProgressCallback): Promise<string[]>` to `packages/electron/src/lib/dependency-installer.ts`. Returns ids that were successfully activated.
- [x] 5.2 Implement enumeration: `readdirSync(<resourcesPath>/bundled-extensions)` ∩ `BUNDLED_EXTENSION_IDS`.
- [x] 5.3 Implement skip-if-present: use `manager.getInstalledPath(source, "user")` (real path: `~/.pi/agent/git/<host>/<path>/`) and emit `"Already installed"`. (Note: corrected from tasks.md draft; pi's actual git-cache layout is under `git/`, not `packages/`. See design.md decision 2.)
- [x] 5.4 Implement activation: copy bundled tree into pi's git cache, run `npm install --omit=dev` if runtime deps declared, then `manager.addSourceToSettings(source, { local: false })` + `settingsManager.flush()`. Git URL from `RECOMMENDED_EXTENSIONS[id].source` is what pi persists. Added unit test `parse-bundled-git-source.test.ts`.
- [x] 5.5 Wire into the wizard's install sequence (`wizard-ipc.ts`): call `installBundledExtensions()` before `installRecommendedExtensions(...)` and feed its return value into `skipPackages`.
- [x] 5.6 `installRecommendedExtensions` gained a `skipPackages?: ReadonlySet<string>` parameter and emits `{ status: "done", output: "Already installed (bundled)" }` for those ids.

## 6. Wizard UI

- [x] 6.1 In the wizard renderer, render a "Bundled ✓" badge when a step's progress output matches `"Already installed (bundled)"` or when it came from `installBundledExtensions()`.
- [x] 6.2 Render an "Installed" (non-bundled) badge for the existing system-already-present case, distinct from the bundled one. (Applied to both the deps step and recommended-extensions step.)
- [x] 6.3 Added pure helper `packages/electron/src/lib/wizard-badge.ts` (`classifyProgressBadge`) + `src/__tests__/wizard-badge.test.ts` covering bundled / bundled-skip / system / no-badge / empty cases. The wizard HTML inlines the same rules with a "keep in sync" comment.

## 7. CI workflow

- [x] 7.1 In `.github/workflows/publish.yml`, add a step that runs `bundle-recommended-extensions.sh` with `BUNDLE_RECOMMENDED_EXTENSIONS=1` before `bundle-server.sh`, on all matrix runners (macOS, Linux, Windows). The step inherits the job's matrix so it runs on each target.
- [x] 7.2 The new step tees the script's size breakdown into `$GITHUB_STEP_SUMMARY` (fenced code block, per-platform/arch heading).
- [x] 7.3 Verified: `publish.yml` only triggers on `v*` tags and `ci.yml` never invokes the bundler, so PR / feature-branch CI is unaffected.

## 8. QA / verification

- [ ] 8.1 Run `qa/make test-linux-x86` on a release build with the bundle enabled; confirm a clean VM with no network can install the app and launch with `pi-anthropic-messages` + `pi-flows` active. **Deferred — requires VM environment + signed release build. Run manually after CI produces a release artifact. Note: `pi-flows` currently cannot be bundled (missing LICENSE, see design.md blocker); validate with `pi-anthropic-messages` only until the pi-flows license lands.**
- [ ] 8.2 Run the same on macOS and Windows QA VMs. **Deferred — same reason as 8.1.**
- [ ] 8.3 Upgrade test: install an older release (no bundle), run the CLI to install `pi-anthropic-messages` manually, then install the new bundled release — confirm the user's existing install is preserved and the bundled copy is ignored. **Deferred.**
- [ ] 8.4 Update-path test: after first run with bundled extensions, run `manager.update(...)` (via the dashboard UI); confirm the git URL resolves and replaces the bundled copy. **Deferred.**

## 9. Docs

- [x] 9.1 Update `AGENTS.md` "Key Files" section with the new script, the shared manifest constant, and the new installer function.
- [x] 9.2 Update `docs/architecture.md` with a "Bundled first-party extensions (Electron installer)" subsection describing the build-time bundling, the runtime activation flow, and why the `local:` install path was rejected.
- [x] 9.3 Add a CHANGELOG entry under `## [Unreleased]`.
