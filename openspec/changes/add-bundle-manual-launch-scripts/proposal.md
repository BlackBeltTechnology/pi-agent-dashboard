# Ship manual-launch scripts in the bundled server directory

## Why

Testers downloading a CI artefact (post `fix-ci-electron-runnable-bundles`) or unzipping a release ZIP have a complete, runnable bundle but no obvious entrypoint when the Electron wrapper hangs (Defender scan, unrelated bootstrap bug, etc.). Today the only way to verify the bundle launches independently is the multi-line PowerShell incantation:

```powershell
$r = "<path>"
$node = "$r\resources\node\node.exe"
$jitiUrl = "file:///" + ($r -replace '\\','/') + "/resources/server/node_modules/jiti/lib/jiti-register.mjs"
Set-Location "$r\resources\server"
& $node --import $jitiUrl "packages\server\src\cli.ts" start
```

That's correct (mirrors `node-spawn.ts::buildNodeImportArgvParts`) but five lines of paste-pain. Testers retype it wrong, mis-quote the URL, or don't know that the entry must be raw-path while the loader must be URL-form.

A pair of one-double-click scripts at `resources/server/start-server.{cmd,ps1,sh}` solves this. They use only what's in the bundle (`resources/node/node.exe` + bundled jiti), need no system Node, and pass through any extra argv to `cli.ts` (so `start-server.cmd status` or `start-server.cmd restart` work without thinking).

## What Changes

- **Add three scripts** at the source location `packages/electron/scripts/server-launch-helpers/`:
  - `start-server.cmd` — Windows batch. Resolves `%~dp0` to its own dir, computes the bundled-node path (`..\node\node.exe`) and the bundled jiti URL, sets cwd to `%~dp0`, invokes the production argv shape. Passes `%*` through.
  - `start-server.ps1` — PowerShell sibling. Same logic via `$PSScriptRoot`. Passes `@args` through.
  - `start-server.sh` — POSIX bash for Linux/macOS unpacked bundles. Same logic via `$(dirname "$0")`. Passes `"$@"` through.
- **Hook into `bundle-server.mjs`**: after the synthetic `package.json` is written, `cpSync` the three scripts into `<SERVER_BUNDLE>/`. On POSIX hosts, `chmod +x` the `.sh` file so it stays executable after `electron-forge package`'s `cpSync`.
- **Filename + path contract**: each script is placed at the **server-bundle root** (`resources/server/start-server.*`), not at the install root. Rationale: it lives next to `packages/server/src/cli.ts` and references everything via `$PSScriptRoot` / `%~dp0` / `$(dirname "$0")`, so the script is self-relocating — copy the unzipped `PI-Dashboard-win32-x64/` anywhere and the script still works.
- **No Electron-side changes**. The scripts are an out-of-band diagnostic surface; `main.ts` continues to spawn the server identically via `launchDashboardServer`.
- **CI assertion (gentle)**: extend the runnable-bundle assertion in `_electron-build.yml` to also check that `resources/server/start-server.cmd` exists on win32 legs and `resources/server/start-server.sh` exists on linux/darwin legs. Cheap drift gate.

## Capabilities

### Modified Capabilities

- `electron-build-pipeline`: adds a Requirement that the bundled-server directory ships the three launch helpers, each self-locating and using only resources inside the bundle.

## Impact

- **Scope**: 3 new tiny scripts (~10-15 LOC each) + ~15 LOC in `bundle-server.mjs` to copy them + ~3 LOC extension to the CI assertion. ~60 LOC total.
- **Artefact size**: negligible (~2 KB per script, three scripts).
- **User-visible**: testers can right-click `start-server.ps1` → "Run with PowerShell" (Windows), double-click `start-server.sh` after `chmod +x` (Linux/macOS via terminal), or just `.\start-server.cmd` (Windows cmd / pwsh). All produce identical results.
- **No coupling to Electron**: the scripts work whether or not Electron is even present. They live inside `resources/server/` which is the same directory the standalone-install + Electron-bundled layouts both use.
- **Defender / AV behaviour**: identical to launching via Electron — same `node.exe` binary, same files touched. The script does not bypass AV; it just removes typing friction.
- **Out of scope**:
  - GUI launcher / desktop shortcut (this is for testers/CI smoke, not end-user UX).
  - Killing an already-running server (use `start-server.cmd stop`; the `stop` subcommand already exists in `cli.ts`).
  - Multi-instance management.
- **Sequencing**: depends on `fix-ci-electron-runnable-bundles` (the bundle must actually be runnable for these scripts to work). Lands cleanly on top.
