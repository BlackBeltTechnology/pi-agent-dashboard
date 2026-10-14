## MODIFIED Requirements

### Requirement: Project-init MAY initialize OpenSpec for coding profiles

When the selected profile is `coding` (an OpenSpec-enabled profile), the skill SHALL determine the target's OpenSpec state and act per this table:

| Condition (first match wins) | Mode | Action |
|---|---|---|
| Dashboard config exists but cannot be read or parsed, or a present OpenSpec setting has the wrong type | `skip` | No prompt, no command; warn that OpenSpec state could not be determined. |
| OpenSpec disabled in the dashboard config, or the target listed in its OpenSpec opt-out directories | `skip` | No prompt, no command; note that OpenSpec is disabled/opted out for this directory. |
| Target is inside a git repository AND (git placement cannot be determined, OR it is a linked worktree — its canonical git dir differs from its canonical git common dir — OR it is not the checkout's top-level directory) | `skip` | No prompt, no command; note why (inherited from main checkout / not the checkout root / git placement undetermined). |
| `openspec/` absent, and the dashboard config sets OpenSpec's fleet-level initialization offer to off | `skip` | No prompt, no command. |
| `openspec/` absent | `offer` | Opt-in `ask_user` (confirm). On confirmation run `openspec init --tools pi`. |
| `openspec/` present, `.pi/skills/openspec-explore/` absent | `repair` | No question. Disclose the repair in the pre-write preview, then run `openspec init --tools pi` after the user confirms the preview. |
| both present | `skip` | No prompt, no command. |

An ABSENT dashboard config, or an absent OpenSpec setting within it, SHALL take the dashboard default (enabled, no opt-outs, offer on). Opt-out matching SHALL use the same path normalization the dashboard uses for opt-out directories (normalized separators and trailing separators, case-insensitive except on Linux), applied to the target's absolute path. A target that is not inside a git repository SHALL NOT be skipped by the git-placement row.

The pre-write preview's confirmation SHALL serve as the explicit confirmation for the `repair` mode's overwrite: the repair SHALL NOT run unless the user confirmed the preview that disclosed it.

The `repair` mode covers a directory initialized for OpenSpec but never wired into pi; the user already chose OpenSpec for it (and has not opted it out), so the skill SHALL complete the wiring rather than ask again.

For both `offer` and `repair`, the pre-write preview SHALL disclose the command's side effects: generated `openspec-*` skills under `.pi/skills/` are written (overwriting existing ones of the same name), and — when legacy OpenSpec wiring is detected using the same legacy-artifact rules as the dashboard's OpenSpec initialization endpoint (root agent-config files containing both OpenSpec marker comments; the legacy OpenSpec command directories; `openspec-`/`opsx-` prefixed files in the legacy command-file directories) — that those marker blocks may be removed and those legacy commands may be deleted, naming each detected path; that the OpenSpec CLI may additionally remove other legacy OpenSpec files it recognizes; and that it may migrate OpenSpec's global configuration.

Both `offer` and `repair` SHALL run `openspec init --tools pi --force`. Every OpenSpec command SHALL be run non-interactively so it never hijacks the session's conversation. After the command the skill SHALL verify exit 0 AND that `.pi/skills/openspec-explore/` now exists. A non-zero exit, a missing `openspec` binary, or a still-missing skills directory SHALL warn the user — listing what `.pi/skills/` actually contains — without failing the scaffold. Non-coding / OpenSpec-off profiles SHALL NOT offer, repair, or run any OpenSpec step.

#### Scenario: Coding profile offers OpenSpec init

- **GIVEN** the user selected the `coding` profile and no `openspec/` directory exists
- **WHEN** the skill runs
- **THEN** it SHALL ask whether to initialize OpenSpec
- **AND** on confirmation SHALL run it non-interactively and verify success

#### Scenario: OpenSpec present but not wired into pi is repaired without a prompt

- **GIVEN** the user selected the `coding` profile
- **AND** `openspec/` exists but `.pi/skills/openspec-explore/` does not
- **AND** the directory is not opted out and OpenSpec is enabled
- **WHEN** the skill runs
- **THEN** it SHALL NOT ask whether to initialize OpenSpec
- **AND** the pre-write preview SHALL list the OpenSpec repair and its side effects
- **AND** after the preview is confirmed it SHALL run that command non-interactively
- **AND** it SHALL verify `.pi/skills/openspec-explore/` exists afterwards

#### Scenario: Opted-out directory is never repaired

- **GIVEN** `openspec/` exists, `.pi/skills/openspec-explore/` does not, and the directory is listed in the dashboard's OpenSpec opt-out directories
- **WHEN** the skill runs
- **THEN** it SHALL NOT prompt for or run any OpenSpec command

#### Scenario: Unreadable dashboard config fails closed

- **GIVEN** `openspec/` exists, `.pi/skills/openspec-explore/` does not, and the dashboard config file exists but is not valid JSON
- **WHEN** the skill runs
- **THEN** it SHALL NOT run any OpenSpec command
- **AND** it SHALL warn that OpenSpec state could not be determined

#### Scenario: Fleet offer switch suppresses the offer but not the repair

- **GIVEN** the dashboard config sets OpenSpec's initialization offer to off
- **WHEN** the skill runs in a directory with no `openspec/`
- **THEN** it SHALL NOT ask to initialize OpenSpec
- **AND WHEN** it runs in a directory with `openspec/` but without `.pi/skills/openspec-explore/`
- **THEN** the repair SHALL still be disclosed and run

#### Scenario: Git placement gates the OpenSpec step

- **WHEN** the target is a linked git worktree, or a subdirectory of a checkout, or inside a repository whose git placement cannot be determined
- **THEN** the skill SHALL NOT run any OpenSpec command
- **AND WHEN** the target is a checkout's top-level directory or a non-git directory
- **THEN** git placement SHALL NOT cause a skip

#### Scenario: Legacy wiring cleanup is disclosed

- **GIVEN** the `offer` or `repair` mode applies
- **AND** the root `AGENTS.md` contains both `<!-- OPENSPEC:START -->` and `<!-- OPENSPEC:END -->` markers
- **WHEN** the pre-write preview is shown
- **THEN** it SHALL name `AGENTS.md` and state that the marker block may be removed by the OpenSpec command

#### Scenario: OpenSpec init skipped when already initialized

- **WHEN** both `openspec/` and `.pi/skills/openspec-explore/` exist in the target
- **THEN** the skill SHALL NOT prompt for or run any OpenSpec command

#### Scenario: Repair failure does not fail the scaffold

- **GIVEN** the repair path was taken
- **WHEN** the OpenSpec command exits non-zero, or `.pi/skills/openspec-explore/` is still missing afterwards
- **THEN** the skill SHALL warn the user, listing the actual contents of `.pi/skills/`
- **AND** the rest of the scaffold SHALL remain written

#### Scenario: Non-coding profile never offers OpenSpec init

- **WHEN** a `docs` (or any OpenSpec-off) profile is selected
- **THEN** the skill SHALL NOT offer, repair, or run `openspec init`
