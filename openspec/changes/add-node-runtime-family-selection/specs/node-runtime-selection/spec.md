# node-runtime-selection Specification

## ADDED Requirements

### Requirement: Node installations are enumerated as candidates

The system SHALL enumerate candidate Node installations from the same roots the
`node`/`npm`/`npx` strategy chains already walk, so the set a user can pick from and
the set the registry can resolve remain identical. Enumeration SHALL be
filesystem-only — no Node binary is spawned to probe a version.

Each candidate SHALL carry per-member entry FILES (`nodeEntry`, `npmEntry`,
`npxEntry`), never a bare directory, because a directory is not a legal spawn target.

#### Scenario: candidate roots mirror the strategy chains

- **WHEN** candidates are enumerated
- **THEN** the result SHALL include, when present: the Electron-bundled runtime at `<resourcesPath>/node`, the managed runtime at `<managedDir>/node`, the PATH-resolved installation, and version-manager roots
- **AND** SHALL NOT include a root that no family strategy chain probes

#### Scenario: partial installation is surfaced, not discarded

- **WHEN** a candidate root contains `node` but no `npm` (e.g. a distro that packages them separately)
- **THEN** the candidate SHALL still be returned, with `npmEntry` absent
- **AND** the absent member SHALL NOT be synthesised as a path that does not exist

#### Scenario: version is read without spawning

- **WHEN** a candidate's version is reported
- **THEN** it SHALL be derived from filesystem metadata
- **AND** no `node --version` process SHALL be spawned

#### Scenario: enumeration cache shares the registry invalidation signal

- **WHEN** `registry.rescan()` is called
- **THEN** any cached candidate enumeration SHALL be invalidated
- **AND** the next enumeration SHALL re-probe the filesystem

### Requirement: One selection writes the whole family atomically

Selecting a Node installation SHALL write the `node`, `npm`, and `npx` overrides in a
SINGLE persist via `registry.setOverrides()`, so no crash window can leave the family
half-updated. Members absent from the selected installation SHALL have their override
CLEARED rather than pointed at a non-existent path.

#### Scenario: selection sets all three keys in one write

- **WHEN** the user selects a candidate exposing all three members
- **THEN** the `node`, `npm`, and `npx` overrides SHALL be persisted in one atomic write
- **AND** each cached Resolution for those tools SHALL be invalidated

#### Scenario: absent member clears rather than points at a missing path

- **WHEN** the user selects a candidate whose `npmEntry` is absent
- **THEN** the `npm` override SHALL be cleared in the same write
- **AND** `resolve("npm")` SHALL fall through its normal chain

#### Scenario: selected entry is validated before persisting

- **WHEN** a selection is submitted
- **THEN** each written path SHALL be verified to be an existing file inside the selected installation root
- **AND** a path failing that check SHALL be rejected without persisting any part of the selection

### Requirement: Family incoherence is reported

When `node`, `npm`, and `npx` resolve into different installation roots, the system
SHALL report the mismatch rather than presenting three unrelated rows. Per-tool
overrides remain supported; a deliberately hand-set member is reported as a deviation
and SHALL NOT be silently overwritten.

#### Scenario: mismatched family is flagged

- **WHEN** the three members resolve into more than one installation root
- **THEN** Settings → Developer options SHALL indicate the family is mismatched
- **AND** SHALL name which member deviates and the root it came from

#### Scenario: coherent family is not flagged

- **WHEN** all resolvable members share one installation root
- **THEN** no mismatch indicator SHALL be shown
- **AND** a member that is legitimately absent SHALL NOT by itself constitute a mismatch

#### Scenario: hand-set override is preserved

- **WHEN** a user has set `npx` independently and then selects an installation
- **THEN** the deviation SHALL be reported before the write
- **AND** the user SHALL be able to keep the hand-set member

### Requirement: Spawned children inherit the selected installation

Child-process PATH construction SHALL prepend the SELECTED Node installation. The
managed runtime SHALL be prepended only when it is the selection, replacing the
current unconditional behaviour of `prependManagedNodeToPath`.

#### Scenario: children get the selected runtime first

- **WHEN** a non-managed installation is selected and a child process is spawned
- **THEN** the selected installation's bin directory SHALL be prepended to the child's PATH
- **AND** the managed runtime SHALL NOT be prepended ahead of it

#### Scenario: no selection preserves current behaviour

- **WHEN** no installation has been selected
- **THEN** child PATH construction SHALL behave exactly as before this change
- **AND** `process.env` SHALL NOT be mutated
