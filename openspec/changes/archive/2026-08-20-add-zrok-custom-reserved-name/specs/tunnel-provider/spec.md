# tunnel-provider Specification Delta

## MODIFIED Requirements

### Requirement: Provider and mode selection
`config.tunnel` SHALL carry `provider` and `mode`, both required when `enabled`. `provider`
names the **primary** provider. The server SHALL refuse to connect when `mode` is unset or
when the selected provider does not support the selected mode. Config keys SHALL remain
named `tunnel` (no rename of persisted keys). The zrok sub-shape SHALL carry `reservedName`
(v2 reserved name); a legacy `reservedToken` (v1) SHALL be preserved on read for downgrade
safety but SHALL NOT be used by the v2 provider and SHALL NOT be promoted to `reservedName`.

A non-primary provider opting in via `tunnel.<id>.enabled` SHALL carry its own
`tunnel.<id>.mode`, because mode support is per-provider and a single top-level `mode`
cannot satisfy two providers with disjoint support (zerotier is private-only; zrok and
ngrok are public-only, so `zrok` primary with `zerotier` also enabled is inexpressible
under one shared `mode`). When `tunnel.<id>.mode` is unset it SHALL default to that
provider's sole supported mode when it has exactly one, and otherwise be a configuration
error for that provider.

A mode rejection SHALL be scoped to the offending provider: an unsupported mode on the
**primary** SHALL refuse the connect as today, while an unsupported mode on a non-primary
provider SHALL disable only that provider and SHALL NOT prevent the remaining providers
from connecting.

#### Scenario: mode must be set explicitly
- **WHEN** `tunnel.enabled` is true and `tunnel.mode` is unset
- **THEN** the server SHALL NOT start a tunnel AND SHALL report a configuration error

#### Scenario: unsupported mode rejected
- **WHEN** `tunnel.provider` is `ngrok` or `zrok` and `tunnel.mode` is `private`
- **THEN** the server SHALL reject the configuration (public-only providers)
- **WHEN** `tunnel.provider` is `zerotier` and `tunnel.mode` is `public`
- **THEN** the server SHALL reject the configuration (private-only provider)

#### Scenario: legacy config back-compat
- **WHEN** an existing `config.json` has a bare `tunnel.reservedToken` and no `tunnel.provider`
- **THEN** the resolver SHALL treat it as `{ provider: "zrok", mode: "public", zrok: { reservedToken } }`

#### Scenario: legacy v1 reserved token is inert under v2
- **WHEN** an existing `config.json` has `tunnel.reservedToken` (or `tunnel.zrok.reservedToken`) and no `tunnel.zrok.reservedName`
- **THEN** the resolver SHALL still yield `{ provider: "zrok", mode: "public" }`, preserve the legacy token field on read, and the connect path SHALL NOT pass the v1 token to the v2 provider, so the provider creates an ephemeral share (never `share public -n public:<v1token>`)

#### Scenario: reservedName is plumbed through connect
- **WHEN** `tunnel.zrok.reservedName` is set and a connect is requested
- **THEN** the connect chain (config → CLI/server → `TunnelConnectOpts.reservedName` → provider) SHALL carry the name and the zrok provider SHALL serve that named share for a stable URL

#### Scenario: reservedName survives a partial config write
- **WHEN** a partial config write updates another `tunnel` field (e.g. `enabled`) while `tunnel.zrok.reservedName` is set
- **THEN** the deep-merge SHALL preserve `reservedName` (it is not dropped)

#### Scenario: A non-primary provider carries its own mode
- **GIVEN** `tunnel.provider` is `zrok` with `tunnel.mode` `public`, and `tunnel.zerotier.enabled` is true
- **WHEN** the config is resolved
- **THEN** zerotier SHALL take its mode from `tunnel.zerotier.mode`, defaulting to `private` as its sole supported mode
- **AND** the top-level `tunnel.mode` SHALL NOT be applied to zerotier

#### Scenario: An unsupported mode on a non-primary provider is contained
- **GIVEN** a non-primary provider is configured with a mode it does not support
- **WHEN** the server connects
- **THEN** that provider alone SHALL be disabled and reported as a configuration error
- **AND** the primary and every other enabled provider SHALL still connect

#### Scenario: An unsupported mode on the primary still refuses
- **WHEN** the primary provider's mode is unsupported
- **THEN** the server SHALL refuse to connect, exactly as before this change

## ADDED Requirements

### Requirement: Per-provider readiness state
The server SHALL expose, for every provider in `KNOWN_TUNNEL_PROVIDERS`, a readiness
state drawn from exactly four values: `not-installed | not-set | disconnected | connected`.

The state SHALL be derived from the three predicates the `TunnelProvider` seam already
declares, evaluated in order and short-circuiting:

| predicate | false → | true → |
|---|---|---|
| `detectBinary()` | `not-installed` | continue |
| `isEnrolled()` | `not-set` | continue |
| liveness (below) | `disconnected` | `connected` |

For a provider declaring `kind: "child"` the liveness predicate SHALL be `status().active`.

For a provider declaring `kind: "daemon"` (tailscale, zerotier) `status().active` SHALL NOT
be used: it returns `this.lastEndpoints.length > 0`, which records only whether *this server
process* completed a connect. A daemon brought up outside the dashboard would report
`disconnected` forever, and a daemon that died would report `connected` forever. Daemon
providers SHALL therefore expose a **live liveness probe** (`probeLive()`) that queries the
daemon itself — tailscale via its backend state (`tailscale serve status --json`, NOT
`tailscale status --json`, which reports peers/identity only), zerotier via network
authorization — and
readiness SHALL use it. This is additional logic on the provider seam; it does not change
the meaning of `status()` for the tunnel lifecycle.

A provider whose predicate throws SHALL resolve to the state for `false` rather than
propagating, so one broken CLI cannot blank the whole readiness report.

Every predicate invocation SHALL be bounded by a timeout of **4 seconds** — shorter than
the 5s poll interval, leaving headroom for a slow cold CLI without letting a hung one
survive into the next tick. A predicate that neither returns nor throws within that bound
SHALL be treated as `false` for that evaluation and the provider SHALL be reported with a
`stale` marker. Readiness SHALL return the providers that answered rather than waiting for
the slowest, so one hung CLI cannot freeze the whole report.

A full readiness tick across all known providers SHALL complete within **p95 < 2s** under
normal conditions, measured over a 10-minute window. Exceeding it means the cadence or the
per-provider cost must change before the feature ships.

#### Scenario: Binary absent
- **WHEN** `detectBinary()` returns false for a provider
- **THEN** its readiness SHALL be `not-installed`
- **AND** `isEnrolled()` and `status()` SHALL NOT be invoked for that provider

#### Scenario: Installed but not enrolled
- **WHEN** `detectBinary()` is true and `isEnrolled()` is false
- **THEN** its readiness SHALL be `not-set`

#### Scenario: Enrolled but no live endpoint
- **WHEN** `isEnrolled()` is true and the liveness predicate is false
- **THEN** its readiness SHALL be `disconnected`

#### Scenario: Serving traffic
- **WHEN** the liveness predicate is true
- **THEN** its readiness SHALL be `connected`
- **AND** the report SHALL carry that provider's endpoints

#### Scenario: A daemon connected outside the dashboard still reports endpoints
- **GIVEN** a `kind: "daemon"` provider is live but `lastEndpoints` is empty because this process never connected it
- **WHEN** readiness reports it as `connected`
- **THEN** the endpoints SHALL be derived from the live probe, not from `lastEndpoints`
- **AND** `probeLive()` SHALL therefore return the reachable endpoints alongside liveness, not a bare boolean

#### Scenario: A daemon started outside the dashboard reports connected
- **GIVEN** tailscale or zerotier is up but this server process never called `connect()`, so `lastEndpoints` is empty
- **WHEN** readiness is evaluated
- **THEN** the provider SHALL report `connected` on the strength of its live probe
- **AND** readiness SHALL NOT consult `status().active` for a `kind: "daemon"` provider

#### Scenario: A daemon that died reports disconnected
- **GIVEN** this server process connected a daemon provider and the daemon has since stopped
- **WHEN** readiness is evaluated
- **THEN** the provider SHALL report `disconnected`, not `connected` from stale in-memory endpoints

#### Scenario: A throwing predicate degrades only its own provider
- **WHEN** `isEnrolled()` throws for one provider
- **THEN** that provider SHALL report `not-set`
- **AND** every other provider's readiness SHALL still be reported

#### Scenario: A hung predicate degrades only its own provider
- **WHEN** a provider's predicate neither returns nor throws within its timeout bound
- **THEN** that provider SHALL be reported with its `false`-branch state and a `stale` marker
- **AND** every other provider's readiness SHALL be returned without waiting for it
- **AND** the bound SHALL be 4s, shorter than the 5s poll interval

#### Scenario: Readiness is reported for every provider, not just the configured one
- **WHEN** the readiness report is requested
- **THEN** it SHALL contain one entry per known provider, independent of `tunnel.provider`

### Requirement: Readiness reflects changes made outside the dashboard
A provider installed, enrolled, or removed by the user outside the dashboard SHALL become
visible without restarting the server. The tool registry caches binary resolutions, so a
readiness evaluation SHALL invalidate the cached resolution for the providers it inspects
(the registry's existing `rescan` path) before calling `detectBinary()`.

The registry cache is **not the only cache**. A provider that memoizes its own binary
lookup in module scope SHALL expose a public invalidation entry point, and readiness SHALL
call it alongside `rescan`. Registry invalidation alone is insufficient wherever a provider
does not consult the registry on each call. This applies to **every** provider carrying such
a memo — zrok and ngrok both do today — not only the one that surfaced the defect.

#### Scenario: Install performed in a terminal is picked up
- **GIVEN** a provider reported `not-installed` and its binary is then installed outside the dashboard
- **WHEN** the next readiness evaluation runs
- **THEN** it SHALL report at least `not-set`
- **AND** no server restart SHALL be required

#### Scenario: Removal is picked up
- **GIVEN** a provider reported `not-set` or `disconnected` and its binary is then removed
- **WHEN** the next readiness evaluation runs
- **THEN** it SHALL report `not-installed`

#### Scenario: Stale cache cannot mask a change
- **WHEN** a readiness evaluation runs
- **THEN** it SHALL NOT return a binary-presence answer derived from a resolution cached before the evaluation began

#### Scenario: A provider-local binary cache is invalidated too
- **GIVEN** a provider memoizes binary presence in module scope rather than reading the tool registry per call
- **WHEN** that binary is installed or removed outside the dashboard and readiness is re-evaluated
- **THEN** the provider SHALL report the new state
- **AND** invalidation SHALL NOT depend on a test-only helper

### Requirement: Readiness is polled only while the Gateway dialog is open
Readiness evaluation shells out per provider (`which`, plus `zerotier-cli listnetworks` and
`tailscale serve status --json`), so it SHALL NOT run unconditionally in the background. The client
SHALL poll every 5 seconds while the Gateway dialog is open, evaluate once immediately on
open, and stop polling when the dialog closes.

A poll SHALL be skipped while a previous evaluation is still in flight, so a slow provider
CLI cannot queue overlapping subprocess batches.

#### Scenario: Poll starts on open
- **WHEN** the Gateway dialog opens
- **THEN** readiness SHALL be evaluated immediately
- **AND** re-evaluated every 5 seconds thereafter

#### Scenario: Poll stops on close
- **WHEN** the Gateway dialog closes
- **THEN** no further readiness evaluation SHALL be scheduled

#### Scenario: Overlapping polls are suppressed
- **GIVEN** an evaluation has not yet returned when the next 5-second tick fires
- **WHEN** the tick fires
- **THEN** the tick SHALL be skipped rather than starting a second concurrent evaluation

#### Scenario: Manual refresh is available
- **WHEN** the user activates the refresh control
- **THEN** a readiness evaluation SHALL run immediately without waiting for the next tick

### Requirement: Setup content is driven by readiness
The Setup tab SHALL render each provider's readiness state, and the steps it offers for a
provider SHALL depend on that state rather than being a fixed list. A step whose precondition
is already satisfied SHALL NOT be presented as outstanding work.

#### Scenario: Not installed shows the install step
- **WHEN** a provider is `not-installed`
- **THEN** the install step SHALL be shown
- **AND** the enroll and connect controls SHALL NOT be offered as actionable

#### Scenario: Not set shows the enroll step
- **WHEN** a provider is `not-set`
- **THEN** the install step SHALL be shown as satisfied
- **AND** the enroll step SHALL be the outstanding action

#### Scenario: Disconnected offers connect
- **WHEN** a provider is `disconnected`
- **THEN** install and enroll SHALL be shown as satisfied
- **AND** connect SHALL be the outstanding action

#### Scenario: Connected shows the live endpoint
- **WHEN** a provider is `connected`
- **THEN** its reachable URL SHALL be shown
- **AND** disconnect SHALL be offered

#### Scenario: State is conveyed by more than colour
- **WHEN** a readiness state is rendered
- **THEN** it SHALL carry a text label, not colour alone (WCAG 1.4.1)

### Requirement: Several providers may run concurrently, with one primary
More than one provider MAY hold a live tunnel at the same time. `tunnel.provider` SHALL
denote the **primary** provider; every other provider is enabled for concurrent connection
via its own `tunnel.<providerId>.enabled` flag. Retaining `tunnel.provider` as the primary
selector preserves the existing legacy-config migration unchanged.

`getTunnelUrl()` SHALL return the **primary** provider's URL. This keeps the OAuth redirect
base, the session-cookie `Secure` flag, and the CORS active-tunnel comparison deriving from
a single origin, so the `oauth-authentication` invariant that the minted redirect URI and the
cookie can never describe different origins holds unchanged with N tunnels live. Non-primary
tunnels are additional reachable URLs; they SHALL NOT mint OAuth redirect URIs.

Each provider SHALL own its own runtime instance, PID file (child kind) and watchdog, so one
provider's recycle or failure does not disturb another's.

#### Scenario: Two providers live at once
- **GIVEN** `tunnel.provider` is `zrok` with `tunnel.mode` `public`
- **AND** `tunnel.tailscale.enabled` is true with `tunnel.tailscale.mode` set to `private`
- **WHEN** the server connects the gateway
- **THEN** both tunnels SHALL be brought up
- **AND** both SHALL be reported `connected` with their own endpoints

#### Scenario: A multi-mode provider must state its mode
- **GIVEN** `tunnel.tailscale.enabled` is true and `tunnel.tailscale.mode` is unset
- **WHEN** the config is resolved
- **THEN** tailscale SHALL be a configuration error for that provider, because it supports both `public` and `private` and no sole mode can be inferred
- **AND** the primary SHALL still connect

#### Scenario: Primary determines the auth origin
- **GIVEN** zrok is primary and tailscale is also connected
- **WHEN** an OAuth redirect URI is minted
- **THEN** it SHALL derive from the zrok URL
- **AND** it SHALL NOT derive from the tailscale URL

#### Scenario: Changing the primary changes the auth origin
- **WHEN** the user designates a different connected provider as primary
- **THEN** `getTunnelUrl()` SHALL return the new primary's URL
- **AND** the redirect base and cookie `Secure` flag SHALL both re-derive from it

#### Scenario: A non-primary failure does not disturb the primary
- **GIVEN** two providers are connected
- **WHEN** the non-primary tunnel drops
- **THEN** the primary tunnel SHALL remain connected
- **AND** only the dropped provider's readiness SHALL change to `disconnected`

#### Scenario: Primary must be a connected provider
- **WHEN** the provider named by `tunnel.provider` is not `connected`
- **THEN** the auth redirect base SHALL fall back exactly as it does today (`auth.redirectBaseUrl` → localhost)
- **AND** a non-primary connected tunnel SHALL NOT be silently promoted to mint redirect URIs

#### Scenario: Single-provider config is unchanged
- **GIVEN** a config with `tunnel.provider` set and no `tunnel.<id>.enabled` flags
- **WHEN** the server connects
- **THEN** exactly one tunnel SHALL be brought up, behaving as before this change

#### Scenario: Mode is validated per enabled provider
- **WHEN** a provider is enabled for concurrent connection in a mode it does not support
- **THEN** the server SHALL reject that provider's configuration
- **AND** SHALL NOT prevent the remaining providers from connecting

### Requirement: Designating the primary is an explicit, confirmed action
The primary SHALL be changed through a dedicated **Make primary** action on the provider's
row, placed before the connect/disconnect action in the same action group. The action SHALL
be offered only for a provider that is currently `connected` and is not already the primary;
the current primary SHALL NOT offer it.

Changing the primary re-mints the OAuth redirect URI, and a provider with the previous URI
registered byte-for-byte will reject sign-in until the new one is registered. The action
SHALL therefore be confirmed and SHALL name that consequence before it is applied. It SHALL
NOT be a one-click toggle.

#### Scenario: Offered on a connected non-primary
- **WHEN** a provider is `connected` and is not the primary
- **THEN** its row SHALL offer "Make primary" ahead of its disconnect action

#### Scenario: Not offered on the current primary
- **WHEN** a provider is the primary
- **THEN** its row SHALL NOT offer an enabled "Make primary" action

#### Scenario: Not offered on a provider that is not connected
- **WHEN** a provider is `not-installed`, `not-set` or `disconnected`
- **THEN** its row SHALL NOT offer "Make primary"

#### Scenario: The consequence is stated before it applies
- **WHEN** the user activates "Make primary"
- **THEN** a confirmation SHALL name the redirect-URI change and the sign-in breakage risk
- **AND** the primary SHALL change only on confirmation
