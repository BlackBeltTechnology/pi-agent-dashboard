# Test Plan — fix-windows-bundled-bash-exe

Stage: design   Generated: 2026-10-21

Hard gate: one clarification (Doctor row when `windowsBashSource: "host"` falls back to bundled) — answered: `ok` + detail "host requested, none found — using bundled"; folded into the spec delta.

Harness notes:
- Windows-only behaviour on macOS/Linux CI is unit-tested with injected `platform` / `exists` / env (existing pattern in `ensure-bundled-git.test.ts`, `select-git-source.test.ts`, `bundled-git-bash-strategy.test.ts`).
- Real-Windows proof lives in the `electron` level: the new `assert-bundled-bash-resolvable.mjs` step on the `_electron-build.yml` win32 legs.
- The docker L3 harness is Linux (`gitSourceReadout` null), so Windows-only Settings UI is covered at L1 (component test with a mocked readout), not L3.

---

## Scenarios

### Edge-case

| id | requirement | technique | level | disposition | input | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| E1 | windowsBashSource setting — Default is bundled | EP | L1 | automated | config JSON without `windowsBashSource` | `loadConfig()` parse | effective `windowsBashSource === "bundled"` |
| E2 | windowsBashSource setting — Unknown value falls back | EP (invalid class) | L1 | automated | config JSON `windowsBashSource: "wsl"`, then `42`, then `null` | `loadConfig()` parse | each → `"bundled"`; `"host"` input → `"host"` |
| E3 | ensureBundledGitOnPath — bundled mode order | decision-table (source × bashSource) | L1 | automated | env `PATH="C:\\Windows\\System32;C:\\host"`, source bundled, gitDir `C:\\res\\git` (x64 libdir), bashSource `bundled` | apply helper | PATH starts `…\\cmd;…\\usr\\bin;…\\mingw64\\bin;C:\\Windows\\System32;C:\\host` |
| E4 | ensureBundledGitOnPath — Host bash source appends usr/bin | decision-table | L1 | automated | same env, bashSource `host` | apply helper | PATH = `…\\cmd;…\\mingw64\\bin;C:\\Windows\\System32;C:\\host;…\\usr\\bin` (usr/bin last, once) |
| E5 | ensureBundledGitOnPath — No-op when source is host | decision-table | L1 | automated | same env, source `host`, bashSource `bundled` and `host` | apply helper | env deep-equals input for both bashSource values |
| E6 | ensureBundledGitOnPath — Idempotence (both modes) | state (repeat) | L1 | automated | env from E3 / E4 | apply helper again with same bashSource | deep-equals single application; no duplicate entries |
| E7 | ensureBundledGitOnPath — Re-application moves usr/bin | state-transition (bundled→host→bundled) | L1 | automated | env from E3 | apply with `host`, then with `bundled` | after `host`: usr/bin exactly once and last; after `bundled`: usr/bin exactly once, 2nd entry |
| E8 | ensureBundledGitOnPath — dedupe is case/trailing-slash insensitive | EP | L1 | automated | env PATH already holding `c:\\RES\\git\\usr\\bin\\` (lower-case drive, trailing slash) | apply with `host` | that entry removed; canonical usr/bin appears once, last |
| E9 | ensureBundledGitOnPath — arm64 libdir | EP | L1 | automated | gitDir with `clangarm64` (no `mingw64`), bashSource `host` | apply helper | prepended libdir is `…\\clangarm64\\bin`; usr/bin last |
| E10 | resolvePiShell — ProgramFiles Git outranks PATH | decision-table | L1 | automated | env `ProgramFiles=C:\\PF`, exists(`C:\\PF\\Git\\bin\\bash.exe`)=true, PATH has bundled usr/bin first with bash.exe | resolve | `{ path: "C:\\PF\\Git\\bin\\bash.exe", isWslLauncher: false }` |
| E11 | resolvePiShell — ProgramFiles key case-insensitive, x86 fallback | EP | L1 | automated | env key `PROGRAMFILES=C:\\PF` (no Git there), `ProgramFiles(x86)=C:\\PF86` with Git bash | resolve | path `C:\\PF86\\Git\\bin\\bash.exe` |
| E12 | resolvePiShell — first PATH dir with bash.exe | BVA (position) | L1 | automated | no ProgramFiles Git; PATH `A;B;C`, bash.exe exists only in B and C | resolve | path `B\\bash.exe` |
| E13 | resolvePiShell — WSL predicate | EP | L1 | automated | first hit `C:\\Windows\\System32\\bash.exe`, then `c:/windows/sysnative/BASH.EXE`, then `C:\\Program Files\\Git\\bin\\bash.exe`, then `D:\\res\\git\\usr\\bin\\bash.exe` | resolve / predicate | `isWslLauncher` true, true, false, false |
| E14 | resolvePiShell — sh.exe never counts | EP | L1 | automated | PATH dir contains only `sh.exe` | resolve | `null` |
| E15 | Observable — Bundled bash path is bash.exe | decision-table | L1 | automated | readout with spawnEnv = bundled mode env, bundle has `usr\\bin\\bash.exe`, no PF Git | `getGitSourceReadout` | `shellPath` ends `usr\\bin\\bash.exe`; `bashSetting: "bundled"`; `shellIsWslLauncher: false` |
| E16 | Observable — Git for Windows outranks the bundle | decision-table | L1 | automated | as E15 + exists(`%ProgramFiles%\\Git\\bin\\bash.exe`) | `getGitSourceReadout` | `shellPath === "<PF>\\Git\\bin\\bash.exe"` |
| E17 | Observable — health shape on Windows | EP | L1 | automated | win32 readout stubbed | `GET /api/health` | `gitSource` keys exactly `{ setting, source, gitPath, gitVersion, shellPath, bashSetting, shellIsWslLauncher }` |
| E18 | Observable — omits gitSource on non-Windows | EP | L1 | automated | platform linux | `GET /api/health` | `gitSource` absent or `null` |
| E19 | Observable — readout cache invalidated by setting change | state-transition | L1 | automated | readout computed with `bundled` | `setWindowsBashSourceSetting("host")` then readout | `bashSetting` now `"host"`; `shellPath` recomputed |
| E20 | Doctor row — decision table (resolved shell × bashSetting × bundle state) | decision-table | L1 | automated | rows: (null, any) / (WSL, bundled, bundle lacks bash.exe) / (WSL, any, source host) / (WSL, host) / (bundled bash, host) / (PF Git bash, bundled) | `runSharedChecks` bash row | resp.: `warning doctor.no_posix_shell` / `warning doctor.bash_is_wsl_launcher` + remedy "update or reinstall the dashboard app" / same code + remedy "install Git for Windows or set windowsGitSource to bundled" / `ok` + detail "requires an installed WSL distro" / `ok` + detail "host bash requested, none found — using bundled" / `ok` |
| E21 | tool-registry — bash strategy chain order | EP | L1 | automated | `registry` definitions | inspect `bash` strategies | names in order `override, bundled-git-bash, managed, where` |
| E22 | tool-registry — bundled bash.exe resolves | EP | L1 | automated | win32 ctx, resourcesPath `C:\\res`, exists(git marker)+exists(`usr\\bin\\bash.exe`) | `registry.resolve("bash")` | `ok`, path `C:\\res\\git\\usr\\bin\\bash.exe`, `source: "bundled"` |
| E23 | tool-registry — sh-only bundle falls through | EP (invalid) | L1 | automated | as E22 but only `usr\\bin\\sh.exe` exists; `where` returns `C:\\Git\\bin\\bash.exe` | `registry.resolve("bash")` | bundled strategy `{ ok:false }` reason names `bash.exe`; resolution `source: "system"` via `where` |
| E24 | electron-build — bash.exe is a copy of sh.exe | EP | L1 | automated | temp dir `usr/bin/sh.exe` (random bytes), no bash.exe | `ensureBundledBashExe(dir)` | `bash.exe` exists, bytes equal `sh.exe`; `sh.exe` still exists; second call no-op (mtime unchanged) |
| E25 | electron-build — tarball already ships bash.exe | EP | L1 | automated | temp dir with both `sh.exe` and distinct-bytes `bash.exe` | `ensureBundledBashExe(dir)` | `bash.exe` bytes unchanged |
| E26 | electron-build — GO/NO-GO list includes bash.exe | EP | L1 | automated | `bundle-server.mjs` + `assert-runnable-bundle.mjs` source | read required-path lists | both contain `usr/bin/bash.exe` alongside `usr/bin/sh.exe` |
| E27 | electron-build — gate step is Node-native | EP | L1 | automated | `.github/workflows/_electron-build.yml` | parse step "Assert pi resolves bundled bash" | exists; `run` starts with `node `; no `shell:` key; `if:` includes win32 + `source_only_bundle == false` |
| E28 | Bundled shell resolvable — Dashboard does not write shellPath | static | L1 | automated | sources `platform/{ensure-bundled-git,git-source,resolve-pi-shell}.ts`, `terminal-manager.ts`, `config-api.ts`, `server.ts` | grep for `shellPath` writes / pi settings writers | no `shellPath` assignment into any pi settings object in these modules |
| E29 | Settings UI — select shown, enabled, hint (Windows) | EP | L1 | automated | `SettingsPanel` with mocked readout `{source:"host",…}` | render | "Bash for agent commands" select present, not disabled, hint mentions bundled-only PATH effect; readout hint shows `shellPath` |
| E30 | Settings UI — hidden on non-Windows | EP | L1 | automated | `SettingsPanel` with readout `null` | render | no "Bash for agent commands" select, no "Git & Bash source" select |
| E31 | Settings UI — change saved in partial + refresh | state-transition | L1 | automated | panel loaded with `windowsBashSource: "bundled"` | select `host`, save | PATCH partial contains `windowsBashSource: "host"`; readout refetch called |
| E32 | i18n — new keys present in all catalogs | EP | L1 | automated | keys `git.bashSource*`, `err.doctor.bash_is_wsl_launcher` | `i18n-orphans.test.ts` + catalog check | keys exist in `i18n-en-source.json`, `i18n-hu.ts`, `i18n-zh-CN.ts` |

### Performance

_None — no latency/throughput requirement; readout stays process-cached (existing behaviour)._

### Frontend-quirk

| id | requirement | technique | level | disposition | input | trigger | expected observable (invariant) |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------------------|
| F1 | windowsBashSource — Change applies to new sessions without restart | state-transition | L1 | automated | config-api with seeded `bundled` | PATCH `{ windowsBashSource: "host" }` | response success, `restartRequired` false; next `augmentEnvWithGitSource` (bundled source) puts usr/bin last |
| F2 | windowsBashSource — Saved value survives a server restart | state-transition | L1 | automated | config file with `windowsBashSource: "host"` | server startup seed path (same site as `setWindowsGitSourceSetting`, `server.ts:631`) | after seed, `getActiveGitSource().bashSetting === "host"` with no config write |
| F3 | ensureBundledGitOnPath — PTY env receives placement | state | L1 | automated | terminal-manager env build, bundled source, bashSource `host` | spawn PTY env computation | PTY env PATH has usr/bin last; cmd + libdir first |
| F4 | Settings UI on a real Windows install | visual/subjective | — | manual-only | Electron Windows install | open Settings → General | [judgment: select reads clearly next to "Git & Bash source"; hint wording understandable] |

### Error-handling

| id | requirement | technique | level | disposition | fault | trigger | expected observable |
|----|-------------|-----------|-------|-------------|-------|---------|---------------------|
| X1 | electron-build — copy step without sh.exe | fault-injection (abort) | L1 | automated | temp dir lacking `usr/bin/sh.exe` (with or without bash.exe) | `ensureBundledBashExe(dir)` | throws naming `sh.exe`; no `bash.exe` created |
| X2 | Observable — Bundle missing bash.exe not reported as bundled bash | fault-injection (missing file) | L1 | automated | bundled spawnEnv, bundle has only `sh.exe`, no other bash on PATH | `getGitSourceReadout` + Doctor | `shellPath === null`; Doctor row `warning` `doctor.no_posix_shell` (not `ok`) |
| X3 | Observable — Bundle missing bash.exe + WSL launcher present | fault-injection | L1 | automated | as X2 + System32 dir with `bash.exe` on PATH | readout + Doctor | `shellPath` = System32 bash, `shellIsWslLauncher: true`; Doctor `warning doctor.bash_is_wsl_launcher`, remedy "update or reinstall" |
| X4 | Bundled shell — Host bash requested but none present falls back | fault-injection (dependency absent) | L1 | automated | bundled source, bashSource `host`, inherited PATH without any bash.exe, no PF Git | augment env + `resolvePiShell` | resolves bundle `usr\\bin\\bash.exe` |
| X5 | Win32 gate — pi resolves bundled bash in bash mode | fault-injection (real runtime) | electron | automated | x64 win32 leg bundle, ProgramFiles → empty dir, stub host dir on PATH | gate run `bashSource: "bundled"` | pi shell == bundle `usr\\bin\\bash.exe`; `$BASH_VERSION` non-empty; `posix … off`; step exit 0 |
| X6 | Win32 gate — Host mode resolves the host shell | decision-table | electron | automated | same env, `bashSource: "host"` | gate run | pi shell == stub `bash.exe`; bundled `git --version` + commit with `#!/bin/sh` pre-commit hook in a temp repo succeed (hook output seen) |
| X7 | Win32 gate — Dashboard readout agrees with pi | invariant | electron | automated | both runs above | shipped `resolvePiShell` vs pi `getShellConfig` | identical normalised paths in both modes |
| X8 | Win32 gate — Bundle without bash.exe fails the leg | fault-injection (abort) | electron | automated | gate pointed at a temp copy of the bundle with `usr/bin/bash.exe` deleted | gate run | exit ≠ 0; message names the shell pi resolved or pi's "No bash shell found" |
| X9 | Win32 gate — Cross-arch leg resolution only | EP | electron | automated | win32-arm64 leg on x64 runner | gate run | resolution assertions pass; log line states exec skipped (cross-arch); exit 0 |
| X10 | Win32 gate — non-Windows legs skip | EP | electron | automated | darwin/linux legs | gate run | exit 0 without probing (or step skipped by `if:`) |
| X11 | Bundled shell — pi bash tool works on a real Windows install without Git for Windows | fault-injection (real host) | — | manual-only | CI-built Windows installer on a machine without Git for Windows | open session, ask model to run `echo $BASH_VERSION && git --version` | [observed by human: bash 5.x + git 2.53.0.windows.4; Doctor bash row ok showing `…\\resources\\git\\usr\\bin\\bash.exe`] |
| X12 | Bundled shell — host mode with a WSL distro | fault-injection (real host) | — | manual-only | Windows machine with an installed WSL distro, bundled git source | set `windowsBashSource: "host"`, new session, run `uname -a` | [observed by human: Linux kernel string; Doctor bash row ok with WSL detail] |
| X13 | Win32 arm64 — bundled bash executes natively | fault-injection (real host) | — | manual-only | Windows on ARM hardware with the arm64 installer | new session, run `echo $BASH_VERSION` | [observed by human: non-empty bash version; no CI runner executes arm64] |

---

## Coverage summary

- Requirements covered: 9/9 delta requirements (windows-git-bash-runtime: 4; electron-build-pipeline: 2; tool-registry: 2 + chain scenario) — every delta scenario maps to ≥1 row.
- Scenarios by class: edge 32 · perf 0 · frontend 4 · error 13
- Scenarios by level: L1 39 · electron 6 · — 4
- Scenarios by disposition: automated 45 · manual-only 4

## New infra needed

- New gate script `packages/electron/scripts/assert-bundled-bash-resolvable.mjs` + its `_electron-build.yml` step (part of the change, not separate infra).
- X8's negative run is executed once on a throwaway branch during implementation (task-level evidence), not on every build.
