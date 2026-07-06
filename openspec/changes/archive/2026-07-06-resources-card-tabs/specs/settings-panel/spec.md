## MODIFIED Requirements

### Requirement: Settings page-id registry contract

`VALID_SETTINGS_TABS` (and the `SettingsTab` type) SHALL enumerate the full set
of page ids: `general, server, sessions, remote, security, providers, packages,
plugins, openspec, skills, agents, extensions, prompts, themes, developer`. The
five resource page ids (`skills, agents, extensions, prompts, themes`) render
the global-scope per-type resource card grids. The plugin `settings-section`
slot SHALL continue to target a page via its `tab` field, defaulting to
`general` when unset. Each settings page SHALL mount `<SettingsSectionSlot
tab={page} />` so plugin claims render on their targeted page. Claims targeting
an id outside the enumerated set SHALL be treated as `general`.

#### Scenario: Unset claim lands on General
- **WHEN** a plugin registers a `settings-section` claim with no `tab`
- **THEN** the claim SHALL render on the General page

#### Scenario: Claim targets a new page id
- **WHEN** a plugin registers a `settings-section` claim with `tab: "developer"`
- **THEN** the claim SHALL render on the Developer page

#### Scenario: Third-party claim with unknown id falls back
- **WHEN** a plugin registers a `settings-section` claim with an id not in `VALID_SETTINGS_TABS`
- **THEN** the claim SHALL render on the General page

#### Scenario: Resource page ids resolve
- **WHEN** the user navigates to `/settings/agents`
- **THEN** the panel SHALL render the global-scope Agents resource card grid

## ADDED Requirements

### Requirement: Settings SHALL expose global resources as per-type card pages

The settings panel nav SHALL include a `Resources` group listing five pages —
**Skills, Agents, Extensions, Prompts, Themes** — each rendering the
global-scope resources of that type as a card grid using the same
`ResourceCard` component as Directory Settings. Because the settings panel is
global-scope, these pages SHALL NOT render an `All / Local / Global` scope
filter; scope SHALL be indicated by a static `global` affordance. A
name/description search filter SHALL be provided.

#### Scenario: Resources group in the settings nav
- **WHEN** the settings panel nav rail renders
- **THEN** a `Resources` group SHALL list `Skills`, `Agents`, `Extensions`, `Prompts`, `Themes`
- **AND** the `Resources` group SHALL be distinct from the existing `Extensions` group

#### Scenario: Global-scope type page omits the scope filter
- **WHEN** the user opens the `Skills` page under Settings
- **THEN** global skills SHALL render as cards
- **AND** no `All / Local / Global` scope filter SHALL be shown
