## MODIFIED Requirements

### Requirement: Directory surface SHALL open as a settings page

The dashboard SHALL expose a route `/folder/:cwd/settings/:page?` that renders a directory-scoped settings page in the content area. The page SHALL present a left-nav (grouped, mirroring the global settings page) on wide viewports and SHALL degrade to the mobile settings hierarchy on narrow viewports. The valid pages SHALL be `instructions`, `packages`, and `resources`, with `packages` as the default when `:page?` is omitted.

The entry-point control SHALL be an item in the folder actions menu, under the directory group, using a cog icon (`mdiCog`) and the label "Directory Settings". It SHALL NOT render as a control on the directory card itself — neither on the git row nor in the tier-0 banner.

#### Scenario: Menu item opens Directory Settings

- **GIVEN** a folder header for cwd `/Users/u/proj`
- **WHEN** the user opens the folder actions menu and activates the "Directory Settings" item
- **THEN** the client SHALL navigate to that directory's settings route
- **AND** the `packages` page SHALL render by default

#### Scenario: No settings cog remains on the card

- **WHEN** an expanded folder card renders
- **THEN** no Directory Settings cog SHALL render on the git row or in the banner
