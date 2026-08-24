# composer-grammar-check Specification

## ADDED Requirements

### Requirement: Corrections-panel controls meet AA contrast and use one visual scale

The corrections panels SHALL render their solid-accent controls (Apply-all in both
presentations, and the active mode tab in the redline presentation) with a label that meets
**WCAG-AA 4.5:1** against that control's own background, since those labels are 11-12px normal
text. Because the raw `--accent-primary` token does not clear 4.5:1 against white in the default
theme, the panels SHALL use the shared darkened accent background
(`ACCENT_BUTTON_BG` = `color-mix(in srgb, var(--accent-primary) 85%, black)`) rather than the raw
token. The panels SHALL also use a single icon family (`@mdi`) for all glyph affordances and a
single radius/size scale (no sub-11px font sizes, no mixed `rounded`/`rounded-md`).

#### Scenario: Apply-all label clears AA in every theme
- **WHEN** either corrections panel renders its Apply-all control
- **THEN** the control's background SHALL be the darkened accent mix, NOT raw
  `bg-[var(--accent-primary)]`
- **AND** its white label SHALL meet at least 4.5:1 against that background in every theme

#### Scenario: Active mode tab clears AA
- **WHEN** the redline panel's mode toggle renders with a selected mode
- **THEN** the selected tab SHALL carry the darkened accent background
- **AND** the unselected tabs SHALL carry no accent background

#### Scenario: Glyph affordances use one icon family
- **WHEN** the panels render Apply / Ignore / close / status affordances
- **THEN** each SHALL render an `@mdi` icon
- **AND** no bare unicode glyph (`✓`, `✕`, `●`) SHALL be used as an affordance

#### Scenario: One radius and size scale
- **WHEN** any corrections-panel element renders
- **THEN** its corner radius SHALL come from the single `rounded-md` scale
- **AND** no rendered text SHALL be smaller than 11px
