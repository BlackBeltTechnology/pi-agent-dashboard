## MODIFIED Requirements

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
