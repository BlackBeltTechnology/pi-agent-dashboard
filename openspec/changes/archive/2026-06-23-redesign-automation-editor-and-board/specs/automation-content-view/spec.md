# automation-content-view — delta

## MODIFIED Requirements

### Requirement: Create Automation entry point

The dashboard SHALL present a "Create Automation" action reachable from the folder Automations entry. The folder Automations row SHALL expose a "+ New" action that opens the create editor directly, and the board SHALL also expose a "Create Automation" action. Activating either SHALL open an editor for the trigger, action (prompt or skill), model (direct via `ModelSelector` or `@role` via role dropdown), scope (`folder` | `global`), `mode`, and `concurrency`, and SHALL write `automation.yaml` (and `prompt.md` for prompt actions) to the chosen scope.

The editor SHALL organize fields into labeled groups — Identity (name, scope), Trigger, Action, and a collapsed Advanced group (`mode`, `sandbox`, `concurrency`, `visibility`) — each Advanced field carrying inline help text. The Model input SHALL be the `ModelSelector` control plus an `@role` dropdown, NOT a free-text field. The Trigger group SHALL render the trigger-type picker (see `automation-trigger-registry`); for the `schedule` kind it SHALL show a human-readable schedule helper (interval/day/time) with a raw-cron escape hatch and a display-only next-run preview computed from the cron expression.

#### Scenario: Create from sidebar without opening board

- **WHEN** a user activates the "+ New" action on the folder Automations row
- **THEN** the create editor SHALL open without first navigating to the board.

#### Scenario: Editor groups fields with Advanced collapsed

- **WHEN** the editor opens
- **THEN** Identity, Trigger, and Action groups SHALL be visible and the Advanced group (mode/sandbox/concurrency/visibility) SHALL be collapsed by default and expandable.

#### Scenario: Model chosen via selector not free text

- **WHEN** a user sets the model
- **THEN** the editor SHALL offer the `ModelSelector` control and an `@role` dropdown, and SHALL write the chosen model id (or `@role`) to `automation.yaml`.

#### Scenario: Schedule helper shows next-run preview

- **WHEN** the `schedule` trigger is selected with a valid cron
- **THEN** the editor SHALL display the next computed fire time as a preview, and SHALL still write the raw cron to `on.cron`.

#### Scenario: Create writes to chosen scope

- **WHEN** a user creates an automation with scope `global`
- **THEN** `~/.pi/automation/<name>/automation.yaml` SHALL be written and the automation SHALL appear with scope `global`.

#### Scenario: Prompt action writes prompt.md

- **WHEN** a user creates a `prompt` automation
- **THEN** a `prompt.md` SHALL be written next to `automation.yaml` and referenced by `action.prompt`.

### Requirement: Triage run list

The Automation view SHALL list runs with status (`running` | `done` | `error`) and surface findings. Auto-archived empty runs SHALL be filterable out of the default (unread) view. Each run row SHALL show its run id, a findings summary, a relative timestamp, and a link to open the run's `result.md` (or log when errored).

#### Scenario: Findings surfaced in Triage

- **WHEN** a run completes with findings
- **THEN** the run SHALL appear in Triage as unread with its `result.md` viewable via a per-row link.

#### Scenario: Empty runs hidden by default

- **WHEN** the user views the default Triage list
- **THEN** auto-archived empty runs SHALL NOT appear unless the user switches to the all-runs filter.

## ADDED Requirements

### Requirement: Editor gates worktree mode on git capability and explains sandbox levels

In the Advanced group, the editor SHALL gate the `worktree` mode on the chosen scope/cwd being a git repository. When the target folder is not a git repo, the editor SHALL disable the `worktree` option and select `local`, with a hint explaining the fallback. The editor SHALL present inline help for each `sandbox` level (`read-only` = no writes; `workspace-write` = write inside the workspace only; `full-access` = write anywhere).

#### Scenario: Non-git folder disables worktree

- **WHEN** the chosen scope resolves to a folder that is not a git repository
- **THEN** the editor SHALL disable the `worktree` mode option, select `local`, and show a hint that worktree requires git.

#### Scenario: Git folder allows worktree

- **WHEN** the chosen scope resolves to a git repository
- **THEN** the editor SHALL allow selecting `worktree`.

#### Scenario: Sandbox levels explained inline

- **WHEN** the Advanced group is expanded
- **THEN** the editor SHALL show inline help describing what each `sandbox` level permits.

### Requirement: Board adopts the session-card status visual language

The board SHALL reuse the dashboard's session-status visual primitives so automation cards and run rows read as siblings of session cards. Cards SHALL render a status rail + status dot whose color derives from the same palette (`active`/`idle` green, `running`/`streaming` amber with pulse, `error` red, `ended`/disabled muted) and SHALL use the headless source icon for spawned runs. A running automation card and a running run row SHALL render the animated barber-pole stripe overlay (amber `running` variant); the selected card SHALL render the neon rotating glow ring + rim. Animations SHALL respect `prefers-reduced-motion`.

#### Scenario: Running automation shows amber pulse + stripe overlay

- **WHEN** an automation has a run in `running` state
- **THEN** its card SHALL show the amber status rail/dot (pulsing) and the animated barber-pole stripe overlay, matching a streaming session card.

#### Scenario: Invalid/disabled cards use the muted/red palette

- **WHEN** an automation is invalid (or disabled)
- **THEN** its card SHALL use the red (or muted) status color from the shared palette, not a bespoke style.

#### Scenario: Reduced motion disables animations

- **WHEN** `prefers-reduced-motion: reduce` is set
- **THEN** the stripe and neon-glow animations SHALL be disabled while the static colors remain.

### Requirement: Automation definition cards with per-automation actions

The board SHALL render each discovered automation as a card showing its trigger summary, next-run (for schedule kinds), model, action kind, scope, and enabled state. A valid automation's card SHALL expose actions to Run now, Edit, Enable/Disable, and Delete. An invalid automation's card SHALL show the validation error and SHALL expose only Edit and Delete.

#### Scenario: Valid automation card shows summary and actions

- **WHEN** a valid `schedule` automation renders on the board
- **THEN** its card SHALL show the trigger summary and next-run, and SHALL expose Run now, Edit, Enable/Disable, and Delete actions.

#### Scenario: Invalid automation card surfaces the error

- **WHEN** an automation fails validation
- **THEN** its card SHALL display the parse/validation error and SHALL expose only Edit and Delete (no Run now).

#### Scenario: Run now triggers a single run

- **WHEN** a user activates Run now on a valid automation
- **THEN** exactly one run SHALL be created for that automation, independent of its schedule.

### Requirement: Delete automation from the board

The board SHALL expose a Delete action on each automation card that, after explicit confirmation, removes the automation via the existing `DELETE /api/plugins/automation` route (scope + name). The list SHALL refresh so the deleted automation no longer appears.

#### Scenario: Delete requires confirmation

- **WHEN** a user activates Delete on an automation card
- **THEN** the UI SHALL require an explicit confirmation before calling the delete route.

#### Scenario: Confirmed delete removes the automation

- **WHEN** the user confirms deletion
- **THEN** the `DELETE /api/plugins/automation` route SHALL be called with the automation's scope and name, the `.pi/automation/<name>/` directory SHALL be removed, and the card SHALL disappear from the refreshed list.

### Requirement: Edit automation pre-loaded into the editor

The board SHALL expose an Edit action on each automation card that opens the editor pre-populated from the existing `automation.yaml` (and `prompt.md` for prompt actions). Saving SHALL update the existing automation in place via the update path (see `automation-trigger-registry` update requirement), not create a duplicate. Editing the name SHALL be treated as a rename or SHALL be disabled to avoid orphaning.

#### Scenario: Edit loads existing config

- **WHEN** a user activates Edit on an automation
- **THEN** the editor SHALL open with all fields (trigger, action, model, scope, mode, sandbox, concurrency, visibility) populated from the automation's `automation.yaml`, and the prompt body populated from `prompt.md` for prompt actions.

#### Scenario: Save updates in place

- **WHEN** the user saves an edited automation without changing its name
- **THEN** the existing `automation.yaml`/`prompt.md` SHALL be updated in place and no second automation directory SHALL be created.
