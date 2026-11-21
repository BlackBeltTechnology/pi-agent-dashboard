## ADDED Requirements

### Requirement: Default model may follow a model role

The Default Model control SHALL offer the model-selector Role tab. Picking a role SHALL set `defaultModel` to the bare role ref `@<role>` (not the role's current model) and `defaultThinkingLevel` to `""`, and include both in the partial sent to `PUT /api/config`. When `defaultModel` is a role ref (`@<role>` or a hand-written `@<role>:<level>`), the control SHALL display it through the shared role-ref display: the role token with the model the role resolves to in the live role map. Picking a concrete model on the Models tab SHALL replace a role ref with that `provider/id`.

#### Scenario: Picking a role persists the ref
- **GIVEN** role `planning` resolves to `anthropic/claude-sonnet-5-5`
- **WHEN** the user opens the Default Model picker, switches to the Roles tab, and picks `@planning`
- **THEN** the partial sent to `PUT /api/config` SHALL contain `defaultModel: "@planning"` and `defaultThinkingLevel: ""`
- **AND** the control SHALL display `@planning` with `claude-sonnet-5-5`

#### Scenario: Re-picking the role drops a hand-written suffix
- **GIVEN** `defaultModel` is `@planning:low`
- **WHEN** the user picks `@planning` on the Roles tab
- **THEN** the partial sent to `PUT /api/config` SHALL contain `defaultModel: "@planning"`

#### Scenario: Concrete pick replaces a role ref
- **GIVEN** `defaultModel` is `@planning`
- **WHEN** the user picks `anthropic/claude-opus-5-5` on the Models tab
- **THEN** the partial sent to `PUT /api/config` SHALL contain `defaultModel: "anthropic/claude-opus-5-5"`

#### Scenario: Roles API absent
- **GIVEN** `defaultModel` is `@planning` and `GET /api/roles` does not answer 2xx
- **WHEN** the Sessions page renders and the user opens the picker
- **THEN** the control SHALL display the `@planning` token
- **AND** the picker SHALL NOT offer a Roles tab

### Requirement: Default model callout explains what a role default resolves to

While `defaultModel` is a role ref and the roles API answers, the Default Model callout SHALL show a follow hint rendering the role ref through the shared role-ref display (role + the `provider/id` it resolves to in the live role map) plus the active preset name, stating that a preset switch changes the model of the next new session. When the role does not resolve to a `provider/id` in the live map (unknown, unassigned, or assigned a value without `provider/`), the callout SHALL instead show a warning-tone notice with the role ref, the active preset name, and the statement that new sessions use pi's own default model until the role is assigned; this notice SHALL replace the pi-mirror skip notice for the same save. With no active named preset, both SHALL omit the preset name. The Sessions page SHALL read the roles API when it mounts and after each Default Model pick. When the roles API does not answer, neither SHALL render.

#### Scenario: Follow hint names preset and resolved model
- **GIVEN** `defaultModel` is `@planning`, the active preset is `Anthropic`, and `planning` resolves to `anthropic/claude-sonnet-5-5`
- **WHEN** the Sessions page renders
- **THEN** the callout SHALL show a hint containing `@planning`, `Anthropic`, and `anthropic/claude-sonnet-5-5`

#### Scenario: Hint follows a preset switch
- **GIVEN** `defaultModel` is `@planning`
- **WHEN** the active preset changes from `Anthropic` to `Proxy`, where `planning` is `proxy/cc/claude-sonnet-5-5`, and the user then opens the Sessions page
- **THEN** the hint SHALL name `Proxy` and `proxy/cc/claude-sonnet-5-5`
- **AND** the persisted `defaultModel` SHALL still be `@planning`

#### Scenario: Unassigned role shows the fallback notice
- **GIVEN** `defaultModel` is `@validate` and `validate` has no model in the active preset `Free`
- **WHEN** the Sessions page renders
- **THEN** the callout SHALL show a warning-tone notice naming `@validate` and `Free` and stating that new sessions use pi's own default model

#### Scenario: No hint without the roles API
- **GIVEN** `defaultModel` is `@planning` and `GET /api/roles` does not answer 2xx
- **WHEN** the Sessions page renders
- **THEN** neither the follow hint nor the fallback notice SHALL render

## MODIFIED Requirements

### Requirement: Default thinking level control paired with the default model

The Sessions page SHALL render a thinking-level control inside the same
`--severity-info-*` callout that hosts the `defaultModel` control, positioned
beside the Default Model selector. The control SHALL be bound to
`config.defaultThinkingLevel`. When the user changes it, the Settings panel SHALL
include `defaultThinkingLevel` in the partial sent to `PUT /api/config`.

The control's selectable levels SHALL be derived from the currently selected
Default Model's supported thinking levels (the same `supportedThinkingLevels`
source used elsewhere in the client); for a role ref, from the model the role
resolves to in the live role map. When the selected Default Model changes, the
selectable levels SHALL re-derive from the newly selected model.

When the Default Model is a role ref and `defaultThinkingLevel` is empty, the
control SHALL display the role-derived level (the ref's `:<level>` suffix, else
the role-assigned level) with a `role` tag, or a `role` placeholder with no level
when no such level is known (roles API absent, role unresolved, or no suffix and
no role level); that display SHALL NOT be persisted and SHALL NOT read `off`
unless `off` is the derived level. A role-ref Default Model SHALL never lock the
control: selecting a level SHALL persist `defaultThinkingLevel`. When the
resolved model is not in the catalogue, all levels SHALL be selectable.

When **no** Default Model is selected, the control SHALL be locked to `off`: it
renders and displays `off`, and no other level is selectable. In this locked
state any selection interaction SHALL be a no-op for persistence — it SHALL NOT
add `defaultThinkingLevel` to the `PUT /api/config` partial and SHALL NOT write
`"off"`. The persisted `defaultThinkingLevel` SHALL remain `""` (empty — "do not
override"), never a spurious `off` override.

#### Scenario: Control renders beside the default model

- **WHEN** the Sessions page is rendered with a Default Model selected
- **THEN** a thinking-level control SHALL appear inside the Default Model callout beside the Default Model selector

#### Scenario: Levels filter to the selected model

- **WHEN** a Default Model with a limited set of supported thinking levels is selected
- **THEN** the thinking-level control SHALL offer only that model's supported levels

#### Scenario: Levels re-derive when the default model changes

- **WHEN** the user changes the Default Model to a different model
- **THEN** the thinking-level control's selectable levels SHALL re-derive from the newly selected model

#### Scenario: Locked to off when no model is selected

- **WHEN** the Sessions page is rendered with no Default Model selected
- **THEN** the thinking-level control SHALL display `off`
- **AND** no level other than `off` SHALL be selectable
- **AND** interacting with the locked control SHALL NOT persist any value
- **AND** the persisted `defaultThinkingLevel` SHALL remain an empty string

#### Scenario: Selecting a level persists it

- **WHEN** the user selects a supported thinking level with a Default Model selected
- **THEN** the Settings panel SHALL include `defaultThinkingLevel` set to that level in the partial sent to `PUT /api/config`

#### Scenario: Role level shown with a role tag

- **GIVEN** `defaultModel` is `@planning`, `defaultThinkingLevel` is `""`, and `planning` is assigned `anthropic/claude-sonnet-5-5:high`
- **WHEN** the Sessions page renders
- **THEN** the thinking-level control SHALL display `high` with a `role` tag

#### Scenario: Overriding a role level persists the Settings field

- **GIVEN** `defaultModel` is `@planning` and `defaultThinkingLevel` is `""`
- **WHEN** the user selects `low` in the thinking-level control
- **THEN** the partial sent to `PUT /api/config` SHALL contain `defaultThinkingLevel: "low"`
- **AND** `defaultModel` SHALL remain `@planning`
- **AND** the control SHALL display `low` without the `role` tag

#### Scenario: Unknown role level shows a placeholder, not off

- **GIVEN** `defaultModel` is `@validate`, `defaultThinkingLevel` is `""`, and `validate` has no model in the live role map
- **WHEN** the Sessions page renders
- **THEN** the thinking-level control SHALL show the `role` placeholder without a level
- **AND** selecting `low` SHALL include `defaultThinkingLevel: "low"` in the partial sent to `PUT /api/config`

### Requirement: Default model saves mirror into pi's global settings
When a Settings save carries a non-empty dashboard `defaultModel`, the dashboard SHALL derive a concrete
`provider/id`: the value itself, or — for a role ref `@<role>[:<level>]` — the model the role resolves to in
the current role map. The dashboard SHALL then write pi's global `~/.pi/agent/settings.json`
`defaultProvider` (text before the first `/`) and `defaultModel` (text after it). The thinking level to
mirror SHALL be, for a concrete model, the saved `defaultThinkingLevel`; for a role ref, the saved
`defaultThinkingLevel` when non-empty, else the ref suffix, else the role-assigned level (none when no
tier exists). While the persisted `defaultModel` is a role ref, a save carrying either `defaultModel` or
`defaultThinkingLevel` SHALL derive both pi keys. When that level is a
non-empty valid thinking level (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`), the dashboard
SHALL also write pi's `defaultThinkingLevel`. Clearing either dashboard value SHALL leave the
corresponding pi keys untouched; for a role-ref default an empty `defaultThinkingLevel` is not a clear
when a suffix or role level supplies the level. A concrete value with no `/`, or a role ref that does not resolve, SHALL
skip the model mirror; the save response SHALL report the skip as non-failing and the Settings panel SHALL
show it as a non-blocking notice in the Default Model callout. An unparseable pi settings file SHALL NOT be
overwritten; that and any other mirror failure SHALL NOT fail the dashboard config save, and the save
response SHALL report it. The Settings panel SHALL show a reported mirror failure as a non-blocking
warning inside the Default Model callout while the save itself counts as saved. A save that carries
neither key SHALL NOT touch pi's file, and pi keys already equal to the derived values SHALL NOT be
rewritten.

While the roles plugin is installed and the persisted `defaultModel` is a role ref, the dashboard SHALL
re-run the mirror with the same rules whenever the effective role map changes (a preset Load, a role edit,
or an external edit of the role file) AND the role default's resolved model or effective level differs
from its resolution when last observed, so pi's default follows the role without a Settings save. A
role-map change that leaves the role default's resolution equal to the one last mirrored or observed, a
dashboard restart, or a role-map change while `defaultModel` is a concrete value SHALL NOT touch pi's file.
A role-ref value that does not resolve to a `provider/id` SHALL be reported as skipped with reason
`unresolved-role`.

The mirror SHALL NOT reload running sessions. Mirror writes SHALL use the same lock and atomic
replacement as the pi settings editor, and SHALL read the dashboard values to mirror from the persisted
dashboard config while holding that lock (not from the request), so overlapping config saves leave pi
matching the final dashboard value.

#### Scenario: Changing the default model updates pi's default
- **GIVEN** pi's settings contain `defaultProvider: "anthropic"`, `defaultModel: "claude-opus-5"`
- **WHEN** the user saves Default model `anthropic/claude-opus-5-5`
- **THEN** pi's settings SHALL contain `defaultProvider: "anthropic"` and `defaultModel: "claude-opus-5-5"`
- **AND** every other key in pi's settings SHALL be unchanged

#### Scenario: Model id containing a slash splits on the first slash
- **WHEN** the user saves Default model `openrouter/deepseek/deepseek-v4.1-flash`
- **THEN** pi's settings SHALL contain `defaultProvider: "openrouter"` and `defaultModel: "deepseek/deepseek-v4.1-flash"`

#### Scenario: Clearing the dashboard default leaves pi untouched
- **GIVEN** pi's settings contain `defaultModel: "claude-opus-5-5"`
- **WHEN** the user clears Default model and saves
- **THEN** pi's `defaultModel` SHALL still be `"claude-opus-5-5"`

#### Scenario: Thinking level mirrors
- **WHEN** the user saves default thinking level `high`
- **THEN** pi's settings SHALL contain `defaultThinkingLevel: "high"`

#### Scenario: Mirror failure does not fail the config save
- **GIVEN** pi's settings file cannot be written
- **WHEN** the user saves a new Default model
- **THEN** `~/.pi/dashboard/config.json` SHALL contain the new value
- **AND** the save response SHALL report the mirror failure
- **AND** the Default Model callout SHALL show a warning while the Save Bar shows the saved state

#### Scenario: Unparseable pi file is never overwritten by the mirror
- **GIVEN** `~/.pi/agent/settings.json` contains truncated JSON
- **WHEN** the user saves a new Default model
- **THEN** `~/.pi/agent/settings.json` SHALL be byte-identical to before
- **AND** the save response SHALL report a parse failure

#### Scenario: Model without a provider separator is skipped, not failed
- **WHEN** a config save sets `defaultModel` to `claude-opus-5-5` (no `/`)
- **THEN** pi's settings SHALL be unchanged
- **AND** the save response SHALL report the mirror as skipped, not failed
- **AND** the Default Model callout SHALL show a non-blocking notice

#### Scenario: Overlapping config saves converge on the final value
- **WHEN** two config saves setting Default model to `anthropic/a` and then `anthropic/b` overlap
- **THEN** after both complete, pi's `defaultModel` SHALL equal the model id in the dashboard's persisted `defaultModel`

#### Scenario: Unrelated config save does not touch pi's file
- **WHEN** the user saves a change to an unrelated setting only
- **THEN** `~/.pi/agent/settings.json` SHALL be byte-identical to before

#### Scenario: Role ref mirrors its resolved model and level
- **GIVEN** role `planning` is assigned `anthropic/claude-sonnet-5-5:high`
- **WHEN** the user picks `@planning` on the Roles tab and saves
- **THEN** pi's settings SHALL contain `defaultProvider: "anthropic"`, `defaultModel: "claude-sonnet-5-5"`, and `defaultThinkingLevel: "high"`

#### Scenario: Unresolved role ref is skipped, not failed
- **GIVEN** role `validate` has no model in the current role map
- **WHEN** the user saves Default model `@validate`
- **THEN** pi's settings SHALL be unchanged
- **AND** the save response SHALL report the mirror as skipped, not failed

#### Scenario: Preset load re-mirrors a role default
- **GIVEN** the roles plugin is installed, `defaultModel` is `@planning`, and pi's `defaultModel` is `claude-sonnet-5-5`
- **WHEN** the user loads preset `Proxy`, where `planning` is `proxy/cc/claude-sonnet-5-5`
- **THEN** pi's settings SHALL contain `defaultProvider: "proxy"` and `defaultModel: "cc/claude-sonnet-5-5"` with no Settings save

#### Scenario: Unrelated role edit does not rewrite pi's default
- **GIVEN** the roles plugin is installed, the user saved Default model `@planning` (mirrored), and has since picked another model interactively in pi
- **WHEN** the user changes the model assigned to role `review` only
- **THEN** `~/.pi/agent/settings.json` SHALL be byte-identical to before

#### Scenario: Role-map change leaves a concrete default alone
- **GIVEN** `defaultModel` is `anthropic/claude-opus-5-5`
- **WHEN** the effective role map changes
- **THEN** `~/.pi/agent/settings.json` SHALL be byte-identical to before
