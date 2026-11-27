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

### Requirement: Default run visibility setting

The automation settings section SHALL expose a default run visibility (`hidden` | `shown`, default `hidden`) applied to automations that do not declare their own `visibility`. The create/edit editor SHALL allow setting a per-automation `visibility` override.

#### Scenario: Settings default applied when automation omits visibility

- **WHEN** the settings default is `shown` and an automation omits `visibility`
- **THEN** that automation's runs SHALL appear on the board.

#### Scenario: Editor sets per-automation override

- **WHEN** a user sets `visibility: hidden` for one automation in the editor
- **THEN** `automation.yaml` SHALL record `visibility: hidden` and that automation's runs SHALL stay off the board regardless of the settings default.

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

### Requirement: Board adopts the session-card status visual language

The board SHALL render each automation as a card that reuses the dashboard's session-status visual language, so automation cards read as siblings of session cards. A card SHALL carry a status rail and status dot. Their colour comes from the theme's status and severity tokens: enabled/idle as success, running as warning with a pulse, orphaned as warning, error/invalid as error, and disabled/ended as muted. The card SHALL show the headless source icon for spawned runs and status **pill** badges (running / orphaned / enabled / disabled / invalid), each carrying a word, not colour alone. A running automation SHALL render the animated barber-pole stripe on its status rail and running pill, not across the whole card. The selected card SHALL use the ui-contract selected-chip recipe instead of the session card's neon FX: an `--accent` border, an `--accent-soft` fill on its header row only (the card body keeps `--bg-secondary`), a bold automation name, and `aria-current="true"`. The selected card SHALL NOT render the host glow or ring FX layers, and unselected cards SHALL NOT carry `aria-current`. All animations SHALL respect `prefers-reduced-motion`. Because the plugin package does not depend on the client package, it SHALL replicate the small status-to-class mapping locally and apply the host's already-global FX classes by name. It SHALL NOT import the client's `session-status-visuals` module.

#### Scenario: Running automation shows amber pulse + stripe overlay

- **WHEN** an automation has a run in `running` state
- **THEN** its status rail and dot SHALL pulse in the running colour and the barber-pole stripe SHALL animate on the rail and running pill, while the card body stays unstriped.

#### Scenario: Invalid/disabled cards use the shared muted/red palette

- **WHEN** an automation is invalid (or disabled)
- **THEN** its card SHALL use the error (or muted) status token, not a bespoke style.

#### Scenario: Reduced motion disables animations

- **WHEN** `prefers-reduced-motion: reduce` is set
- **THEN** the stripe animation SHALL be disabled while the static status colours remain.

#### Scenario: Selected card uses the selector style, not neon

- **WHEN** the user clicks an automation card
- **THEN** that card SHALL carry an `--accent` border, an `--accent-soft` header row, a bold name and `aria-current="true"`, and SHALL contain no glow or ring FX layer.

#### Scenario: Selection moves between cards

- **WHEN** one card is selected and the user clicks a different card
- **THEN** only the newly clicked card SHALL carry `aria-current="true"` and the selected styling; the previous card SHALL return to the `--border-secondary` border with no header fill.

#### Scenario: Selected running card keeps its stripe

- **WHEN** the selected card's automation has a running run
- **THEN** the rail and running-pill stripe SHALL still render, and the selection SHALL add no animated layer.

#### Scenario: Card body text keeps contrast when selected

- **WHEN** a card is selected
- **THEN** its body (schedule, last-run line, run history and their `--accent-text` links) SHALL stay on `--bg-secondary`, and only the header row SHALL paint `--accent-soft`, behind content drawn in `--text-primary` or `--text-secondary`, or on its own opaque pill, badge or button background.

### Requirement: Automation card shows a last-run summary and a Stop action

Each valid automation card that is not editing SHALL show a last-run summary inline, derived from the runs already loaded: the latest run's status pill, its human start label and duration, a findings chip when the count is above 0, an **Open session** link when the run has a session id, and a Monitor, Result or Log link chosen by status. When the automation has a `running` or `orphaned` run, the card SHALL expose a **Stop** action for that run; otherwise, while the card is not editing, it SHALL expose **Run now**. **Edit** SHALL be a visible card action (not inside the overflow control); activating Edit or the automation's name SHALL expand that card into the inline editor, and activating the trigger summary SHALL do the same with focus on the Trigger section. While the card is editing, Edit SHALL read **Close editor** and SHALL collapse the editor; the Stop action and the orphaned-run notice SHALL stay visible, while Run now, Enable/Disable, the last-run summary and the run history SHALL be hidden until the editor closes. Delete (with confirmation) SHALL remain available under the overflow control. The overflow control's menu SHALL render in a body-mounted portal (via the `ui:popover` primitive) so the card's clip does not hide it, and SHALL dismiss on outside click or Esc.

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
- **AND** activating the automation's name SHALL expand the same inline editor in that card.

#### Scenario: Editing card hides Run now and Disable

- **GIVEN** an idle, enabled automation
- **WHEN** its card is editing
- **THEN** Run now and Disable SHALL NOT render on that card, and SHALL render again after the editor closes

#### Scenario: Edit expands the card in place

- **WHEN** the user activates Edit on a card
- **THEN** the editor SHALL render inside that card, below its header and summary, with no modal dialog or backdrop
- **AND** the button SHALL read "Close editor" with `aria-expanded="true"`
- **AND** focus SHALL move to the first control of the Trigger section

#### Scenario: Trigger summary opens the editor on Trigger

- **WHEN** the user activates a card's trigger summary
- **THEN** the card SHALL expand into the editor with focus inside the Trigger section

#### Scenario: Close editor restores the card and focus

- **WHEN** the user activates "Close editor" or Cancel on a clean editor
- **THEN** the card SHALL collapse back to its summary, last-run line and run history
- **AND** focus SHALL return to the control that opened the editor

#### Scenario: Overflow menu is visible over the card when opened

- **WHEN** a user activates the `⋯` overflow control on an automation card
- **THEN** the Delete action SHALL render in a portal anchored to the control, positioned so the card's clipping container does not clip it, and SHALL stay in the viewport when the card sits near a viewport or scroll-container edge.

#### Scenario: Overflow menu dismisses on outside click or Esc

- **WHEN** the overflow menu is open
- **AND** the user clicks outside the menu and its trigger, or presses Esc
- **THEN** the menu SHALL close without invoking Delete.

### Requirement: Automation overlay routes SHALL declare back-navigation depth

The Automations plugin's two `shell-overlay-route` claims SHALL declare a `depth` (and `parentPath` where applicable) so the shell's global depth-aware back action resolves them instead of treating them as the card list (depth 0) and no-opping.

- The board route `/folder/:encodedCwd/automations` SHALL declare `depth: 1`. Its back target SHALL be `/` (cards).
- The run-monitor route `/automation/run/:sid` SHALL declare `depth: 2` and `parentPath: "/folder/:encodedCwd/automations"`. Because the run URL cannot supply `:encodedCwd`, `computeParent` degrades to `/`; the run monitor's back SHALL instead return to its **launching route** via the shell's tracked-predecessor `history.back()` fast-path — the board when opened from the board, the session when opened from a session.

The board and run-monitor back controls SHALL continue to invoke the shell-provided `onBack` callback; no plugin-local back logic SHALL be added. Because these routes are reached via wouter's raw `useLocation` (a direct history mutation that bypasses the app's wrapped `navigate`), the nav tracker's `history.pushState`/`replaceState` observation is what records the launching route so the fast-path can return to it (see `url-routing`).

#### Scenario: Board back returns to cards
- **GIVEN** the user opened the Automations board at `/folder/<encoded cwd>/automations`
- **WHEN** the user activates the board back control
- **THEN** the app SHALL navigate to `/` (cards)
- **AND** the back control SHALL NOT be a no-op

#### Scenario: Run monitor back returns to the board it was opened from
- **GIVEN** the user opened a run monitor at `/automation/run/<sid>` from the board for cwd `/Users/u/proj` (a raw `history.pushState` recorded by the tracker)
- **WHEN** the user activates the depth-aware back action
- **THEN** the shell SHALL invoke `window.history.back()` returning to `/folder/<encoded /Users/u/proj>/automations`
- **AND** SHALL NOT navigate to `/` or to an unrelated route

#### Scenario: Run monitor back returns to the launching session
- **GIVEN** the user opened a run monitor at `/automation/run/<sid>` directly from a session `/session/abc` (depth 1)
- **WHEN** the user activates the depth-aware back action
- **THEN** the shell SHALL invoke `window.history.back()` returning to `/session/abc`
- **AND** SHALL NOT navigate to `/` or to the board

#### Scenario: Legacy manifest without depth still backs to cards
- **GIVEN** an automation manifest whose `shell-overlay-route` board claim omits `depth`
- **WHEN** the user activates the board back control
- **THEN** the route SHALL resolve to `depth 2` by default and the back action SHALL navigate to `/`
- **AND** the back control SHALL NOT be a dead no-op

### Requirement: Default model is chosen through the shared model picker

The automation settings section SHALL present the configured default model (the
fallback used when an `@role` cannot be resolved) through the shared model
picker over the dashboard's known model catalogue, not as free-text input. The
stored value SHALL remain a `provider/model-id` string; an empty string SHALL
continue to mean "no default model configured", and the user SHALL be able to
return to that state. A stored value absent from the catalogue SHALL still be
displayed as the current selection until the user picks another model or
clears it.

#### Scenario: Picking a default model

- **WHEN** the user opens the default-model control on the Automation settings
  page and selects `anthropic/claude-opus-4-7`
- **THEN** the automation settings SHALL store `"anthropic/claude-opus-4-7"` as
  the default model

#### Scenario: Free text is not accepted

- **WHEN** the user interacts with the default-model control
- **THEN** there SHALL be no way to submit a model id that is not in the
  catalogue

#### Scenario: Default model can be cleared

- **GIVEN** a default model is set
- **WHEN** the user activates the clear affordance next to the control
- **THEN** the automation settings SHALL store `""` as the default model

#### Scenario: Stale stored value remains visible

- **GIVEN** the automation config has loaded with default model `"gone/model"`
  which is not in the catalogue
- **WHEN** the Automation settings page renders
- **THEN** the control SHALL display `gone/model` as the current selection

#### Scenario: Catalogue arriving after mount populates the picker

- **GIVEN** the Automation settings page mounted before the roles catalogue was
  received
- **WHEN** the catalogue arrives
- **THEN** the default-model control SHALL list those models without a page
  reload

#### Scenario: Picker shows favorites

- **GIVEN** `"anthropic/claude-opus-4-7"` is favorited
- **WHEN** the default-model control opens
- **THEN** that model SHALL show a filled ★ toggle

### Requirement: Role-backed model states what follows the role
When a role is selected as the automation's model, the editor SHALL show the trigger through the shared role-ref display and, below it, the hint (`data-testid="create-model-role-level-hint"`) "Follows @<role>: model and thinking level change when the role changes. Edit it in Settings → Roles." in 12 px `--text-secondary`.

#### Scenario: Hint names both followed values
- **WHEN** the user picks `@coding` as the automation model
- **THEN** the hint names `@coding` and says that both the model and the thinking level follow the role

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

### Requirement: Automation overlay surfaces scroll their own overflow

The Automations board (`/folder/:encodedCwd/automations`) and the run monitor (`/folder/:encodedCwd/automations/run/:sid`) SHALL each fill their shell-overlay slot (`flex-1 min-h-0`) and be their own single vertical scroll container. All of their content SHALL be reachable when it is taller than the host, without relying on the host to scroll. This conforms to `shell-overlay-route` "Route-backed overlay content SHALL be reachable".

#### Scenario: Long definitions list is reachable on a 13-inch desktop

- **WHEN** a folder has enough automation definitions that the board content is taller than the desktop plugin overlay (viewport 1440x900)
- **THEN** the board root is a vertical scroller (`overflow-y: auto`) whose height is bounded by the overlay
- **AND** scrolling it to the end brings the last definition card fully inside the overlay panel

#### Scenario: Long definitions list is reachable on mobile

- **WHEN** the same folder's Automations board opens at a mobile viewport
- **THEN** the board scrolls within the detail panel and its last definition card can be reached

#### Scenario: Exactly one vertical scroller

- **WHEN** the board shows tall content
- **THEN** the panel contains exactly one overflowing vertical scroller (the board root)

#### Scenario: Short list does not produce a scrollbar

- **WHEN** a folder has a single automation definition
- **THEN** the board content fits, and the board root does not overflow (no scrollbar is shown)

#### Scenario: Run monitor scrolls its own overflow

- **WHEN** the run monitor shows a findings block taller than its host
- **THEN** the run monitor root is a vertical scroller bounded by the host, and the end of the findings block can be reached

### Requirement: Automation overlay Back stays visible while scrolling

The header row that holds the Back control on the Automations board and on the run monitor SHALL stay visible while the content scrolls, because Back is the dismiss affordance of the flush plugin overlay.

#### Scenario: Back stays reachable while scrolled

- **WHEN** the board (or run monitor) has been scrolled to the end
- **THEN** its Back control (`automation-board-back` / `automation-run-monitor-back`) is still inside the visible panel area and can be activated without scrolling back up

### Requirement: Automation overlay roots do not scroll horizontally

Neither the board root nor the run monitor root SHALL scroll horizontally. Long names truncate. Wide markdown in the run monitor's findings SHALL scroll horizontally inside its own wrapper.

#### Scenario: Long folder or automation name does not widen the board

- **WHEN** the board shows tall content and a long folder name or automation name
- **THEN** the board root's `scrollWidth` does not exceed its `clientWidth`

#### Scenario: Wide findings markdown does not scroll the run monitor root

- **WHEN** the findings block contains a markdown table or code block wider than the panel
- **THEN** the run monitor root's `scrollWidth` does not exceed its `clientWidth`
- **AND** the wide content can be reached by scrolling horizontally inside the findings wrapper

### Requirement: Board distinguishes loading, error and empty

The Automation board SHALL show a loading state until its definitions fetch settles, an error state with Retry when it fails (network error or non-2xx), and the empty state only when it succeeds with zero definitions. The board chrome SHALL render in every state.

#### Scenario: Pending fetch shows loading
- **WHEN** the board mounts and the definitions request has not settled
- **THEN** the list area SHALL show a loading indicator (`data-testid="automation-loading"`)
- **AND** SHALL NOT show the empty state

#### Scenario: Failed fetch shows error with retry
- **GIVEN** the definitions request returns HTTP 503 or rejects
- **THEN** the list area SHALL show an error (`data-testid="automation-error"`) and a Retry button
- **AND** SHALL NOT show "No automations in this folder"

#### Scenario: Retry recovers
- **GIVEN** the board is in the error state and the next request succeeds with 2 definitions
- **WHEN** the user activates Retry
- **THEN** `automation-loading` SHALL show until the request settles, then the 2 definitions SHALL render and the error SHALL clear

#### Scenario: Successful empty fetch shows the explainer
- **WHEN** the request succeeds with zero definitions
- **THEN** the empty state with the Create action SHALL render

#### Scenario: Mutation refresh revalidates in place
- **GIVEN** a board that loaded definitions earlier
- **WHEN** a mutation (delete, enable/disable, run now, stop, create) triggers a refresh
- **THEN** the previously loaded list SHALL stay rendered (no `automation-loading`) and card-local state, including a stop result notice, SHALL be preserved

#### Scenario: Folder change clears the list and ignores stale responses
- **GIVEN** the board is loading definitions for folder A
- **WHEN** the folder changes to B before A's request settles
- **THEN** the list SHALL be cleared and `automation-loading` SHALL show (no folder-A definitions visible)
- **AND** a late response for A, success or failure, SHALL be ignored (last-request-wins) so the board converges to B's result with no error caused by A

#### Scenario: Failed reload clears the list
- **GIVEN** a board that loaded definitions earlier
- **WHEN** a Retry or mutation refresh fetch fails
- **THEN** the board SHALL show the error state, the previously loaded list SHALL be cleared and the run-history fetches SHALL be skipped

### Requirement: Create Automation opens an inline draft

The board's "Create Automation" action and the folder actions menu "New automation" item SHALL open a new-automation draft: an inline editor at the top of that folder's board list, never a modal dialog. The menu item SHALL navigate to the board with the draft already open. Closing or creating the draft SHALL leave no history entry that reopens it.

#### Scenario: New automation from the folder menu opens the board draft

- **WHEN** a user activates the "New automation" item in a folder's actions menu
- **THEN** the dashboard SHALL navigate to that folder's automation board
- **AND** the board SHALL show the new-automation draft open at the top of the list, with no modal dialog

#### Scenario: Board Create opens the draft inline

- **WHEN** a user activates "Create Automation" on the board
- **THEN** a draft card holding the editor SHALL appear at the top of the automation list, with no modal dialog

#### Scenario: Closing the draft does not reopen it on Back

- **GIVEN** the board was opened from the folder menu "New automation" item
- **WHEN** the user cancels or creates the draft and then uses Back
- **THEN** the draft SHALL NOT reopen

#### Scenario: Draft on an empty folder

- **GIVEN** the folder has no automations
- **WHEN** the user arrives from the folder menu "New automation" item
- **THEN** the empty-state explanation SHALL stay and the draft SHALL show below it

#### Scenario: Load failure shows the error, not a draft

- **GIVEN** the board's automation list fails to load
- **WHEN** the user arrives from the folder menu "New automation" item
- **THEN** the board SHALL show its load-error state with Retry and SHALL NOT show a draft

### Requirement: Automation editor writes the chosen scope, action and model

The editor SHALL edit the trigger, actions (incl. additional fan-out actions), agent, model, name and scope (`folder` | `global`, create only), `mode`, `concurrency`, `sandbox` and `visibility`, and SHALL write `automation.yaml` (plus `prompt.md` for prompt actions) to the chosen scope, keeping keys it does not edit. The model SHALL be picked through `ModelSelector`, directly or as an `@role` from its Role tab listing the live built-in and custom roles.

#### Scenario: Create writes to chosen scope

- **WHEN** a user creates an automation with scope `global`
- **THEN** `~/.pi/automation/<name>/automation.yaml` SHALL be written and the automation SHALL appear with scope `global`.

#### Scenario: Prompt action writes prompt.md

- **WHEN** a user creates a `prompt` automation
- **THEN** a `prompt.md` SHALL be written next to `automation.yaml` and referenced by `action.prompt`.

#### Scenario: Saving keeps keys the editor does not show

- **GIVEN** an automation with `disabled: true` and `maxConcurrentSpawns: 3`
- **WHEN** the user edits its prompt and saves
- **THEN** the written `automation.yaml` SHALL still declare `disabled: true` and `maxConcurrentSpawns: 3`

#### Scenario: Custom role is selectable in the editor

- **GIVEN** a custom role `nightly` exists
- **WHEN** the user opens the automation editor's model picker Role tab
- **THEN** `nightly` SHALL be offered and selecting it SHALL store `model: "@nightly"`

### Requirement: Direct model carries a thinking level, a role does not

When no ACP agent is chosen, on the direct-model branch the editor SHALL render a thinking-level control beside the model selector, offering the picked model's `supportedThinkingLevels`; the level SHALL be written as a `:<level>` suffix on `model`, and no override SHALL write the bare `"<provider>/<id>"`. When a role is selected no thinking-level control SHALL render and `model` SHALL be the bare `@role`.

#### Scenario: Direct model with a thinking level

- **WHEN** a user picks model `anthropic/claude-sonnet-4-5` and level `high` on the direct-model branch
- **THEN** the written `automation.yaml` SHALL declare `model: "anthropic/claude-sonnet-4-5:high"`.

#### Scenario: Role branch offers no level control

- **WHEN** a user selects a role on the model picker's Role tab
- **THEN** no thinking-level control SHALL render
- **AND** the written `model` value SHALL be the bare `@role` token with no suffix.

### Requirement: Inline editor presentation

The editor SHALL render inside the board card it edits, with no backdrop, grouped into Trigger, Runs as (agent + model), a collapsed Advanced group whose header shows the current mode, concurrency and sandbox, and Action. Name and Scope SHALL be editable only in the create draft. The next-run preview SHALL show a relative duration with a pulsing dot. Action ids and descriptions SHALL wrap. Text controls SHALL show a visible token border.

#### Scenario: Inline groups, no modal

- **WHEN** the editor opens for an existing automation
- **THEN** Trigger, Runs as, Advanced and Action SHALL render inside the card with no backdrop, and Name and Scope SHALL NOT be editable fields

#### Scenario: Next-run shown as a relative duration

- **WHEN** the `schedule` trigger has a valid cron
- **THEN** the next-run preview SHALL show the time until the next fire with a pulsing status dot.

#### Scenario: Text controls are visibly bordered

- **WHEN** the editor shows the Cron, Name or Prompt control in any theme
- **THEN** each control SHALL render a visible border and field background from theme tokens, not plain text

#### Scenario: Action names are not truncated

- **WHEN** the action picker lists `core.prompt`, `core.skill` and `flows.run` with their descriptions
- **THEN** each action id and description SHALL be fully readable, wrapping rather than truncating

### Requirement: Editor save bar

A save bar SHALL stay visible at the bottom of the editing card while the board scrolls. It SHALL show the scope and write path, the editor's unsaved-change count, Cancel, and Save (edit) or Create with the next-run time (create). Save SHALL be disabled while an edit has no unsaved change. An untouched editor SHALL report no unsaved change.

#### Scenario: Unsaved count is shown

- **WHEN** the user changes the schedule of an existing automation
- **THEN** the save bar SHALL report 1 unsaved change and Save SHALL be enabled

#### Scenario: Save bar stays reachable

- **WHEN** the editor is taller than the board viewport and the user scrolls the board
- **THEN** the save bar with Cancel and Save SHALL stay visible at the bottom of the visible card area
- **AND** the board root SHALL remain the only vertical scroller, also with a long prompt, and its header with Back SHALL stay visible above the save bar

#### Scenario: Save bar names where it writes

- **WHEN** the editor is open for a global automation `pr-triage`
- **THEN** the save bar SHALL show that it writes under `~/.pi/automation/pr-triage/`

#### Scenario: Unchanged edit cannot be saved

- **WHEN** the editor opens for an existing automation and nothing is changed, including a worktree automation in a folder without git
- **THEN** the save bar SHALL report no unsaved change and Save SHALL be disabled

### Requirement: Editor fits phone widths

At 375 px the editor SHALL render in one column with no horizontal scroll in the card or board. Planned trigger kinds SHALL fold into one "coming soon" marker.

#### Scenario: Phone width has no horizontal scroll

- **WHEN** the board renders at 375 px wide with a card editing
- **THEN** the editor SHALL render in one column with no horizontal scroll inside the card or board
- **AND** planned trigger kinds SHALL fold into one "coming soon" marker

#### Scenario: Stop stays on a phone while editing

- **GIVEN** an automation with a `running` run
- **WHEN** its card is editing at 375 px wide
- **THEN** its Stop action SHALL stay visible in the card header

### Requirement: One inline editor at a time with an unsaved-changes guard

The board SHALL show at most one open editor. Opening another editor (also via this folder's menu "New automation" item), Close editor or Cancel while the open editor has unsaved changes SHALL keep it open with an inline warning naming the count and offering Discard and Save & switch (Save & close when closing). Discard SHALL continue unsaved; Save SHALL continue only on success. Leaving the board is not guarded.

#### Scenario: Clean editor switches immediately

- **GIVEN** card A's editor is open with no unsaved changes
- **WHEN** the user activates Edit on card B
- **THEN** card A SHALL collapse and card B SHALL open its editor

#### Scenario: Dirty editor warns before switching

- **GIVEN** card A's editor has 2 unsaved changes
- **WHEN** the user activates Edit on card B
- **THEN** card A's editor SHALL stay open with a warning naming 2 unsaved changes and offering Discard and Save & switch
- **AND** card B SHALL NOT open yet

#### Scenario: Re-requesting the open editor does nothing

- **GIVEN** card A's editor has unsaved changes
- **WHEN** the user activates card A's name or trigger summary
- **THEN** no warning SHALL appear and the edits SHALL stay, with focus moved to the requested section

#### Scenario: Discard continues without saving

- **GIVEN** the unsaved-changes warning is shown for card A while switching to card B
- **WHEN** the user activates Discard
- **THEN** no save request SHALL be sent and card B SHALL open its editor

#### Scenario: Failed save keeps the edits

- **GIVEN** the unsaved-changes warning is shown for card A
- **WHEN** the user activates Save & switch and the save fails
- **THEN** card A's editor SHALL stay open with its edits and the error, and card B SHALL NOT open

#### Scenario: Closing a dirty editor warns

- **GIVEN** card A's editor has unsaved changes
- **WHEN** the user activates Close editor or Cancel
- **THEN** the editor SHALL stay open with the warning offering Discard and Save & close

#### Scenario: Back is not intercepted

- **GIVEN** an editor with unsaved changes is open
- **WHEN** the user activates the board's Back control
- **THEN** the board SHALL navigate through the shell's back action without a warning and the edits SHALL be discarded
