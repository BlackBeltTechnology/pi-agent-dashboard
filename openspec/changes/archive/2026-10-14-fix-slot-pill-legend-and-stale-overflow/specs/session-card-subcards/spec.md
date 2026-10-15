## MODIFIED Requirements

### Requirement: Subcard wrapper component renders translucent inset panel with capsule legend title
The desktop session card SHALL group related controls inside `SessionSubcard` wrappers. Each `SessionSubcard` SHALL render a border-only inset panel (no fill) with a small uppercase capsule (pill) legend overhanging the panel's top border (fieldset-legend style).

The panel container SHALL carry these class tokens: `relative`, `mt-2.5`, `rounded-lg`, `border border-[var(--border-subtle)]`, `px-2 pt-2.5 pb-1.5`, and SHALL carry no background (`bg-[…]`) class token.

The legend title SHALL be an absolutely-positioned `<span>` with class tokens: `absolute`, `-top-2`, `left-1/2`, `-translate-x-1/2`, `px-1.5`, `py-px`, `rounded-full`, `bg-[var(--bg-primary)]`, `border border-[var(--border-subtle)]`, `text-[11px]`, `font-semibold`, `uppercase`, `tracking-wide`, `text-[var(--text-secondary)]`, `leading-none`. It SHALL render the wrapper's `title` prop verbatim, and MAY host the subcard's legend menu. The legend's size, weight, tracking, overhang and colour match the folder slot pill legend (`directory-card-layout`); they take the `ui-contract.md` capsule-legend recipe (the `meta` 11 px step plus `uppercase`), and are pinned against the runtime's `SLOT_PILL_LEGEND` constant. The `mt-2.5` stacking gap and `pt-2.5` top padding SHALL keep a subcard's legend clear of the panel above it and of its own children.

#### Scenario: Subcard renders capsule legend and translucent panel
- **WHEN** `<SessionSubcard title="OPENSPEC">...</SessionSubcard>` is rendered with non-empty children
- **THEN** the rendered output SHALL contain a panel with class tokens `relative`, `mt-2.5`, `border`, `rounded-lg`, `pt-2.5` and no `bg-[` token, and not `mt-1.5` or `py-1.5`
- **AND** the panel SHALL contain a capsule `<span>` with text `OPENSPEC` carrying class tokens `absolute`, `-top-2`, `rounded-full`, `uppercase`, `tracking-wide`, `text-[11px]` and `text-[var(--text-secondary)]`, and not `text-[9px]`, `text-[12px]`, `tracking-wider` or `-top-1.5`
- **AND** the children SHALL be rendered inside the panel

#### Scenario: Stacked subcard legends do not overlap the panel above
- **WHEN** a desktop session card renders two or more subcards in sequence
- **THEN** each subcard legend's top edge lies at or below the bottom border edge of the element rendered directly above that subcard

#### Scenario: Subcard hides when children are null
- **WHEN** `<SessionSubcard title="MEMORY">{null}</SessionSubcard>` is rendered
- **THEN** the wrapper SHALL render nothing (no panel, no title row)

#### Scenario: Subcard hides when children are false
- **WHEN** `<SessionSubcard title="PROCESS">{false}</SessionSubcard>` is rendered
- **THEN** the wrapper SHALL render nothing

#### Scenario: Subcard hides when children are an empty array
- **WHEN** `<SessionSubcard title="FLOWS">{[]}</SessionSubcard>` is rendered
- **THEN** the wrapper SHALL render nothing

## ADDED Requirements

### Requirement: Worktree card-slot claims are spaced like subcards
The session card's worktree card-slot wrapper (`data-testid="worktree-card-section-gap"`, which hosts every `worktree-card-section` claim such as the KB and MCP slot pills) SHALL carry `mt-2.5`, `flex`, `flex-col` and `gap-2.5`, so that each claim's capsule legend clears both the subcard above the wrapper and the claim above it within the wrapper, by the same stacking gap as `SessionSubcard`.

#### Scenario: Wrapper carries the stacking tokens
- **WHEN** a desktop session card renders for a session whose `gitWorktree` is set
- **THEN** the `worktree-card-section-gap` element carries `mt-2.5`, `flex`, `flex-col` and `gap-2.5`, and not `mt-1.5`

#### Scenario: Second card-slot claim legend does not reach into the first
- **WHEN** the worktree card slot renders two claims (KB, then MCP) at 768 and 1440 px
- **THEN** the second claim's legend top edge lies at or below the first claim's bottom border edge
