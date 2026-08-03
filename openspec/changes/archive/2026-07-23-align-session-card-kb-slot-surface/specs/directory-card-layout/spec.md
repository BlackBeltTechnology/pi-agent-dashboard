## ADDED Requirements

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
