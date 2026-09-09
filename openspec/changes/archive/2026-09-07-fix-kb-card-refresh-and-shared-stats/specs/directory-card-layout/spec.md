# directory-card-layout — delta

## MODIFIED Requirements

### Requirement: Folder slots render as single-concern pills in a responsive grid

The directory card (`SessionList.renderGroup`) SHALL present its folder slot sections — Automations, Goals, KB, OpenSpec — as discrete pills arranged in a grid, instead of dense one-line `LABEL (n) → ⟳ [action]` rows. Each slot pill SHALL show, at minimum: a slot-colored leading glyph, an uppercase slot label, and the slot's primary count/value; the slot's state (e.g. KB `⚠ N stale`, Automations `⚠ N invalid`) SHALL render inline within the same pill. Each pill SHALL remain a single click target that performs the slot's existing primary navigation (open board / open settings), and each slot section SHALL keep its own data hook.

Slot pills SHALL be **state-only**: a pill SHALL render no secondary action buttons of any kind — no refresh, no create, no navigation shortcut. Pills read a number; the folder actions menu changes something. On this directory-card (sidebar) surface, every action a slot needs SHALL be contributed to the folder actions menu instead. The worktree-card placement — whose scope has no folder actions menu — is governed by the placement requirement below, which sanctions at most one sibling action control outside the pill root.

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

### Requirement: Folder slot pill exposes a surface variant selected by placement

`SlotPill` (`packages/dashboard-plugin-runtime/src/SlotPill.tsx`) SHALL accept an optional
`surface: "raised" | "flat"` prop defaulting to `"raised"`. The `surface` value SHALL affect ONLY
the pill body's background and shadow plus the capsule legend's fill; the border, corner radius,
hover-border, leading glyph chip, and the capsule legend's structure (border, text, overhang
position) SHALL be identical for both values.

- For `surface="raised"` (the default, used for sidebar folder cards) the pill body SHALL carry
  `bg-[var(--bg-secondary)]` and `shadow-[0_1px_2px_var(--shadow-card)]` (the current appearance,
  unchanged).
- For `surface="flat"` (used when a folder section is rendered inside a session card) the pill body
  SHALL carry NO fill and NO shadow (border only), matching the `SessionSubcard` border-only panel
  so a folder section in a session card is visually consistent with the sibling
  OPENSPEC / GIT / PROCESS subcards. The capsule legend's fill follows the surface it overhangs
  (the session-card background). See change: align-session-card-kb-slot-surface.

The folder-section slot props SHALL carry an optional `placement: "sidebar" | "card"` defaulting to
`"sidebar"`. A folder-section component SHALL pass `surface="flat"` to `SlotPill` when
`placement === "card"` and `surface="raised"` (or omit it) otherwise. The `worktree-card-section`
slot consumer (`WorktreeCardSectionSlot`) SHALL supply `placement: "card"` to every claim it
renders; the `sidebar-folder-section` consumer SHALL NOT set `placement` (defaulting to sidebar).

The state-only rule binds the **pill root**: no interactive element SHALL nest inside a pill's
button root in any placement. In the **card** placement — whose scope has no folder actions menu —
a folder section MAY render at most one compact action control as a **sibling** of its pill,
outside the pill root. The sidebar placement SHALL NOT render such a sibling control; sidebar
actions belong to the folder actions menu.

#### Scenario: SlotPill defaults to the raised sidebar surface
- **WHEN** `SlotPill` is rendered without a `surface` prop
- **THEN** its body SHALL carry `bg-[var(--bg-secondary)]` and the `shadow-[0_1px_2px_var(--shadow-card)]` token

#### Scenario: SlotPill flat surface matches the subcard panel
- **WHEN** `SlotPill` is rendered with `surface="flat"`
- **THEN** its body SHALL carry no fill (background) class token and no `shadow-*` class token — border only
- **AND** its border, rounded corners, glyph chip, and capsule legend structure SHALL be unchanged from the raised variant, while the legend's fill follows the surface it overhangs (`--bg-primary` when flat, the pill body's `--bg-tertiary` when raised)

#### Scenario: KB section renders flat inside a session card
- **WHEN** the KB folder section is rendered via the `worktree-card-section` slot on a worktree session card (placement `card`)
- **THEN** the KB pill SHALL render with the flat border-only surface (no fill, no shadow), visually matching the OPENSPEC / GIT / PROCESS subcards on the same card

#### Scenario: KB section stays raised in the sidebar
- **WHEN** the KB folder section is rendered via the `sidebar-folder-section` slot in the sidebar folder card (no placement supplied)
- **THEN** the KB pill SHALL render with the raised opaque surface (`bg-[var(--bg-secondary)]` + shadow), unchanged from today

#### Scenario: Card-placement sibling action control stays outside the pill root
- **WHEN** a folder section in the card placement renders an action control
- **THEN** the control SHALL be a sibling of the pill outside the pill's button root, and the pill root SHALL contain no interactive element
- **AND** in the sidebar placement no sibling action control SHALL render
