# directory-card-layout Specification

## Purpose
TBD - created by archiving change redesign-directory-card. Update Purpose after archive.
## Requirements
### Requirement: Folder slots render as single-concern pills in a responsive grid

The directory card (`SessionList.renderGroup`) SHALL present its folder slot sections — Automations, Goals, KB, OpenSpec — as discrete pills arranged in a grid, instead of dense one-line `LABEL (n) → ⟳ [action]` rows. Each slot pill SHALL show, at minimum: a slot-colored leading glyph, an uppercase slot label, and the slot's primary count/value; the slot's state (e.g. KB `⚠ N stale`, Automations `⚠ N invalid`) SHALL render inline within the same pill. Each pill SHALL remain a single click target that performs the slot's existing primary navigation (open board / open settings), and each slot section SHALL keep its own data hook.

Slot pills SHALL be **state-only**: a pill SHALL render no secondary action buttons of any kind — no refresh, no create, no navigation shortcut. Pills read a number; the folder actions menu changes something. Every action a slot needs SHALL be contributed to the folder actions menu instead.

The pill component SHALL NOT expose a prop accepting arbitrary action markup. State markers that are *facts* rather than controls — such as the KB pill's inline stale marker — remain inside the pill; a stale badge appearing both on the pill (as state) and on the menu's reindex item (as that action's context) is intended, not duplication.

The grid SHALL use two columns at sidebar/desktop width and SHALL collapse to a single column at narrow (mobile) width. A slot section that renders nothing (e.g. a plugin disabled, or data not yet loaded) SHALL simply be absent from the grid without breaking the layout of the remaining pills.

#### Scenario: KB stale state renders inline in the KB pill
- **WHEN** the KB slot for a folder reports `chunks: 20230` and `staleCount: 1`
- **THEN** the KB pill SHALL show the KB glyph, the `KB` label, the `20.2k` (or `20,230`) chunk count, and an inline `⚠ 1 stale` marker within the same pill

#### Scenario: Pill click performs the slot's primary navigation
- **WHEN** the user clicks the OpenSpec slot pill for a folder
- **THEN** the OpenSpec board for that folder SHALL open (same navigation the previous `OpenSpec (N) →` row performed)

#### Scenario: No slot pill renders an action button
- **WHEN** the directory card renders all four slot pills
- **THEN** the pill grid SHALL contain zero focusable or interactive elements other than the pill roots themselves
- **AND** no `mdiRefresh`, `mdiPlus`, `mdiArchiveOutline` or `mdiFileDocumentOutline` control SHALL render inside a pill

#### Scenario: Grid collapses to one column at mobile width
- **WHEN** the directory card is rendered below the mobile breakpoint
- **THEN** the slot pills SHALL stack in a single column with no horizontal overflow or clipping

#### Scenario: Missing slot leaves no broken cell
- **WHEN** a folder has only three of the four slot sections rendering (one plugin disabled)
- **THEN** the grid SHALL render the three available pills without an empty broken cell or layout shift of the header/git rows

### Requirement: Directory card shows a folder-tab nub

The directory card SHALL render a small folder-tab nub peeking above its top-left corner so the card's silhouette reads as a folder. The nub SHALL be a static, non-interactive element (`aria-hidden`, `pointer-events: none`) rendered as a sibling behind the bordered card such that the card paints over the nub's lower edge and only its top peeks above the card. The nub SHALL use theme tokens (card background + subtle border) so it remains legible-but-subtle across all supported themes, and SHALL NOT intercept clicks, change the card's content layout, or add per-frame paint cost.

#### Scenario: Nub is non-interactive and behind the card
- **WHEN** the user clicks anywhere over the region occupied by the nub
- **THEN** the click SHALL reach the underlying card content, header, or slot pill, never the nub
- **AND** the nub SHALL render behind the bordered card (the card's opaque surface hides the nub's lower edge, leaving only the top visible as a tab)

#### Scenario: Nub does not shift the card content
- **WHEN** the directory card is rendered with the folder-tab nub
- **THEN** the header, git row, and slot-pill grid SHALL keep their existing layout, with the nub occupying only reserved space above the card's top edge

#### Scenario: Nub adapts across themes
- **WHEN** the active theme changes
- **THEN** the nub's background and border SHALL follow the same theme tokens as the card so it stays legible-but-subtle in every theme

### Requirement: Directory card encloses its Create tray and sessions in a folder body

When a folder group is expanded, the directory card SHALL render its header (git row + slot pills) and a folder body inside ONE continuous bordered surface, so the card reads as a folder containing its contents. The folder body SHALL contain, in order: a `CREATE` separator + the spawn actions (New Session / New Worktree), a `SESSIONS` separator, the folder's session cards, and the "Show N ended" affordance. The header and body SHALL share the `--bg-primary` surface (one continuous sheet) with no seam shading at the header/body junction — the `CREATE` separator alone marks it. Session cards SHALL keep their existing surface and selection ring. The session list SHALL render ONE gray directory rail (`--rail-directory`) down its left band, each card connecting to it with a 9px tick; the per-card status spine is REMOVED and status is carried by the inline status chip alone. Each card's drag zone SHALL be an opaque hover-revealed bead parked in the rail band (opaque `--bg-primary` + `--border-subtle`, masking the rail so the grip glyph stays legible), retaining `data-testid="drag-handle-session"`. Spawn behavior, worktree gating, DnD reordering, collapse/expand, and all `data-testid`s SHALL be preserved.

#### Scenario: Directory rail replaces the per-card status gutter
- **GIVEN** a folder group with session cards
- **WHEN** the folder body renders
- **THEN** no card SHALL render a status gutter (`data-rail-bg`), the list SHALL render one `--rail-directory` rail, and each card SHALL draw a 9px tick into it

#### Scenario: Drag bead masks the rail
- **WHEN** a session card is hovered
- **THEN** its drag bead SHALL reveal over the rail band with an opaque background so the rail does not bleed through the grip glyph

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

### Requirement: Folder slot pill exposes a surface variant selected by placement

`SlotPill` (`packages/dashboard-plugin-runtime/src/SlotPill.tsx`) SHALL accept an optional
`surface: "raised" | "flat"` prop defaulting to `"raised"`. The `surface` value SHALL affect ONLY
the pill body's background and shadow; the border, corner radius, hover-border, leading glyph chip,
and the overhanging capsule legend title SHALL be identical for both values.

- For `surface="raised"` (the default, used for sidebar folder cards) the pill body SHALL carry
  `bg-[var(--bg-secondary)]` and `shadow-[0_1px_2px_var(--shadow-card)]` (the current appearance,
  unchanged).
- For `surface="flat"` (used when a folder section is rendered inside a session card) the pill body
  SHALL carry `bg-[color-mix(in_srgb,var(--bg-surface)_50%,transparent)]` and SHALL NOT carry any
  `shadow-*` token — matching the `SessionSubcard` translucent panel surface so a folder section in
  a session card is visually consistent with the sibling OPENSPEC / GIT / PROCESS subcards.

The folder-section slot props SHALL carry an optional `placement: "sidebar" | "card"` defaulting to
`"sidebar"`. A folder-section component SHALL pass `surface="flat"` to `SlotPill` when
`placement === "card"` and `surface="raised"` (or omit it) otherwise. The `worktree-card-section`
slot consumer (`WorktreeCardSectionSlot`) SHALL supply `placement: "card"` to every claim it
renders; the `sidebar-folder-section` consumer SHALL NOT set `placement` (defaulting to sidebar).

#### Scenario: SlotPill defaults to the raised sidebar surface
- **WHEN** `SlotPill` is rendered without a `surface` prop
- **THEN** its body SHALL carry `bg-[var(--bg-secondary)]` and the `shadow-[0_1px_2px_var(--shadow-card)]` token

#### Scenario: SlotPill flat surface matches the subcard panel
- **WHEN** `SlotPill` is rendered with `surface="flat"`
- **THEN** its body SHALL carry `bg-[color-mix(in_srgb,var(--bg-surface)_50%,transparent)]`
- **AND** its body SHALL NOT carry any `shadow-*` class token
- **AND** its border, rounded corners, glyph chip, and capsule legend SHALL be unchanged from the raised variant

#### Scenario: KB section renders flat inside a session card
- **WHEN** the KB folder section is rendered via the `worktree-card-section` slot on a worktree session card (placement `card`)
- **THEN** the KB pill SHALL render with the flat translucent surface (no shadow), visually matching the OPENSPEC / GIT / PROCESS subcards on the same card

#### Scenario: KB section stays raised in the sidebar
- **WHEN** the KB folder section is rendered via the `sidebar-folder-section` slot in the sidebar folder card (no placement supplied)
- **THEN** the KB pill SHALL render with the raised opaque surface (`bg-[var(--bg-secondary)]` + shadow), unchanged from today

