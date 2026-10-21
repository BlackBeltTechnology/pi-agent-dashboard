# Tasks

Tests first in every group (write → see red → implement → green). Test tasks carry the scenario Triple and a `test-plan` id; `test-plan.md` is the automated-vs-manual source of truth.

## 1. Ship bundled bash.exe (build)

- [x] 1.1 Test (L1, exemplar `packages/electron/src/__tests__/scan-packaged-symlinks.test.ts`): temp dir with `usr/bin/sh.exe` (random bytes), no `bash.exe` · call `ensureBundledBashExe(dir)` · `bash.exe` exists with identical bytes, `sh.exe` kept, second call is a no-op (test-plan #E24)
- [x] 1.2 Test (L1, same exemplar): temp dir with `sh.exe` and distinct-bytes `bash.exe` · call `ensureBundledBashExe(dir)` · `bash.exe` bytes unchanged (test-plan #E25)
- [x] 1.3 Test (L1, same exemplar): temp dir lacking `usr/bin/sh.exe` (with and without `bash.exe`) · call `ensureBundledBashExe(dir)` · throws naming `sh.exe`, no `bash.exe` created (test-plan #X1)
- [x] 1.4 Implement `ensureBundledBashExe(gitDir)` (exported from `packages/electron/scripts/download-git-windows.mjs` or a sibling `scripts/lib/` module) and call it right after `extract()`, before `writeLicense`; refresh the file-header comment. Verify 1.1–1.3 green.
- [x] 1.5 Test (L1, exemplar `packages/electron/src/__tests__/build-config-parity.test.ts`): sources of `bundle-server.mjs` + `assert-runnable-bundle.mjs` · read their bundled-git required-path lists · both contain `usr/bin/bash.exe` alongside `usr/bin/sh.exe` (test-plan #E26)
- [x] 1.6 Add `usr/bin/bash.exe` to the GO/NO-GO list + success log in `bundle-server.mjs` and to the win32 required paths in `assert-runnable-bundle.mjs`; drop the "ships NO bash.exe" comments. Verify 1.5 green.
- [x] 1.7 Update `packages/electron/AGENTS.md` rows for `download-git-windows.mjs`, `bundle-server.mjs`, `assert-runnable-bundle.mjs` (`See change: fix-windows-bundled-bash-exe`).

## 2. windowsBashSource setting + PATH placement (shared)

- [x] 2.1 Test (L1, exemplar `packages/shared/src/__tests__/config-heap-limits.test.ts`): config JSON without `windowsBashSource` · `loadConfig()` · effective value `"bundled"` (test-plan #E1)
- [x] 2.2 Test (L1, same exemplar): config `windowsBashSource` = `"wsl"`, `42`, `null`, `"host"` · `loadConfig()` · first three → `"bundled"`, `"host"` → `"host"` (test-plan #E2)
- [x] 2.3 Add `windowsBashSource: "bundled" | "host"` to `DashboardConfig` type, defaults and parse in `packages/shared/src/config.ts` (mirroring `windowsGitSource` at `:1318`, `:1769`, `:2640-2645`). Verify 2.1–2.2 green.
- [x] 2.4 Test (L1, exemplar `packages/shared/src/__tests__/ensure-bundled-git.test.ts`): env `PATH="C:\Windows\System32;C:\host"`, source bundled, gitDir `C:\res\git` (mingw64), bashSource `bundled` · apply `ensureBundledGitOnPath` · PATH starts `…\cmd;…\usr\bin;…\mingw64\bin;C:\Windows\System32;C:\host` (test-plan #E3)
- [x] 2.5 Test (L1, same exemplar): same env, bashSource `host` · apply · PATH `…\cmd;…\mingw64\bin;C:\Windows\System32;C:\host;…\usr\bin`, usr/bin once and last (test-plan #E4)
- [x] 2.6 Test (L1, same exemplar): same env, source `host`, bashSource `bundled` and `host` · apply · env deep-equals input both times (test-plan #E5)
- [x] 2.7 Test (L1, same exemplar): env from 2.4 / 2.5 · apply again with same bashSource · deep-equals single application, no duplicates (test-plan #E6)
- [x] 2.8 Test (L1, same exemplar): env from 2.4 · apply `host` then `bundled` · after `host` usr/bin once + last; after `bundled` usr/bin once + 2nd entry (test-plan #E7)
- [x] 2.9 Test (L1, same exemplar): PATH already holding `c:\RES\git\usr\bin\` · apply `host` · that entry removed, canonical usr/bin once + last (test-plan #E8)
- [x] 2.10 Test (L1, same exemplar): gitDir with `clangarm64` only, bashSource `host` · apply · prepended libdir `…\clangarm64\bin`, usr/bin last (test-plan #E9)
- [x] 2.11 Implement `bashSource` in `ensureBundledGitOnPath` (strip existing bundled entries case/trailing-slash-insensitively, then place per mode; operate on the already-normalised `PATH` key) and fix the stale `pi.exec("sh")` header comment. Verify 2.4–2.10 green and existing `ensure-bundled-git.test.ts` cases still pass.
- [x] 2.12 Add module state `bashSetting` + `setWindowsBashSourceSetting()` in `packages/shared/src/platform/git-source.ts` (invalidates active + readout caches), carry it in `ActiveGitSource`, pass it from `augmentEnvWithGitSource` to `ensureBundledGitOnPath`. Verify by 3.x readout tests and 4.x wiring tests.
- [x] 2.13 Update `packages/shared/src/platform/AGENTS.md` rows (`ensure-bundled-git.ts`, `git-source.ts`; correct "Shell = `usr/bin/sh.exe`").

## 3. Pi-order shell resolution + readout + Doctor (shared)

- [x] 3.1 Test (L1, exemplar `packages/shared/src/__tests__/select-git-source.test.ts` for injected `exists`/env): env `ProgramFiles=C:\PF` with Git bash present, PATH with bundled usr/bin bash first · `resolvePiShell` · `{ path: "C:\PF\Git\bin\bash.exe", isWslLauncher: false }` (test-plan #E10)
- [x] 3.2 Test (L1, same exemplar): env key `PROGRAMFILES=C:\PF` (no Git), `ProgramFiles(x86)=C:\PF86` with Git bash · resolve · `C:\PF86\Git\bin\bash.exe` (test-plan #E11)
- [x] 3.3 Test (L1, same exemplar): no PF Git, PATH `A;B;C`, `bash.exe` only in B and C · resolve · `B\bash.exe` (test-plan #E12)
- [x] 3.4 Test (L1, same exemplar): first hit `C:\Windows\System32\bash.exe`, `c:/windows/sysnative/BASH.EXE`, `C:\Program Files\Git\bin\bash.exe`, `D:\res\git\usr\bin\bash.exe` · predicate · true, true, false, false (test-plan #E13)
- [x] 3.5 Test (L1, same exemplar): PATH dir with only `sh.exe` · resolve · `null` (test-plan #E14)
- [x] 3.6 Implement `resolvePiShell({ env, exists })` + `isWslLauncherBash(path)` in a new `packages/shared/src/platform/resolve-pi-shell.ts` (PATH scan only, no bundled-path literals; cite `shell.js:8-11,19-27,66-85` in the header). Verify 3.1–3.5 green and `no-hardcoded-bundled-git-paths.test.ts` green.
- [x] 3.7 Test (L1, new `packages/shared/src/__tests__/git-source-readout.test.ts`, exemplar `ensure-bundled-git.test.ts`; `invalidateGitSourceCache` between cases; build bundled paths with `path.win32.join` pieces or add the file to the lint `ALLOWLIST`): spawnEnv in bundled mode, bundle has `usr\bin\bash.exe`, no PF Git · `getGitSourceReadout` · `shellPath` ends `usr\bin\bash.exe`, `bashSetting: "bundled"`, `shellIsWslLauncher: false` (test-plan #E15)
- [x] 3.8 Test (L1, same file): as 3.7 + PF Git bash exists · readout · `shellPath === "<PF>\Git\bin\bash.exe"` (test-plan #E16)
- [x] 3.9 Test (L1, same file): readout computed with `bundled` · `setWindowsBashSourceSetting("host")` then readout · `bashSetting: "host"`, `shellPath` recomputed (test-plan #E19)
- [x] 3.10 Test (L1, same file; Doctor assertion goes green with 3.15): bundled spawnEnv, bundle has only `sh.exe`, no other bash · readout + Doctor bash row · `shellPath === null` and Doctor `warning doctor.no_posix_shell`, not `ok` (test-plan #X2)
- [x] 3.11 Test (L1, same file; Doctor assertion goes green with 3.15): as 3.10 + System32 dir with `bash.exe` on PATH · readout + Doctor bash row · `shellPath` = System32 bash, `shellIsWslLauncher: true`, Doctor `warning doctor.bash_is_wsl_launcher` with remedy "update or reinstall the dashboard app" (test-plan #X3)
- [x] 3.12 Test (L1, same file): bundled source, bashSource `host`, inherited PATH without bash, no PF Git · augment env + `resolvePiShell` · bundle `usr\bin\bash.exe` (test-plan #X4)
- [x] 3.13 Implement readout changes in `git-source.ts`: `getGitSourceReadout(which, { spawnEnv })` runs `resolvePiShell`, drops the `which("sh")` fallback, adds `bashSetting` + `shellIsWslLauncher`. Verify 3.7–3.9 and 3.12 green, plus the readout assertions of 3.10–3.11.
- [x] 3.14 Test (L1, exemplar `packages/shared/src/__tests__/doctor-core.test.ts`): bash-row decision table — (null) / (WSL, bundled, bundle lacks bash.exe) / (WSL, source host) / (WSL, bashSetting host) / (bundled bash, bashSetting host) / (PF Git bash, bundled) · `runSharedChecks` · resp. `warning doctor.no_posix_shell` / `warning doctor.bash_is_wsl_launcher` + "update or reinstall the dashboard app" / same code + "install Git for Windows or set windowsGitSource to bundled" / `ok` + "requires an installed WSL distro" / `ok` + "host bash requested, none found — using bundled" / `ok` (test-plan #E20)
- [x] 3.15 Implement the Doctor bash row branches + `doctor.bash_is_wsl_launcher` code in `packages/shared/src/doctor-core.ts` (detail string no longer mentions `sh.exe`). Verify 3.14, 3.10, 3.11 green and `doctor-core-row-set.test.ts` green.
- [x] 3.16 Update `packages/shared/src/platform/AGENTS.md` (new `resolve-pi-shell.ts` row) and `packages/shared/src/doctor-core.ts.AGENTS.md` (bash row branches).

## 4. Server + client wiring

- [x] 4.1 Test (L1, exemplar `packages/server/src/__tests__/config-api.test.ts`): config-api with seeded `bundled` · PATCH `{ windowsBashSource: "host" }` · success, `restartRequired` false, next `augmentEnvWithGitSource` (bundled source) puts usr/bin last (test-plan #F1)
- [x] 4.2 Test (L1, same exemplar; or a test of the extracted startup-seed helper): config file `windowsBashSource: "host"` · run the startup seed path used at `server.ts:631` · `getActiveGitSource().bashSetting === "host"` with no config write (test-plan #F2)
- [x] 4.3 Implement: accept + validate `windowsBashSource` in `packages/server/src/config-api.ts` (call `setWindowsBashSourceSetting`), seed it in `packages/server/src/server.ts` next to `setWindowsGitSourceSetting`. Verify 4.1–4.2 green.
- [x] 4.4 Test (L1, exemplar `packages/server/src/__tests__/runtime-health.test.ts`): win32 readout stubbed · `GET /api/health` · `gitSource` keys exactly `{ setting, source, gitPath, gitVersion, shellPath, bashSetting, shellIsWslLauncher }` (test-plan #E17)
- [x] 4.5 Test (L1, same exemplar): platform linux · `GET /api/health` · `gitSource` absent or `null` (test-plan #E18)
- [x] 4.6 Implement: `packages/server/src/routes/system-routes.ts` passes the `ToolResolver.buildSpawnEnv(process.env)` env to `getGitSourceReadout`. Verify 4.4–4.5 green.
- [x] 4.7 Test (L1, exemplar `packages/server/src/__tests__/terminal-gateway.test.ts` or the nearest terminal-manager env test): terminal-manager env build, bundled source, bashSource `host` · compute PTY env · PATH has usr/bin last, cmd + libdir first (test-plan #F3). No code change expected in `terminal-manager.ts`; fix wiring only if red.
- [x] 4.8 Test (L1, exemplar `packages/client/src/components/__tests__/SettingsPanel.test.tsx`): `SettingsPanel` with mocked readout `{ source: "host", … }` · render · "Bash for agent commands" select present + enabled, hint mentions bundled-only PATH effect, readout hint shows `shellPath` (test-plan #E29)
- [x] 4.9 Test (L1, same exemplar): readout `null` · render · neither "Bash for agent commands" nor "Git & Bash source" select present (test-plan #E30)
- [x] 4.10 Test (L1, same exemplar): loaded `windowsBashSource: "bundled"` · select `host`, save · PATCH partial contains `windowsBashSource: "host"` and readout refetch is called (test-plan #E31)
- [x] 4.11 Implement in `packages/client/src/components/settings/SettingsPanel.tsx`: config type (`:293`), section map (`:342`), save-partial diff (`:394-396`), refresh trigger (`:1051`), readout type (`:833-836`), new `SelectField` (`git.bashSource`, options `git.bashSourceBundled` / `git.bashSourceHost`, hint `git.bashSourceHint`), `shellPath` in the "Currently active" hint. Verify 4.8–4.10 green.
- [x] 4.12 Test (L1, exemplar `packages/client/src/lib/__tests__/i18n-orphans.test.ts`): keys `git.bashSource`, `git.bashSourceBundled`, `git.bashSourceHost`, `git.bashSourceHint`, `err.doctor.bash_is_wsl_launcher` · catalog check · present in `i18n-en-source.json`, `i18n-hu.ts`, `i18n-zh-CN.ts` (test-plan #E32)
- [x] 4.13 Add the i18n keys (en/hu/zh-CN). Verify 4.12 + `i18n-orphans.test.ts` green.
- [x] 4.14 Test (L1, static, exemplar `packages/shared/src/__tests__/no-hardcoded-bundled-git-paths.test.ts`): sources `platform/{ensure-bundled-git,git-source,resolve-pi-shell}.ts`, `terminal-manager.ts`, `config-api.ts`, `server.ts` · scan · no `shellPath` assignment into pi settings (test-plan #E28)

## 5. Tool registry

- [x] 5.1 Test (L1, exemplar `packages/shared/src/__tests__/tool-registry-definitions.test.ts`): registry definitions · inspect `bash` strategies · names `override, bundled-git-bash, managed, where` (test-plan #E21)
- [x] 5.2 Test (L1, exemplar `packages/shared/src/tool-registry/__tests__/bundled-git-bash-strategy.test.ts`): win32 ctx, resourcesPath `C:\res`, git marker + `usr\bin\bash.exe` exist · `registry.resolve("bash")` · ok, path `C:\res\git\usr\bin\bash.exe`, source `bundled` (test-plan #E22)
- [x] 5.3 Test (L1, same exemplar): only `usr\bin\sh.exe` exists, `where` returns `C:\Git\bin\bash.exe` · resolve · bundled strategy `{ ok:false }` naming `bash.exe`, resolution source `system` (test-plan #E23)
- [x] 5.4 Implement `bundledGitBashStrategy` → `usr/bin/bash.exe` (`strategies.ts`), update its doc comment, the `definitions.ts:344` comment and the win32 `bash` install hint (`definitions.ts:73-77`); flip the existing `sh.exe` assertions in `bundled-git-bash-strategy.test.ts` / `tool-registry-definitions.test.ts:494` (leave `fixtures/strategies.pre-change.ts.txt` untouched). Verify 5.1–5.3 green.
- [x] 5.5 Update `packages/shared/src/tool-registry/AGENTS.md` (`strategies.ts`, `definitions.ts` rows).

## 6. Build-time pi resolution gate (electron)

- [x] 6.1 Test (L1, exemplar `packages/shared/src/__tests__/nightly-workflow-contract.test.ts`): `.github/workflows/_electron-build.yml` · parse step "Assert pi resolves bundled bash" · exists, `run` starts with `node `, no `shell:` key, `if:` includes win32 + `source_only_bundle == false` (test-plan #E27; assertion lives in `publish-workflow-contract.test.ts`)
- [x] 6.2 Implement `packages/electron/scripts/assert-bundled-bash-resolvable.mjs` per design D4 (jiti-load shipped `pi-dashboard-shared` helpers + `resolvePiShell`; `import()` shipped pi `dist/index.js`; `normalizeEnvPathKey`; empty `ProgramFiles*`; stub host dir; cwd = empty temp dir; two runs; arch-gated exec; host-mode git commit with `#!/bin/sh` hook) and add the workflow step after "Assert runnable bundle". Verify 6.1 green.
- [ ] 6.3 Electron (exemplar: existing "Assert runnable bundle" step in `_electron-build.yml`): x64 win32 leg, ProgramFiles → empty dir, stub host dir on PATH · gate run `bashSource: "bundled"` · pi shell == bundle `usr\bin\bash.exe`, `$BASH_VERSION` non-empty, `posix … off`, exit 0 (test-plan #X5)
- [ ] 6.4 Electron (same exemplar): same env, `bashSource: "host"` · gate run · pi shell == stub `bash.exe`; bundled `git --version` + commit with `#!/bin/sh` pre-commit hook in a temp repo succeed, hook output seen (test-plan #X6)
- [ ] 6.5 Electron (same exemplar): both runs · compare shipped `resolvePiShell` vs pi `getShellConfig` · identical normalised paths in both modes (test-plan #X7)
- [ ] 6.6 Electron (same exemplar; run once on a throwaway branch per `validate-ci-workflow-pre-merge`, record the run URL in the PR): gate pointed at a bundle copy with `usr/bin/bash.exe` deleted · gate run · exit ≠ 0, message names the resolved shell or "No bash shell found" (test-plan #X8)
- [ ] 6.7 Electron (same exemplar): win32-arm64 leg on x64 runner · gate run · resolution asserts pass, log states exec skipped (cross-arch), exit 0 (test-plan #X9)
- [ ] 6.8 Electron (same exemplar): darwin/linux legs · gate · exit 0 without probing or step skipped by `if:` (test-plan #X10)
- [ ] 6.9 Dispatch `ci-electron.yml` (Windows legs) on the branch; confirm 6.3–6.5, 6.7, 6.8 green in the logs and record the run URL in the PR.
- [x] 6.10 Add the gate script row to `packages/electron/AGENTS.md`.

## 7. Docs

- [x] 7.1 Delegate to DocScribe (caveman style): `docs/architecture.md` § "Windows runtime dependencies (git + bash)" — bundle ships `usr/bin/bash.exe` copy; pi resolves via `getShellConfig` (`shellPath` → `%ProgramFiles%\Git\bin\bash.exe` → `where bash.exe`), not `pi.exec("sh")`; `windowsBashSource` placement + side effects; readout pi-order + residuals; build gate. Add `docs/faq.md` entries: "No bash shell found" / WSL "no installed distributions" on Windows Electron; how to use WSL bash (`windowsBashSource: "host"`). Verify `grep -n "bash.exe\|windowsBashSource" docs/architecture.md docs/faq.md`.

## 8. Integration + manual QA

- [x] 8.1 `set -o pipefail; npm test 2>&1 | tee /tmp/pi-test.log` green; `npm run quality:changed` clean.
- [ ] 8.2 Run `review-code` on the diff; resolve findings.
- [ ] 8.3 Manual (test-plan: manual-only, #X11): CI-built Windows installer on a machine without Git for Windows → new session, model runs `echo $BASH_VERSION && git --version` → bash 5.x + git 2.53.0.windows.4; Doctor bash row ok showing `…\resources\git\usr\bin\bash.exe`.
- [ ] 8.4 Manual (test-plan: manual-only, #X12): Windows with an installed WSL distro, bundled git source → set `windowsBashSource: "host"`, new session, `uname -a` → Linux kernel string; Doctor bash row ok with WSL detail.
- [ ] 8.5 Manual (test-plan: manual-only, #X13): Windows on ARM with the arm64 installer → new session, `echo $BASH_VERSION` → non-empty.
- [ ] 8.6 Manual (test-plan: manual-only, #F4): Electron Windows → Settings → General: "Bash for agent commands" reads clearly next to "Git & Bash source"; hint wording understandable.

## Workflow follow-up

- Optional: file an upstream pi-coding-agent issue proposing a non-WSL / `sh.exe` fallback in `getShellConfig` on win32 (not a dependency).
- Ship via `ship-it` in the worktree; the fix reaches users with the next Electron release (`release-cut`).
