## ADDED Requirements

### Requirement: One documented command installs the HyperFrames skill bundle

The repo SHALL document a single supported command that installs the HyperFrames skill bundle, and pi sessions opened against this repo SHALL discover the installed skills without any repo-level configuration.

#### Scenario: Documented command installs the core set

- **WHEN** a contributor with no HyperFrames skills installed runs the install command documented in `docs/hyperframes.md`
- **THEN** the command exits 0
- **AND** the core set is present in the universal skill store `~/.agents/skills`
- **AND** the core set includes `hyperframes`, `hyperframes-animation`, `hyperframes-audio`, `hyperframes-cli`, `hyperframes-core`, `hyperframes-creative`, `hyperframes-keyframes`, `hyperframes-registry`, and `media-use`

#### Scenario: pi discovers installed skills with no repo configuration

- **WHEN** the core set is installed and a contributor starts a pi session from the repo root
- **THEN** the installed skills appear in the session's available-skills listing
- **AND** invoking `/hyperframes` loads the full SKILL.md body
- **AND** no entry in `.pi/settings.json` is required for that discovery

#### Scenario: Installing leaves the repo untouched

- **WHEN** a contributor runs the documented install command from inside the repo checkout
- **THEN** `git status` reports no changes
- **AND** no file is created under `vendor/`
- **AND** `.pi/settings.json` is unmodified

### Requirement: Router lazy-install is documented as expected behaviour

The documentation SHALL state that the `/hyperframes` router installs creation workflows on demand, so that a contributor does not mistake the install step for a fault.

#### Scenario: Routing to an uninstalled workflow installs it

- **WHEN** a contributor invokes `/hyperframes` with a request that routes to a workflow that is not yet installed
- **THEN** the router installs that workflow before entering it
- **AND** `docs/hyperframes.md` describes this as expected behaviour
- **AND** `docs/hyperframes.md` states that author-time network access is required for it

### Requirement: Prerequisites are documented before they fail

The documentation SHALL state every prerequisite that this repo does not already satisfy, so that a contributor learns of them before a render fails.

#### Scenario: FFmpeg requirement is stated

- **WHEN** a contributor reads `docs/hyperframes.md`
- **THEN** the doc states that FFmpeg is required for rendering
- **AND** the doc states that FFmpeg is not installed by this repo's setup and is not present in the `docker/` image
- **AND** the doc describes the failure mode observed when FFmpeg is absent

#### Scenario: Node version requirement is stated and reconciled

- **WHEN** a contributor reads `docs/hyperframes.md`
- **THEN** the doc states the Node.js 22+ requirement
- **AND** the doc notes that this repo's `engines.node` constraint already satisfies it

### Requirement: Trust and reproducibility limitations are stated, not implied

The documentation SHALL disclose that the workflow executes unpinned third-party code with machine-global effect, and that the installed bundle cannot be pinned.

#### Scenario: Security posture is disclosed

- **WHEN** a contributor reads `docs/hyperframes.md`
- **THEN** the doc states that `npx hyperframes` executes third-party code fetched at run time
- **AND** the doc states that skills are installed into a machine-global store affecting every project on that machine, not only this repo

#### Scenario: Version drift is disclosed

- **WHEN** a contributor reads `docs/hyperframes.md`
- **THEN** the doc states that the install command tracks upstream `main`
- **AND** the doc states that no supported version pin exists
- **AND** the doc states that renders are therefore not reproducible across time

### Requirement: Project skill namespace and repo contents stay uncontaminated

The HyperFrames bundle SHALL NOT be copied into the repo, and no rendered output SHALL be committed by this change.

#### Scenario: .pi/skills/ contains only project-authored skills

- **WHEN** an auditor lists `.pi/skills/`
- **THEN** no entry is a HyperFrames skill
- **AND** no entry points, directly or transitively, at an installed HyperFrames skill

#### Scenario: No vendored copy and no media in version control

- **WHEN** an auditor inspects the repo tree after this change
- **THEN** no copy of the upstream `skills/` tree exists in version control
- **AND** no update script for such a copy exists
- **AND** no rendered video, composition, or media asset was committed

### Requirement: Documentation is reachable through existing conventions

The topic doc SHALL be recorded in the directory `AGENTS.md` tree, and the root `AGENTS.md` SHALL be left unchanged.

#### Scenario: Topic doc exists and is indexed

- **WHEN** a contributor runs `kb agents docs/hyperframes.md`
- **THEN** `docs/hyperframes.md` exists
- **AND** `docs/AGENTS.md` carries a row for it
- **AND** that row's purpose field follows caveman style

#### Scenario: Root AGENTS.md is unchanged

- **WHEN** a contributor diffs the root `AGENTS.md`
- **THEN** the file is unmodified by this change
