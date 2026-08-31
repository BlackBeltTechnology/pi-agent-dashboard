# node-runtime-selection Specification

## Purpose
TBD - created by archiving change add-node-runtime-family-selection. Update Purpose after archive.

## Requirements

### Requirement: Node installations are enumerated as candidates

The system SHALL enumerate candidate Node installations from the same roots the
`node`/`npm`/`npx` strategy chains already walk, so the set a user can pick from and
the set the registry can resolve remain identical. Enumeration SHALL be
filesystem-only — no Node binary is spawned to probe a version.

Each candidate SHALL carry per-member entry FILES (`nodeEntry`, `npmEntry`,
`npxEntry`), never a bare directory, because a directory is not a legal spawn target.

#### Scenario: every strategy-chain root is enumerated

- **WHEN** candidates are enumerated
- **THEN** the result SHALL include, when present: the Electron-bundled runtime at `<resourcesPath>/node`, the managed runtime at `<managedDir>/node`, and the PATH-resolved installation — every root a family strategy chain probes
- **AND** version-manager installation roots (`~/.nvm/versions/node/*`, fnm, volta, asdf) SHALL additionally be enumerated by explicit scope decision — the chains themselves do not walk them; the selection surface makes them resolvable by writing overrides
- **AND** the mirror guarantee is one-directional: no chain-probed root MAY be missing from the enumeration; version-manager roots are additive

#### Scenario: partial installation is surfaced, not discarded

- **WHEN** a candidate root contains `node` but no `npm` (e.g. a distro that packages them separately)
- **THEN** the candidate SHALL still be returned, with `npmEntry` absent
- **AND** the absent member SHALL NOT be synthesised as a path that does not exist

#### Scenario: version is read without spawning

- **WHEN** a candidate's version is reported
- **THEN** it SHALL be derived from the filesystem alone — the version-manager directory name where one encodes it (e.g. `~/.nvm/versions/node/v22.11.0`), or an installation metadata file where one exists
- **AND** no `node --version` process SHALL be spawned
- **AND** when no filesystem source encodes the version, the version field SHALL be absent rather than spawned-for or guessed

#### Scenario: enumeration cache shares the registry invalidation signal

- **WHEN** `registry.rescan()` is called
- **THEN** any cached candidate enumeration SHALL be invalidated
- **AND** the next enumeration SHALL re-probe the filesystem

### Requirement: One selection writes the whole family atomically

Selecting a Node installation SHALL write the `node`, `npm`, and `npx` overrides in a
SINGLE persist via `registry.setOverrides()`, so no crash window can leave the family
half-updated. Members absent from the selected installation SHALL have their override
CLEARED rather than pointed at a non-existent path — unless that member carries a
hand-set override, which takes precedence: it is reported as a deviation before the
write and preserved unless the user explicitly discards it. The clear rule and the
hand-set-preserved rule can fire on the same write (a hand-set `npm` beside a
node-only candidate); hand-set always wins.

#### Scenario: selection sets all three keys in one write

- **WHEN** the user selects a candidate exposing all three members
- **THEN** the `node`, `npm`, and `npx` overrides SHALL be persisted in one atomic write
- **AND** each cached Resolution for those tools SHALL be invalidated

#### Scenario: absent member clears rather than points at a missing path

- **WHEN** the user selects a candidate whose `npmEntry` is absent AND the `npm` override carries no hand-set value
- **THEN** the `npm` override SHALL be cleared in the same write
- **AND** `resolve("npm")` SHALL fall through its normal chain

#### Scenario: hand-set member outranks the absent-member clear

- **WHEN** the user selects a candidate whose `npmEntry` is absent AND `npm` carries a hand-set override
- **THEN** the `npm` override SHALL NOT be cleared by the selection
- **AND** the deviation SHALL be reported before the write, per the hand-set-override scenario below

#### Scenario: selected entry is validated before persisting

- **WHEN** a selection is submitted
- **THEN** each written path SHALL be verified to be an existing file inside the selected installation root
- **AND** a path failing that check SHALL be rejected without persisting any part of the selection
- **AND** the written paths SHALL be the enumeration's own probed entry files, so containment holds by construction; validation exists to reject tampered or stale client-submitted paths, not legitimate distro layouts (the entry-probe patterns per root type are defined in `design.md`)
- **AND** preserved hand-set members are an explicit exception: their overrides are kept, not written, and MAY point outside the selected root

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

### Requirement: Spawned children follow the selection through the landed ladder

The spawn-runtime ladder (landed, `unify-pi-runtime-identity`) SHALL govern pi-session
spawns and SHALL read this change's selection as its gated step-1 candidate (via the
`node` tool override the picker writes). This requirement reconciles the
pre-ladder "unconditional `prependManagedNodeToPath`" wording so the unconditional
managed prepend is not silently re-introduced, and scopes which consumer classes
follow the selection directly: dashboard-tooling spawns SHALL follow the selection
directly; managed-tree mutations SHALL NOT.

#### Scenario: pi-session spawns honour the selection via the ladder

- **WHEN** a non-managed installation is selected and a pi session is spawned
- **THEN** the ladder SHALL resolve the selection at its gated step-1 candidate when it passes the version gate
- **AND** the child's PATH SHALL carry the resolved runtime's bin directory first, per the landed `managed-node-runtime` spec

#### Scenario: dashboard-tooling spawns follow the selection directly

- **WHEN** a non-managed installation is selected and a dashboard-tooling child process (non-pi-session) is spawned
- **THEN** the selected installation's bin directory SHALL be prepended to the child's PATH ahead of any managed runtime
- **AND** `process.env` SHALL NOT be mutated

#### Scenario: no selection preserves landed ladder behaviour

- **WHEN** no installation has been selected
- **THEN** pi-session spawns SHALL follow the ladder's ungated fallback exactly as landed (user Node → managed → own runtime)
- **AND** dashboard-tooling child PATH construction SHALL behave as before this change

#### Scenario: managed-tree mutations keep the managed runtime

- **WHEN** a managed-tree mutation spawn runs (e.g. pi-core-updater installing into `<managedDir>/node_modules/`)
- **THEN** the managed Node SHALL remain first on that child's PATH, per the landed "Managed-tree mutations retain the managed runtime" requirement
- **AND** the selection SHALL NOT displace it
