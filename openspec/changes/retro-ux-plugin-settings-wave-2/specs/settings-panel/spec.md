## MODIFIED Requirements

### Requirement: Shared settings group and notice components
`@blackbelt-technology/dashboard-plugin-runtime` SHALL export `SettingsGroup` and `SettingsNotice`. `SettingsGroup` SHALL render a `<details>` whose summary is 14 px semibold in `--text-primary`, at least 44 px tall, with a visible `--focus-ring` outline on keyboard focus, and an optional meta text at 12 px in `--text-secondary` (the summary is interactive, so its text meets the 12 px interactive floor). `SettingsNotice` SHALL render the `ui-contract.md` severity callout recipe for tones `info`, `warning`, `error` and `success`. Neither SHALL contain a Tailwind palette class, hex or `rgba(` literal.

#### Scenario: Notice tone maps to the severity family
- **WHEN** `SettingsNotice` is rendered with `tone="warning"`
- **THEN** its computed background, border and text colours equal the active theme's `--severity-warning-bg`, `--severity-warning-border` and `--severity-warning-fg`

#### Scenario: Group meta meets the interactive text floor
- **WHEN** `SettingsGroup` is rendered with `meta="3 fields"`
- **THEN** the meta text's computed font size SHALL be 12 px and its colour SHALL equal `--text-secondary`

## ADDED Requirements

### Requirement: Shared settings status, item, facts and table components
`@blackbelt-technology/dashboard-plugin-runtime` SHALL export four presentation-only components for read-only and repeated content on settings pages:

- `SettingsStatusPill` — a pill with a tone (`success`, `info`, `warning`, `error`, `neutral`) painted from the matching `--severity-*` tokens, an optional decorative icon (`aria-hidden`), and a REQUIRED text label, at 11 px semibold (12 px when rendered inside an interactive element).
- `SettingsItem` — a card for one repeated entity (a profile, instance, server, binding): title, optional subtitle, a status area, an actions area and an optional body. When `collapsible`, it SHALL render as `<details>` whose `<summary>` contains the title AND the status area, so a collapsed card still shows its state; the summary SHALL be at least 44 px tall with a visible focus ring.
- `SettingsFacts` — a read-only term/value list rendered as `<dl>` with terms in `--text-secondary` and values in `--text-primary`, at 12 px.
- `SettingsTable` — a read-only table with header cells `scope="col"`, 12 px text, that scrolls horizontally inside its container instead of widening the page.

All four SHALL accept caller `data-testid`s, SHALL paint only through theme tokens (no Tailwind palette class, hex or `rgba(` literal) and SHALL use only the 11, 12 and 14 px type steps. None SHALL carry a save model.

#### Scenario: Status pill never relies on colour alone
- **WHEN** `SettingsStatusPill` is rendered with `tone="error"` and label `Password rejected`
- **THEN** the text `Password rejected` SHALL be visible and part of the pill's accessible text
- **AND** its computed colours SHALL equal `--severity-error-bg`, `--severity-error-border` and `--severity-error-fg`

#### Scenario: Collapsed item still shows status
- **WHEN** a collapsible `SettingsItem` with status pill `Not paired` is collapsed
- **THEN** the `Not paired` pill SHALL remain visible in the summary

#### Scenario: Wide table scrolls inside its container
- **WHEN** a `SettingsTable` wider than its container renders at a 375 px viewport
- **THEN** the page SHALL NOT scroll horizontally and the table container SHALL scroll instead

### Requirement: Developer page offers a "Show plugin internals" preference
The Developer settings page SHALL offer a toggle "Show plugin internals", stored in this browser's local storage (per-browser, like other view-only developer aids; no dashboard config key or file format is added), default off. When off, plugin settings pages SHALL NOT show a plugin's slot claims. When on, the full host chrome SHALL show a collapsed "Plugin internals" disclosure listing the plugin id and its contributed slots, and the compact chrome of a promoted page SHALL add the slot list to its existing "Plugin details" disclosure.

#### Scenario: Off by default
- **WHEN** a user who never changed the preference opens `/settings/plugins/quota`
- **THEN** no slot claim names (such as `settings-section`) SHALL be visible on the page

#### Scenario: Turning it on reveals internals
- **WHEN** the user turns on "Show plugin internals" on the Developer page and opens `/settings/plugins/quota`
- **THEN** the host chrome SHALL show a collapsed "Plugin internals" disclosure
- **AND** expanding it SHALL list `composer-context-group` and `settings-section`
