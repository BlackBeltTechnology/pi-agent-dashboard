## ADDED Requirements

### Requirement: `ui:action-list` items accept an optional tone

`UiActionListItem` SHALL accept an optional `tone` whose type is the shared `UiTone` union `"go" | "create" | "caution" | "danger"`. The shared package SHALL export `UiTone`, the readonly `UI_TONES` list and an `isUiTone(value)` runtime guard next to `UiActionListItem`, so that every layer validates with one guard. The field is additive. An item without `tone` SHALL render exactly as before.

The `ui:action-list` renderer SHALL honour `tone` in both of its modes:
- **Menu mode** (inside an `ActionListMenuContext`): the item follows the menu tone rendering of `session-actions-menu`. Its icon is coloured with the tone's `--accent-<hue>-text` token. An enabled `danger` item has a `--tint-red-bg` hover and focus background. A disabled item drops the colour. The item carries `data-action-tone`.
- **Inline mode:** the icon is coloured with the tone's `--accent-<hue>-text` token, the label keeps the neutral colour, and the button carries `data-action-tone`.

Intent props are untyped, so `ActionList` SHALL validate `tone` with `isUiTone` before using it for colour or `data-action-tone`. Any value outside the union SHALL render as neutral, including inherited object keys (`constructor`, `__proto__`) and non-strings. The item SHALL still render and stay activatable, and no error SHALL be thrown. Tone SHALL NOT alter the item's activation, disabled behaviour or accessible name.

#### Scenario: Toned item renders a coloured icon in menu mode
- **WHEN** `ActionList` renders inside `ActionListMenuContext` with `actions: [{ label: "Delete", icon: "mdiDelete", tone: "danger" }]`
- **THEN** the `menuitem` SHALL carry `data-action-tone="danger"`
- **AND** its icon SHALL use `--accent-red-text`

#### Scenario: Toned item renders a coloured icon inline
- **WHEN** `ActionList` renders without a menu context with `actions: [{ label: "Run", icon: "mdiPlay", tone: "go" }]`
- **THEN** the button's icon SHALL use `--accent-green-text`
- **AND** its label SHALL keep the neutral colour

#### Scenario: Unknown tone renders neutral
- **WHEN** an intent publishes an action with `tone: "purple"`, and separately with `tone: "__proto__"` and `tone: 42`
- **THEN** the item SHALL render with no `data-action-tone` and a neutral icon
- **AND** activating it SHALL run its handler

#### Scenario: Untoned item is unchanged
- **WHEN** `ActionList` renders `actions: [{ label: "Open", icon: "mdiOpenInNew" }]`
- **THEN** the rendered markup SHALL carry no `data-action-tone`, and no element SHALL gain a `class` attribute it did not have before (no empty `class=""`)
