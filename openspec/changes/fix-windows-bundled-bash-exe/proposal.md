# Proposal

## Why

On Windows Electron installs running on the bundled git source (no Git for Windows on the host), every pi `bash` tool call fails. pi-coding-agent 1.3.0 `getShellConfig()` checks only `shellPath`, then `%ProgramFiles%\Git\bin\bash.exe`, then the first `where bash.exe` hit. It never looks for `sh.exe`. dugite-native ships GNU bash only as `usr/bin/sh.exe`. The `embed-git-bash-on-windows` premise ("pi's `!`/`!!` call `pi.exec("sh")`") does not hold. The `bash` tool, user `!` commands and `!cmd` config values all go through `getShellConfig()`. The outcome depends on the host:
- Without the WSL launcher: `No bash shell found`.
- When `C:\Windows\System32\bash.exe` (the WSL launcher) exists: pi silently picks WSL. That fails with "no installed distributions" when no distro is installed, and runs commands inside Linux when one is.

Doctor meanwhile reports bash as OK, because the dashboard's own resolver accepts `sh.exe`.

Spike 1 (2026-10-21, GitHub Actions `windows-latest`, pinned dugite-native `v2.53.0-4` x64, `pi-coding-agent@1.3.0`, host Git hidden):

| Phase | pi resolves | Outcome |
|---|---|---|
| bundle as shipped | `System32\bash.exe` (WSL launcher) | ✗ exit 1, WSL "no installed distributions" |
| `shellPath` = bundled `sh.exe` | bundled `sh.exe` | works, but bash runs with `posix on` |
| `sh.exe` copied to `usr/bin/bash.exe` | bundled `bash.exe` | ✓ bash 5.2.37, `posix off`, arrays / `[[ ]]` / process substitution / brace expansion / pipes OK, bundled git 2.53.0.windows.4 |

Spike 2 (same runner, bundled `bash.exe` present): PATH order alone decides between the bundled shell and the host shell. Bundled git works whatever the order.

| bundled `usr/bin` on PATH | git `--version` / init / commit / log / `#!/bin/sh` pre-commit hook | pi resolves |
|---|---|---|
| ahead of `System32` | ✓ | bundled `usr\bin\bash.exe` |
| after `System32` (last) | ✓ | `System32\bash.exe` (WSL launcher) |
| absent | ✓ | `System32\bash.exe` (WSL launcher) |

## What Changes

- **Ship `bash.exe`.** The Windows git bundle step ships `usr/bin/bash.exe`, a byte copy of dugite-native's `usr/bin/sh.exe`, so pi's `where bash.exe` can resolve the bundled shell in full bash mode. `sh.exe` stays in place.
- **New setting `windowsBashSource: "bundled" | "host"`** in `~/.pi/dashboard/config.json` (default `"bundled"`). Windows-only. It takes effect only while the active git source is `"bundled"`.
  - `"bundled"`: bundled `usr/bin` is prepended ahead of `System32`, so pi uses the bundled bash.
  - `"host"`: bundled `usr/bin` is appended after the inherited PATH, so pi uses the host's first `bash.exe` (e.g. the WSL launcher with a distro). Bundled git keeps working, per spike 2.
  - The setting appears as a select field next to the existing "Git & Bash source" select in Settings. It persists across restarts and applies to newly spawned sessions and terminals. Side effect of `"host"`: MSYS tools in `usr/bin` (e.g. `find`, `sort`) are shadowed by `System32` tools for spawned children. `"host"` with no host `bash.exe` falls back to the bundled bash.
- **Build checks require `bash.exe`.** The build GO/NO-GO guard and the runnable-bundle assertion require `usr/bin/bash.exe`. A new win32 build-leg gate runs the shipped pi-coding-agent's `getShellConfig()` against the bundled spawn env and fails unless pi resolves the bundled `bash.exe` in bash mode.
- **Diagnostics report what pi will actually use.** The `/api/health` `gitSource` readout and the Doctor "bash source" row report the shell pi would resolve for a fresh spawn, computed in pi's order over the augmented spawn env. Documented residuals: the session cwd, and a user-set pi `shellPath` (which applies to the bash tool and `!` commands only). That is the bundled `bash.exe` only when it exists, never `sh.exe`. The readout gains `bashSetting` and `shellIsWslLauncher`. Doctor warns when pi would pick the WSL launcher without an explicit `"host"` choice.
- **Spec catch-up** to shipped behaviour:
  - the tool-registry `bash` chain already includes the bundled strategy;
  - the `/api/health` `gitSource` shape is `{ setting, source, gitPath, gitVersion, shellPath }`, and the field is `null` on macOS/Linux (spec accepts absent or null).
- **Doc fixes.** Correct the stale `pi.exec("sh")` premise (`ensure-bundled-git.ts` header, `docs/architecture.md`). Update the `sh.exe`-as-bash notes in `strategies.ts`, `definitions.ts`, `bundle-server.mjs`, `assert-runnable-bundle.mjs`, `platform/AGENTS.md` and the specs.

The dashboard never writes pi's `shellPath`. There is no change on macOS/Linux, and no change to how `selectGitSource` picks the git source.

**Behaviour change (intended):** on the bundled git source with the default `windowsBashSource: "bundled"`, `bash` by name resolves to the bundled `bash.exe` for every spawned child:
- pi (bash tool, `!`, `!cmd`);
- a `bash` typed in a dashboard terminal;
- `#!/usr/bin/env bash` git hooks.

A user with a WSL distro, who gets WSL bash today, therefore gets the bundled Windows bash. With an explicit `windowsGitSource: "bundled"` plus Git for Windows installed, the bundled `bash.exe` also shadows Git's `bash.exe` for PATH lookups. pi still prefers `%ProgramFiles%\Git\bin\bash.exe`. Either user can restore the host shell with `windowsBashSource: "host"`; pi's own `shellPath` also works, for the bash tool and `!` commands.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `windows-git-bash-runtime`:
  - new `windowsBashSource` setting;
  - bundled shell must be resolvable by pi as `bash.exe`;
  - `ensureBundledGitOnPath` places `usr/bin` according to `windowsBashSource`;
  - the readout and Doctor report the shell pi resolves, and the health shape is caught up to shipped code.
- `electron-build-pipeline`: the win32 embed and GO/NO-GO require `usr/bin/bash.exe` (runnable-bundle legs only); a win32 leg proves pi resolves the bundled bash.
- `tool-registry`: the `bash` chain records the shipped bundled strategy (`override` → `bundled-git-bash` → `managed` → `where`), which on win32 resolves the bundle's `usr/bin/bash.exe`.

## Impact

- **Build:**
  - `packages/electron/scripts/download-git-windows.mjs` (copy `sh.exe` → `bash.exe` after extract)
  - `bundle-server.mjs` (GO/NO-GO list + comment)
  - `assert-runnable-bundle.mjs` (required paths + comment)
  - new `assert-bundled-bash-resolvable.mjs`
  - `.github/workflows/_electron-build.yml` (win32 step)
- **Shared:**
  - `platform/ensure-bundled-git.ts` (`usr/bin` placement by `bashSource`, comment)
  - `platform/git-source.ts` (readout: pi-order shell resolution, existence check, `bashSetting`, WSL flag)
  - new pi-order shell resolver + WSL-launcher predicate in `platform/`
  - `config.ts` (`windowsBashSource` type/default/parse)
  - `tool-registry/strategies.ts` (`bundledGitBashStrategy` → `bash.exe`) and `definitions.ts` (comment + win32 `bash` install hint)
  - `doctor-core.ts` (bash row)
- **Server:**
  - `packages/server/src/config-api.ts` (accept `windowsBashSource`, set + invalidate)
  - `packages/server/src/server.ts` (startup seed)
  - `packages/server/src/routes/system-routes.ts` (pass the `buildSpawnEnv` env to the readout)
  - `packages/shared/src/platform/binary-lookup.ts:316-320` and `packages/server/src/terminal/terminal-manager.ts:332` need no change: they inherit the behaviour through `augmentEnvWithGitSource`.
- **Client:**
  - `packages/client/src/components/settings/SettingsPanel.tsx`: config type, section map, save-partial diff, readout refresh trigger, readout type, select field, and shell path in the readout hint
  - i18n `i18n-en-source.json` / `i18n-hu.ts` / `i18n-zh-CN.ts` (labels + new Doctor code)
- **Tests that flip from `sh.exe` to `bash.exe`:** `bundled-git-bash-strategy.test.ts`, `tool-registry-definitions.test.ts`, `ensure-bundled-git.test.ts`, `doctor-core*.test.ts`.
- **New tests:** config parse, the resolver, the readout, the Settings save-partial, and a `publish-workflow-contract.test.ts` assertion for the new step.
- **Docs:** `docs/architecture.md` § Windows runtime dependencies, `docs/faq.md`, directory `AGENTS.md` rows.
- **Size:** about 2.5 MB more uncompressed per Windows artifact (one extra copy of `sh.exe`).
- **Compatibility:**
  - Users with Git for Windows in `%ProgramFiles%` are unaffected for pi (pi step 2 wins). With `windowsGitSource: "bundled"`, other children resolving `bash` by name get the bundled one (see Behaviour change).
  - Users on host git source are unaffected (no bundle on PATH).
  - Bundled-source users with a WSL distro: see Behaviour change above.
- **Rollback:** revert. The bundle goes back to lacking `bash.exe`, and an unknown `windowsBashSource` key in config is ignored by older parsers. No migration and no persisted state beyond the optional config key.
- **Delivery:** the fix reaches users only through a new Electron release.

## Discipline Skills

- `review-code` — non-trivial change across build scripts, the shared resolver, config, the client settings and Doctor; run before commit.
- `security-hardening` considered, not triggered. The change decides which shell binary runs agent commands (PATH order), but every candidate is already trusted:
  - the signed app bundle;
  - host installs the operator chose (`windowsBashSource: "host"` is an explicit opt-in);
  - no untrusted input, auth or secrets are involved.

  Residual: `where.exe` searches the cwd first. That is pi-side behaviour this change does not alter.
- No performance / observability / irreversible-step triggers. There is no latency budget. The Doctor row is a diagnostic, not new instrumentation. The `/api/health` `gitSource` gains two additive fields; nothing is removed or renamed.
