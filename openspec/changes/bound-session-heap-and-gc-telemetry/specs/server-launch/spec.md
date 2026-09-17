## ADDED Requirements

### Requirement: The dashboard server's heap ceiling is config-derived

Both launch paths — the bridge-initiated launch and the standalone launcher —
SHALL derive the dashboard server's heap ceiling from `serverHeap.maxOldSpaceMb`
rather than from a value fixed in the source.

The bridge-initiated path does not apply any ceiling today: it delegates to the
shared launch primitive without supplying an environment, so the heap-stamping
helper beside it never runs. It SHALL supply the derived ceiling through the
primitive's caller-environment input.

This SHALL land together with the withholding of the dashboard's own heap flag
from spawned sessions. A server that a bridge auto-starts inherits its
environment from the pi session that started it; once that environment no longer
carries a ceiling, an unstamped bridge path would run the server at the runtime
default instead of the intended one.

The default SHALL be `1536`, lowered from the previously hardcoded `8192`. A
deployment with no such configuration therefore runs under a materially lower
ceiling than before; this is intentional and is only safe once the in-memory
event store is byte-bounded. An operator-supplied heap flag already present in
the environment SHALL continue to win, unchanged from current behavior.

The standalone launcher runs before the project's TypeScript loader is
installed, so it SHALL read the value without importing the shared
TypeScript configuration module.

#### Scenario: No configuration applies the lowered default
- **WHEN** the server is launched with no `serverHeap` in the config
- **THEN** it SHALL run with the `1536` MB request on both launch paths

#### Scenario: Bridge auto-start does not fall back to the runtime default
- **WHEN** a pi session whose environment carries no heap flag auto-starts a dashboard server
- **THEN** that server SHALL run under the configured server ceiling
- **AND** it SHALL NOT run under the runtime's own default

#### Scenario: Configured ceiling is honored on both paths
- **WHEN** `serverHeap.maxOldSpaceMb` is set to `4096`
- **THEN** a bridge-initiated launch SHALL use `4096`
- **AND** a standalone launch SHALL use `4096`

#### Scenario: Operator-pinned environment value still wins
- **WHEN** the environment already carries an operator-set heap flag
- **THEN** the launcher SHALL NOT override it, regardless of `serverHeap`

#### Scenario: Standalone launcher tolerates an unreadable config
- **WHEN** the config file is absent or malformed at standalone launch
- **THEN** the launcher SHALL use the `1536` default and start normally
