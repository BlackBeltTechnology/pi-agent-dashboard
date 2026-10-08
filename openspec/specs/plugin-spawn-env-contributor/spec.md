# plugin-spawn-env-contributor Specification

## Purpose
Let trusted dashboard plugins contribute environment variables to pi sessions the dashboard spawns. The host enforces safety limits on what they can contribute.

## Requirements

### Requirement: Trusted plugins can register spawn-env contributors
The server plugin context SHALL offer an optional hook to register a spawn-env contributor. A contributor is a synchronous function. It receives the spawn mechanism (`headless`, `tmux`, `wt`, or `wsl-tmux`) and returns a map of environment variable names to string values. The hook SHALL return an unregister function. On registration, a plugin MAY declare a supersede marker: the name of a provenance marker variable, plus the set of names it may supersede. The host SHALL honour only names in that declared set.

Contributors SHALL be applied only for plugins that pass the same trust test the host uses for the plugin session-spawn hook. For other plugins the hook SHALL be a no-op.

At each spawn, the host SHALL skip contributors whose plugin is currently disabled in the dashboard config.

#### Scenario: Untrusted plugin contribution ignored
- **WHEN** an untrusted plugin registers a contributor returning `{ "FOO": "1" }`
- **THEN** no dashboard-spawned session environment contains `FOO` from that contributor

#### Scenario: Disabled plugin contribution ignored
- **WHEN** a trusted plugin's contributor is registered and the plugin is then disabled
- **THEN** sessions spawned afterwards do not receive its variables

### Requirement: Contributions apply to every spawn mechanism without overriding
Contributed variables SHALL be applied to the environment of every dashboard spawn mechanism: headless, tmux, Windows Terminal, and WSL tmux.

The host SHALL build the environment in this order:
1. the host's own shaping, including the bridge-internal scrub
2. removal of names recorded as plugin-projected by a bridge extension, restricted to that plugin's declared runtime-scope names
3. validation of contributions
4. application of contributions to names still absent

For tmux-hosted mechanisms, a value present only in the tmux server's global environment is not considered present, and the contribution is applied over it per window. A contributed variable SHALL NOT overwrite a variable that is already present in the dashboard server's base spawn environment, or one that the host sets itself.

The host SHALL reject these names:
- names not matching `^[A-Z_][A-Z0-9_]*$`
- values containing NUL
- `PATH`, `HOME`, `USERPROFILE`, `SHELL`
- any name starting with `NODE_`, `LD_`, `DYLD_`, `PI_DASHBOARD_`, `ELECTRON_`, or `CONTEXT_MODE_BRIDGE_`
- `CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS`

#### Scenario: Reserved name rejected
- **WHEN** a trusted contributor returns `{ "NODE_OPTIONS": "--inspect", "CONTEXT_MODE_BRIDGE_DEPTH": "1" }`
- **THEN** neither value from the contributor appears in the spawned environment

#### Scenario: Tmux pane receives contribution
- **WHEN** a trusted contributor returns `{ "CTX_FETCH_STRICT": "1" }` and a session is spawned into an existing tmux server
- **THEN** the pi process in the new pane has `CTX_FETCH_STRICT=1`

### Requirement: A failing contributor never blocks a spawn
A contributor that throws or returns a non-object SHALL be skipped. Entries with invalid names or values SHALL be dropped individually. Each case SHALL be logged as a warning, and the spawn SHALL proceed.

#### Scenario: Throwing contributor
- **WHEN** a trusted contributor throws
- **THEN** the session spawns successfully without that contributor's variables
- **AND** a warning is logged
