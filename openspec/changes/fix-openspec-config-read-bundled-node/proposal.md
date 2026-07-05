## Why

The global OpenSpec profile section in the dashboard Settings panel shows "not found" / fails to load the current profile when the dashboard runs as a **bundled Electron app on macOS (and Windows)** — even though the `openspec` CLI is installed, resolvable, and its global config (`~/.config/openspec/config.json`) is correct.

Confirmed root cause (reproduced on an affected macOS machine):

```
env -i HOME=… ~/.pi-dashboard/node_modules/.bin/openspec config list --json
  → env: node: No such file or directory
  → exit=127

(normal shell PATH) same command
  → valid JSON, exit=0
```

The managed `openspec` bin is a `#!/usr/bin/env node` shebang script. It runs only when a binary literally named `node` is on the spawning process's PATH. The chain that breaks:

1. Electron (GUI-launched) spawns the dashboard server under `ELECTRON_RUN_AS_NODE`, so `process.execPath` is the Electron binary (named `Electron`, not `node`).
2. `ToolResolver.buildSpawnEnv` prepends `MANAGED_BIN` (`~/.pi-dashboard/node_modules/.bin` — holds `openspec`/`pi` symlinks, no `node`) and `dirname(execPath)` (the Electron `MacOS` dir — no file named `node`) to the child PATH. Neither seeds a real `node`.
3. The server spawns `openspec` via the shared runner. On **unix**, `nodeScriptToArgv` returns `[".bin/openspec"]` and trusts the shebang; on **Windows** the same helper already node-wraps `.js` scripts (`[node.exe, script.js]`). So Windows is protected against the shim/interpreter problem, unix is not.
4. `/usr/bin/env node` finds no `node` → exit 127.
5. `configListOrAsync` unwraps any failure to `null` **silently** (no 500, no log line, no toast).
6. `GET /api/openspec/config` returns `200 { profile:"custom", workflows:[] }`. The Settings panel cannot reconcile the empty set with a real profile and renders "not found / won't load the current profile."

The dashboard works in dev/Linux because the server is launched from a terminal with a full shell PATH (and usually a real `node` from nvm/homebrew on it). The bundled-Electron child-spawn PATH is stripped, exposing the shebang gap.

Two independent defects fall out of this:

- **Exec gap (trigger):** unix `openspec`/`pi` spawns depend on a `node` interpreter the bundled server's child PATH does not guarantee.
- **Diagnosability (why it presents as "not found"):** `configListOrAsync` collapses exit-127 (and every other CLI failure) into an empty config with no signal, so a *read failure* is indistinguishable from a *genuinely empty profile*.

## What Changes

- **Fix the unix exec gap.** Make the runner spawn openspec (and other managed Node-script CLIs) so a real `node` interpreter is guaranteed, rather than relying on the `#!/usr/bin/env node` shebang. Candidate approaches (to be settled in `design.md`):
  - Extend `nodeScriptToArgv` to node-wrap `.js` entry points on **unix as well as Windows** — resolve `bin/openspec.js` (not the `.bin` symlink) and spawn `[<resolved node>, openspec.js]` via the registry's `node` resolution.
  - And/or ensure `buildSpawnEnv` seeds a **real node bin dir** (`<resources>/node/bin` or `~/.pi-dashboard/node/bin`) onto the child PATH so `env node` resolves.
- **Fix the silent degradation.** `configListOrAsync` (and the `GET /api/openspec/config` handler) must distinguish a CLI-read failure from an empty profile, so the Settings panel can render a real error state ("couldn't read OpenSpec config") instead of a fake-empty "not found."
- No change to the on-disk config format, the config path (`~/.config/openspec/config.json`), or the openspec CLI version pinning.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `tool-resolution`: managed Node-script executors (`openspec`, `pi`) SHALL be spawnable without relying on a `#!/usr/bin/env node` shebang finding `node` on the child PATH — the interpreter is resolved and supplied explicitly (parity with the existing Windows node-wrap), OR a real `node` bin dir is guaranteed on the spawn env.
- `openspec-profile-settings`: the global config read SHALL propagate CLI-read failures as a distinct error state to the Settings UI rather than degrading to an empty (`workflows: []`) profile that renders as "not found."

## Impact

- `packages/shared/src/tool-registry/definitions.ts` — `nodeScriptToArgv` unix branch (node-wrap `.js` on unix), and/or openspec/pi executor strategy ordering to resolve `bin/openspec.js` over the `.bin` symlink.
- `packages/shared/src/platform/binary-lookup.ts` — optionally `buildSpawnEnv` to seed a real node bin dir onto the child PATH.
- `packages/shared/src/platform/openspec.ts` — `configListOrAsync` (and callers) to surface failure vs. empty distinctly.
- `packages/server/src/routes/openspec-routes.ts` — `GET /api/openspec/config` to return an error state on read failure instead of masking it as an empty profile.
- `packages/client/src/lib/openspec-config-api.ts` + Settings panel — render a "couldn't read config" state distinct from an empty/custom profile.
- Platform-specific: reproduced on bundled Electron macOS; Windows shares the shebang class of bug but is already partially mitigated by the existing node-wrap — verify no regression.

## Verification

- Repro (pre-fix): `env -i HOME="$HOME" ~/.pi-dashboard/node_modules/.bin/openspec config list --json` → `exit=127`, `env: node: No such file`.
- Post-fix: the bundled Electron server's openspec spawn succeeds with a stripped GUI PATH; the Settings panel loads the correct profile (`expanded` for the confirmed config: 10 workflows persisted as `custom` + expanded set).
- A CLI-read failure surfaces as a distinct error state in Settings, never as a silent empty profile.

### CI coverage (no manual bundle needed)

The fix is verifiable in CI at two layers — the manual macOS-bundle check (original tasks 1.2 / 5.5) is now a backstop, not the primary gate:

- **Unit + runner integration (`npm test`, every PR).** `node-script-argv-matrix.test.ts` proves the node-wrap argv shape + a real stripped-PATH (`env: { PATH: "" }`) spawn; `runner-spawn-env.test.ts` proves the `ELECTRON_RUN_AS_NODE` fallback flag; `openspec-runner-stripped-path.integration.test.ts` drives the REAL `OPENSPEC_CONFIG_LIST` recipe through `run` + `runAsync` with an empty PATH over a managed-bin `.bin/openspec` shebang-symlink topology, with a CONTROL raw-shebang spawn asserting exit 127. This reproduces the failing spawn env (task 1.2's intent) on the ordinary Linux CI host.
- **Bundled-Electron launch smoke (real GUI runners).** `qa/tests/09-electron-mac-launch.sh` (macos-14 arm64 + macos-15-intel x64) and `08-electron-real-launch.sh` (linux) already run in CI via `_electron-build.yml` (called by `ci-e2e-electron.yml` on electron-touching PRs to develop, plus `ci-electron.yml` on-demand and `publish.yml`). They **direct-exec the inner Mach-O**, so `process.execPath` is the Electron binary with the stripped GUI PATH — the exact `execpath-fallback` topology that triggers the bug. Extend both to: seed a fake `~/.pi-dashboard/node_modules/.bin/openspec` (`#!/usr/bin/env node` shebang) + a known `~/.config/openspec/config.json`, then after `/api/health` assert `GET /api/openspec/config` returns 200 + the seeded profile (not 502, not empty). Pre-fix that spawn dies exit-127 → assertion fails; post-fix the node-wrap resolves it → passes. Gracefully SKIP (exit 0) only if the seed itself cannot be created. Closes deferred tasks 1.2 / 5.5 as a deterministic CI regression gate.
- **Not a fit:** the Playwright `tests/e2e/` suite targets the Docker all-in-one container (a standalone server, not a bundled `.app`), so it does not reproduce the Electron-execPath trigger; a DOM-level Settings check there would test the wrong topology. True Electron+DOM E2E (`_electron.launch()`) is a larger, separate change.
