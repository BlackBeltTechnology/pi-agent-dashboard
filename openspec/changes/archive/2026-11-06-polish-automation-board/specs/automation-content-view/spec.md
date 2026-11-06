# Spec Delta: automation-content-view

## MODIFIED Requirements

### Requirement: Triage run list

The Automation view SHALL list each automation's runs **under that automation's card** as a collapsible run history, instead of in one detached table. Runs SHALL be attributed to an automation by scope and name together, so a folder automation and a global automation with the same name keep separate histories. The history SHALL show the latest 3 runs by default and SHALL offer a control that expands it to all retained runs. Each run row SHALL show:

- the status (`running` | `done` | `error` | `stopped` | `orphaned`) as a pill carrying a word, not colour alone;
- a human-readable start label: "Today <time>", "Yesterday <time>", or a short date plus time for anything older, with the time in the browser locale's hour-and-minute format and the full run id available as a tooltip;
- the duration ("Ns" under a minute, "Nm Ss" under an hour, "Hh MMm" from an hour on; suffixed "so far" while running), or the error or stop reason when the run did not complete;
- a findings chip, **only when** the findings count is greater than 0;
- an **Open session** link whenever the run has a session id;
- a status-specific secondary link for a non-parent run: **Monitor** for a running or orphaned run, **Result** for a `done` or `stopped` run, **Log** for an errored run. A parent row has no result of its own; it expands to its children instead.

The `orphaned`, connectivity and scope facts shown on rows and cards SHALL come from the server listing, never from values stored in the run record.

Open session SHALL navigate to the run's session view. For any run other than one the engine is still tracking, it SHALL use a view that works whether or not the session has been archived, never a dead link. Monitor SHALL navigate to the run-monitor route for that run. Result and Log SHALL show the run's `result.md` rendered as markdown. Auto-archived empty runs SHALL stay hidden unless the user enables "Show archived". A parent run SHALL be one history row that expands to its child rows, and each child row SHALL carry its own action label, status, and Open session link.

#### Scenario: Findings count surfaced in Triage

- **WHEN** a run completes with N findings and N > 0
- **THEN** its history row SHALL show an "N findings" chip and a Result link that renders its `result.md` as markdown
- **AND WHEN** a run completes with 0 findings
- **THEN** its row SHALL NOT show a findings chip.

#### Scenario: Empty runs hidden by default

- **WHEN** the user views an automation's run history with "Show archived" off
- **THEN** auto-archived empty runs SHALL NOT appear.

#### Scenario: Run row navigates to its session

- **WHEN** the user activates Open session on a run row whose run has a session id
- **THEN** the dashboard SHALL navigate to that session's view
- **AND** if the session is archived, SHALL open it in the archived session view.

#### Scenario: Running run row shows a watch link and stripe

- **WHEN** a run is `running`
- **THEN** its row SHALL show "N m so far" and a Monitor link (formerly labelled `watch`) that navigates to the run-monitor route for that run
- **AND** its status pill SHALL carry the animated running indicator (honouring `prefers-reduced-motion`).

#### Scenario: Same-named automations keep separate histories

- **WHEN** a folder automation and a global automation share a name and both have runs
- **THEN** each card SHALL show only the runs of its own scope.

#### Scenario: Stopped run offers its result

- **WHEN** a run is `stopped`
- **THEN** its row SHALL show the stop reason and a Result link.

#### Scenario: History collapses to the latest three runs

- **WHEN** an automation has more than 3 visible runs
- **THEN** its history SHALL show the 3 most recent runs and a control to show all runs.

#### Scenario: Labels switch to a date after Yesterday

- **WHEN** a run started two calendar days ago
- **THEN** its label SHALL be a short date plus time, not a weekday.

#### Scenario: Hour-long durations drop seconds

- **WHEN** a finished run took 1 hour, 5 minutes and 12 seconds
- **THEN** its duration SHALL read "1h 05m".

#### Scenario: Raw run id is not the row label

- **WHEN** a run row is rendered
- **THEN** its visible label SHALL be the human start label, and the full run id SHALL be available only as a tooltip.

### Requirement: Automation card shows a last-run summary and a Stop action

Each valid automation card SHALL show a last-run summary inline, derived from the runs already loaded: the latest run's status pill, its human start label and duration, a findings chip when the count is above 0, an **Open session** link when the run has a session id, and a Monitor, Result or Log link chosen by status. When the automation has a `running` or `orphaned` run, the card SHALL expose a **Stop** action for that run; otherwise it SHALL expose **Run now**. **Edit** SHALL be a visible card action (not inside the overflow control), and activating the automation's name SHALL also open the editor. Delete (with confirmation) SHALL remain available under the overflow control. The overflow control's menu SHALL render in a body-mounted portal (via the `ui:popover` primitive) so the card's `overflow-hidden` clip does not hide it, and SHALL dismiss on outside click or Esc.

When the latest run is `orphaned`, the card SHALL show an **orphaned** status pill and a warning notice. The notice SHALL state that the run is no longer tracked (for example because the server restarted while it was running), that its completion was not recorded, and whether its session is still connected, and SHALL link to the session.

#### Scenario: Last-run summary rendered on the card

- **WHEN** an automation has at least one prior run
- **THEN** its card SHALL show the latest run's status, human start label, duration, an Open session link when a session id exists, and the status-specific Monitor/Result/Log link.

#### Scenario: Stop replaces Run now while running

- **WHEN** an automation has a `running` run
- **THEN** the card SHALL show a Stop action (not Run now) that stops that run.

#### Scenario: Orphaned run is named and stoppable

- **WHEN** an automation's latest run is reported `orphaned`
- **THEN** the card SHALL show an orphaned pill, a warning notice explaining that the run is no longer tracked, and a Stop action.

#### Scenario: Edit is directly reachable

- **WHEN** a valid automation card is rendered
- **THEN** an Edit action SHALL be visible on the card without opening the overflow menu
- **AND** activating the automation's name SHALL open the same editor.

#### Scenario: Overflow menu is visible over the card when opened

- **WHEN** a user activates the `⋯` overflow control on an automation card
- **THEN** the Delete action SHALL render in a portal anchored to the control, positioned so the card's `overflow-hidden` container does not clip it, and SHALL stay in the viewport when the card sits near a viewport or scroll-container edge.

#### Scenario: Overflow menu dismisses on outside click or Esc

- **WHEN** the overflow menu is open
- **AND** the user clicks outside the menu and its trigger, or presses Esc
- **THEN** the menu SHALL close without invoking Delete.

### Requirement: Board adopts the session-card status visual language

The board SHALL render each automation as a card that reuses the dashboard's session-status visual language, so automation cards read as siblings of session cards. A card SHALL carry a status rail and status dot. Their colour comes from the theme's status and severity tokens: enabled/idle as success, running as warning with a pulse, orphaned as warning, error/invalid as error, and disabled/ended as muted. The card SHALL show the headless source icon for spawned runs and status **pill** badges (running / orphaned / enabled / disabled / invalid), each carrying a word, not colour alone. A running automation SHALL render the animated barber-pole stripe on its status rail and running pill, not across the whole card. The selected card SHALL render the neon rotating glow and rim. All animations SHALL respect `prefers-reduced-motion`. Because the plugin package does not depend on the client package, it SHALL replicate the small status-to-class mapping locally and apply the host's already-global FX classes by name. It SHALL NOT import the client's `session-status-visuals` module.

#### Scenario: Running automation shows amber pulse + stripe overlay

- **WHEN** an automation has a run in `running` state
- **THEN** its status rail and dot SHALL pulse in the running colour and the barber-pole stripe SHALL animate on the rail and running pill, while the card body stays unstriped.

#### Scenario: Invalid/disabled cards use the shared muted/red palette

- **WHEN** an automation is invalid (or disabled)
- **THEN** its card SHALL use the error (or muted) status token, not a bespoke style.

#### Scenario: Reduced motion disables animations

- **WHEN** `prefers-reduced-motion: reduce` is set
- **THEN** the stripe and neon-glow animations SHALL be disabled while the static status colours remain.

## ADDED Requirements

### Requirement: Board colours and sizing follow the theme contract

The Automations board SHALL take every colour from the dashboard theme tokens (status and severity tint tokens), so it follows every palette in light and dark mode, and SHALL contain no raw colour literals. Card actions SHALL meet the dashboard's minimum button target size.

#### Scenario: Colours follow the active theme

- **WHEN** the user switches between palettes or between light and dark mode
- **THEN** every status pill, rail, notice and button on the board SHALL take its colour from the active theme's tokens.

### Requirement: Board text is human-readable

The board SHALL show schedules in human-readable form, with the raw cron expression available on hover, and SHALL fall back to the raw cron when an expression cannot be humanised. It SHALL show the next fire relative to now ("today <time>", "tomorrow <time>", else a short date plus time, in the browser locale), summarise a `flows.run` action by its flow name, and, for a folder with no automations, show a short explanation of automations and a Create Automation action.

#### Scenario: Schedule is humanised with cron on hover

- **WHEN** an automation's trigger is the schedule `20 9 * * *`
- **THEN** its card SHALL read "Daily at 09:20"
- **AND** the raw cron SHALL be available on hover.

#### Scenario: Unhumanisable cron falls back to raw text

- **WHEN** a schedule expression has no human-readable rendering
- **THEN** the card SHALL show the raw cron expression.

#### Scenario: Next fire is relative

- **WHEN** an automation next fires tomorrow at 09:20
- **THEN** its card SHALL read "next tomorrow 09:20".

#### Scenario: Empty folder explains automations

- **WHEN** a folder has no automations
- **THEN** the board SHALL show an explanation of automations and a Create Automation action.
