# provider-quota-surfacing Specification

## Purpose
TBD - created by archiving change add-provider-quota-plugin. Update Purpose after archive.
## Requirements
### Requirement: Quota tracking SHALL be disabled by default, opt-in, per-provider, ToS-gated
The plugin MAY be bundled but SHALL be **disabled by default** (plugin activation
UI). Beyond activation it SHALL require a one-time Terms-of-Service acknowledgement
AND per-provider enablement (`plugins.quota.providers.<id>.enabled`, off by
default). None of activation, ack, or per-provider enable SHALL be turned on by
migration or upgrade. No subscription-quota endpoint call SHALL occur unless the
plugin is enabled AND acknowledged AND that provider is enabled.

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

### Requirement: Server SHALL resolve credentials via the host auth abstraction
The server entry SHALL obtain provider credentials through the dashboard's own auth
abstraction (`InternalAuthStorage` / `provider-auth-storage.ts`), NOT by reading a
hardcoded `~/.pi/agent/auth.json` path. It SHALL adapt that resolver to the
`AuthStorage` shape `@latentminds/pi-quotas` consumes.

#### Scenario: No hardcoded path
- **WHEN** the server entry resolves a provider token
- **THEN** it SHALL call the host auth abstraction and SHALL NOT open the auth.json
  file directly

### Requirement: Anthropic SHALL be excluded from the subscription tracker
The plugin SHALL NOT attempt a subscription-quota fetch for Anthropic (pi blocks
Claude subscription inference server-side; API-key sessions return
`not_applicable`).

#### Scenario: Anthropic skipped
- **WHEN** the enabled provider set includes Anthropic
- **THEN** the server SHALL NOT call the Anthropic quota endpoint

### Requirement: Server SHALL fetch quota safely and expose it via an endpoint
When gated on, the server SHALL fetch via `@latentminds/pi-quotas` (its per-provider
TTL cache), suppress `not_applicable`, validate/clamp windows, and expose the result
at `GET /api/quota` as `{ providers: [{ provider, windows[] }] }`, where each window
carries `label`, `usedPercent` (0..100), `resetsAt`, and `windowSeconds`. Quota
SHALL NOT be persisted to the durable event store.

#### Scenario: Normalized quota exposed
- **WHEN** an enabled non-Anthropic OAuth provider returns usage
- **THEN** `GET /api/quota` SHALL include that provider's normalized windows incl.
  `windowSeconds`

#### Scenario: API-key session omitted
- **WHEN** a provider credential is a direct API key (`not_applicable`)
- **THEN** that provider SHALL be omitted from `/api/quota` with no error

### Requirement: Tokens SHALL never leave the server
The server SHALL expose and log only quota-derived fields. OAuth access/refresh
tokens and API keys SHALL NOT appear in `/api/quota`, any broadcast, or any log line
(error objects, URLs, and headers redacted).

#### Scenario: No secret in output or logs
- **WHEN** quota is exposed or a fetch error is logged
- **THEN** no substring of any provider token/key SHALL appear in the output or log

### Requirement: Client SHALL render a per-provider quota widget and degrade gracefully
The client entry SHALL render one quota mini-slider per enabled provider (matching
the context slider's shape), driven by `/api/quota`, and SHALL claim
`settings-section` for the ToS gate + per-provider toggles + window selection.

#### Scenario: Widget renders from /api/quota
- **WHEN** `/api/quota` returns a provider with windows
- **THEN** the client SHALL render that provider's mini-slider with a fill coloured
  by pace severity

#### Scenario: No data shows no widget
- **WHEN** `/api/quota` returns no providers (disabled or none enabled)
- **THEN** the client SHALL render no quota widget and no error

### Requirement: Client SHALL warn when usage outruns elapsed time, with safe math
The client SHALL derive pace per window using consistent units
(`secondsToReset = (Date.parse(resetsAt) − now) / 1000`;
`elapsedRaw = (windowSeconds − secondsToReset) / windowSeconds`;
`projected = usedPercent / min(elapsedRaw, 1)`) and SHALL warn when
`projected ≥ 100`. It SHALL return the guarded state BEFORE any division:
`windowSeconds ≤ 0` or non-finite → "pace unavailable"; non-finite
`Date.parse(resetsAt)` → "pace unavailable"; `elapsedRaw ≤ EPS` → "pace
unavailable"; `secondsToReset ≤ 0` → stale (grey, not "on pace"). It SHALL never
emit `Infinity`/`NaN` or a spurious warning.

#### Scenario: Just-reset window does not explode
- **WHEN** a window has just reset (`elapsedRaw ≤ EPS`)
- **THEN** the client SHALL render "pace unavailable" and produce no `Infinity`/`NaN`
  or warning

#### Scenario: Stale reset is not shown as on pace
- **WHEN** `resetsAt` is in the past (`secondsToReset ≤ 0`)
- **THEN** the window SHALL render greyed/stale and SHALL NOT report "on pace"

#### Scenario: Pace tick marks now
- **WHEN** a window is rendered (slider or dialog)
- **THEN** a `now` tick SHALL sit at `elapsed × 100`% of the track

### Requirement: Clicking a slider SHALL open the shared Dialog primitive with a provider selector
Clicking a mini-slider SHALL open the dashboard's shared `Dialog` primitive
(`useUiPrimitive(UI_PRIMITIVE_KEYS.dialog)`), pre-selected to that provider, with a
selector to switch provider or show all. The plugin SHALL NOT hand-roll a modal.

#### Scenario: Click opens dialog pre-selected to the provider
- **WHEN** the user clicks the Codex mini-slider
- **THEN** the shared `Dialog` SHALL open centered and modal, showing the Codex
  card (its windows with pace bars, `now` tick, projected %)

#### Scenario: Selector switches to all providers
- **WHEN** the user selects `All`
- **THEN** the dialog SHALL render a card for every provider in `/api/quota`

#### Scenario: Dialog inherits primitive behaviour
- **WHEN** the dialog is open
- **THEN** Esc and click-outside SHALL close it and it SHALL expose `role="dialog"`
  with `aria-modal`

### Requirement: Plugin load failure SHALL be isolated
A failure to load the quota-plugin (including an unavailable/broken
`@latentminds/pi-quotas`) SHALL NOT crash the dashboard shell.

#### Scenario: Broken dependency surfaced in health
- **WHEN** the quota-plugin fails to load
- **THEN** `/api/health.plugins[]` SHALL report it with an error and the rest of the
  shell SHALL function normally

