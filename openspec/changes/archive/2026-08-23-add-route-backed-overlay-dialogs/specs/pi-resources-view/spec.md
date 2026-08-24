## ADDED Requirements

### Requirement: Global and folder resource surfaces SHALL be one scope-switched surface

`/settings/{skills,agents,extensions,prompts,themes}` and `/folder/:cwd/settings/{skills,agents,extensions,prompts,themes}` render the same `ResourceGridPanel`, differing only in props: the global surface passes `scopes={["global"]}` with the scope filter hidden and routes file views to `/pi-resource`; the folder surface passes both scopes with the filter shown and routes file views to `/folder/:cwd/view`.

These ten route destinations SHALL collapse into one scope-switched surface. The surface SHALL derive its scope set, its scope-filter visibility, and its file-view target from the matched route rather than from a duplicated component tree. All ten paths SHALL continue to resolve and SHALL continue to render the resource type named in the path.

The two routes are never mounted simultaneously, so this is not a correctness defect — the justification is duplication cost alone: ten destinations maintaining one grid's wiring at two call sites, both of which this change already edits.

#### Scenario: Global resource path renders global scope only

- **WHEN** the user navigates to `/settings/skills`
- **THEN** the surface SHALL render the skills resource grid at global scope
- **AND** the scope filter SHALL NOT be shown

#### Scenario: Folder resource path renders both scopes with a filter

- **WHEN** the user navigates to `/folder/<encodedCwd>/settings/skills`
- **THEN** the surface SHALL render the skills resource grid across local and global scope
- **AND** the scope filter SHALL be shown

#### Scenario: File view target follows the matched scope

- **GIVEN** the user is on `/settings/skills`
- **WHEN** the user opens a resource file
- **THEN** the file view SHALL be routed to the global resource file path

#### Scenario: Folder file view target follows the folder scope

- **GIVEN** the user is on `/folder/<encodedCwd>/settings/skills`
- **WHEN** the user opens a resource file
- **THEN** the file view SHALL be routed to the folder-scoped file view path

#### Scenario: All ten resource paths still resolve

- **WHEN** each of `/settings/{skills,agents,extensions,prompts,themes}` and `/folder/<encodedCwd>/settings/{skills,agents,extensions,prompts,themes}` is opened
- **THEN** each SHALL render the resource type named in its path
- **AND** no path SHALL 404 or fall through to the card list

#### Scenario: One grid renders per matched route

- **GIVEN** a resource route is open as a route-backed overlay
- **WHEN** the surface renders
- **THEN** exactly one `ResourceGridPanel` SHALL be mounted for that route
