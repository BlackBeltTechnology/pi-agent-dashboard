# provider-quota-surfacing Specification

## Purpose
Surface per-account provider subscription quota (Codex, Copilot, OpenRouter,
Synthetic, Z.ai, OpenCode Go, Kimi) in the dashboard's cross-session web UI, so
operators can see how much subscription budget remains and whether usage is
outrunning the reset window — server-fetched, disabled by default, ToS-gated,
per-provider, Anthropic excluded, tokens never leaving the server.

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
`settings-section` for the ToS gate + master enable + per-provider toggles.

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

### Requirement: Quota dialog SHALL offer an on-demand refresh
The quota detail dialog SHALL provide a refresh control in its header that
re-queries `GET /api/quota` on demand, independent of the background poll, and
SHALL surface how recent the shown data is via a relative "last updated"
caption. The compact footer widget SHALL NOT gain a refresh control. A refresh
SHALL be single-flight: a stale (out-of-order) response SHALL NOT overwrite a
newer one, and the control SHALL be disabled while a request is in flight.

#### Scenario: Refresh re-queries on demand
- **WHEN** the user activates the refresh control in the open dialog
- **THEN** the client SHALL issue a fresh `GET /api/quota` and render the
  returned snapshot, updating the "last updated" caption

#### Scenario: Out-of-order response is discarded
- **WHEN** a manual refresh is issued while a poll (or earlier refresh) request
  is still outstanding, and the older request resolves last
- **THEN** the client SHALL keep the newest response and SHALL NOT clobber it
  with the older one, and SHALL NOT report a "last updated" time older than the
  newest applied snapshot

#### Scenario: Refresh failure degrades honestly
- **WHEN** the refresh request fails
- **THEN** the client SHALL keep the previously shown snapshot and SHALL NOT
  render an error dialog

#### Scenario: Refresh dropping the selected provider falls back
- **WHEN** a refresh returns a snapshot that no longer contains the
  currently-selected provider
- **THEN** the dialog SHALL fall back to the `All` selection rather than render
  an empty detail view

### Requirement: Server SHALL retry transient quota-fetch failures within a bounded budget
When retry is enabled, the server SHALL retry a provider whose fetch failed with
a TRANSIENT kind (`http` 429/5xx, `timeout`, `network`) using an exponential
backoff, and SHALL NOT retry a TERMINAL kind (`no-credential`, `no-adapter`,
`no-data`). Classification requires the fetcher layer to surface the underlying
failure kind rather than a single opaque kind. Retry SHALL run within the
`/api/quota` request and SHALL be bounded by a per-provider total wall-clock
budget (covering both the between-attempt sleeps and each attempt's request
timeout), so one provider can neither stall the shared snapshot without limit
nor be resurrected across the poll. Retry SHALL respect the existing gates: a
disabled plugin or disabled provider SHALL trigger no fetch and therefore no
retry. Every retried attempt SHALL reuse the existing scrubbed error path; the
change SHALL add no new log or output path that can carry a token.

#### Scenario: Transient failure is retried then succeeds
- **WHEN** an enabled provider's first fetch fails with `http` 429 and a
  subsequent attempt within budget succeeds
- **THEN** `/api/quota` SHALL return that provider's live windows and SHALL NOT
  mark it stale or unavailable

#### Scenario: Terminal failure is not retried
- **WHEN** an enabled provider's fetch fails with `no-credential`
- **THEN** the server SHALL make no further attempt for that provider and SHALL
  report it via the existing stale/unavailable handling

#### Scenario: Retry stays within the total budget
- **WHEN** a provider keeps failing transiently
- **THEN** the server SHALL stop retrying once the per-provider total budget is
  exhausted, fall back to the stale/unavailable handling, and the added latency
  for that provider SHALL NOT exceed the budget

#### Scenario: Disabled provider is never retried
- **WHEN** retry is enabled but a provider is disabled (or the plugin is
  disabled)
- **THEN** the server SHALL make zero fetch attempts and zero retries for it

#### Scenario: One provider's retries do not multiply another's attempts
- **WHEN** two providers are enabled and only one is failing transiently
- **THEN** the healthy provider SHALL be fetched once and its result SHALL NOT
  be delayed beyond the shared snapshot's slowest-branch completion

### Requirement: Retry SHALL be configurable, off by default, bounded, with an honest schedule preview
Retry SHALL be governed by `plugins.quota.retry.{enabled,maxAttempts,baseDelayMs,maxDelayMs}`,
defaulting to disabled and turned on by neither migration nor upgrade.
`maxAttempts` SHALL mean retries AFTER the initial attempt (`0` disables retry),
matching the shell's retry-settings semantics. Every numeric field SHALL be
schema-bounded and clamped to a safe value on read, so a malformed persisted
config can never drive an unbounded wait or a timer overflow. The settings
section SHALL present the retry controls reusing the existing plugin-settings
element vocabulary (checkbox + labelled number inputs + schedule preview) rather
than bespoke UI, and SHALL display the backoff sequence and the TOTAL wall-clock
time the retries will consume — the between-attempt sleeps PLUS each attempt's
request timeout — before a provider is marked unavailable. Saving the settings
SHALL preserve the retry configuration alongside the existing enablement fields.

#### Scenario: Retry defaults off
- **WHEN** the plugin is enabled but no retry config was ever set
- **THEN** retry SHALL be disabled and the server SHALL make exactly one attempt
  per enabled provider

#### Scenario: Schedule preview states the real total
- **WHEN** the user sets `maxAttempts` and `baseDelayMs` in the settings
- **THEN** the preview SHALL render the backoff sequence and a total that
  INCLUDES the per-attempt request timeout, so the stated cost equals the
  worst-case wall-clock wait

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
