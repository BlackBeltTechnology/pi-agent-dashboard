## MODIFIED Requirements

### Requirement: Merged scope sections

The resource browse surface SHALL NOT render Local/Global as stacked collapsible
sections. Resources SHALL instead be presented per type (Skills, Agents,
Extensions, Prompts, Themes) as a flat card grid, with **scope** conveyed by a
per-card `local`/`global` badge rather than by which section a row sits in. On a
surface that spans both scopes (Directory Settings), an `All / Local / Global`
segmented filter SHALL narrow the grid by the card scope badge.

#### Scenario: Scope shown per card, not per section
- **WHEN** the user views a resource type page for a workspace with local and global resources of that type
- **THEN** all resources SHALL render as cards in one grid
- **AND** each card SHALL carry a `local` or `global` scope badge
- **AND** there SHALL be no stacked "Local" / "Global" section headers

#### Scenario: Scope filter replaces scope sections
- **WHEN** the user selects the `Global` scope filter on a type page
- **THEN** only cards with a `global` scope badge SHALL remain visible

### Requirement: Collapsible resource hierarchy

The resource browse surface SHALL render resources as a flat card grid rather
than a collapsible chevron tree. There SHALL be no section/group/package chevron
toggles and no depth-based indentation for browsing resources. Package
provenance SHALL be conveyed by a per-card `📦 <package-name>` source badge
rather than by nesting resources under a collapsible package row.

#### Scenario: No chevron tree
- **WHEN** a resource type page loads
- **THEN** resources SHALL render as cards immediately (no collapsed groups to expand)
- **AND** no chevron toggle SHALL gate their visibility

#### Scenario: Package provenance is a badge, not nesting
- **GIVEN** a package `pi-flows` contributes skills to the workspace
- **WHEN** the user views the Skills page
- **THEN** each contributed skill SHALL render as its own card with a `📦 pi-flows` badge
- **AND** the skills SHALL NOT be nested under a collapsible `📦 pi-flows` row
