## ADDED Requirements

### Requirement: Plugin activates only when `pi-blackhole` is installed

The `blackhole` plugin manifest SHALL declare `requires.piExtensions: ["pi-blackhole"]` so the dashboard treats it as inactive when the extension is absent.

#### Scenario: Extension present

- **WHEN** `pi-blackhole` is installed and the plugin is enabled
- **THEN** `/settings/plugins/blackhole` SHALL render the configuration form
- **AND** the plugin's `settings-section` claim SHALL be registered

#### Scenario: Extension absent

- **WHEN** `pi-blackhole` is not installed
- **THEN** `/settings/plugins/blackhole` SHALL render a not-installed state naming the install command `pi install npm:pi-blackhole`
- **AND** SHALL NOT render any configuration control

#### Scenario: Plugin declares no dependency on the extension package

- **WHEN** the repo-lint test reads `packages/blackhole-plugin/package.json`
- **THEN** neither `dependencies` nor `peerDependencies` nor `devDependencies` SHALL contain `pi-blackhole`

### Requirement: Config file location and discovery

The server SHALL resolve the config file at `<agentDir>/pi-blackhole/pi-blackhole-config.json`, where `<agentDir>` honours the `PI_CODING_AGENT_DIR` environment variable and otherwise defaults to `~/.pi/agent`.

#### Scenario: Default location

- **WHEN** `PI_CODING_AGENT_DIR` is unset
- **THEN** the resolved path SHALL be `~/.pi/agent/pi-blackhole/pi-blackhole-config.json`

#### Scenario: Overridden agent directory

- **WHEN** `PI_CODING_AGENT_DIR` is set to `/tmp/alt`
- **THEN** the resolved path SHALL be `/tmp/alt/pi-blackhole/pi-blackhole-config.json`

#### Scenario: File absent

- **WHEN** the config file does not exist
- **THEN** `GET /api/plugins/blackhole/config` SHALL return the built-in defaults with a flag indicating the file is absent
- **AND** SHALL NOT create the file

### Requirement: Reading configuration

`GET /api/plugins/blackhole/config` SHALL return the parsed configuration, the resolved file path, and the set of keys present in the file that the plugin does not manage.

#### Scenario: Valid config returned

- **WHEN** the file contains valid JSON
- **THEN** the response SHALL include every managed key with its effective value
- **AND** SHALL report the count of unmanaged keys present in the file

#### Scenario: Values absent from the file report as defaults

- **WHEN** the file omits `observeAfterTokens`
- **THEN** the response SHALL report the built-in default `15000` for that key
- **AND** SHALL mark it as not user-set

### Requirement: Unparseable configuration fails closed

When the config file exists but cannot be parsed, the server SHALL report a parse error and SHALL NOT fall back to defaults, and the client SHALL NOT render an editable form.

#### Scenario: Malformed JSON on read

- **WHEN** the file contains a trailing comma
- **THEN** `GET /api/plugins/blackhole/config` SHALL return a parse-error result carrying the parser message
- **AND** SHALL NOT return a config object

#### Scenario: Write blocked while unparseable

- **WHEN** the file cannot be parsed
- **AND** a client issues `PUT /api/plugins/blackhole/config`
- **THEN** the server SHALL reject the request without writing to the file
- **AND** the file's bytes SHALL be unchanged

#### Scenario: No form is rendered on a parse error

- **WHEN** the client receives a parse-error result
- **THEN** the settings section SHALL render the error, the file path, and recovery actions
- **AND** SHALL NOT render any input, select, textarea, or toggle for a config key
- **AND** the save control SHALL be disabled

### Requirement: Writes preserve keys the plugin does not manage

`PUT /api/plugins/blackhole/config` SHALL perform a read-modify-write: it SHALL re-read the file, apply only managed keys from the request, and serialise the merged object.

#### Scenario: Annotation keys survive a save

- **WHEN** the file contains `_comment`, `_notes`, and `skipForProviders`
- **AND** a client saves a change to `compactAfterTokens`
- **THEN** the written file SHALL still contain `_comment`, `_notes`, and `skipForProviders` with their original values
- **AND** `compactAfterTokens` SHALL hold the new value

#### Scenario: Unknown key added by a newer extension survives

- **WHEN** the file contains a key absent from the plugin's descriptor map
- **AND** any save is performed
- **THEN** that key SHALL be present in the written file with its original value

#### Scenario: Concurrent external edit is not clobbered by stale form state

- **WHEN** the file is modified on disk after the client loaded it
- **AND** a client saves a change to one key
- **THEN** only that key SHALL differ from the on-disk file's prior content

### Requirement: Server-side validation is the security boundary

`PUT /api/plugins/blackhole/config` SHALL validate every submitted key against the plugin's field descriptors and reject the whole request on any violation, without partial application.

#### Scenario: Enum violation rejected

- **WHEN** a request sets `compaction` to `"sometimes"`
- **THEN** the server SHALL reject the request
- **AND** SHALL NOT write to the file

#### Scenario: Type violation rejected

- **WHEN** a request sets `observeAfterTokens` to `"lots"`
- **THEN** the server SHALL reject the request

#### Scenario: Bound violation rejected

- **WHEN** a request sets `dropperPressureThreshold` to `1.8`
- **THEN** the server SHALL reject the request, the accepted range being `0`–`1`

#### Scenario: Unknown key in the request is rejected

- **WHEN** a request contains a key absent from the descriptor map
- **THEN** the server SHALL reject the request rather than writing an arbitrary key

#### Scenario: Rejection is atomic

- **WHEN** a request contains one valid and one invalid key
- **THEN** neither key SHALL be written

### Requirement: Model fallback chains are editable as ordered lists

The settings section SHALL render `model`, `observerModel` + `observerFallbackModels`, `reflectorModel` + `reflectorFallbackModels`, and `dropperModel` + `dropperFallbackModels` as per-worker ordered chains, where list position determines resolution order.

#### Scenario: Chain order maps to array order

- **WHEN** the observer chain shows primary `A` then fallbacks `B`, `C`
- **THEN** `observerModel` SHALL be `A` and `observerFallbackModels` SHALL be `[B, C]` in that order

#### Scenario: Promoting a fallback to primary

- **WHEN** the user moves the first fallback above the primary
- **AND** saves
- **THEN** the former fallback SHALL be written as `observerModel`
- **AND** the former primary SHALL be written as the first entry of `observerFallbackModels`

#### Scenario: Reordering is operable from the keyboard

- **WHEN** a chain entry is focused
- **THEN** move-up, move-down, and remove SHALL each be reachable and activatable by keyboard alone
- **AND** each SHALL expose an accessible name identifying the model it acts on

#### Scenario: Boundary controls are disabled, not absent

- **WHEN** an entry is first in its chain
- **THEN** its move-up control SHALL be present and disabled

#### Scenario: Per-model fields are editable

- **WHEN** a chain entry is expanded
- **THEN** `provider`, `id`, `thinking`, `cooldownHours`, and `contextWindow` SHALL be editable
- **AND** an empty `contextWindow` SHALL be written as absent, meaning inherit from pi

#### Scenario: Implicit tail is shown but not editable in place

- **WHEN** a worker chain is rendered
- **THEN** the resolution tail `base model → session model` SHALL be displayed
- **AND** SHALL NOT be presented as an entry of that worker's chain

#### Scenario: Session-model tail reflects `sessionFallback`

- **WHEN** `sessionFallback` is `false`
- **THEN** the session-model tail SHALL be rendered as excluded

### Requirement: Saved configuration applies without a session restart

The settings section SHALL communicate that saved changes take effect immediately in running sessions, because the extension re-reads its config from disk after every write.

#### Scenario: Apply semantics stated

- **WHEN** the configuration form renders in a non-error state
- **THEN** it SHALL state that saved changes apply to running sessions immediately
- **AND** SHALL NOT state that a session restart is required
