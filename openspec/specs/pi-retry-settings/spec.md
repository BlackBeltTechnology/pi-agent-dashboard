# pi-retry-settings Specification

## Purpose
TBD - created by archiving change retry-forever-with-stop-control. Update Purpose after archive.
## Requirements
### Requirement: Dashboard exposes pi's native retry policy as a GLOBAL editor

The dashboard SHALL expose pi's own retry policy as an editable settings surface on the Sessions
settings tab, covering ALL SIX native fields:

| Field | pi default |
|---|---|
| `retry.enabled` | `true` |
| `retry.maxRetries` | `3` |
| `retry.baseDelayMs` | `2000` |
| `retry.provider.timeoutMs` | SDK default (absent) |
| `retry.provider.maxRetries` | `0` |
| `retry.provider.maxRetryDelayMs` | `60000` |

These values are pi's, not the dashboard's: the dashboard SHALL NOT maintain a parallel retry
policy, and SHALL NOT implement a retry loop of its own.

The editor SHALL be GLOBAL only. pi has no persisted per-session retry policy —
`AgentSession.setAutoRetryEnabled` delegates to `SettingsManager.setRetryEnabled`, which writes the
global file — so the surface SHALL NOT present a per-session or project-scoped editor.

#### Scenario: Surface reads the effective policy

- **WHEN** the retry settings surface is opened
- **THEN** it SHALL display the values currently in `~/.pi/agent/settings.json`
- **AND** where a key is absent it SHALL display pi's own default from the table above

#### Scenario: All six native fields are editable

- **WHEN** the retry settings surface is rendered
- **THEN** it SHALL offer a control for each of `retry.enabled`, `retry.maxRetries`,
  `retry.baseDelayMs`, `retry.provider.timeoutMs`, `retry.provider.maxRetries`,
  `retry.provider.maxRetryDelayMs`

#### Scenario: No project-scope or per-session editor

- **WHEN** the retry settings surface is rendered
- **THEN** it SHALL NOT offer a project-scoped (`.pi/settings.json`) variant of any field
- **AND** it SHALL NOT offer a per-session retry control

#### Scenario: Defaults are pi's own until the user opts in

- **GIVEN** a dashboard installation whose user has never edited retry settings
- **THEN** no `retry` block SHALL have been written to `~/.pi/agent/settings.json`
- **AND** pi's behavior SHALL be unchanged from a dashboard-free install

#### Scenario: The invisible-wait consequence of the provider layer is disclosed

- **WHEN** the provider fields are rendered
- **THEN** the surface SHALL state that a wait taken inside the provider layer emits no event, so it
  renders as ordinary streaming with no attempt count or countdown

### Requirement: The editor lives on the Sessions tab and commits through the unified Save

The retry editor SHALL render on the **Sessions** settings tab, not Providers. Three of the six
fields (`retry.enabled`, `retry.maxRetries`, `retry.baseDelayMs`) are turn-level rather than
provider-scoped, the policy's observable effect is on a session (waiting / attempt n / countdown /
Stop), and the sibling turn-lifecycle settings (`askUserPromptTimeoutSeconds`,
`spawnRegisterTimeoutMs`) already live there. The enclosing section SHALL be titled "Retry"; the
provider trio keeps its own subheading inside it.

The editor SHALL NOT render a private Save button. It SHALL register as a draft source with the
panel's unified Save (see change: unify-settings-save-contract) so that a single Save commits every
dirty store, the nav rail shows a per-page dirty dot, and the leave guard offers Save / Discard /
Cancel. The registered `page` SHALL match the tab the section renders on. A commit that cannot
proceed SHALL reject rather than silently no-op, so the host keeps the source dirty and names it in
the partial-failure message instead of reporting a false success.

#### Scenario: Section renders exactly one heading

- **WHEN** the retry section is rendered inside its settings section
- **THEN** the title SHALL appear exactly once (the section provides it; the body SHALL NOT repeat it)

#### Scenario: No private Save button

- **WHEN** the retry settings surface is rendered
- **THEN** it SHALL NOT render its own Save control

#### Scenario: An edit marks the panel dirty on the Sessions page

- **GIVEN** the loaded policy is displayed
- **WHEN** the user changes any retry field
- **THEN** the source SHALL report dirty
- **AND** the unsaved-changes count SHALL include it
- **AND** the Sessions nav entry SHALL show a dirty dot

#### Scenario: The unified Save commits the retry policy

- **GIVEN** a dirty retry edit
- **WHEN** the user activates the panel's Save
- **THEN** the retry policy SHALL be written
- **AND** the source SHALL report clean afterwards

#### Scenario: Discard restores the loaded policy

- **GIVEN** a dirty retry edit
- **WHEN** the user discards
- **THEN** the fields SHALL return to the loaded values
- **AND** the source SHALL report clean

#### Scenario: A failed write keeps the source dirty

- **GIVEN** a dirty retry edit whose write will fail
- **WHEN** the unified Save runs
- **THEN** the commit SHALL reject
- **AND** the source SHALL remain dirty
- **AND** the panel SHALL name it among the failed sources rather than reporting success

#### Scenario: Invalid input rejects the commit

- **GIVEN** a field holding a value the validator rejects
- **WHEN** the unified Save runs
- **THEN** the commit SHALL reject
- **AND** nothing SHALL be written

### Requirement: Saving writes a merge-preserving global settings block

Saving SHALL write into the GLOBAL `~/.pi/agent/settings.json`. The write SHALL preserve every
unrelated key byte-identical, including keys the dashboard does not know about. The project-scoped
`.pi/settings.json` SHALL NEVER be written.

#### Scenario: Unrelated keys survive the write byte-identically

- **GIVEN** `~/.pi/agent/settings.json` contains `packages`, `extensions`, and
  `dashboardPluginBridges` keys
- **WHEN** the user saves a retry policy
- **THEN** the file SHALL contain the new `retry` block
- **AND** `packages`, `extensions`, and `dashboardPluginBridges` SHALL be byte-identical to their
  prior values

#### Scenario: Unknown keys inside the retry block survive

- **GIVEN** the file contains `retry.someFutureKnob`
- **WHEN** the user saves the six known fields
- **THEN** `retry.someFutureKnob` SHALL remain unchanged

#### Scenario: Project settings are never written

- **WHEN** any retry policy is saved
- **THEN** `<cwd>/.pi/settings.json` SHALL NOT be created or modified

### Requirement: Values are validated before they are written

The surface SHALL reject values pi cannot use. An invalid value SHALL NOT be written.

- `enabled` — boolean.
- `maxRetries` — non-negative integer.
- `baseDelayMs` — positive integer.
- `provider.timeoutMs` — positive integer, or absent (meaning "SDK default").
- `provider.maxRetries` — non-negative integer.
- `provider.maxRetryDelayMs` — non-negative integer; `0` disables pi's server-requested-delay limit.

#### Scenario: Invalid value is rejected

- **WHEN** the user submits `maxRetries: -1` or `baseDelayMs: 0`
- **THEN** the value SHALL NOT be written to the settings file
- **AND** the surface SHALL report the reason

#### Scenario: Provider fields validate independently

- **WHEN** the user submits `provider.maxRetryDelayMs: -5`
- **THEN** nothing SHALL be written
- **AND** the surface SHALL report the offending field

#### Scenario: An absent provider timeout is permitted

- **WHEN** `provider.timeoutMs` is left empty
- **THEN** the save SHALL succeed
- **AND** the key SHALL be omitted rather than written as `0` or `null`

#### Scenario: Large attempt counts are permitted, not capped

- **WHEN** the user submits `maxRetries: 100`
- **THEN** the value SHALL be accepted and written, because pi imposes no clamp on it
- **AND** the surface SHALL NOT impose a maximum of its own

#### Scenario: A long tail is warned about, not refused

- **WHEN** the entered values yield more than ~20 attempts
- **THEN** the surface SHALL show a non-blocking warning carrying the computed total wait
- **AND** the value SHALL remain saveable

#### Scenario: Retry can be disabled entirely

- **WHEN** the user turns `retry.enabled` off and saves
- **THEN** `retry.enabled: false` SHALL be written
- **AND** the agent-level attempt-count and base-delay controls SHALL be shown as inactive, because
  pi ignores them when retry is disabled

### Requirement: Saving applies the policy to running sessions

Because pi reads its settings once, at session construction, a settings write alone SHALL NOT be
treated as applied. On a successful save the dashboard SHALL reload every connected session so the
new policy takes effect immediately.

#### Scenario: Connected sessions are reloaded on save

- **GIVEN** three sessions are connected to the dashboard
- **WHEN** the user saves a new retry policy
- **THEN** the dashboard SHALL dispatch a reload to each of the three sessions

#### Scenario: A failed write does not reload anything

- **GIVEN** the settings file cannot be written (permissions, invalid JSON on disk)
- **WHEN** the user saves
- **THEN** no session SHALL be reloaded
- **AND** the surface SHALL report the failure

#### Scenario: Global scope is disclosed

- **WHEN** the retry settings surface is rendered
- **THEN** it SHALL state that the policy is global and also affects pi sessions started outside the
  dashboard

### Requirement: The delay curve is disclosed, not hidden

Because pi's agent-level delay is `baseDelayMs · 2^(attempt-1)` with no ceiling, the surface SHALL
show the consequence of the chosen values rather than leaving the user to discover a multi-hour tail.

#### Scenario: Surface previews the resulting schedule

- **WHEN** `maxRetries: 8` and `baseDelayMs: 2000` are entered
- **THEN** the surface SHALL show the resulting delay progression and the total time before the turn
  finally fails

