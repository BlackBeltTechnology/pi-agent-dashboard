## ADDED Requirements

### Requirement: Allowed hostnames section on Security tab
The Security tab SHALL render an **Allowed hostnames** section between *Trusted networks* and *Pair a device* with four parts, in this order: (1) a mode control offering exactly `Report only` and `Enforce`, bound to `hostGate.mode`, with a one-sentence consequence beside it that changes with the selection; when the server reports the mode is set by `PI_DASHBOARD_HOST_GATE` the control SHALL be disabled and state that reason; (2) a read-only **Currently admitted** list rendered from `GET /api/host-gate` `admitted` (never re-derived on the client), one row per entry, grouped by source, each row carrying a text source pill from the set `loopback`, `IP address`, `bind address`, `.local`, `public base URL`, `CORS origin`, `live tunnel`, `allowed host`, and — for sources edited elsewhere — a link to that settings page instead of a remove control; (3) an **Additional hostnames** editor (one hostname per line) bound to the panel draft's `allowedHosts` that, on blur, marks any entry containing a scheme, port, or path, or failing the gate's own hostname regex (shared from `packages/shared`), as invalid and states the bare hostname to enter instead (or that the name cannot be admitted); (4) a **Recent refusals** list from `GET /api/host-gate` `recent` showing hostname, count, last-seen, an outcome pill reading the entry's own `outcome` (`would-refuse` or `refused`), and an **Allow** button that appends the hostname to the draft `allowedHosts`; rows whose hostname is in the editor's current value SHALL be hidden (applied at render on every fetch); an empty list SHALL render "No refusals since start." Both `hostGate.mode` and `allowedHosts` SHALL persist through the panel's Save exactly like every other Settings field (`computeConfigPartial` diffs them; `CONFIG_FIELD_PAGE` maps them to `security`); the section SHALL issue no write of its own. All four parts SHALL be operable by keyboard, every control SHALL have an accessible name, and state SHALL never be conveyed by colour alone.

#### Scenario: Mode switch states its consequence inline
- **WHEN** the operator selects `Enforce`
- **THEN** the sentence beside the control SHALL change to say unlisted hosts get 403, no confirmation dialog SHALL open, and the pending draft SHALL hold `hostGate.mode: "enforce"` until Save

#### Scenario: Env override disables the mode control
- **WHEN** `GET /api/host-gate` returns `envOverridden: true`
- **THEN** both mode options SHALL be disabled and a line SHALL name `PI_DASHBOARD_HOST_GATE` as the reason

#### Scenario: Derived rows link to their source
- **WHEN** `admitted` contains `{ host: "pi.example.com", source: "public-base-url" }`
- **THEN** the list SHALL show a row `pi.example.com` with pill `public base URL` and a link to the Gateway page, and no remove control

#### Scenario: Invalid extra hostname is explained
- **WHEN** the operator enters `https://dash.home.arpa:9443/` in Additional hostnames and leaves the field
- **THEN** the field SHALL be marked invalid and the message SHALL contain `dash.home.arpa`

#### Scenario: Name the gate cannot admit is refused at entry
- **WHEN** the operator enters `my_service.docker` in Additional hostnames and leaves the field
- **THEN** the field SHALL be marked invalid and the message SHALL say the name cannot be used as an allowed host

#### Scenario: Allow moves a refusal into the draft allow-list
- **WHEN** Recent refusals shows `proxy-int.corp` and the operator activates its Allow button
- **THEN** `proxy-int.corp` SHALL appear in the Additional hostnames editor, the row SHALL leave the Recent refusals list, the panel SHALL show unsaved changes, and no request SHALL have been sent until Save
- **WHEN** the operator saves
- **THEN** `PUT /api/config` SHALL carry `allowedHosts` including `proxy-int.corp` and, after refetch, Currently admitted SHALL show it with pill `allowed host`

#### Scenario: Outcome pill is per entry
- **WHEN** `recent` holds `{ host: "a.example", outcome: "would-refuse" }` and `{ host: "b.example", outcome: "refused" }`
- **THEN** the rows SHALL read `would-refuse` and `refused` respectively, regardless of the current mode control value

### Requirement: Gateway URL row shows host admission
Each gateway URL row on the Gateway page and in the setup guide SHALL show an informational **Host admitted** pill after its status text when the row URL's hostname is present in the live `publicBaseUrls` (via `resolvePublicBaseUrls`) or `cors.allowedOrigins` hosts of the current config, with a `title` explaining that the hostname is an allowed Host because it is a gateway URL. The pill SHALL NOT be a control, SHALL be absent when the hostname is in neither list, and SHALL NOT depend on the row's `data-status`.

#### Scenario: Pill on an OK row
- **WHEN** a gateway row for `https://pi.example.com` has status `ok` and `publicBaseUrls` contains `https://pi.example.com`
- **THEN** the row SHALL show `Host admitted` with a title naming `pi.example.com`

#### Scenario: No pill when the public base URL is missing
- **WHEN** a gateway row for `https://pi.example.com` has status `incomplete` because `https://pi.example.com` is missing from live `publicBaseUrls` and `cors.allowedOrigins`
- **THEN** the row SHALL NOT show `Host admitted`

#### Scenario: Pill on an incomplete row whose public base URL is intact
- **WHEN** a gateway row for `https://pi.example.com` has status `incomplete` because only its `trustedNetworks` delta is missing, and `publicBaseUrls` still contains `https://pi.example.com`
- **THEN** the row SHALL show `Host admitted`
