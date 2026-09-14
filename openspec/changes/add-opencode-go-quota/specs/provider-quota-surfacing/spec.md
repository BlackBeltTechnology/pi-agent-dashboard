# provider-quota-surfacing Specification

## ADDED Requirements

### Requirement: Server SHALL fetch opencode-go Go-subscription quota
When the plugin is enabled and `opencode-go` is enabled, the server SHALL fetch
the OpenCode **Go subscription** usage from `GET https://opencode.ai/zen/go/v1/usage`
with the `opencode-go` credential as `Authorization: Bearer <token>`, resolved
through the host auth abstraction (never a hardcoded auth.json path). The request
SHALL carry a non-default `User-Agent` header, because the default client
fingerprint is rejected by the endpoint's edge (Cloudflare 1010 → HTTP 403) in a
way indistinguishable from an auth failure. The response's `usage.rolling`,
`usage.weekly`, and `usage.monthly` — each `{ status, percent, resetsAt }` — SHALL
map to normalized quota windows. A window SHALL be emitted whenever it carries a
finite `percent` AND a usable reset stamp, REGARDLESS of its `status` (so an
`exceeded`/throttled cadence is still shown, not hidden). `percent` SHALL be
treated as percent USED and clamped to `0..100`.

#### Scenario: Go usage exposed
- **WHEN** `opencode-go` is enabled and the endpoint returns
  `{ usage: { rolling: { status:"ok", percent, resetsAt }, weekly:{…}, monthly:{…} } }`
- **THEN** `GET /api/quota` SHALL include `opencode-go` with three normalized
  windows carrying `usedPercent` (0..100) and `resetsAt`

#### Scenario: User-Agent required
- **WHEN** the server fetches opencode-go quota
- **THEN** the request SHALL send a non-default `User-Agent` header so the edge
  does not reject it as a bot (which would surface as a false auth failure)

#### Scenario: No Go subscription on the key
- **WHEN** the endpoint returns 403 `EntitlementError` (valid key, not on Go)
- **THEN** the server SHALL treat it as a terminal failure, SHALL NOT retry, and
  SHALL report `opencode-go` as unavailable rather than a stale or zero window

#### Scenario: Edge block is not misread as no-subscription
- **WHEN** the endpoint returns a 403 whose body signals a Cloudflare 1010 edge
  block (not an entitlement error)
- **THEN** the server SHALL report `opencode-go` unavailable with a DISTINCT
  detail identifying the edge block, so it is not conflated with "no subscription"

#### Scenario: Non-ok window still emitted
- **WHEN** a returned window has a finite `percent` and reset stamp but a `status`
  other than `"ok"`
- **THEN** that window SHALL still be exposed with its real `percent`, NOT dropped

#### Scenario: Malformed percent dropped
- **WHEN** a returned window has a non-finite/absent `percent` or no reset stamp
- **THEN** that window SHALL be omitted rather than exposed as a misleading 0%

#### Scenario: Credential is header-only and correctly identified
- **WHEN** the opencode-go quota is fetched, exposed, or its error logged
- **THEN** the token SHALL be resolved for the `opencode-go` credential id (NOT
  the Zen `opencode` id), SHALL appear only in the request `Authorization`
  header, and no substring of it SHALL appear in `/api/quota`, any broadcast, or
  any log line

## MODIFIED Requirements

### Requirement: Wallet-balance and cookie-gated providers SHALL remain unsupported
The plugin SHALL NOT attempt a quota fetch for providers that expose only a wallet
balance with no resetting window (`deepseek`, `minimax`) or whose usage is reachable
only behind a browser-session cookie plus a workspace id — specifically the
OpenCode **Zen** pay-as-you-go gateway (`opencode`), whose balance requires the
`server.queryBilling` console RPC. This exclusion SHALL NOT apply to the OpenCode
**Go subscription** (`opencode-go`), which exposes a key-authenticated resetting-
window usage API and IS supported.

#### Scenario: Zen wallet not fetched
- **WHEN** the plugin is enabled
- **THEN** the server SHALL NOT call any `opencode` (Zen) balance/console endpoint
  and SHALL NOT list `opencode`, `deepseek`, or `minimax` as supported providers

#### Scenario: Go distinguished from Zen
- **WHEN** the supported-provider list is computed
- **THEN** it SHALL include `opencode-go` and SHALL NOT include `opencode`
