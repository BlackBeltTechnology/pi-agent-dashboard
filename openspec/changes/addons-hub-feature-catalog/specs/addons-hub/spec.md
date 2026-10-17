## MODIFIED Requirements

### Requirement: The Add-ons page SHALL explain extensions, skills, plugins and packages

The Add-ons page SHALL render a concept explainer that defines, in plain language and without internal identifiers:
- **pi** as the AI agent working in each session and **the dashboard** as the web app;
- an **extension** as code that runs inside pi in every session (including terminal pi) and changes what the AI agent can do;
- a **skill** as written know-how the AI reads when a task matches, with no code running;
- a **dashboard plugin** as code that runs only in the dashboard and changes what the user sees and controls, with no effect in terminal pi;
- a **package** as the unit the user installs (npm, git or a folder), which may contain any mix of the above.

The explainer SHALL include one worked example naming a feature that has both an extension part and a dashboard-plugin part: the first installed catalog feature of kind `agent-and-dashboard` in catalog order; when none is installed, a static example built from a recommended-extensions entry and the dashboard plugin named by its `dashboardPlugin` link. The explainer SHALL be dismissible; dismissal SHALL persist across reloads on the same browser. A link in the page header SHALL reopen it. The page SHALL also render a one-line legend for the part labels (dashboard UI, extension, bridge, skills, prompts, themes).

#### Scenario: First visit shows the explainer
- **GIVEN** the user has never dismissed the explainer on this browser
- **WHEN** the Add-ons page renders
- **THEN** the explainer SHALL be expanded above the installed list

#### Scenario: Dismissal persists
- **GIVEN** the user dismissed the explainer
- **WHEN** the page is reloaded
- **THEN** the explainer SHALL render collapsed
- **AND** activating the header link "What are extensions and plugins?" SHALL expand it and move focus to it

#### Scenario: Explainer is keyboard and screen-reader reachable
- **WHEN** the user tabs to the explainer toggle and presses Enter
- **THEN** the explainer SHALL expand or collapse
- **AND** the toggle SHALL expose its expanded state to assistive technology

#### Scenario: Example uses an installed feature
- **GIVEN** `plugin:goal` is the first installed `agent-and-dashboard` feature
- **WHEN** the explainer renders
- **THEN** its worked example SHALL name Goal and its extension package

#### Scenario: Static example fallback
- **GIVEN** no installed feature has kind `agent-and-dashboard`
- **WHEN** the explainer renders
- **THEN** it SHALL show the static example

### Requirement: Part labels SHALL carry plain-language tooltips

Every part label rendered on an add-on row or card (dashboard UI, extension, bridge, skills, prompts, themes) SHALL expose a plain-language description of that part as an accessible tooltip, matching the explainer's definitions.

#### Scenario: Hovering an extension label
- **WHEN** the user hovers or focuses an `extension` label on a row
- **THEN** a tooltip SHALL state that it runs inside pi in every session and changes what the AI agent can do

#### Scenario: Hovering a bridge label
- **WHEN** the user hovers or focuses a `bridge` label on a row
- **THEN** a tooltip SHALL state that the dashboard installs it into pi so its dashboard plugin can talk to the AI agent

### Requirement: A recommended extension SHALL appear once on the Add-ons page

On the global Add-ons page, a recommended extension installed at global scope that is active in pi, or whose global entry is in the hub's all-empty filter form (turned off from the hub), SHALL render only as (part of) a feature row in the Installed tab and SHALL NOT render a Discover card. An entry on disk at global scope but not active for any other reason has no installed row, so it SHALL keep its card (Activate state) in the Discover tab. The recommended panel in the Discover tab SHALL list every recommended entry that has no Installed row; an entry installed only in a folder SHALL keep its card with its existing folder state, so it is never invisible on the page. When every recommended entry is installed globally, the panel SHALL render a single line stating that all recommended add-ons are installed instead of an empty grid. "Install all missing" SHALL keep its existing behaviour.

#### Scenario: Installed recommended entry is not repeated
- **GIVEN** `pi-flows` is recommended and installed globally
- **WHEN** the Add-ons page renders
- **THEN** `pi-flows` SHALL render as part of a feature row in the Installed tab
- **AND** SHALL NOT render as a card in the Discover tab

#### Scenario: Feature turned off from the hub has no Discover card
- **GIVEN** recommended `pi-flows` is installed globally and its feature was turned off from the hub
- **WHEN** the Add-ons page renders
- **THEN** `pi-flows` SHALL render as an off feature row in the Installed tab
- **AND** SHALL NOT render as a card in the Discover tab

#### Scenario: Folder-only install keeps its card
- **GIVEN** `pi-simplify` is recommended and installed only in folder `/repo`
- **WHEN** the Discover tab renders
- **THEN** the recommended panel SHALL still show a `pi-simplify` card with its folder install state

#### Scenario: Missing recommended entry is offered
- **GIVEN** `@blackbelt-technology/pi-image-fit-extension` is recommended and not installed
- **WHEN** the Discover tab renders
- **THEN** the recommended panel SHALL show a card for it with an Install action

### Requirement: The installed list SHALL be filterable

The Add-ons Installed tab SHALL provide a text filter matching feature display name, any package part's source (bridge paths excluded), and description (case-insensitive substring), and toggle chips `From pi-dashboard` (origin `first-party` or `mixed`), `Community` (origin `community` or `mixed`), `Has dashboard UI` (feature has a dashboard-plugin part), `Agent only` (kind `agent-only`), `Local source` (any package part installed from a local path or git checkout) and `Disabled` (state `off` or `partial`). Filters SHALL combine with AND. Groups with no matching rows SHALL be hidden. When nothing matches, the list SHALL say so and offer a link that moves the query to the npm search in the Discover tab. Available updates are listed in the Updates tab; the list SHALL NOT offer an `Update available` chip.

#### Scenario: Text filter narrows rows
- **WHEN** the user types `memory` into the filter
- **THEN** only features whose name, a part's source or description contains `memory` SHALL remain

#### Scenario: Local source chip
- **WHEN** the user activates `Local source`
- **THEN** only features with a package part installed from a local path or git checkout SHALL remain

#### Scenario: Origin chips combine with AND
- **WHEN** the user activates both `From pi-dashboard` and `Community`
- **THEN** only `mixed` features SHALL remain

#### Scenario: Disabled chip includes partial features
- **WHEN** the user activates `Disabled`
- **THEN** features in state `off` or `partial` SHALL remain

#### Scenario: Update chip before any check
- **WHEN** the Installed tab renders, before or after an update check
- **THEN** no `Update available` chip SHALL render
- **AND** features with an available update SHALL be listed in the Updates tab once a check completes

#### Scenario: Empty result
- **WHEN** the filter matches no row
- **THEN** the list SHALL render a "nothing matches" message with a link to search npm for the same text

### Requirement: Local-source rows SHALL be summarised by one banner

When one or more displayed features have a package part from a local path or git checkout, the Add-ons page SHALL render one informational banner stating how many add-ons run from local source, with a `Show` action that clears the text filter and the other chips and turns on the `Local source` filter. The banner count and the `Local source` chip SHALL use the same predicate (a feature with any package part of source type local or git; `dashboardManaged` bridges excluded), so the filtered list shows exactly the counted features. The banner SHALL NOT offer a bulk reset.

#### Scenario: Banner counts local overrides
- **GIVEN** 13 displayed features have a local-checkout package part and 9 dashboard-managed bridges are local paths
- **WHEN** the page renders
- **THEN** a banner SHALL state that 13 add-ons run from local source
- **AND** activating its `Show` action, even while a text filter is active, SHALL clear the other filters and turn on the `Local source` filter
- **AND** exactly those 13 features SHALL remain visible
