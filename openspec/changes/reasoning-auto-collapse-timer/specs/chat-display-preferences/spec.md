## MODIFIED Requirements

### Requirement: Global display preferences SHALL gate chat-view elements
The dashboard MUST persist a `DisplayPrefs` object in `preferences.json` controlling which chat-view elements render. The schema SHALL include boolean flags for `tokenStatsBar`, `contextUsageBar`, `reasoning`, `toolResults`, `turnMetadata`, `debugTools`, plus a `toolCalls` sub-object with booleans `read`, `bash`, `edit`, `agent`, `generic`. The schema SHALL also include a numeric `reasoningAutoCollapseMs` controlling how long a live-streamed reasoning block stays expanded after it completes before auto-collapsing.

`reasoningAutoCollapseMs` SHALL default to `30000` (30 seconds). A value of `0` SHALL mean "never auto-collapse" — a live-streamed reasoning block stays expanded until the user collapses it. The value SHALL only affect live-streamed reasoning blocks; replayed blocks are unaffected.

#### Scenario: Reasoning hidden when disabled
- **GIVEN** global `displayPrefs.reasoning = false`
- **WHEN** the chat view renders a turn containing reasoning content
- **THEN** no reasoning block SHALL render
- **AND** `reasoningAutoCollapseMs` SHALL have no effect

#### Scenario: Default auto-collapse delay
- **GIVEN** a `DisplayPrefs` object with no explicit `reasoningAutoCollapseMs`
- **WHEN** it is loaded or merged from a preset
- **THEN** the effective value SHALL be `30000`

#### Scenario: Legacy preferences file is backfilled
- **GIVEN** a persisted `preferences.json` whose `displayPrefs` predates the field and has no `reasoningAutoCollapseMs`
- **WHEN** the preferences store loads it
- **THEN** `reasoningAutoCollapseMs` SHALL be set to `30000` before it reaches any client
- **AND** the client SHALL never observe `reasoningAutoCollapseMs` as `undefined`

#### Scenario: Partial PATCH preserves the field
- **GIVEN** a stored `reasoningAutoCollapseMs` value
- **WHEN** a `PATCH /api/preferences/display` updates a different display field and omits `reasoningAutoCollapseMs`
- **THEN** the stored and broadcast `reasoningAutoCollapseMs` SHALL retain its prior value
- **AND** SHALL NOT be reset to `undefined`

### Requirement: Per-session overrides SHALL deep-merge over global prefs
Per-session `displayPrefsOverride` SHALL deep-merge over the global `DisplayPrefs` via `mergeDisplayPrefs`. Scalar and numeric fields present in the override SHALL win over the global value; absent fields SHALL fall through to global. `reasoningAutoCollapseMs` SHALL follow the same rule, and an override value of `0` SHALL be preserved (not coerced to the default).

#### Scenario: Boolean override wins
- **GIVEN** global `displayPrefs.reasoning = true`, `tokenStatsBar = true`
- **AND** session override `{ reasoning: false }`
- **WHEN** effective prefs are computed
- **THEN** the result has `reasoning: false` and `tokenStatsBar: true`

#### Scenario: Numeric override precedence
- **GIVEN** global `reasoningAutoCollapseMs = 30000`
- **AND** session override `{ reasoningAutoCollapseMs: 0 }`
- **WHEN** effective prefs are computed
- **THEN** the result has `reasoningAutoCollapseMs: 0`
