## Purpose

Let users view and change the Pi-relevant, user-tunable context-mode parameters from the dashboard. They are persisted in an engine-neutral settings file that pi sessions apply at startup.

## ADDED Requirements

### Requirement: Fixed settings file with logical keys
The plugin SHALL persist settings to the fixed path `~/.pi/context-mode/settings.json`. The path SHALL NOT be derived from request input or from any setting. The file SHALL store values under logical, engine-neutral keys (for example `search.windowMs`), never under environment-variable names. A key absent from the file SHALL mean "use the context-mode default".

#### Scenario: Absent file means defaults
- **WHEN** `~/.pi/context-mode/settings.json` does not exist
- **THEN** the read route reports every parameter at its default and marked as default
- **AND** the plugin sets no environment variable in any session

#### Scenario: Stored keys are logical
- **WHEN** the user saves a search window of 30000 ms
- **THEN** the file contains `"search.windowMs": 30000` and no key named `CONTEXT_MODE_SEARCH_WINDOW_MS`

### Requirement: Exposed parameter set
The plugin SHALL expose these parameters. Each has a type, a default, a scope, and its context-mode environment variable.

Storage-scope parameters:
- data directory: `CONTEXT_MODE_DIR`, path. A leading `~` SHALL be expanded to an absolute path before projection, because context-mode requires an absolute value here.
- alternative data directory: `CONTEXT_MODE_DATA_DIR`, path
- session suffix: `CONTEXT_MODE_SESSION_SUFFIX`, string

Runtime-scope parameters:
- search window: `CONTEXT_MODE_SEARCH_WINDOW_MS`, positive number, default 60000
- search soft cap: `CONTEXT_MODE_SEARCH_MAX_RESULTS_AFTER`, positive integer, default 3
- search hard block: `CONTEXT_MODE_SEARCH_BLOCK_AFTER`, positive integer, default 8
- locale: `CONTEXT_MODE_LOCALE`, BCP-47 string
- time zone: `CONTEXT_MODE_TZ`, IANA zone
- output price per token: `PI_CONTEXT_MODE_PRICE_OUTPUT_PER_TOKEN`, positive number, default 0.000005
- pricing model label: `PI_CONTEXT_MODE_MODEL_ID`, string
- strict fetch: `CTX_FETCH_STRICT`, boolean, default off

The plugin SHALL NOT expose or write these variables:
- bridge-internal: `CONTEXT_MODE_BRIDGE_DEPTH`, `CONTEXT_MODE_BRIDGE_IDLE_MS`, `CONTEXT_MODE_EMBEDDED_PLUGIN_TOOLS`. The Pi adapter forces the idle value for foreground sessions.
- for other hosts, with no effect under Pi: `CONTEXT_MODE_AGY_EXEC_TIMEOUT_MS`, `CONTEXT_MODE_COPILOT_PLUGIN`
- split-store hazards under Pi: `CONTEXT_MODE_PROJECT_DIR` and `CONTEXT_MODE_PLATFORM`. context-mode's tool server honours them, but its Pi extension does not. Setting either would make the two processes resolve different session stores.

#### Scenario: Unknown or internal key rejected
- **WHEN** the client PUTs a settings object containing `bridge.depth`
- **THEN** the write is rejected
- **AND** no session receives `CONTEXT_MODE_BRIDGE_DEPTH` from the plugin

### Requirement: Validate before writing
The write route SHALL accept a full settings object and validate every key against the parameter set: known key, correct type, numeric bounds, enum membership, valid IANA time zone, valid locale, and absolute or `~`-prefixed paths. It SHALL NOT modify the file when any key is invalid. It SHALL respond 400 with one error per invalid key. A valid write SHALL be atomic, so no partially written file is ever observable.

#### Scenario: Invalid number rejected
- **WHEN** the client PUTs `{"search.blockAfter": 0}`
- **THEN** the response is 400 and names `search.blockAfter`
- **AND** the file on disk is unchanged

#### Scenario: Valid write persists
- **WHEN** the client PUTs `{"fetch.strict": true}`
- **THEN** the response is 200
- **AND** a subsequent read returns `fetch.strict: true`, not marked as default

### Requirement: Settings form
The plugin SHALL render a settings section grouped by concern: storage, search throttling, locale, stats, network. The section SHALL show:
- each parameter's effective value, with a DEFAULT badge when it is unset
- a per-field reset
- inline validation errors on invalid fields; a save attempted while any field is invalid SHALL NOT change the file
- a notice that changes apply only to newly started sessions
- a notice that a variable already exported in the session's environment takes precedence, except a value present only in a tmux server's global environment
- on storage-scope fields, a notice that they apply to dashboard-spawned sessions only

The plugin SHALL declare `requires.piExtensions: ["context-mode"]` so the dashboard reports the dependency. This is the same declaration the hermes-memory settings plugin uses, and it is a status report, not a hard gate.

#### Scenario: Unset field shows default
- **WHEN** `search.windowMs` is absent from the file
- **THEN** the field shows `60000` with a DEFAULT badge

#### Scenario: Reset returns to default
- **WHEN** the user edits a field and clicks its reset control
- **THEN** the field shows the default value and the DEFAULT badge
- **AND** after saving and reloading, the field is still reported as default

### Requirement: Dashboard-spawned sessions receive all settings via spawn env
The plugin SHALL register a spawn-env contributor. It SHALL read the current settings file at each spawn, with no stale cache.

It SHALL project into the dashboard-spawned session's environment every parameter in the file that is valid and not default-off. This covers both storage and runtime scope, except that nothing is projected for WSL tmux spawns. The WSL guest has its own home directory and settings file, which its own bridge reads.

Invalid entries in the file SHALL be omitted individually, with a warning logged. A variable already present in the dashboard server's base spawn environment SHALL NOT be overwritten. Variables the bridge extension itself projected into an ancestor process do not count as present.

#### Scenario: Spawned session environment carries settings
- **WHEN** the file contains `"search.windowMs": 30000` and the dashboard spawns a session
- **THEN** the spawned process environment contains `CONTEXT_MODE_SEARCH_WINDOW_MS=30000`

#### Scenario: Invalid entry in an externally edited file
- **WHEN** the file is valid JSON but contains `"search.blockAfter": -1`
- **THEN** the spawned environment does not contain `CONTEXT_MODE_SEARCH_BLOCK_AFTER`
- **AND** the other valid entries are projected

#### Scenario: Stale bridge-projected value does not block an update
- **WHEN** the dashboard server was auto-started by a pi session whose bridge projected `CTX_FETCH_STRICT=1`, and the file now contains `"fetch.strict": false`
- **THEN** a newly spawned session does not contain `CTX_FETCH_STRICT`

#### Scenario: External edit seen on next spawn
- **WHEN** the file is edited outside the dashboard and a session is then spawned
- **THEN** the spawned environment reflects the edited values

### Requirement: Any session applies runtime settings via the bridge extension
Every pi session that loads the plugin's bridge extension SHALL project the valid runtime-scope parameters in the file onto its own environment, omitting invalid entries, before context-mode starts its tool server. The bridge SHALL NOT project storage-scope parameters, because context-mode opens its stores when its extension loads. An environment variable that is already present SHALL NOT be overwritten. The bridge SHALL record which names it projected, so the dashboard host can tell plugin-projected values from operator exports. The host SHALL honour only recorded names that belong to the runtime-scope parameter set. A missing or unparsable file SHALL leave the environment unchanged and SHALL NOT fail session startup.

#### Scenario: Terminal-launched session receives runtime settings
- **WHEN** the file contains `"fetch.strict": true` and the user starts `pi` from a shell where `CTX_FETCH_STRICT` is unset
- **THEN** context-mode's tool server runs with `CTX_FETCH_STRICT=1`

#### Scenario: Bridge never projects storage settings
- **WHEN** the file contains `"storage.dir": "~/cm-data"` and `pi` is started from a shell
- **THEN** the bridge does not set `CONTEXT_MODE_DIR`

#### Scenario: Explicit environment wins, including for disabling
- **WHEN** the shell already exports `CTX_FETCH_STRICT=1` and the file contains `"fetch.strict": false`
- **THEN** the session keeps `CTX_FETCH_STRICT=1`

#### Scenario: Corrupt file is ignored
- **WHEN** the settings file contains invalid JSON
- **THEN** the session starts normally with no plugin-set variables
