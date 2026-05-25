# electron-build-pipeline — delta

## ADDED Requirements

### Requirement: Bundled-server directory ships manual-launch helpers
The bundled server directory produced by `packages/electron/scripts/bundle-server.mjs` SHALL include three self-locating launch helper scripts at the bundle root:

- `resources/server/start-server.cmd` — Windows batch
- `resources/server/start-server.ps1` — PowerShell
- `resources/server/start-server.sh` — POSIX bash (chmod 0755)

Each script SHALL use only resources inside the bundle (`../node/node.exe` or `../node/bin/node`, `node_modules/jiti/lib/jiti-register.mjs`), require no system Node installation, and forward any trailing arguments to the dashboard server's `cli.ts` entry. Each script SHALL be self-relocating — copying the unzipped tree to any path SHALL NOT break the script.

The argv shape SHALL match `packages/shared/src/platform/node-spawn.ts::buildNodeImportArgvParts`: loader position URL-wrapped as `file://`, entry position raw OS path (per the documented JITI VERSION CONTRACT).

#### Scenario: Windows user double-clicks start-server.cmd
- **WHEN** a user unzips the Windows ZIP to any directory AND double-clicks `resources\server\start-server.cmd`
- **THEN** a console window SHALL open and the dashboard server SHALL bind to `http://localhost:8000` within 30-120 s (Defender-dependent)
- **AND** `GET http://localhost:8000/api/health` SHALL return 200 OK

#### Scenario: PowerShell variant identical
- **WHEN** the user runs `& "$root\resources\server\start-server.ps1" start` (or right-click → Run with PowerShell)
- **THEN** the same launch SHALL occur with identical argv shape
- **AND** `$LASTEXITCODE` SHALL be 0 on clean Ctrl+C exit

#### Scenario: POSIX user invokes start-server.sh
- **WHEN** a user extracts the AppImage / .deb / .dmg and runs `bash resources/server/start-server.sh start` (or `./resources/server/start-server.sh start` if executable bit preserved)
- **THEN** the same launch SHALL occur and bind `http://localhost:8000`

#### Scenario: Self-relocating across paths
- **WHEN** the unzipped tree is moved from `C:\test3\zip\…\PI-Dashboard-win32-x64\` to `D:\other\PI-Dashboard-win32-x64\`
- **THEN** `start-server.cmd` SHALL still work without any edit, because all paths are resolved via `%~dp0` / `$PSScriptRoot` / `$(dirname "$0")`

#### Scenario: Trailing args forwarded
- **WHEN** the user runs `start-server.cmd status` (or `.ps1 status` or `.sh status`)
- **THEN** the script SHALL invoke `cli.ts status`, NOT `cli.ts start`
- **AND** the helper SHALL NOT inject a default `start` subcommand — `cli.ts`'s own arg parsing decides

### Requirement: CI assertion includes launch helpers
The CI assertion step `Assert runnable bundle (cli.ts exists)` in `_electron-build.yml` SHALL also verify that all three launch helpers are present in the bundled server directory. Missing any helper SHALL fail the leg.

#### Scenario: Missing helper fails the leg
- **WHEN** the assertion runs and any of `resources/server/start-server.{cmd,ps1,sh}` is absent
- **THEN** the leg SHALL fail with a non-zero exit
- **AND** the error message SHALL name the missing path
- **AND** SHALL reference change `add-bundle-manual-launch-scripts`

#### Scenario: All helpers present
- **WHEN** all three helpers exist alongside `cli.ts` and `package.json` under the bundled-server tree
- **THEN** the assertion SHALL succeed and the leg SHALL continue
