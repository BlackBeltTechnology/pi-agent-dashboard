## MODIFIED Requirements

### Requirement: Quota tracking SHALL be disabled by default, opt-in, per-provider, ToS-gated
The plugin MAY be bundled but SHALL be **disabled by default** (plugin activation
UI). Beyond activation it SHALL require a one-time Terms-of-Service acknowledgement
AND per-provider enablement (`plugins.quota.providers.<id>.enabled`, off by
default). None of activation, ack, or per-provider enable SHALL be turned on by
migration or upgrade. No subscription-quota endpoint call SHALL occur unless the
plugin is enabled AND acknowledged AND that provider is enabled.

The settings section SHALL show the Terms-of-Service warning as a visible
warning-tone notice (testid `quota-tos-warning`) placed above the provider list,
with its full text in the page — never only in a tooltip or `title` attribute — so
keyboard, screen-reader and touch users can read it. The notice SHALL use the
`--severity-warning-*` tokens with an icon and text at 12 px or larger.

#### Scenario: Disabled plugin fetches nothing
- **WHEN** the plugin is bundled but not enabled
- **THEN** the server entry SHALL make no quota endpoint call and expose no quota

#### Scenario: Per-provider gate
- **WHEN** the plugin is enabled, the ToS is acknowledged, and `openai-codex` is
  enabled but `github-copilot` is not
- **THEN** the server SHALL fetch Codex quota and SHALL NOT fetch Copilot quota

#### Scenario: Disable clears cached quota
- **WHEN** a previously-enabled provider is disabled
- **THEN** the server SHALL stop fetching it and clear its cached quota

#### Scenario: ToS warning is visible without hover
- **WHEN** the quota plugin is enabled and `/settings/plugins/quota` renders its body
- **THEN** a warning notice stating that quota checks call undocumented provider endpoints that may break the provider's terms SHALL be visible above the provider list
- **AND** its text SHALL be present in the DOM as visible content, not only in a `title` attribute

#### Scenario: Provider toggles default off
- **WHEN** the settings render with no saved `plugins.quota.providers`
- **THEN** every provider switch (testid `quota-provider-<id>`) SHALL be off

### Requirement: Retry SHALL be configurable, off by default, bounded, with an honest schedule preview
Retry SHALL be governed by `plugins.quota.retry.{enabled,maxAttempts,baseDelayMs,maxDelayMs}`,
defaulting to disabled and turned on by neither migration nor upgrade.
`maxAttempts` SHALL mean retries AFTER the initial attempt (`0` disables retry),
matching the shell's retry-settings semantics. Every numeric field SHALL be
schema-bounded and clamped to a safe value on read, so a malformed persisted
config can never drive an unbounded wait or a timer overflow. The settings
section SHALL present the retry controls with the shared settings field kit
inside a "Retries" settings group: a labelled switch for `retry.enabled`, and
number fields for `maxAttempts`, `baseDelayMs` and `maxDelayMs` whose units appear
as unit chips (e.g. "ms") and whose allowed ranges appear in the hint — never in
the label text. The number fields SHALL be disabled while retries are off. The
section SHALL display the backoff sequence and the TOTAL wall-clock time the
retries will consume — the between-attempt sleeps PLUS each attempt's request
timeout — before a provider is marked unavailable, as an info-tone notice with
text at 12 px or larger. Saving the settings SHALL preserve the retry
configuration alongside the existing enablement fields.

#### Scenario: Retry defaults off
- **WHEN** the plugin is enabled but no retry config was ever set
- **THEN** retry SHALL be disabled and the server SHALL make exactly one attempt
  per enabled provider

#### Scenario: Schedule preview states the real total
- **WHEN** the user sets `maxAttempts` and `baseDelayMs` in the settings
- **THEN** the preview SHALL render the backoff sequence and a total that
  INCLUDES the per-attempt request timeout, so the stated cost equals the
  worst-case wall-clock wait
- **AND** the preview (testid `quota-retry-preview`) SHALL be an info notice whose text is at least 12 px

#### Scenario: Retry fields disabled while retries are off
- **WHEN** the retry switch (testid `quota-retry-enabled`) is off
- **THEN** the Max retries, First wait and Longest wait number fields SHALL be disabled and no schedule preview SHALL render

#### Scenario: Units and ranges live in chips and hints
- **WHEN** the retry fields render
- **THEN** the delay fields SHALL show a "ms" unit chip and a hint stating the allowed range
- **AND** no label SHALL contain "(ms)"

#### Scenario: Malformed config is clamped, not obeyed
- **WHEN** the persisted retry config carries an out-of-range value (e.g. a
  negative or overflow-scale delay)
- **THEN** the server SHALL clamp it to the schema bound before any arithmetic
  or timer use and SHALL NOT produce an unbounded wait

#### Scenario: Saving provider toggles preserves retry
- **WHEN** the user changes a per-provider toggle and saves while a retry config
  exists
- **THEN** the persisted config SHALL retain the retry settings and SHALL NOT
  erase them

## ADDED Requirements

### Requirement: Quota settings body has no identity header and a distinct master switch

The quota settings body (testid `quota-settings`) SHALL NOT render a heading or id
chip repeating the plugin title ("Provider Quota") or id (`quota`), and SHALL NOT
wrap itself in its own bordered card. The master switch for `plugins.quota.enabled`
(testid `quota-enable`) SHALL be labelled "Check quotas" with a hint stating that
turning it off stops all checks while the plugin stays on. Providers SHALL render
as switches in a "Providers" settings group. All configuration SHALL save through
the host Save bar (draft id `plugin:quota`); config keys SHALL stay unchanged. No
text in the body SHALL render below 11 px, and no raw hex color SHALL be used.

#### Scenario: Body does not repeat identity
- **WHEN** the quota plugin is enabled and `/settings/plugins/quota` renders its body
- **THEN** the body SHALL contain no heading "Provider Quota" and no `quota` id chip

#### Scenario: Master switch names its effect
- **WHEN** the body renders
- **THEN** the switch `quota-enable` SHALL be labelled "Check quotas" with a hint saying the plugin stays on
- **AND** toggling it and committing from the host Save bar SHALL write `plugins.quota.enabled`

### Requirement: Each enabled provider shows a worded status pill

For each enabled provider row, the settings SHALL show a status pill carrying a
word derived from the live quota state: "Signed in" (success) when quota data
is present; otherwise by the existing unavailable reason — `no-credential` →
"Not signed in" (neutral), `peer-rejected` → "Request refused" (warning),
`no-data` → "No quota reported" (neutral), `no-adapter` → "Not supported"
(neutral). The quota plugin's ToS acknowledgement gate is unchanged by this
change. The word SHALL always be present (color is never the only
signal) and SHALL be at least 11 px. A disabled provider SHALL show no pill. The
reason testid `quota-provider-<id>-reason` SHALL be kept on the pill for a
non-signed-in state.

#### Scenario: Refused provider
- **WHEN** OpenCode Go is enabled and its quota request was refused
- **THEN** its row SHALL show a warning-tone pill with the words "Request refused"

#### Scenario: Missing credentials
- **WHEN** OpenRouter is enabled with no credential
- **THEN** its row SHALL show a pill "Not signed in" with testid `quota-provider-openrouter-reason`

#### Scenario: Disabled provider has no pill
- **WHEN** Copilot is disabled
- **THEN** its row SHALL show only the switch, with no status pill
