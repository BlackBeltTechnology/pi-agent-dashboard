## REMOVED Requirements

### Requirement: Spawn actions render in a detached Create tray
**Reason**: The folder metaphor was incomplete — the Create tray and session cards floated below the card as detached siblings, so nothing looked "contained." Replaced by enclosing the Create tray + sessions inside the folder body (see ADDED requirement below).
**Migration**: In `SessionList.renderGroup`, move `FolderSpawnButtons` (the Create tray), the session list, and the "Show N ended" row inside a new `folderbody` wrapper that shares the header's border. Spawn behavior, worktree gating, and `folder-spawn-*` / spawn-error test ids are preserved.

## ADDED Requirements

### Requirement: Directory card encloses its Create tray and sessions in a folder body

When a folder group is expanded, the directory card SHALL render its header (git row + slot pills) and a folder body inside ONE continuous bordered surface, so the card reads as a folder containing its contents. The folder body SHALL contain, in order: a `CREATE` separator + the spawn actions (New Session / New Worktree), a `SESSIONS` separator, the folder's session cards, and the "Show N ended" affordance. The header and body SHALL share the `--bg-primary` surface (one continuous sheet), with a soft non-interactive fold-shadow seam marking the header/body junction. Session cards SHALL keep their existing surface, status spine, and selection ring (unchanged). Spawn behavior, worktree gating, DnD reordering, collapse/expand, and all `data-testid`s SHALL be preserved.

#### Scenario: Create tray renders inside the folder body
- **WHEN** a folder group is rendered expanded
- **THEN** the `New Session` / `New Worktree` spawn actions SHALL render inside the folder's bordered surface (below a `CREATE` separator), not as a detached sibling outside the card

#### Scenario: Sessions render inside the folder body under a SESSIONS separator
- **WHEN** a folder has one or more sessions and is expanded
- **THEN** a `SESSIONS` separator SHALL precede the session cards, and the session cards SHALL render inside the folder's bordered surface

#### Scenario: Ended row stays enclosed
- **WHEN** a folder has ended sessions
- **THEN** the "Show N ended" affordance SHALL render inside the folder body (after the active sessions), not outside the card

#### Scenario: Collapsed folder shows only the header
- **WHEN** a folder group is collapsed
- **THEN** the folder body (Create tray + sessions + ended) SHALL NOT render, and the header SHALL present as a fully-rounded standalone card

#### Scenario: Spawn still works from inside the folder
- **WHEN** the user clicks `New Session` inside the enclosed folder body
- **THEN** a new session SHALL be spawned in that folder (identical to the previous detached-tray behavior)

### Requirement: Root (non-workspace) folder gets an accent-tinted surface

A directory card for a folder that is NOT a member of a workspace SHALL render with a subtle accent-tinted surface — a background derived from the theme's own accent color mixed into the card surface (e.g. `color-mix(in srgb, var(--accent-blue) ~5%, var(--bg-primary))`) plus an accent-tinted border — so the folder boundary remains legible across all themes, including low-contrast/warm themes where the plain surface blends into the page. A directory card for a folder rendered inside a workspace container SHALL NOT receive this tint (the workspace container already separates it).

#### Scenario: Top-level folder is visually distinct in a low-contrast theme
- **WHEN** a top-level (non-workspace) folder is rendered under a warm/low-contrast theme where `--bg-primary` and the sidebar are near-identical
- **THEN** the folder card SHALL show the accent-tinted surface + border so its boundary is clearly distinguishable from the page

#### Scenario: Workspace-grouped folder is not tinted
- **WHEN** a folder is rendered inside a workspace container (`inWorkspace`)
- **THEN** its directory card SHALL NOT receive the accent tint

#### Scenario: Tint adapts to the active theme
- **WHEN** the active theme changes
- **THEN** the root-folder tint SHALL derive from that theme's `--accent-blue` (not a hardcoded color), staying subtle in every theme
