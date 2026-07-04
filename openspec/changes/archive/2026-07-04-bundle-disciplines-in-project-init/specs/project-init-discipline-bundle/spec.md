## ADDED Requirements

### Requirement: The coding profile scaffolds discipline doctrine

The `project-init` `coding` profile SHALL write the discipline-checkpoint table and the `## Discipline Skills` proposal convention into the scaffolded `AGENTS.md`.

#### Scenario: Scaffolded AGENTS.md carries the checkpoint table

- **WHEN** a bare directory is initialized with the `coding` profile
- **THEN** the written `AGENTS.md` contains a discipline-checkpoint table mapping task signals to `eng-disciplines` skills
- **AND** it contains the `## Discipline Skills` proposal-authoring convention
- **AND** the block sits adjacent to the `## OpenSpec` section

#### Scenario: Docs profile is unaffected

- **WHEN** a directory is initialized with the `docs` profile
- **THEN** no discipline-checkpoint table is written
- **AND** no discipline-skill install is offered

### Requirement: Init detects and offers to install the discipline skills

When the `coding` profile is chosen, `project-init` SHALL detect whether the `eng-disciplines` package is installed globally and, if absent, offer to install it user-globally — never forcing the install.

#### Scenario: Absent skills trigger an opt-in prompt

- **WHEN** the `coding` profile is selected
- **AND** `@blackbelt-technology/pi-dashboard-eng-disciplines` is not installed globally
- **THEN** the user is asked (via `ask_user`) whether to install it
- **AND** on consent the step runs `pi install npm:@blackbelt-technology/pi-dashboard-eng-disciplines`
- **AND** the install targets user-global settings, not the scaffolded project

#### Scenario: Present skills skip the prompt

- **WHEN** the `coding` profile is selected
- **AND** the package is already installed globally
- **THEN** no install prompt is shown
- **AND** init proceeds without a redundant install

#### Scenario: The install is disclosed before confirmation

- **WHEN** the planned writes are previewed in Step 3
- **THEN** the preview discloses that a global `pi install` may be offered if the skills are missing

### Requirement: Decline and failure degrade gracefully

Declining the install, an install failure, or a missing `pi` binary SHALL NOT break init or leave the checkpoint table as dead references.

#### Scenario: Decline still writes usable doctrine

- **WHEN** the user declines the install
- **THEN** the scaffolded `AGENTS.md` is still written with the checkpoint table
- **AND** it carries a footnote naming the `pi install` command to activate the skills later
- **AND** init completes successfully

#### Scenario: Missing pi binary is tolerated

- **WHEN** detection cannot run because `pi` is not on PATH
- **THEN** the step is skipped
- **AND** the activation footnote remains as the path forward
- **AND** init does not error

### Requirement: Publication is a prerequisite

The install command SHALL only be referenced once the package is installable from npm.

#### Scenario: Publication verified before referencing install

- **WHEN** this change is implemented
- **THEN** `npm view @blackbelt-technology/pi-dashboard-eng-disciplines version` returns a version
- **AND** if it does not, publishing the package is treated as a blocking predecessor
