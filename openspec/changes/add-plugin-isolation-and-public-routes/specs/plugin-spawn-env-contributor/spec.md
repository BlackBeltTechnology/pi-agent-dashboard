## MODIFIED Requirements

### Requirement: Contributions apply to every spawn mechanism without overriding
Contributed variables SHALL be applied to the environment of every dashboard spawn mechanism: headless, tmux, Windows Terminal, and WSL tmux — except an **isolated plugin spawn** (a plugin spawn with a valid `scope.agentDir`, see `plugin-spawn-scope`), to which no contribution SHALL be applied, because contributors configure the operator environment and may carry secrets.

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

#### Scenario: Isolated plugin spawn receives no contribution
- **WHEN** a trusted contributor returns `{ "CTX_FETCH_STRICT": "1" }` and a plugin spawns with a valid `scope.agentDir`
- **THEN** the isolated session's environment SHALL NOT contain `CTX_FETCH_STRICT`
- **AND** the contributor SHALL NOT be invoked for that spawn
