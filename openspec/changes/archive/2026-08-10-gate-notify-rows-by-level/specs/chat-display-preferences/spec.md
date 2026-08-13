# chat-display-preferences Specification (delta)

## ADDED Requirements

### Requirement: Notify minimum-level display preference

`DisplayPrefs` SHALL include a field `notifyMinLevel` of type
`"all" | "success" | "warnings" | "errors"` controlling the minimum
`ctx.ui.notify` level that renders as a chat row. It SHALL be part of all three
presets and of the sparse merge, exactly like other top-level `DisplayPrefs`
fields.

The severity ladder SHALL be `info < success < warning < error`. `success`
SHALL rank ABOVE `info` — a success notify reports an outcome, whereas info is
chatter — so `"success"` means "outcomes and problems, no chatter". This
ordering is a deliberate product decision and SHALL be documented at the type
definition.

The axis SHALL NOT include an "off" value. `"errors"` is its floor: an
`error`-level notify SHALL render at every setting.

Neither write path validates the value: `PATCH /api/preferences/display` merges
the partial as stored, the per-session override is persisted as received, and
the preferences file is a documented hand-editable surface. The predicate SHALL
therefore treat an unrecognized `notifyMinLevel` value as `"all"`, so that no
stored value can suppress an `error` notify.

`shared` SHALL export a single predicate that decides visibility of one row
against one `notifyMinLevel`. Both chat-view gate sites SHALL consume that one
predicate rather than re-deriving the comparison. Because `shared` cannot import
the client row type, the predicate SHALL accept a structural row shape covering
only the discriminator fields, and each gate site SHALL adapt its local object
to that shape rather than re-implementing the check against its own field names.

#### Scenario: Field present in every preset
- **GIVEN** the `DISPLAY_PRESETS` map
- **WHEN** any preset is read
- **THEN** it SHALL define `notifyMinLevel`
- **AND** `simple`, `standard` and `everything` SHALL all default it to `"all"`

#### Scenario: Level ranking places success above info
- **GIVEN** `notifyMinLevel = "success"`
- **WHEN** visibility is evaluated for each level
- **THEN** `success`, `warning` and `error` SHALL be visible
- **AND** `info` SHALL be hidden

#### Scenario: Errors survive the strictest setting
- **GIVEN** `notifyMinLevel = "errors"`
- **WHEN** visibility is evaluated for an `error`-level notify
- **THEN** it SHALL be visible
- **AND** no value of `notifyMinLevel` SHALL exist that hides it

#### Scenario: Unrecognized minimum-level value fails open
- **GIVEN** a persisted or overridden `notifyMinLevel` that is not one of `all`, `success`, `warnings`, `errors`
- **WHEN** visibility is evaluated for notify rows at every level
- **THEN** the floor SHALL be treated as `"all"`
- **AND** every notify row SHALL be visible, including `error`
- **AND** the comparison SHALL NOT yield `false` for all rows via an undefined rank

#### Scenario: Unrecognized level normalizes to info
- **GIVEN** a notify row whose `params.level` is absent or is not one of `info`, `success`, `warning`, `error`
- **WHEN** visibility is evaluated
- **THEN** the level SHALL be treated as `info`, matching `normalizeNotifyLevel`

#### Scenario: Per-session override wins over global
- **GIVEN** global prefs with `notifyMinLevel: "all"`
- **AND** a per-session override with `notifyMinLevel: "errors"`
- **WHEN** `mergeDisplayPrefs(global, override)` is evaluated
- **THEN** the effective value SHALL be `"errors"`

#### Scenario: Absent override falls back to global
- **GIVEN** global prefs with `notifyMinLevel: "warnings"`
- **AND** a per-session override that omits `notifyMinLevel`
- **WHEN** `mergeDisplayPrefs(global, override)` is evaluated
- **THEN** the effective value SHALL be `"warnings"`

#### Scenario: Legacy preferences file is backfilled
- **GIVEN** a persisted `preferences.json` whose `displayPrefs` predates the field and has no `notifyMinLevel`
- **WHEN** the preferences store loads it
- **THEN** `notifyMinLevel` SHALL be set to `"all"` before it reaches any client
- **AND** the client SHALL never observe `notifyMinLevel` as `undefined`

#### Scenario: Partial PATCH preserves the field
- **GIVEN** a stored `notifyMinLevel` value
- **WHEN** a `PATCH /api/preferences/display` updates a different display field and omits `notifyMinLevel`
- **THEN** the stored and broadcast `notifyMinLevel` SHALL retain its prior value
- **AND** SHALL NOT be reset to `undefined`

#### Scenario: Configurable from both settings surfaces
- **GIVEN** the global Settings panel
- **WHEN** the user changes the notify-level control
- **THEN** the global `notifyMinLevel` SHALL be patched
- **AND** the per-session chat-view menu SHALL expose the same 4-value control as an override, marked when it differs from global

### Requirement: Notify rows SHALL be hidable; blocking asks SHALL NOT

The rule that inline interactive-UI rows always render SHALL be narrowed to
**blocking** interactive rows. A `ctx.ui.notify` row is fire-and-forget —
nothing in the session waits on it — and SHALL be gated by `notifyMinLevel`.

A row that solicits an answer (`ask_user`, `select`, `confirm`, `input`, and any
future prompt kind) SHALL remain non-hidable at every value of every display
preference, because hiding an unanswered ask stalls the session with no visible
cause.

The gate SHALL identify a notify row by its own discriminator, and SHALL NOT
identify it by `role === "interactiveUi"` nor by the presence of a level field.
The predicate SHALL fail open: a row it cannot positively classify as a notify
SHALL render.

#### Scenario: A blocking ask renders at the strictest setting
- **GIVEN** `notifyMinLevel = "errors"`
- **WHEN** the chat view renders an unanswered `ask_user`, `select`, `confirm` or `input` row
- **THEN** the row SHALL render
- **AND** the session SHALL remain answerable

#### Scenario: Unclassifiable interactive row renders
- **GIVEN** an `interactiveUi` row that the notify predicate does not positively identify as a notify
- **WHEN** visibility is evaluated at any `notifyMinLevel`
- **THEN** the row SHALL render
