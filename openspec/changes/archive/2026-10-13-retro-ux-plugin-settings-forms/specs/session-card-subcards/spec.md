## MODIFIED Requirements

### Requirement: Subcard wrapper component renders translucent inset panel with capsule legend title
The desktop session card SHALL group related controls inside `SessionSubcard` wrappers. Each `SessionSubcard` SHALL render a border-only inset panel (no fill) with a small uppercase capsule (pill) legend overhanging the panel's top border (fieldset-legend style).

The panel container SHALL carry these class tokens: `relative`, `mt-1.5`, `rounded-lg`, `border border-[var(--border-subtle)]`, `px-2 py-1.5`, and SHALL carry no background (`bg-[…]`) class token.

The legend title SHALL be an absolutely-positioned `<span>` with class tokens: `absolute`, `-top-1.5`, `left-1/2`, `-translate-x-1/2`, `px-1.5`, `py-px`, `rounded-full`, `bg-[var(--bg-primary)]`, `border border-[var(--border-subtle)]`, `text-[12px]`, `font-semibold`, `uppercase`, `tracking-wider`, `text-[var(--text-secondary)]`, `leading-none`. It SHALL render the wrapper's `title` prop verbatim, and MAY host the subcard's legend menu. The legend's size, weight and colour match the folder slot pill legend (`directory-card-layout`); they take the `ui-contract.md` section-heading size, weight and colour, and keep `uppercase` as the documented capsule-legend exception.

#### Scenario: Subcard renders capsule legend and translucent panel
- **WHEN** `<SessionSubcard title="OPENSPEC">...</SessionSubcard>` is rendered with non-empty children
- **THEN** the rendered output SHALL contain a panel with class tokens `relative`, `border`, `rounded-lg` and no `bg-[` token
- **AND** the panel SHALL contain a capsule `<span>` with text `OPENSPEC` carrying class tokens `absolute`, `-top-1.5`, `rounded-full`, `uppercase`, `text-[12px]` and `text-[var(--text-secondary)]`, and not `text-[9px]`
- **AND** the children SHALL be rendered inside the panel

#### Scenario: Subcard hides when children are null
- **WHEN** `<SessionSubcard title="MEMORY">{null}</SessionSubcard>` is rendered
- **THEN** the wrapper SHALL render nothing (no panel, no title row)

#### Scenario: Subcard hides when children are false
- **WHEN** `<SessionSubcard title="PROCESS">{false}</SessionSubcard>` is rendered
- **THEN** the wrapper SHALL render nothing

#### Scenario: Subcard hides when children are an empty array
- **WHEN** `<SessionSubcard title="FLOWS">{[]}</SessionSubcard>` is rendered
- **THEN** the wrapper SHALL render nothing
