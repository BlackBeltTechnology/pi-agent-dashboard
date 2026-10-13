## ADDED Requirements

### Requirement: Operate refusals carry a reason and remedies

Every route that refuses a caller with `error: "operate_required"` SHALL respond
with status 403 and a body containing `success: false`, `error: "operate_required"`,
a human-readable `message`, a `reason`, and a `remedies` array. The admission
decision itself SHALL NOT change: the same callers are admitted and refused as
before this requirement.

`reason` SHALL be `tier-too-low` when the request authenticated with a paired-device
credential whose tier is below `operate`, and `no-credential` otherwise.

`remedies` SHALL be an ordered, duplicate-free subset of the closed set
`use-host`, `raise-tier`, `sign-in`, `request-access`, in that order:
- `use-host` SHALL always be present;
- `raise-tier` SHALL be present exactly when `reason` is `tier-too-low`;
- `sign-in` SHALL be present exactly when the dashboard login page offers at least
  one configured login method;
- `request-access` SHALL be present exactly when the server exposes a LAN pairing
  request entry point that would admit a request from this caller's address, and
  `reason` is `no-credential`.

#### Scenario: Network-admitted browser without a credential

- **GIVEN** a request from `192.168.16.220` admitted by a trusted-network entry, with no credential, and no login method configured
- **WHEN** it calls `GET /api/vault`
- **THEN** the response SHALL be 403 with `error` `operate_required`, `reason` `no-credential` and `remedies` exactly `["use-host"]`
- **AND** the response SHALL carry no vault data

#### Scenario: Paired device below operate tier

- **GIVEN** a request authenticated with a paired-device bearer of tier `control`
- **WHEN** it calls `GET /api/vault`
- **THEN** `reason` SHALL be `tier-too-low` and `remedies` SHALL start with `["use-host", "raise-tier"]`
- **AND** `remedies` SHALL NOT contain `request-access`

#### Scenario: Login method configured

- **GIVEN** a configured login method and a credential-less network-admitted caller
- **WHEN** it is refused
- **THEN** `remedies` SHALL contain `sign-in`

#### Scenario: Service mutation refusal uses the same body

- **GIVEN** a credential-less network-admitted caller
- **WHEN** it calls a `/api/services*` mutation
- **THEN** the 403 body SHALL have the same `error`, `reason` and `remedies` as a vault refusal for the same caller
- **AND** the service SHALL be unchanged

#### Scenario: Admission unchanged

- **WHEN** an `operate`-tier device bearer, an operator session, or a genuinely local caller calls `GET /api/vault`
- **THEN** the request SHALL succeed exactly as before

### Requirement: Operate refusals disclose nothing beyond the caller's own position

An `operate_required` body SHALL NOT contain host names, IP addresses, CIDR ranges,
trusted-network entries, paired-device identifiers or labels, access-grant or
host-gate posture, or any stored value. Its `message` SHALL be a fixed string per route and
`reason`, never interpolated from request or server data.

#### Scenario: Body carries no network or host data

- **GIVEN** trusted networks `192.168.16.0/24` and a server host name configured
- **WHEN** a credential-less caller from that range is refused
- **THEN** no string in the body SHALL contain `192.168.`, the CIDR, the host name, or a paired-device label

### Requirement: Vault settings explain an operate refusal

When loading Settings → Vault fails with `operate_required`, the section SHALL
render an explanatory callout instead of the generic load-error line. The callout
SHALL state that this device cannot open the vault, SHALL render one row per
remedy in the order received, and SHALL NOT render a row for a remedy that is
absent. A `request-access` row SHALL offer an action that starts the LAN pairing
request; every other row SHALL be instructional text. Any other load failure SHALL
keep rendering the existing load-error line.

#### Scenario: Unpaired LAN browser

- **GIVEN** the vault load returns `operate_required` with `remedies` `["use-host"]`
- **WHEN** Settings → Vault renders
- **THEN** the callout SHALL be shown with exactly one remedy row (use-host)
- **AND** the generic "Couldn't load the vault" line SHALL NOT be shown
- **AND** no "Request access" action SHALL be shown

#### Scenario: Request access available

- **GIVEN** `remedies` `["use-host", "request-access"]`
- **WHEN** the callout renders
- **THEN** it SHALL show a "Request access" action

#### Scenario: Older server without remedies

- **GIVEN** the vault load returns 403 `operate_required` without a `remedies` field
- **WHEN** Settings → Vault renders
- **THEN** the callout SHALL be shown with the use-host row only

#### Scenario: Other failure unchanged

- **GIVEN** the vault load fails with a network error or a 500
- **WHEN** Settings → Vault renders
- **THEN** the existing "Couldn't load the vault: …" line SHALL be shown and no callout
