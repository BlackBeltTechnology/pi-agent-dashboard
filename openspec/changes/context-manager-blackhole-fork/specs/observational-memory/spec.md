## ADDED Requirements

### Requirement: The fork records its provenance and what it shed
The fork SHALL live under `packages/context-manager/src/blackhole/` with upstream pi-blackhole v0.5.15's relative paths. Every `.ts` file there, tests included, SHALL start with one of: the forked-file header naming its upstream pi-blackhole path, version and the MIT licence; the pi-vendored header naming the pi version and source file and the MIT licence; or the new-file header stating it is not upstream code. `packages/context-manager/NOTICE` SHALL carry the upstream copyright notice. `src/blackhole/FORK.md` SHALL record the upstream commit, the kept LOC (files with the forked-file header) and dropped LOC per upstream directory, and every upstream test of a kept module that is not ported, with a reason tied to a dropped module or a named vitest 4 incompatibility and a follow-up. At least 95% of the upstream test files of kept modules SHALL be ported.

#### Scenario: Header on every file
- **WHEN** the provenance test scans `src/blackhole/`
- **THEN** every `.ts` file starts with the `Forked from pi-blackhole v0.5.15` header, the pi-vendored header, or the new-file header

#### Scenario: Ported test share
- **WHEN** the provenance test compares upstream test files of kept modules with ported ones
- **THEN** at least 95% are ported and each missing one is listed in `FORK.md` with its reason

#### Scenario: Shed LOC is current
- **WHEN** the kept-LOC test counts non-test LOC of files under `src/blackhole/` that carry the forked-file header
- **THEN** the count equals the kept total recorded in `FORK.md`
- **AND** none of `pi-base/`, `changelog/`, `om/status-bar.ts`, `om/inline-compaction.ts` exists under `src/blackhole/`

### Requirement: Config and state stay upstream-compatible
The fork SHALL read configuration from the same sources, in the same precedence, with the same keys, defaults and `PI_BLACKHOLE_*` overrides as upstream v0.5.15, and SHALL NOT write the config file (no first-run defaults file, no legacy-migration write-back). It SHALL read and write the same pending, cooldown and debug files under `<agentDir>/pi-blackhole/`, and the same session custom entry types, custom message types and compaction `details` schema.

#### Scenario: Upstream state read by the fork
- **WHEN** a session was used with upstream pi-blackhole (pending file, cooldown file and `om.*` entries present) and is resumed with the fork active
- **THEN** the observer continues from the recorded coverage and `/context memory` shows the upstream observations

#### Scenario: Fork state read by upstream
- **WHEN** a session was used with the fork and is resumed with upstream pi-blackhole
- **THEN** upstream continues from the recorded coverage and its `/blackhole-memory` shows the fork's observations

#### Scenario: Project override
- **WHEN** `<cwd>/.pi/pi-blackhole-config.json` sets `observeAfterTokens` and the global file sets another value
- **THEN** the fork uses the project value

### Requirement: The fork registers only in active sessions and never collides with upstream
The fork SHALL register no `pi.on` handler of its own; its hook bodies SHALL run as context-manager chassis consumers. Its `recall` tool SHALL follow the kernel's tool lifecycle: registered only in sessions whose context-manager state is `active`, re-added to the active tools on resume, and removed on `active`→`refused`. Its commands SHALL be subcommands of `/context`: `compact [instructions]`, `memory`, `memory off|on`, `memory cleanup`, `recall`, `export`. Upstream's `/blackhole configure|settings|changelog` SHALL NOT be provided. Its headless export flag SHALL be `--context-export` with upstream's `--blackhole-export` argument grammar. In a session that is not `active`, a subcommand SHALL print the state and do nothing.

#### Scenario: Refused session
- **WHEN** pi-blackhole is installed and the context-manager flag is on
- **THEN** the session is `refused`, no fork hook body runs, no `recall` from the fork is registered, and upstream's `/blackhole` and `recall` work as before

#### Scenario: Recall after resume
- **WHEN** an active session that used `recall` is resumed with the context manager active
- **THEN** `recall` is in the active tools

#### Scenario: Observation toggle is session-scoped
- **WHEN** the user runs `/context memory off` in an active session
- **THEN** the observer stops launching for that session
- **AND** no config file is written, and the output names the dashboard setting for a persistent change

#### Scenario: Headless export
- **WHEN** `pi --context-export "days:7 mode:timeline out:<file>" --no-session -p` runs in an active project
- **THEN** `<file>` holds the same timeline export upstream's `--blackhole-export` produces for the same sessions

### Requirement: recall keeps upstream behaviour
The fork's `recall` tool SHALL accept upstream v0.5.15's parameters and return the same output for the same session, including `#N` expansion, `#N:path` and `#N:text` drill-down with continuation hints, observation-source ids, `mode` and `scope`, capped by `recallResponseMaxChars`.

#### Scenario: Drill-down parity
- **WHEN** the same session is queried with `recall` from upstream and from the fork with `#3:text`
- **THEN** both outputs are byte-identical
