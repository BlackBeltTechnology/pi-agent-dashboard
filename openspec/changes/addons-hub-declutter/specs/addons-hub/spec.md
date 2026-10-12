## Purpose

The Add-ons page is the single place where a user sees and manages everything that extends pi and the dashboard. It names things in plain language, explains the underlying concepts, and shows each installed item once.

## ADDED Requirements

### Requirement: The add-on management page SHALL be named "Add-ons"

The global settings page that manages installed packages SHALL be labelled **Add-ons** in the settings rail and in its page heading. The rail group containing it SHALL be labelled **ADD-ONS**. The word "Pi Ecosystem" SHALL NOT appear as the page or section heading. "Extension" SHALL keep its narrow meaning (the part that runs inside pi); it SHALL NOT be used as the name of the page.

#### Scenario: Rail and heading use the new name
- **WHEN** the user opens `/settings/add-ons`
- **THEN** the rail SHALL show an `ADD-ONS` group containing an `Add-ons` item marked active
- **AND** the page heading SHALL read `Add-ons`

#### Scenario: Translations exist for the new labels
- **WHEN** the UI language is Hungarian or Chinese
- **THEN** the rail group, rail item and heading SHALL render translated strings, not English fallbacks

### Requirement: The Add-ons page SHALL explain extensions, skills, plugins and packages

The Add-ons page SHALL render a concept explainer that defines, in plain language and without internal identifiers:
- **pi** as the AI agent working in each session and **the dashboard** as the web app;
- an **extension** as code that runs inside pi in every session (including terminal pi) and changes what the AI agent can do;
- a **skill** as written know-how the AI reads when a task matches, with no code running;
- a **dashboard plugin** as code that runs only in the dashboard and changes what the user sees and controls, with no effect in terminal pi;
- a **package** as the unit the user installs (npm, git or a folder), which may contain any mix of the above.

The explainer SHALL include one worked example naming a feature that has both an extension part (an entry of the recommended-extensions manifest) and a dashboard-plugin part (a plugin that ships with the dashboard and requires that extension). The explainer SHALL be dismissible; dismissal SHALL persist across reloads on the same browser. A link in the page header SHALL reopen it. The page SHALL also render a one-line legend for the part labels (dashboard UI, extension, skills, tools).

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

### Requirement: Part labels SHALL carry plain-language tooltips

Every part label rendered on an add-on row or card (dashboard UI, extension, skills, tools) SHALL expose a plain-language description of that part as an accessible tooltip, matching the explainer's definitions.

#### Scenario: Hovering an extension label
- **WHEN** the user hovers or focuses an `extension` label on a row
- **THEN** a tooltip SHALL state that it runs inside pi in every session and changes what the AI agent can do

### Requirement: Dashboard-managed bridge entries SHALL NOT render as installed rows

An installed-package row whose server response marks it `dashboardManaged` SHALL NOT render anywhere installed rows render (global and folder Add-ons pages) and SHALL NOT count in installed totals or in the local-source banner. These entries remain in `packages[]` and keep loading in pi; only their display is suppressed.

#### Scenario: Plugin bridges are hidden
- **GIVEN** `packages[]` contains nine bridge paths written for enabled dashboard plugins
- **WHEN** the Add-ons page renders
- **THEN** no row named `index.ts` (or any other bridge path) SHALL render
- **AND** the installed count SHALL exclude those nine entries

#### Scenario: A user-added entry pointing at the same kind of file still shows
- **GIVEN** a `packages[]` entry that is not recorded as a dashboard-managed bridge
- **WHEN** the page renders
- **THEN** that entry SHALL render as a normal row regardless of its file name

### Requirement: A recommended extension SHALL appear once on the Add-ons page

On the global Add-ons page, a recommended extension installed at global scope (recommended entry `installed.scope === "global"`) SHALL render only in the installed list. The recommended panel in the browse area SHALL list every recommended entry that is not installed at global scope; an entry installed only in a folder SHALL keep its card with its existing folder state, so it is never invisible on the page. When every recommended entry is installed globally, the panel SHALL render a single line stating that all recommended add-ons are installed instead of an empty grid. "Install all missing" SHALL keep its existing behaviour.

#### Scenario: Installed recommended entry is not repeated
- **GIVEN** `pi-flows` is recommended and installed globally
- **WHEN** the Add-ons page renders
- **THEN** `pi-flows` SHALL render as a row in the installed list
- **AND** SHALL NOT render as a card in the recommended panel

#### Scenario: Folder-only install keeps its card
- **GIVEN** `pi-simplify` is recommended and installed only in folder `/repo`
- **WHEN** the global Add-ons page renders
- **THEN** the recommended panel SHALL still show a `pi-simplify` card with its folder install state

#### Scenario: Missing recommended entry is offered
- **GIVEN** `@blackbelt-technology/pi-image-fit-extension` is recommended and not installed
- **WHEN** the Add-ons page renders
- **THEN** the recommended panel SHALL show a card for it with an Install action

### Requirement: The installed list SHALL be filterable

The Add-ons installed list SHALL provide a text filter matching display name, source and description (case-insensitive substring), and toggle chips `Local source` and `Update available`. Filters SHALL combine with AND. Groups with no matching rows SHALL be hidden. When nothing matches, the list SHALL say so and offer a link that moves the query to the npm search.

#### Scenario: Text filter narrows rows
- **WHEN** the user types `memory` into the filter
- **THEN** only rows whose name, source or description contains `memory` SHALL remain

#### Scenario: Local source chip
- **WHEN** the user activates `Local source`
- **THEN** only rows installed from a local path or git checkout SHALL remain

#### Scenario: Empty result
- **WHEN** the filter matches no row
- **THEN** the list SHALL render a "nothing matches" message with a link to search npm for the same text

### Requirement: Local-source rows SHALL be summarised by one banner

When one or more displayed installed rows come from a local path or git checkout, the Add-ons page SHALL render one informational banner stating how many add-ons run from local source, with a `Show` action that clears the text filter and the other chips and turns on the `Local source` filter. The banner count and the `Local source` chip SHALL use the same predicate (source type local or git, `dashboardManaged` excluded), so the filtered list shows exactly the counted rows. The banner SHALL NOT offer a bulk reset.

#### Scenario: Banner counts local overrides
- **GIVEN** 13 displayed installed rows are local checkouts and 9 hidden rows are dashboard-managed bridges
- **WHEN** the page renders
- **THEN** a banner SHALL state that 13 add-ons run from local source
- **AND** activating its `Show` action, even while a text filter is active, SHALL clear the other filters and turn on the `Local source` filter
- **AND** exactly those 13 rows SHALL remain visible
