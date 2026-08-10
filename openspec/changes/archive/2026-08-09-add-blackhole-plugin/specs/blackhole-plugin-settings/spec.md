## ADDED Requirements

### Requirement: The plugin self-gates on extension presence

An unsatisfied `requires.piExtensions` does not deactivate a plugin or drop its claims, so the plugin SHALL gate its own visibility rather than relying on the host to withhold it. The manifest SHALL still declare `requires.piExtensions: ["pi-blackhole"]` for the Packages-page install affordance.

#### Scenario: Extension present

- **WHEN** `pi-blackhole` is installed and the plugin is enabled
- **THEN** `/settings/plugins/blackhole` SHALL render the configuration form

#### Scenario: Extension absent

- **WHEN** `pi-blackhole` is not present in pi's installed-package registry
- **THEN** `/settings/plugins/blackhole` SHALL render a not-installed state naming the install command `pi install npm:pi-blackhole`
- **AND** SHALL NOT render any configuration control
- **AND** the not-installed state SHALL be produced by the plugin's own component, not by the host declining to mount it

#### Scenario: Installed-ness comes from the package registry, not the filesystem

- **WHEN** the plugin determines whether the extension is installed
- **THEN** it SHALL consult pi's installed-package registry, the same source the host's requirement probes use
- **AND** SHALL NOT infer installation from the existence of blackhole's directory or config file, which the extension creates on first run and which therefore means "has run at least once"

#### Scenario: Installed but never run

- **WHEN** `pi-blackhole` is in the package registry but has never run, so no config file exists
- **THEN** the settings page SHALL render the configuration form populated with defaults
- **AND** SHALL NOT render the not-installed state

#### Scenario: Manifest declares the requirement for the install prompt

- **WHEN** the manifest is inspected
- **THEN** `requires.piExtensions` SHALL list `pi-blackhole`
- **AND** the plugin SHALL NOT depend on that declaration to hide any surface

#### Scenario: Plugin declares no dependency on the extension package

- **WHEN** the repo-lint test reads `packages/blackhole-plugin/package.json`
- **THEN** neither `dependencies` nor `peerDependencies` nor `devDependencies` SHALL contain `pi-blackhole`

### Requirement: Config file location and discovery

The server SHALL resolve the config file at `<agentDir>/pi-blackhole/pi-blackhole-config.json`, mirroring the extension's own agent-directory resolution: `PI_CODING_AGENT_DIR` when set, otherwise `~/.pi/agent`. The filename SHALL be a fixed constant, never derived from request input.

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

#### Scenario: Key order is preserved

- **WHEN** a file whose keys are in a deliberate non-alphabetical order is saved
- **THEN** the written file SHALL list keys in their original relative order
- **AND** keys newly set by the save SHALL be appended rather than interleaved

#### Scenario: Concurrent external edit is not clobbered by stale form state

- **WHEN** the file is modified on disk after the client loaded it but before the request's own read
- **AND** a client saves a change to one key
- **THEN** only that key SHALL differ from the content observed at the request's read

> Note: this bounds staleness of the *client's* snapshot only. A write landing between the request's read and its write is outside this guarantee, per the requirement below on concurrent external writes.

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
- **THEN** the server SHALL reject the request, the accepted interval being `(0, 1]`

#### Scenario: Validation mirrors the extension's own coercion rules

- **WHEN** the descriptor bounds are compared against blackhole's config parser
- **THEN** token and turn counts SHALL accept integers strictly greater than `0`
- **AND** `cooldownHours` SHALL additionally accept `0`, meaning disabled
- **AND** `dropperPressureThreshold` SHALL reject `0` and accept `1`

#### Scenario: A value the extension would silently discard is rejected at the door

- **WHEN** a request carries a value blackhole's parser would coerce away, such as `observeAfterTokens` of `0`
- **THEN** the server SHALL reject the request rather than writing a value the extension will ignore in favour of its default

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

#### Scenario: A worker chain cannot be emptied

- **WHEN** a worker chain contains only its primary entry
- **THEN** that entry SHALL NOT offer a remove control
- **AND** the primary SHALL be changeable only by editing it or by promoting a fallback above it

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

### Requirement: Apply semantics are stated without asserting a guarantee

The settings section SHALL NOT tell the user a session restart is required. Whether a running session picks up the change is a property of the pinned `pi-blackhole` version, not something the dashboard controls or can guarantee.

#### Scenario: Restart is not demanded

- **WHEN** the configuration form renders in a non-error state
- **THEN** it SHALL NOT state that a session restart is required

#### Scenario: Immediate apply is attributed, not guaranteed

- **WHEN** the form describes when changes take effect
- **THEN** the statement SHALL be attributed to the extension's own reload behaviour
- **AND** SHALL NOT be phrased as a guarantee made by the dashboard

### Requirement: Concurrent external writes are narrowed, not claimed to be prevented

Blackhole writes the same config file, and no cross-process lock exists. The server SHALL narrow the write window and SHALL NOT present the result as exclusive access.

#### Scenario: Re-read happens immediately before the write

- **WHEN** a save is performed
- **THEN** the merge SHALL use content read within the same request, not content from the client's load

#### Scenario: The write is atomic from a reader's perspective

- **WHEN** the file is written
- **THEN** a concurrent reader SHALL observe either the previous content or the new content, never a partial file

#### Scenario: An interleaved external write is not silently reported as merged

- **WHEN** the file changes on disk between the request's read and its write
- **THEN** the outcome SHALL NOT be reported to the user as having preserved that external change
