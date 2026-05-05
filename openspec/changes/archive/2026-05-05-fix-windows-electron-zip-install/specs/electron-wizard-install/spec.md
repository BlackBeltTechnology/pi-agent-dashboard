## ADDED Requirements

### Requirement: Fitness-based npm resolution
`dependency-installer.ts::resolveNpm()` SHALL probe `<managed-node> <managed-npm-cli> --version` (5 s timeout) before returning the managed npm command. If the probe fails (non-zero exit, malformed stdout, or thrown error), the resolver SHALL fall through to the bundled npm in `resources/node/`.

#### Scenario: managed npm is corrupt
- **WHEN** managed Node copy at `~/.pi-dashboard/node/` exists but `<node> <npm-cli.js> --version` exits non-zero or hangs
- **THEN** `resolveNpm()` SHALL fall back to bundled npm
- **AND** the wizard install SHALL still proceed using the bundled binary

#### Scenario: managed npm works
- **WHEN** the probe returns a `\d+.\d+.\d+`-shaped version string within 5 s
- **THEN** `resolveNpm()` SHALL return the managed npm command (preserving the canonical install for server + bridge to share)

### Requirement: Offline install falls back to registry on failure
`installStandalone` SHALL wrap `runOfflineInstall` in a try/catch. On any failure (cache key mismatch, npm crash, missing transitive dep, non-ASCII path issue), the wizard SHALL emit `offline-install` error progress and continue with the registry-install code path so the user is never dead-ended.

#### Scenario: offline cache crashes during install
- **WHEN** `runOfflineInstall` throws
- **THEN** `installStandalone` SHALL log the failure
- **AND** emit `running` progress for each per-package row labelled "Falling back to registry…"
- **AND** invoke `sharedBootstrapInstall` to install via the live registry

### Requirement: Pre-clone git extensions to bypass pi's broken shell-quoting
For every recommended extension whose `source` is a git URL, `installRecommendedExtensions` SHALL pre-clone the repo to its destination path using `spawn("git", ["clone", url, dest])` (no shell, discrete argv) before invoking pi's `DefaultPackageManager.installAndPersist()`. The destination SHALL be `<agentDir>/git/<host>/<path>` to match where pi's manager expects the cache.

#### Scenario: Windows username with space pre-clones successfully
- **WHEN** the destination is `C:\Users\Róbert Csákány\.pi\agent\git\github.com\BlackBeltTechnology\pi-anthropic-messages`
- **THEN** `git clone` SHALL succeed because spaces in the destination are not re-split by any shell
- **AND** pi's subsequent `installAndPersist` SHALL skip its own (broken) clone because the directory exists

#### Scenario: npm-source extension is not pre-cloned
- **WHEN** the source is `npm:<pkg>` or any non-git URL
- **THEN** `preClonePiExtensionIfGit` SHALL be a no-op
- **AND** pi's manager SHALL handle the install normally

### Requirement: PATH augmentation for recommended extensions install
`installRecommendedExtensions` SHALL temporarily set `process.env.PATH` to include the bundled / managed Node.js bin directory for the duration of the install loop. The original PATH SHALL be restored in a `finally` block. This ensures pi's `DefaultPackageManager` (which inherits parent process env, with no override hook) finds `npm` / `npm.cmd` when shelling `npm install -g <pkg>`.

#### Scenario: PATH is augmented during loop
- **WHEN** the install loop runs
- **THEN** `process.env.PATH` SHALL contain the bundled / managed Node.js bin directory
- **AND** any child process spawned by pi's manager SHALL inherit it

#### Scenario: PATH is restored after loop
- **WHEN** the loop completes (success, failure, or thrown exception)
- **THEN** `process.env.PATH` SHALL be reset to its value before the loop ran

### Requirement: Real npm error surfaced from stderr
`runNpmWithArgv` SHALL parse stderr for lines matching `^npm (error|ERR!)` (excluding the "A complete log of this run can be found in: ..." footer) and use those lines as the rejected error message. The fallback (when no error lines match) is the last 500 chars of stderr.

#### Scenario: npm install fails with structured error lines
- **WHEN** stderr contains `npm error Class extends value undefined is not a constructor or null` followed by `npm error A complete log of this run can be found in: ...`
- **THEN** the rejected error SHALL contain "Class extends value undefined is not a constructor or null"
- **AND** SHALL NOT include only the footer

### Requirement: Wizard renders node-runtime row
The standalone-install wizard step SHALL render a progress row keyed `prog-node-runtime` as the first item in `progress-list`. This row SHALL transition `pending → running → done` driven by `installManagedNode`'s progress events under step id `node-runtime`.

#### Scenario: node-runtime row visible during managed Node copy
- **WHEN** the wizard reaches the standalone install step
- **THEN** the row labelled "node runtime" SHALL be visible
- **AND** SHALL show a spinning icon while `installManagedNode` is copying files
- **AND** SHALL show `✓` when the copy completes

### Requirement: Per-package progress fanout in offline install
`runOfflineInstall` SHALL emit `running`, `done`, and `error` progress events under each pinned package's UI step id (the package basename, e.g. `pi-coding-agent`, `openspec`, `tsx`) in addition to the existing `offline-install` step id. This allows the wizard's per-package rows to update live during the single npm install.

#### Scenario: all package rows transition to running together
- **WHEN** `runOfflineInstall` begins the npm install spawn
- **THEN** the wizard rows for every outstanding pinned package SHALL transition to `running`

#### Scenario: all package rows transition to done together
- **WHEN** the npm install spawn exits successfully
- **THEN** all matching wizard rows SHALL transition to `done`

#### Scenario: all package rows transition to error on failure
- **WHEN** the npm install spawn throws
- **THEN** all matching wizard rows SHALL transition to `error` with the surfaced message

### Requirement: Window state coords clamped to visible displays
`window-state.ts::loadWindowState()` SHALL validate any persisted `x`/`y` against `screen.getAllDisplays()` work areas. If the window rect (using saved width/height) does not have at least 50×50 visible on any display, the saved coords SHALL be discarded and the window SHALL fall back to the centered default.

#### Scenario: saved coords are off-screen
- **WHEN** the saved `x`/`y` lands the window entirely off all connected displays
- **THEN** `loadWindowState()` SHALL return state with `x` and `y` undefined
- **AND** the BrowserWindow SHALL open at the OS default centered position

#### Scenario: saved coords are on-screen
- **WHEN** the saved `x`/`y` overlaps any display by ≥ 50×50
- **THEN** `loadWindowState()` SHALL preserve the coords
