## ADDED Requirements

### Requirement: Bind reachability predicate

The system SHALL expose a pure, testable predicate that decides whether a bind host can serve a configured trusted entry.

Evaluation order, first match wins:
1. A **loopback trusted entry** SHALL be exempt from the predicate and SHALL NEVER be reported unreachable, whatever the bind host. This exemption takes precedence over the containment rule below. An entry is loopback when every address it can match lies within `127.0.0.0/8` — so `127.0.0.1`, `127.0.0.*`, `127.*.*.*` and `127.0.0.0/8` are exempt, while `127.0.0.0/7` is NOT, because it also matches `126.x.x.x`.
2. A bind host that is not an IPv4 literal — `::`, any IPv6 literal, or a hostname — SHALL be treated as reachable for every entry. The predicate is advisory, so an un-modellable bind host SHALL fail open and stay silent rather than warn on a bind it cannot reason about.
3. A bind host of `0.0.0.0` SHALL be reachable for every entry.
4. Otherwise a trusted entry SHALL be reported **unreachable** when the bind host is not an address contained by that entry's range.

The predicate SHALL accept exact IP, wildcard (`10.0.0.*`, `10.0.*.*`), and CIDR (`192.168.1.0/24`) entry formats, matching the formats accepted by the Trusted Networks section. It SHALL evaluate the union of `config.auth.bypassHosts` and top-level `config.trustedNetworks`, because both feed the runtime guard.

Containment is an **address**-level test, not a routing test: an entry whose range contains the bind host is reported reachable even if no route to that network exists. This is sufficient for an advisory and SHALL NOT be represented as a reachability guarantee.

#### Scenario: Loopback entry exempt under a specific-interface bind
- **GIVEN** the bind host is `10.0.0.5`
- **AND** the only trusted entry is `127.0.0.1`
- **WHEN** the predicate is evaluated
- **THEN** it SHALL report no unreachable entry, because the loopback exemption precedes containment

#### Scenario: Non-IPv4-literal bind host fails open
- **GIVEN** the bind host is `::` or a hostname
- **AND** `auth.bypassHosts` contains `192.168.1.0/24`
- **WHEN** the predicate is evaluated
- **THEN** it SHALL report no unreachable entry

#### Scenario: Multi-segment wildcard containment
- **GIVEN** the bind host is `10.0.0.5`
- **AND** `auth.bypassHosts` contains `10.0.*.*` and `192.168.1.*`
- **WHEN** the predicate is evaluated
- **THEN** `10.0.*.*` SHALL be reachable
- **AND** `192.168.1.*` SHALL be unreachable

#### Scenario: Loopback bind cannot serve a LAN range
- **GIVEN** the resolved bind host is `127.0.0.1`
- **AND** `auth.bypassHosts` contains `192.168.1.0/24`
- **WHEN** the predicate is evaluated
- **THEN** it SHALL report `192.168.1.0/24` as unreachable

#### Scenario: Specific-interface bind cannot serve a foreign range
- **GIVEN** the resolved bind host is `10.0.0.5`
- **AND** `auth.bypassHosts` contains `192.168.1.0/24`
- **WHEN** the predicate is evaluated
- **THEN** it SHALL report `192.168.1.0/24` as unreachable

#### Scenario: Specific-interface bind inside the trusted range is reachable
- **GIVEN** the resolved bind host is `192.168.1.42`
- **AND** `auth.bypassHosts` contains `192.168.1.0/24`
- **WHEN** the predicate is evaluated
- **THEN** it SHALL report no unreachable entry

#### Scenario: All-interfaces bind is always reachable
- **GIVEN** the resolved bind host is `0.0.0.0`
- **AND** `auth.bypassHosts` contains any set of entries
- **WHEN** the predicate is evaluated
- **THEN** it SHALL report no unreachable entry

#### Scenario: Loopback trusted entry never warns
- **GIVEN** the resolved bind host is `127.0.0.1`
- **AND** the only trusted entries are `127.0.0.1`, `127.0.0.2`, `127.0.0.*` and `127.0.0.0/8`
- **WHEN** the predicate is evaluated
- **THEN** it SHALL report no unreachable entry

#### Scenario: No trusted entries configured
- **GIVEN** both `auth.bypassHosts` and `trustedNetworks` are empty or absent
- **WHEN** the predicate is evaluated
- **THEN** it SHALL report no unreachable entry

#### Scenario: Wildcard and exact entry formats
- **GIVEN** the resolved bind host is `127.0.0.1`
- **AND** `auth.bypassHosts` contains `10.0.0.*` and `10.0.0.7`
- **WHEN** the predicate is evaluated
- **THEN** it SHALL report both entries as unreachable

### Requirement: Effective bind host is the predicate's input

The bind host the predicate evaluates MUST be the host the server actually resolved — `--host`, else `PI_DASHBOARD_HOST`, else `config.bindHost`, else the default. `config.bindHost` alone is NOT a valid input: a deployment may set the bind host by flag or environment while leaving `config.bindHost` absent, in which case the config value understates the true bind and the predicate would warn on a bind that already serves the entry.

The server SHALL publish these values as a top-level `reachability` object on the **`GET /api/config`** response — `{ resolvedBindHost, pendingBindHost, unreachable[] }` — which already carries `preHandler: networkGuard`. They SHALL NOT be published on an unguarded endpoint: together they describe the operator's private network topology, and `/api/health` is served without a `preHandler`, so an unauthenticated peer that can reach the port would be able to read them.

When `pendingBindHost` changes while the server runs, the server SHALL broadcast the updated `reachability` object to every connected browser socket as a `ServerToBrowserMessage`, in the manner of `display_prefs_updated`, and SHALL replay it to a socket that connects afterwards. A client therefore observes the change without polling and without reopening the Settings panel.

The server SHALL publish **two** values, both computed server-side because only the server knows the flag and environment inputs:
- `resolvedBindHost` — the host the running listener actually bound, **captured at boot and frozen**. It SHALL NOT be re-derived per request, or the restart-pending window would silently collapse.
- `pendingBindHost` — the host the server *would* bind if restarted now: the same `--host` → `PI_DASHBOARD_HOST` → `config.bindHost` → default chain re-evaluated against current config. Flag and environment continue to win, so this is the honest answer to "what will the next restart apply", which a saved config value alone is not.

The predicate's bind-host input is:
1. The user has an unsaved listen-interface edit → the **draft** value.
2. Otherwise → `pendingBindHost`.

The server SHALL evaluate its own startup log and reported field against `pendingBindHost` by the same rule, so client and server never disagree on the input outside an unsaved draft. An unsaved draft is a deliberate, carved-out divergence: it exists only in the browser and describes a configuration that has not been persisted.

A deployment that sets the bind host by flag or environment yields the same value for both `resolvedBindHost` and `pendingBindHost`, so it never warns and never shows a restart notice — no presence-flag for `config.bindHost` is required, and none is available, because the config loader always materialises a default for that key.

Whenever `pendingBindHost` differs from `resolvedBindHost`, the Settings header's **existing Restart affordance** SHALL indicate that a restart is pending, independently of whether the advisory is displayed. No new restart-notice component or copy is introduced — `bindHost` is already a restart-required field, so this reuses the signal the panel already owns. The two signals stay distinct: the advisory says "this configuration cannot work", the header says "your change is not live yet".

#### Scenario: Saved but unrestarted does not re-show the advisory
- **GIVEN** `resolvedBindHost` is `127.0.0.1`
- **AND** config.json now sets `bindHost` to `0.0.0.0` with no overriding flag or environment variable, so `pendingBindHost` is `0.0.0.0`
- **AND** `auth.bypassHosts` contains `192.168.1.0/24`
- **WHEN** the Trusted Networks section renders
- **THEN** the advisory SHALL NOT be displayed
- **AND** the Settings header's Restart affordance SHALL indicate a pending restart

#### Scenario: Flag or environment still wins over a saved config value
- **GIVEN** the server was started with `--host 127.0.0.1`
- **AND** config.json sets `bindHost` to `0.0.0.0`
- **WHEN** `pendingBindHost` is computed
- **THEN** it SHALL be `127.0.0.1`, because the flag also wins on the next start
- **AND** the advisory SHALL be displayed for any non-loopback trusted entry

#### Scenario: Resolved host is frozen at boot
- **GIVEN** the server bound `127.0.0.1` at boot
- **WHEN** config.json is edited to `0.0.0.0` while the server runs
- **THEN** `resolvedBindHost` SHALL still report `127.0.0.1`
- **AND** the Settings header's Restart affordance SHALL indicate a pending restart

#### Scenario: Pending bind host change is pushed to connected browsers
- **GIVEN** a browser socket is connected with `pendingBindHost` equal to `127.0.0.1`
- **WHEN** `pendingBindHost` becomes `0.0.0.0`
- **THEN** the server SHALL broadcast the updated `reachability` object to that socket
- **AND** a socket connecting afterwards SHALL receive the same value on connect

#### Scenario: Topology detail is not exposed unauthenticated
- **WHEN** the resolved bind host or the unreachable trusted entries are served over HTTP
- **THEN** the endpoint SHALL apply the same network guard as `/api/config`
- **AND** the values SHALL NOT appear in any unguarded response

#### Scenario: Environment-set bind host is honoured over the config default
- **GIVEN** `PI_DASHBOARD_HOST=0.0.0.0` and no `bindHost` set in config.json, which the loader materialises as the `127.0.0.1` default
- **AND** `auth.bypassHosts` contains `192.168.1.0/24`
- **WHEN** the predicate is evaluated on either the client or the server
- **THEN** both `resolvedBindHost` and `pendingBindHost` SHALL be `0.0.0.0`
- **AND** it SHALL report no unreachable entry
- **AND** no advisory SHALL be displayed

#### Scenario: Unsaved draft edit governs the predicate
- **GIVEN** the server resolved its bind host to `127.0.0.1`
- **AND** the user has changed the listen interface to `0.0.0.0` in an unsaved draft
- **WHEN** the predicate is evaluated
- **THEN** it SHALL use the draft value and report no unreachable entry

#### Scenario: Unsaved trusted entries are predicate input too
- **GIVEN** the pending effective host is `127.0.0.1`
- **AND** the user has added `192.168.1.0/24` to the draft without saving
- **WHEN** the predicate is evaluated
- **THEN** it SHALL evaluate the **draft** trusted entries, not only the loaded ones
- **AND** report `192.168.1.0/24` as unreachable

### Requirement: Reachability advisory in the Trusted Networks section

When the bind reachability predicate reports at least one unreachable trusted entry, the Trusted Networks section MUST display an advisory stating that the dashboard is not listening on an interface that can serve those entries. The advisory SHALL be advisory only: it SHALL NOT alter request-guard behavior, and it SHALL NOT allow or deny any request differently.

The advisory and the block-event trust banner MAY be displayed at the same time and SHALL NOT suppress one another. A bind that fails to serve one trusted entry can still accept, and therefore record denials from, traffic on another range — so the two conditions are independent. When both are present the advisory SHALL be rendered first, because it explains why block events may be missing for the unreachable range.

The advisory SHALL offer both remediation affordances: a control that sets `bindHost` to `0.0.0.0` in the working draft, and a link that navigates to the Server page's listen-interface picker. The advisory SHALL state that changing the listen interface takes effect only after a restart.

Once remediation has been applied but the resolved bind host has not yet caught up — the draft or saved value differs from the running bind — the section SHALL continue to state that a restart is required. The restart notice SHALL NOT disappear together with the advisory, because between remediation and restart the original failure still holds.

#### Scenario: Advisory shown for an unreachable trusted network
- **GIVEN** the loaded config has `bindHost` `127.0.0.1` and `auth.bypassHosts` containing `192.168.1.0/24`
- **WHEN** the user opens the Security page
- **THEN** the Trusted Networks section SHALL display the reachability advisory
- **AND** the advisory SHALL name the unreachable entry

#### Scenario: Advisory hidden when every trusted entry is reachable
- **GIVEN** the loaded config has `bindHost` `0.0.0.0` and `auth.bypassHosts` containing `192.168.1.0/24`
- **WHEN** the user opens the Security page
- **THEN** the reachability advisory SHALL NOT be displayed

#### Scenario: Advisory appears immediately on adding an unreachable entry
- **GIVEN** the loaded config has `bindHost` `127.0.0.1` and no trusted entries
- **WHEN** the user adds `192.168.1.0/24` via the Trusted Networks section
- **THEN** the reachability advisory SHALL appear without requiring a Save

#### Scenario: Inline remediation sets bindHost in the draft
- **GIVEN** the reachability advisory is displayed
- **WHEN** the user activates the listen-on-all-interfaces control
- **THEN** the working draft SHALL have `bindHost` set to `0.0.0.0`
- **AND** the advisory SHALL no longer be displayed
- **AND** the header's Restart affordance SHALL indicate a pending restart
- **AND** the change SHALL NOT be persisted until Save

#### Scenario: Restart signal persists until the running bind catches up
- **GIVEN** the user saved `bindHost` as `0.0.0.0` and the server has not restarted
- **WHEN** the Settings panel renders
- **THEN** the header's Restart affordance SHALL indicate a pending restart
- **AND** it SHALL clear once `resolvedBindHost` matches `pendingBindHost`

#### Scenario: Advisory and block-event banner coexist
- **GIVEN** the bind host is `10.0.0.5` and `auth.bypassHosts` contains `192.168.1.0/24`
- **AND** a denial has been recorded for a peer at `10.0.0.9`
- **WHEN** the Trusted Networks section renders
- **THEN** both the reachability advisory and the block-event trust banner SHALL be displayed
- **AND** the advisory SHALL be rendered first

#### Scenario: Link remediation navigates to the picker
- **GIVEN** the reachability advisory is displayed
- **WHEN** the user activates the change-listen-interface link
- **THEN** the app SHALL navigate to `/settings/server`
- **AND** unsaved edits on the Security page SHALL be preserved

#### Scenario: Advisory states the restart requirement
- **WHEN** the reachability advisory is displayed
- **THEN** it SHALL state that changing the listen interface requires a restart

#### Scenario: Guard behavior unchanged
- **GIVEN** the reachability advisory is displayed
- **WHEN** any request reaches the network guard
- **THEN** the guard SHALL allow or deny it exactly as it would with the advisory absent

### Requirement: Headless bind reachability surface

The server MUST surface an unreachable-trusted-network condition without the Settings UI, for operators who configure `config.json`, the `--host` flag, or `PI_DASHBOARD_HOST` and never open the dashboard. On startup, when the bind reachability predicate reports at least one unreachable trusted entry, the server SHALL emit a `console.warn` line prefixed `[bind-reachability]`, matching the existing server convention (`[openspec-poll]`, `[hydration]`, `[worktree-init-trust]`), naming the bind host and the unreachable entries. The bracketed prefix is the stable token a log-scraping test matches on. The guarded config surface SHALL carry an additive, **read-only** field reporting the condition, `resolvedBindHost`, and `pendingBindHost`. The field SHALL be failure-isolated in the manner of the other telemetry reads: a fault computing it SHALL NOT fail the response. It SHALL NOT be added to `/api/health`, which is unguarded.

The field is computed, never persisted. The config write path SHALL strip it before persisting, in the same manner as `resolvedTrustedNetworks`, so a client that echoes a full config object back on write cannot write a derived value into `config.json`.

#### Scenario: Computed field is stripped on write
- **GIVEN** a `PUT` to the config surface whose body echoes the computed reachability field
- **WHEN** the write is persisted
- **THEN** the field SHALL NOT appear in `config.json`

#### Scenario: Startup log line on unreachable trusted network
- **GIVEN** the resolved bind host is `127.0.0.1` and `auth.bypassHosts` contains `192.168.1.0/24`
- **WHEN** the server starts
- **THEN** it SHALL emit one `[bind-reachability]`-prefixed warn line
- **AND** that line SHALL contain `127.0.0.1` and `192.168.1.0/24`

#### Scenario: No log line when every entry is reachable
- **GIVEN** the resolved bind host is `0.0.0.0`
- **WHEN** the server starts with any trusted entries configured
- **THEN** no `[bind-reachability]`-prefixed line SHALL be emitted

#### Scenario: Guarded surface reports the condition
- **GIVEN** the resolved bind host is `127.0.0.1` and `auth.bypassHosts` contains `192.168.1.0/24`
- **WHEN** `GET /api/config` is served to a permitted caller
- **THEN** the response SHALL include `reachability.resolvedBindHost` `127.0.0.1`, `reachability.pendingBindHost`, and `reachability.unreachable` containing `192.168.1.0/24`

#### Scenario: Reachability absent from the unguarded health endpoint
- **WHEN** `GET /api/health` is served
- **THEN** the response SHALL NOT contain `resolvedBindHost`, `pendingBindHost`, or any trusted-entry value

#### Scenario: Reachability field failure isolation
- **GIVEN** computing the reachability field throws
- **WHEN** the guarded config surface is served
- **THEN** the response SHALL still succeed
- **AND** the remaining fields SHALL be present

#### Scenario: Containerized deployment does not warn
- **GIVEN** `PI_DASHBOARD_HOST` resolves the bind host to `0.0.0.0`, as the shipped compose file defaults it
- **AND** config.json carries no `bindHost` key
- **WHEN** the server starts with trusted entries configured
- **THEN** neither the log line nor a non-empty reported field SHALL be produced
- **AND** no advisory SHALL be displayed in the client, which evaluates the same `pendingBindHost`
