# directory-card-layout Specification

## Purpose
TBD - created by archiving change redesign-directory-card. Update Purpose after archive.
## Requirements
### Requirement: Folder slots render as single-concern pills in a responsive grid

The directory card (`SessionList.renderGroup`) SHALL present its folder slot sections — Automations, Goals, KB, OpenSpec — as discrete pills arranged in a grid, instead of dense one-line `LABEL (n) → ⟳ [action]` rows. Each slot pill SHALL show, at minimum: a slot-colored leading glyph, an uppercase slot label, and the slot's primary count/value; the slot's state (e.g. KB `⚠ N stale`, Automations `⚠ N invalid`) SHALL render inline within the same pill. Each pill SHALL remain a single click target that performs the slot's existing primary navigation (open board / open settings), and each slot section SHALL keep its own data hook and secondary actions (refresh, create). The grid SHALL use two columns at sidebar/desktop width and SHALL collapse to a single column at narrow (mobile) width. A slot section that renders nothing (e.g. a plugin disabled, or data not yet loaded) SHALL simply be absent from the grid without breaking the layout of the remaining pills.

#### Scenario: KB stale state renders inline in the KB pill
- **WHEN** the KB slot for a folder reports `chunks: 20230` and `staleCount: 1`
- **THEN** the KB pill SHALL show the KB glyph, the `KB` label, the `20.2k` (or `20,230`) chunk count, and an inline `⚠ 1 stale` marker within the same pill

#### Scenario: Pill click performs the slot's primary navigation
- **WHEN** the user clicks the OpenSpec slot pill for a folder
- **THEN** the OpenSpec board for that folder SHALL open (same navigation the previous `OpenSpec (N) →` row performed)

#### Scenario: Grid collapses to one column at mobile width
- **WHEN** the directory card is rendered below the mobile breakpoint
- **THEN** the slot pills SHALL stack in a single column with no horizontal overflow or clipping

#### Scenario: Missing slot leaves no broken cell
- **WHEN** a folder has only three of the four slot sections rendering (one plugin disabled)
- **THEN** the grid SHALL render the three available pills without an empty broken cell or layout shift of the header/git rows

### Requirement: Directory card shows a folder watermark

The directory card SHALL render a faint 3D half-open folder watermark behind its content, centered and clipped to the card's rounded bounds. The watermark SHALL be a static vector asset with `pointer-events: none`, sit beneath the card content (behind the header, git row, and slot pills), and SHALL NOT intercept clicks or measurably change per-frame paint cost. The watermark SHALL remain legible-but-subtle across all supported themes.

#### Scenario: Watermark is non-interactive and behind content
- **WHEN** the user clicks anywhere over the region occupied by the watermark
- **THEN** the click SHALL reach the underlying card content or slot pill, never the watermark
- **AND** the watermark SHALL render behind the slot pills (lower stacking order)

### Requirement: Spawn actions render in a detached Create tray

The `New Session` and `New Worktree` spawn buttons SHALL render in a Create tray positioned OUTSIDE the directory card's bordered surface (a sibling below the card), visually separated by a divider label, and SHALL NOT be enclosed by the card's border/shadow. The buttons SHALL preserve their existing behavior, gating (worktree button shown only when `showWorktree` holds), and `data-testid`s.

#### Scenario: Spawn buttons sit outside the card border
- **WHEN** a folder group is rendered expanded
- **THEN** the `New Session` and `New Worktree` buttons SHALL render below the bordered card element, not within it

#### Scenario: New Session still spawns a session
- **WHEN** the user clicks `New Session` in the detached Create tray
- **THEN** a new session SHALL be spawned in that folder (identical to the previous in-card button behavior)

#### Scenario: Worktree button remains gated
- **WHEN** every session in the folder is a confirmed non-git repo (`isGitRepo === false`) or git worktrees are disabled
- **THEN** the `New Worktree` button SHALL NOT render in the Create tray

