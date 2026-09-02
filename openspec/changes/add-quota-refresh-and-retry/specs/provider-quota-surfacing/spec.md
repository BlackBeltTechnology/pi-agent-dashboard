## ADDED Requirements

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
