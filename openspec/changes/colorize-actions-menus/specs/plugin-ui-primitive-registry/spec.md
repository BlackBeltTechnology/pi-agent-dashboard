## ADDED Requirements

### Requirement: `ui:action-list` items accept an optional tone

`UiActionListItem` SHALL accept an optional `tone` whose type is the shared `UiTone` union `"go" | "create" | "caution" | "danger"`, exported from the shared package next to `UiActionListItem`. The field is additive. An item without `tone` SHALL render exactly as before.

The `ui:action-list` renderer SHALL honour `tone` in both of its modes:
- **Menu mode** (inside an `ActionListMenuContext`): the item follows the menu tone rendering of `session-actions-menu`. Its icon is coloured with the tone's `--tint-*-fg` token, a `danger` item has a `--tint-red-bg` hover, and a disabled item drops the colour. The item carries `data-tone`.
- **Inline mode:** the icon is coloured with the tone's `--tint-*-fg` token and the label keeps the neutral colour.

A `tone` value outside the union, which can arrive from an untyped intent payload, SHALL render as neutral. The item SHALL still render and stay activatable, and no error SHALL be thrown. Tone SHALL NOT alter the item's activation, disabled behaviour or accessible name.

#### Scenario: Toned item renders a coloured icon in menu mode
- **WHEN** `ActionList` renders inside `ActionListMenuContext` with `actions: [{ label: "Delete", icon: "mdiDelete", tone: "danger" }]`
- **THEN** the `menuitem` SHALL carry `data-tone="danger"`
- **AND** its icon SHALL use `--tint-red-fg`

#### Scenario: Toned item renders a coloured icon inline
- **WHEN** `ActionList` renders without a menu context with `actions: [{ label: "Run", icon: "mdiPlay", tone: "go" }]`
- **THEN** the button's icon SHALL use `--tint-green-fg`
- **AND** its label SHALL keep the neutral colour

#### Scenario: Unknown tone renders neutral
- **WHEN** an intent publishes an action with `tone: "purple"`
- **THEN** the item SHALL render with no `data-tone` and a neutral icon
- **AND** activating it SHALL run its handler

#### Scenario: Untoned item is unchanged
- **WHEN** `ActionList` renders `actions: [{ label: "Open", icon: "mdiOpenInNew" }]`
- **THEN** the rendered markup SHALL carry no `data-tone`, and its classes SHALL match the pre-change output
