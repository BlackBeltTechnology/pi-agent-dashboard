## ADDED Requirements

### Requirement: General page renders a pi runtime status row
The **General** page SHALL render a read-only pi runtime status row as part of its page inventory. The row is not a field: it is bound to no config key, contributes nothing to the Save Bar, and therefore has no `CONFIG_FIELD_PAGE` entry. It is a persistent status surface, distinct from the conditional pi version advisory that may render alongside it.

The **Developer** page inventory is unchanged — the pi runtime picker and the Tools section remain there, adjacent, as the only editors of pi runtime overrides.

#### Scenario: Row present on General
- **WHEN** the Settings panel resolves to `/settings/general`
- **THEN** the pi runtime status row SHALL be rendered
- **AND** it SHALL NOT be gated on the pi version advisory's visibility condition

#### Scenario: Row contributes no dirty state
- **WHEN** the pi runtime status row is rendered and the rest of the panel is clean
- **THEN** the Save Bar SHALL NOT appear
- **AND** no dirty-page chip SHALL name General on account of the row

#### Scenario: Picker stays on Developer
- **WHEN** the Settings panel resolves to `/settings/developer`
- **THEN** the pi runtime picker SHALL be rendered immediately above the Tools section, unchanged

### Requirement: Page navigation accepts an optional section scroll target
The panel's internal page-navigation helper SHALL accept an optional target identifying a section on the destination page. When supplied, the panel SHALL scroll that section into view after the destination page renders. When omitted, navigation SHALL behave exactly as before, including its existing unsaved-changes gating.

The scroll target SHALL be transient and SHALL NOT be encoded in the route. `/settings/:page` and the legacy `?tab=<id>` form remain the complete addressable surface.

#### Scenario: Navigate with a scroll target
- **WHEN** navigation is requested to the Developer page with the pi runtime picker as the scroll target
- **THEN** the panel SHALL navigate to `/settings/developer`
- **AND** SHALL scroll the pi runtime picker into view

#### Scenario: Navigate without a scroll target
- **WHEN** navigation is requested with no scroll target, as the Save Bar page chips do
- **THEN** the panel SHALL navigate to the destination page with no scrolling behaviour change

#### Scenario: Unsaved changes still gate navigation
- **WHEN** navigation with a scroll target is requested while the panel is dirty
- **THEN** the same unsaved-changes gating that applies to page navigation SHALL apply

#### Scenario: Route stays unchanged
- **WHEN** navigation with a scroll target completes
- **THEN** the resulting URL SHALL be `/settings/<page>` with no fragment or additional query parameter naming the section
