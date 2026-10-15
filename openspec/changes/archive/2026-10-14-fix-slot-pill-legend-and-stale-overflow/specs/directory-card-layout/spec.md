## MODIFIED Requirements

### Requirement: Folder slots render as single-concern pills in a responsive grid

The directory card (`SessionList.renderGroup`) SHALL present its folder slot sections — Automations, Goals, KB, OpenSpec — as discrete pills arranged in a grid, instead of dense one-line `LABEL (n) → ⟳ [action]` rows. Each slot pill SHALL show, at minimum: a slot-colored leading glyph, an uppercase slot label, and the slot's primary count/value; the slot's state (e.g. KB alert icon + `N` with full "N stale" text for assistive tech and hover, Automations `⚠ N invalid`) SHALL render inline within the same pill. Each pill SHALL remain a single click target that performs the slot's existing primary navigation (open board / open settings), and each slot section SHALL keep its own data hook.

Slot pills SHALL be **state-only**: a pill SHALL render no secondary action buttons of any kind — no refresh, no create, no navigation shortcut. Pills read a number; the folder actions menu changes something. On this directory-card (sidebar) surface, every action a slot needs SHALL be contributed to the folder actions menu instead. The worktree-card placement — whose scope has no folder actions menu — is governed by the placement requirement below, which sanctions at most one sibling action control outside the pill root.

The pill component SHALL NOT expose a prop accepting arbitrary action markup. State markers that are *facts* rather than controls — such as the KB pill's inline stale marker — remain inside the pill; a stale badge appearing both on the pill (as state) and on the menu's reindex item (as that action's context) is intended, not duplication.

The grid SHALL use two columns at sidebar/desktop width and SHALL collapse to a single column at narrow (mobile) width. A slot section that renders nothing (e.g. a plugin disabled, or data not yet loaded) SHALL simply be absent from the grid without breaking the layout of the remaining pills.

#### Scenario: KB stale state renders inline in the KB pill
- **WHEN** the KB slot for a folder reports `chunks: 20230` and `staleCount: 1`
- **THEN** the KB pill SHALL show the KB glyph, the `KB` label, the `20.2k` (or `20,230`) chunk count, and an inline stale marker (alert icon + `1`) within the same pill, whose accessible text reads `1 stale`

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


### Requirement: Folder slot pill legend meets the type floor
The capsule legend of `SlotPill` SHALL render at `text-[11px]`, `font-semibold`, `uppercase`, `tracking-wide`, in `--text-secondary`, in both the raised and the flat surface variant, for every SlotPill user (folder sections such as KB, MCP, goals, automation, team and OpenSpec, and session-card placements) and for every hand-mirrored copy of the SlotPill chrome (the inert `cli-failed` OpenSpec pill in `FolderOpenSpecSection`). It SHALL overhang the pill's top border with `-top-2` so the capsule is centred on the border and does not reach the pill's content row. Legend structure (border, rounded capsule, centring) is otherwise unchanged, and its fill keeps following the surface. Its size, weight, tracking, overhang and colour match the `SessionSubcard` legend; they take the `ui-contract.md` capsule-legend recipe (the `meta` 11 px step plus `uppercase`), which `ui-contract.md` names as an explicit exception to the aligned-action-surface 12 px label rule.

#### Scenario: Legend size in both variants
- **WHEN** a `SlotPill` is rendered with `surface="raised"` and with `surface="flat"`
- **THEN** both legends carry `text-[11px]`, `uppercase`, `-top-2` and `text-[var(--text-secondary)]`
- **AND** neither carries `text-[9px]`, `text-[12px]`, `tracking-wider` or `-top-1.5`

#### Scenario: Mirrored OpenSpec pill legend matches SlotPill
- **WHEN** the OpenSpec folder section renders its inert `cli-failed` pill
- **THEN** its legend carries every token of the runtime's exported `SLOT_PILL_LEGEND` constant, the same constant `SlotPill` uses

#### Scenario: Legend stays clear of the content row
- **WHEN** the KB `SlotPill` renders in the sidebar folder grid (one column at 375 px, two columns at 768 and 1440 px)
- **THEN** the legend's bottom edge lies at or above the top edge of the glyph chip and the count line
