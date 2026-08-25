## MODIFIED Requirements

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
