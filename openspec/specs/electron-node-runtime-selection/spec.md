# electron-node-runtime-selection Specification

## Purpose

Defines how the Electron app selects the Node.js binary used to spawn the dashboard server. The app prefers a Node runtime bundled in Electron's resources, resolves its per-platform binary path, falls back to Electron's own executable only when the bundled runtime is missing, and repairs a stripped Windows `PATH` so spawned processes can locate system executables.

## Requirements

### Requirement: Bundled Node runtime is the preferred server runtime

The runtime selector SHALL return the bundled Node binary as the server runtime whenever a bundled Node directory is provided and the platform-specific binary exists on disk.

#### Scenario: Bundled Node present on POSIX

- **WHEN** a bundled Node directory is provided and the platform is macOS or Linux
- **THEN** the selector resolves the binary as `<bundledNodeDir>/bin/node`
- **AND** returns a bundled result carrying that binary path when the file exists

#### Scenario: Bundled Node present on Windows

- **WHEN** a bundled Node directory is provided and the platform is Windows
- **THEN** the selector resolves the binary as `<bundledNodeDir>\node.exe`
- **AND** returns a bundled result carrying that binary path when the file exists

### Requirement: Fallback to Electron's own executable when bundled Node is missing

When no bundled Node directory is provided or the platform-specific bundled binary does not exist,
the runtime selector SHALL first try the shared server-spawn runtime resolution (override, `PATH`,
version-manager probe, managed Node), gated on the dashboard server's `engines.node` range, and
return a system result for the first qualifying Node. Only when none qualifies SHALL it fall back
to Electron's own executable path, signalling that the fallback binary must run in Node mode — and
only when Electron's embedded Node version (`process.versions.node`) satisfies the range. When it
does not, the selector SHALL return an unavailable result carrying the embedded version and the
required range, and the Electron app SHALL surface that reason to the user instead of spawning a
server the Node-version guard would refuse.

#### Scenario: No bundled directory provided

- **WHEN** no bundled Node directory is provided
- **AND** no system Node satisfies the server engines range
- **AND** Electron's embedded Node satisfies the server engines range
- **THEN** the selector returns an execpath-fallback result using Electron's own executable path
- **AND** flags that the process must be launched with `ELECTRON_RUN_AS_NODE` enabled

#### Scenario: Bundled directory provided but binary absent

- **WHEN** a bundled Node directory is provided but the platform-specific binary file does not exist
- **AND** no system Node satisfies the server engines range
- **AND** Electron's embedded Node satisfies the server engines range
- **THEN** the selector returns an execpath-fallback result using Electron's own executable path
- **AND** flags that the process must be launched with `ELECTRON_RUN_AS_NODE` enabled

#### Scenario: System Node preferred over Electron's executable

- **WHEN** the bundled binary is missing
- **AND** the first `node` on `PATH` is `v26.1.0`
- **THEN** the selector SHALL return a system result with that binary
- **AND** SHALL NOT flag `ELECTRON_RUN_AS_NODE`

#### Scenario: Embedded Node below the floor

- **WHEN** the bundled binary is missing and no system Node qualifies
- **AND** Electron's embedded Node reports `24.18.1` while the server engines range is `>=26.0.0 <27`
- **THEN** the selector SHALL return an unavailable result naming `24.18.1` and `>=26.0.0 <27`
- **AND** the app SHALL NOT spawn the dashboard server with Electron's executable
- **AND** the app SHALL surface the reason through the existing launch-failure path (`failed` phase), naming the missing bundled runtime and the version mismatch

### Requirement: Resolve bundled runtime paths from resources per platform

The resolver SHALL locate the bundled Node binary, its installation directory, and the bundled npm CLI beneath the app's `node` resources directory using platform-correct layouts, returning null when a target is absent.

#### Scenario: Resources path in a packaged app

- **WHEN** the process exposes a resources path (packaged Electron)
- **THEN** the resolver bases all bundled-runtime paths on `<resourcesPath>/node`

#### Scenario: Resources path in development

- **WHEN** no resources path is exposed (development)
- **THEN** the resolver bases bundled-runtime paths on the project `resources/node` directory relative to the source file

#### Scenario: Bundled Node binary lookup per platform

- **WHEN** resolving the bundled Node binary
- **THEN** on Windows the resolver checks `<resources>/node/node.exe`
- **AND** on macOS or Linux the resolver checks `<resources>/node/bin/node`
- **AND** returns null when the checked binary does not exist

#### Scenario: Bundled Node directory resolution

- **WHEN** the bundled Node binary exists
- **THEN** the resolver returns `<resources>/node` as the installation directory
- **AND** returns null when the bundled Node binary does not exist

#### Scenario: Bundled npm CLI lookup across layouts

- **WHEN** resolving the bundled npm CLI script
- **THEN** the resolver returns the first existing path among `<resources>/node/lib/node_modules/npm/bin/npm-cli.js` and `<resources>/node/node_modules/npm/bin/npm-cli.js`
- **AND** returns null when neither path exists

### Requirement: Repair a stripped Windows system PATH before spawning

The PATH repair helper SHALL prepend canonical Windows system directories to the environment `PATH` when running on Windows, adding only directories that exist on disk and are not already present, and SHALL leave the environment unchanged on non-Windows hosts.

#### Scenario: Non-Windows host

- **WHEN** the host platform is not Windows
- **THEN** the helper returns the environment unchanged

#### Scenario: Missing system directories on Windows

- **WHEN** the host is Windows and canonical system directories such as `System32`, `System32\Wbem`, `System32\WindowsPowerShell\v1.0`, `System32\OpenSSH`, and the WindowsApps directory exist on disk but are absent from `PATH`
- **THEN** the helper prepends the existing missing directories to `PATH` using the `;` delimiter
- **AND** derives the system root from `SYSTEMROOT`/`SystemRoot`, defaulting to `C:\Windows`

#### Scenario: Directory already present on PATH

- **WHEN** a candidate directory is already present in `PATH` under case-insensitive comparison
- **THEN** the helper does not add it again

#### Scenario: Idempotent application

- **WHEN** the helper is applied twice to the same environment
- **THEN** the result equals applying it once
