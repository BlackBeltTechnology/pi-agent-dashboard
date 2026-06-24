# automation-content-view Specification

## Purpose
TBD - created by archiving change add-automation-plugin. Update Purpose after archive.
## Requirements
### Requirement: Automation UI contributed via shell slots

The plugin SHALL contribute its UI exclusively through existing dashboard slots and SHALL NOT add Automation-specific conditional rendering to core shell files. It SHALL claim `sidebar-folder-section` (folder nav entry), `shell-overlay-route` (full-page board + run monitor), `session-card-badge` (optional running indicator, predicate-gated), and `settings-section` (scopes + retention + default run visibility config). The board SHALL NOT use the `command-route` slot, whose consumer is not mounted in the shell.

#### Scenario: Folder nav entry rendered via slot

- **WHEN** a folder has N automations
- **THEN** the sidebar SHALL show an "Automations (N) →" entry rendered by the plugin's `sidebar-folder-section` claim, with no core shell branch added.

#### Scenario: Folder nav entry visually mirrors the OpenSpec folder section

- **WHEN** the Automations row and the OpenSpec row render in the same folder card
- **THEN** the Automations row SHALL use the same header anatomy as the OpenSpec row: a 10px uppercase clickable title with count and `→`, a refresh control, and right-aligned action chip(s).

#### Scenario: Board opens via shell-overlay-route

- **WHEN** a user activates the folder "Automations (N) →" entry
- **THEN** the shell SHALL navigate to `/folder/:encodedCwd/automations` and render the board through the plugin's `shell-overlay-route` claim, scoped to the decoded cwd.

#### Scenario: No core branch for automation

- **WHEN** the automation plugin is disabled
- **THEN** the shell SHALL render with no Automation nav entry, board route, badge, or settings section, and no errors.

### Requirement: Create Automation entry point

The dashboard SHALL present a "Create Automation" action reachable from the folder Automations entry. The folder Automations row SHALL expose a "+ New" action that opens the create editor directly, and the board SHALL also expose a "Create Automation" action. Activating either SHALL open an editor for the trigger, action (prompt or skill), model (direct via `ModelSelector` or `@role` via role dropdown), scope (`folder` | `global`), `mode`, and `concurrency`, and SHALL write `automation.yaml` (and `prompt.md` for prompt actions) to the chosen scope.

#### Scenario: Create from sidebar without opening board

- **WHEN** a user activates the "+ New" action on the folder Automations row
- **THEN** the create editor SHALL open without first navigating to the board.

#### Scenario: Create writes to chosen scope

- **WHEN** a user creates an automation with scope `global`
- **THEN** `~/.pi/automation/<name>/automation.yaml` SHALL be written and the automation SHALL appear with scope `global`.

#### Scenario: Prompt action writes prompt.md

- **WHEN** a user creates a `prompt` automation
- **THEN** a `prompt.md` SHALL be written next to `automation.yaml` and referenced by `action.prompt`.

### Requirement: Default run visibility setting

The automation settings section SHALL expose a default run visibility (`hidden` | `shown`, default `hidden`) applied to automations that do not declare their own `visibility`. The create/edit editor SHALL allow setting a per-automation `visibility` override.

#### Scenario: Settings default applied when automation omits visibility

- **WHEN** the settings default is `shown` and an automation omits `visibility`
- **THEN** that automation's runs SHALL appear on the board.

#### Scenario: Editor sets per-automation override

- **WHEN** a user sets `visibility: hidden` for one automation in the editor
- **THEN** `automation.yaml` SHALL record `visibility: hidden` and that automation's runs SHALL stay off the board regardless of the settings default.

### Requirement: Triage run list

The Automation view SHALL list runs with status (`running` | `done` | `error`) and surface findings. Auto-archived empty runs SHALL be filterable out of the default (unread) view. Each run row SHALL show its run id, a **findings count** (the number of findings captured in `result.md`, `0` for auto-archived empty runs), a relative timestamp, and a **status-specific link**: `watch` for a running run, `result` for a completed run with findings, and `log` for an errored run. The running run row SHALL render the barber-pole stripe overlay.

#### Scenario: Findings count surfaced in Triage

- **WHEN** a run completes with N findings
- **THEN** the run row SHALL show "N findings" and a `result` link that opens its `result.md`.

#### Scenario: Empty runs hidden by default

- **WHEN** the user views the default Triage list
- **THEN** auto-archived empty runs SHALL NOT appear unless the user switches to the all-runs filter.

#### Scenario: Running run row shows a watch link and stripe

- **WHEN** a run is in `running` state
- **THEN** its row SHALL show a `watch` link and the animated barber-pole stripe overlay.

### Requirement: Board adopts the session-card status visual language

The board SHALL render each automation as a card that reuses the dashboard's session-status visual language so automation cards read as siblings of session cards. A card SHALL carry a status rail + status dot whose color derives from the shared palette (`active`/`idle` green, `running` amber with pulse, `error` red, disabled/`ended` muted) and SHALL show the headless source icon for spawned runs and status **pill** badges (running / enabled / disabled / invalid). A running automation card SHALL render the animated barber-pole stripe overlay (amber `running` variant); the selected card SHALL render the neon rotating glow + rim. All animations SHALL respect `prefers-reduced-motion`. Because the plugin package does not depend on the client package, it SHALL replicate the small status→class mapping locally and apply the host's already-global FX classes by name (it SHALL NOT import the client's `session-status-visuals` module).

#### Scenario: Running automation shows amber pulse + stripe overlay

- **WHEN** an automation has a run in `running` state
- **THEN** its card SHALL show the amber status rail/dot (pulsing) and the barber-pole stripe overlay, matching a streaming session card.

#### Scenario: Invalid/disabled cards use the shared muted/red palette

- **WHEN** an automation is invalid (or disabled)
- **THEN** its card SHALL use the red (or muted) status color from the shared palette, not a bespoke style.

#### Scenario: Reduced motion disables animations

- **WHEN** `prefers-reduced-motion: reduce` is set
- **THEN** the stripe and neon-glow animations SHALL be disabled while the static status colors remain.

### Requirement: Automation card shows a last-run summary and a Stop action

Each valid automation card SHALL show a last-run summary inline — the latest run's status pill, a relative timestamp, the findings count, and a link to its `result.md` (or log when errored) — derived from the runs already loaded. When the automation has a `running` run, the card SHALL expose a Stop action that aborts that run; otherwise the card SHALL expose Run now. Edit and Delete (with confirmation) SHALL remain available; Delete MAY live under an overflow control.

#### Scenario: Last-run summary rendered on the card

- **WHEN** an automation has at least one prior run
- **THEN** its card SHALL show the latest run's status, relative time, findings count, and result/log link.

#### Scenario: Stop replaces Run now while running

- **WHEN** an automation has a `running` run
- **THEN** the card SHALL show a Stop action (not Run now) that stops that run.

### Requirement: Editor visual presentation

The Create/Edit editor SHALL present its grouped fields in bordered group boxes (Identity / Trigger / Action / collapsed Advanced), SHALL use segmented controls for Scope (`folder` | `global`) and Action kind (`prompt` | `skill`), SHALL render the schedule next-run preview as a relative duration with a pulsing status dot, and SHALL show the scope/path subtitle plus an "armed on save" status chip in the header and a footer caption naming the files written.

#### Scenario: Grouped boxes with segmented Scope/Action

- **WHEN** the editor opens
- **THEN** Identity/Trigger/Action SHALL render as bordered group boxes and Scope and Action kind SHALL be segmented controls.

#### Scenario: Next-run shown as a relative duration

- **WHEN** the `schedule` trigger has a valid cron
- **THEN** the next-run preview SHALL show the time until the next fire with a pulsing status dot.

