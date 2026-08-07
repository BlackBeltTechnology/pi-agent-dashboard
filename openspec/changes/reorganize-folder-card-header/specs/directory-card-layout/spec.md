## MODIFIED Requirements

### Requirement: Folder slots render as single-concern pills in a responsive grid

The directory card (`SessionList.renderGroup`) SHALL present its folder slot sections — Automations, Goals, KB, OpenSpec — as discrete pills arranged in a grid, instead of dense one-line `LABEL (n) → ⟳ [action]` rows. Each slot pill SHALL show, at minimum: a slot-colored leading glyph, an uppercase slot label, and the slot's primary count/value; the slot's state (e.g. KB `⚠ N stale`, Automations `⚠ N invalid`) SHALL render inline within the same pill.

Each pill SHALL be a single click target that performs the slot's existing primary navigation (open board / open settings), and SHALL expose no other interactive control. A slot section SHALL keep its own data hook, but SHALL NOT render secondary action buttons (refresh, create, archive, reindex) inside the pill; those actions are contributed to the folder actions menu instead.

The grid SHALL use two columns at sidebar/desktop width and SHALL collapse to a single column at narrow (mobile) width. A slot section that renders nothing (e.g. a plugin disabled, or data not yet loaded) SHALL simply be absent from the grid without breaking the layout of the remaining pills.

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

#### Scenario: Pills expose no secondary action buttons
- **WHEN** the Automations, Goals, KB and OpenSpec pills render for a folder
- **THEN** none of them SHALL render a refresh, create, archive, specs, or reindex button
- **AND** the whole pill SHALL remain one click target

#### Scenario: A repeated glyph never carries two scopes
- **WHEN** the slot pill grid renders
- **THEN** no glyph SHALL appear more than once across the grid with a different meaning per occurrence

### Requirement: Folder slot pill exposes a surface variant selected by placement

The shared `SlotPill` primitive SHALL expose a body surface variant so a slot section reads correctly in both placements: `raised` (default) for sidebar folder cards, and `flat` for a folder section rendered inside a session card, matching the session subcard panel. Only the body background and shadow SHALL differ between variants; border, radius, hover border, glyph chip and capsule legend SHALL be identical.

The variant SHALL be selected by an explicit `placement` prop (`"sidebar" | "card"`), and `WorktreeCardSectionSlot` SHALL supply `placement="card"` so a folder section rendered inside a session card resolves to the flat surface. The flat surface SHALL use a translucent mix over `--bg-surface` with no shadow; the raised surface SHALL use the opaque secondary background with a card shadow. Both SHALL resolve from existing theme tokens.

`SlotPill` SHALL NOT expose a slot for caller-supplied action markup. Callers needing an action SHALL contribute a folder actions menu item instead, so the host owns grouping, ordering, keyboard semantics and mobile presentation.

#### Scenario: KB section renders flat inside a session card
- **WHEN** the KB folder section is rendered via the `worktree-card-section` slot on a session card
- **THEN** `WorktreeCardSectionSlot` SHALL supply `placement="card"`
- **AND** its pill SHALL use the `flat` surface variant

#### Scenario: SlotPill flat surface matches the subcard panel
- **WHEN** a `flat` pill renders beside a session subcard
- **THEN** its background and elevation SHALL match the subcard panel

#### Scenario: SlotPill rejects caller-supplied action markup
- **WHEN** a plugin renders a `SlotPill`
- **THEN** no prop SHALL accept arbitrary action markup for the pill's trailing region
