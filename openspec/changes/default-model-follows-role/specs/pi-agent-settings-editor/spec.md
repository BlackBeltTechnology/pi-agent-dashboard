## MODIFIED Requirements

### Requirement: Explicit drift repair for the default model
The dashboard SHALL expose an action that writes pi's `defaultProvider`/`defaultModel` and
`defaultThinkingLevel` from the CURRENT dashboard `defaultModel`/`defaultThinkingLevel`, applying the same
rules as the save-time mirror (empty value leaves pi untouched; a model with no `/` is skipped; a role ref
`@<role>[:<level>]` is resolved against the current role map and skipped when it does not resolve; an
unparseable pi file is never overwritten). It SHALL NOT reload sessions. A dashboard value derives a pi
value only when it is non-empty and, for the model, contains `/` or is a role ref that resolves to a
`provider/id`. For a role ref, the derived thinking level SHALL follow the save-time mirror's precedence
(non-empty `defaultThinkingLevel`, else ref suffix, else role-assigned level, else none). The pi settings section SHALL offer
this action only when at least one derived value exists and differs from pi's value.

#### Scenario: Pre-existing drift is repaired
- **GIVEN** the dashboard `defaultModel` is `anthropic/claude-opus-5-5` and pi's `defaultModel` is `claude-opus-5`
- **WHEN** the user triggers "Apply dashboard default to pi"
- **THEN** pi's `defaultProvider` SHALL be `"anthropic"` and `defaultModel` SHALL be `"claude-opus-5-5"`

#### Scenario: Empty or separator-less dashboard value is never drift
- **GIVEN** the dashboard `defaultModel` is empty or is a concrete value (not starting with `@`) with no `/`, and its thinking level is empty
- **WHEN** the pi settings section renders
- **THEN** the drift-repair action SHALL NOT be shown, whatever pi's values are

#### Scenario: No action offered without drift
- **GIVEN** pi's default keys equal the values derived from the dashboard config
- **WHEN** the pi settings section renders
- **THEN** the drift-repair action SHALL NOT be shown

#### Scenario: Role default drift compares the resolved model
- **GIVEN** the dashboard `defaultModel` is `@planning`, `planning` resolves to `proxy/cc/claude-sonnet-5-5`, and pi's `defaultProvider`/`defaultModel` are `anthropic`/`claude-sonnet-5-5`
- **WHEN** the pi settings section renders
- **THEN** the drift-repair action SHALL be shown
- **AND** triggering it SHALL set pi's `defaultProvider` to `"proxy"` and `defaultModel` to `"cc/claude-sonnet-5-5"`

#### Scenario: Unresolved role default is never drift
- **GIVEN** the dashboard `defaultModel` is `@validate`, `validate` has no model in the current role map, and the thinking level is empty
- **WHEN** the pi settings section renders
- **THEN** the drift-repair action SHALL NOT be shown
