## REMOVED Requirements

### Requirement: Pinned-directory guard
**Reason**: Superseded by the broader "Directory-eligibility guard". The home page now renders for workspace-owned folders too (not pinned-only), the guard waits on BOTH the pinned-loaded and workspace-loaded flags, and the miss notice is de-pinned to "not available". The prior pinned-only scenarios are re-expressed under the new requirement.

## ADDED Requirements

### Requirement: Directory-eligibility guard

The directory home page SHALL render for cwds that are EITHER present in
`pinnedDirectories` OR are a member folder of a workspace (i.e. present in the
union of `workspaces[].folders`). A cwd that is neither, reached by direct URL,
SHALL render a "not available" notice with a pin call-to-action instead of the
prompt surface. The pinned list and the workspace list arrive in SEPARATE messages
(`pinned_dirs_updated`, then `workspaces_updated`), so the guard SHALL wait for BOTH
to have loaded before deciding — gating on a pinned-loaded flag alone is insufficient
and SHALL NOT be used. It SHALL show a loading state until both arrive, so a cold
load or refresh never flashes the notice for an eligible cwd.

#### Scenario: Unpinned workspace-folder cwd renders the home page

- **GIVEN** `<cwd>` is a member of `workspaces[].folders` AND is NOT in `pinnedDirectories`
- **WHEN** the user opens `/folder/<encodedCwd>`
- **THEN** the directory home page prompt surface SHALL render (not the not-available notice)

#### Scenario: Neither-pinned-nor-workspace cwd shows the notice

- **GIVEN** `<cwd>` is not in the loaded `pinnedDirectories` and not in any `workspaces[].folders`
- **WHEN** the user opens `/folder/<encodedCwd>`
- **THEN** a "not available" notice with a pin CTA SHALL render and no prompt SHALL be shown

#### Scenario: Cold load does not flash the notice between the two messages

- **GIVEN** `<cwd>` is a workspace folder that is NOT pinned
- **AND** `pinned_dirs_updated` has arrived but `workspaces_updated` has NOT yet arrived
- **WHEN** the user opens `/folder/<encodedCwd>` directly
- **THEN** a loading state SHALL render (the notice SHALL NOT flash in the window before workspaces load)
- **AND** once `workspaces_updated` arrives the prompt surface SHALL render

## MODIFIED Requirements

### Requirement: Sidebar open affordance

Each directory sidebar row — whether pinned OR a workspace-owned folder — SHALL
expose an "open" affordance distinct from the collapse toggle that navigates to
`/folder/:encodedCwd`. Activating it SHALL NOT toggle the folder's collapsed state
and SHALL NOT initiate a drag-reorder.

#### Scenario: Open affordance appears on an UNPINNED workspace-folder row

- **GIVEN** a folder rendered inside a workspace container that is NOT pinned (its `DirectoryGroup.pinned` is `false`)
- **THEN** its row SHALL expose the "open" affordance (the render condition SHALL treat workspace membership, not only pinned state, as sufficient)

#### Scenario: Open affordance navigates to the home page

- **WHEN** the user activates the open affordance on any directory row (pinned or workspace)
- **THEN** the client SHALL navigate to `/folder/<encodedCwd>` for that directory

#### Scenario: Open affordance does not toggle collapse

- **GIVEN** a folder is expanded
- **WHEN** the user activates its open affordance
- **THEN** the folder SHALL remain expanded (the collapse state is unchanged)
