## ADDED Requirements

### Requirement: Folder slot pill legend meets the type floor
The capsule legend of `SlotPill` SHALL render at `text-[12px]`, `font-semibold`, in `--text-secondary`, in both the raised and the flat surface variant, for every SlotPill user (folder sections such as KB, MCP, goals, automation, team and OpenSpec, and session-card placements). Legend structure (border, overhang, uppercase) is otherwise unchanged, and its fill keeps following the surface. Its size, weight and colour match the `SessionSubcard` legend; they take the `ui-contract.md` section-heading size, weight and colour, and keep `uppercase` as the documented capsule-legend exception.

#### Scenario: Legend size in both variants
- **WHEN** a `SlotPill` is rendered with `surface="raised"` and with `surface="flat"`
- **THEN** both legends carry `text-[12px]` and `text-[var(--text-secondary)]`, and neither carries `text-[9px]`
