## ADDED Requirements

### Requirement: Slot pill glyph and state-marker colours resolve from host hue tokens

The slot pill's leading glyph SHALL paint `--accent-<hue>-text` on a `--tint-<hue>-bg` chip, and its hover border SHALL use `--tint-<hue>-border`, where `<hue>` is one of the host hue tokens. The pill's public accent values SHALL remain accepted unchanged and SHALL resolve as: `blue` and `indigo` → blue, `cyan` and `teal` → green, `purple` → purple, `red` → red. The mirrored OpenSpec pill's broken-state glyph SHALL use the same purple pair.

Inline state markers SHALL paint `--accent-orange-text` for warnings (Automations invalid count, MCP disabled-server count) and `--accent-red-text` for errors (MCP config parse error). Unit labels and state markers inside the pill SHALL render at 11 px or larger.

No slot pill, and no folder section that renders one, SHALL paint a raw palette colour class.

#### Scenario: Glyph meets the non-text floor in every palette

- **WHEN** each host hue used by the slot pill (blue, green, purple, red) is resolved in each of the 18 theme × mode combinations
- **THEN** `--accent-<hue>-text` against `--tint-<hue>-bg` SHALL measure at least 3:1

#### Scenario: Markers meet the text floor in every palette

- **WHEN** `--accent-orange-text` and `--accent-red-text` are resolved against `--bg-secondary` in each of the 18 theme × mode combinations
- **THEN** each SHALL measure at least 4.5:1

#### Scenario: Legacy accent keys keep working

- **GIVEN** a plugin passing accent `indigo` (Goals, MCP), `cyan` (KB) or `teal`
- **WHEN** its pill renders
- **THEN** the glyph SHALL paint `--accent-blue-text` (indigo) or `--accent-green-text` (cyan, teal) with no change at the call site

#### Scenario: Slot pills read in the light theme

- **GIVEN** the base light theme
- **WHEN** the directory card renders its Automations, Goals, KB, MCP, Team and OpenSpec pills, including an Automations invalid marker and an MCP disabled count
- **THEN** every glyph SHALL measure at least 3:1 and every marker at least 4.5:1 against its composited background
