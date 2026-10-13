## ADDED Requirements

### Requirement: Operate refusals carry a reason and remedies

Every route that refuses a caller with `error: "operate_required"` SHALL respond
with status 403 and a body containing `success: false`, `error: "operate_required"`,
a `message`, a `reason`, and a `remedies` array. Which callers are admitted and
refused SHALL NOT change. Refusals issued earlier in the request by the network
guard (`network_not_allowed`) or the route-tier gate (`insufficient_scope`) are
out of scope and SHALL keep their current bodies.

`reason` SHALL be `tier-too-low` when the request authenticated with a valid
paired-device credential whose tier is below `operate`, and `no-credential`
otherwise — including a presented credential that did not verify.

`remedies` SHALL be an ordered, duplicate-free list. This requirement defines the
values `use-host`, `re-pair` and `sign-in`, in that relative order; a later change
MAY add values by modifying this requirement, and clients SHALL ignore values they
do not recognise.
- `use-host` SHALL be present exactly when the request is not genuinely local
  (loopback without a proxy forwarding header);
- `re-pair` SHALL be present exactly when `reason` is `tier-too-low`;
- `sign-in` SHALL be present exactly when a usable login method is configured at
  the time of the refusal: an OAuth provider with a non-empty client id, enabled
  passkeys, or an identity browser-login configuration while identity is enforced.

`message` SHALL be one of these fixed strings:

| route family | `no-credential` | `tier-too-low` |
|---|---|---|
| vault | the vault needs an operate-tier credential or a locally trusted caller | the vault needs an operate-tier credential; this device's credential has a lower tier |
| services | service mutations need an operate-tier credential or a locally trusted caller | service mutations need an operate-tier credential; this device's credential has a lower tier |

#### Scenario: Network-admitted browser without a credential

- **GIVEN** a request from a trusted-network address with no credential, and no usable login method
- **WHEN** it calls `GET /api/vault`
- **THEN** the response SHALL be 403 with `error` `operate_required`, `reason` `no-credential`, `remedies` exactly `["use-host"]` and the vault `no-credential` message
- **AND** the response SHALL carry no vault data

#### Scenario: Usable login method configured

- **GIVEN** an OAuth provider with a non-empty client id and a credential-less trusted-network caller
- **WHEN** it is refused
- **THEN** `remedies` SHALL be `["use-host", "sign-in"]`

#### Scenario: Provider without a client id is not a login method

- **GIVEN** the only configured OAuth provider has an empty client id, passkeys are disabled and identity is not enforced
- **WHEN** a credential-less trusted-network caller is refused
- **THEN** `remedies` SHALL NOT contain `sign-in`

#### Scenario: Trusted-network paired device below operate tier

- **GIVEN** no usable login method and a request from a trusted-network address authenticated with a paired-device bearer of tier `control`
- **WHEN** it calls `GET /api/vault`
- **THEN** `reason` SHALL be `tier-too-low`, `remedies` SHALL be `["use-host", "re-pair"]` and `message` the vault `tier-too-low` string
- **AND** the refusal SHALL come from the vault's operate rule; the route-tier gate's trusted-source exemption SHALL be unchanged

#### Scenario: Low-tier device on the host itself

- **GIVEN** strict local-proof mode is off, no usable login method, and a genuinely local request authenticated with an `observe`-tier bearer
- **WHEN** it calls `GET /api/vault`
- **THEN** `reason` SHALL be `tier-too-low` and `remedies` SHALL be `["re-pair"]`

#### Scenario: Revoked bearer counts as no credential

- **GIVEN** no usable login method and a trusted-network request presenting a revoked device bearer
- **WHEN** it calls `GET /api/vault`
- **THEN** `reason` SHALL be `no-credential` and `remedies` SHALL be `["use-host"]`

#### Scenario: Off-network low-tier device keeps the tier refusal

- **GIVEN** a request from an address that is neither local nor trusted, authenticated with a `control`-tier bearer
- **WHEN** it calls `GET /api/vault`
- **THEN** the response SHALL be the existing `insufficient_scope` refusal, unchanged

#### Scenario: Service mutation refusal uses the same reason and remedies

- **GIVEN** a credential-less trusted-network caller
- **WHEN** it calls a `/api/services*` mutation
- **THEN** the 403 body SHALL have the same `reason` and `remedies` as a vault refusal for the same caller and the services `no-credential` message
- **AND** the service SHALL be unchanged

#### Scenario: Admission unchanged

- **WHEN** any of these calls `GET /api/vault`: an `operate`-tier device bearer; an `operate`-tier or claim-less operator session; an identity principal; a genuinely local caller admitted by the network guard
- **THEN** the request SHALL succeed exactly as before

### Requirement: Operate refusals disclose nothing beyond the caller's own position

An `operate_required` body SHALL contain only the keys `success`, `error`, `message`,
`reason` and `remedies`. It SHALL NOT contain host names, IP addresses, CIDR ranges,
trusted-network entries, paired-device identifiers or labels, access-grant or
host-gate posture, vault status or contents, or any stored value. The presence of
`sign-in` is the one server-configuration fact it discloses: that a usable login
method exists, which the public login surfaces already reveal for every configured
method.

#### Scenario: Body carries no network, host, device or vault data

- **GIVEN** trusted networks `192.168.16.0/24`, a server host name, a paired device with id `dev-1` labelled `robson-mbp`, and a vault holding one account, one binding and one grant
- **WHEN** a credential-less caller from that range is refused, and a `control`-tier bearer of `dev-1` from that range is refused
- **THEN** each body SHALL have exactly the keys `success`, `error`, `message`, `reason`, `remedies`
- **AND** no string in either body SHALL contain `192.168.`, the CIDR, the host name, `dev-1`, `robson-mbp`, or the account, binding or grant names

### Requirement: Vault settings explain an operate refusal

When loading Settings → Vault fails with `operate_required` and the body carries a
`remedies` list, the section SHALL render an explanatory callout instead of the
generic load-error line. The callout SHALL state that this device cannot open the
vault and SHALL render one instructional row per remedy it recognises, in the
order received, ignoring values it does not recognise. The `sign-in` row SHALL
link to the dashboard login page. The callout SHALL offer a control that retries
the vault load without reloading the page; while a retry is in flight the control
SHALL be disabled and the callout SHALL be marked busy, so one activation issues
at most one request. Any other load failure —
including an `operate_required` body without `remedies` from an older server —
SHALL keep rendering the existing load-error line.

#### Scenario: Unpaired LAN browser

- **GIVEN** the vault load returns `operate_required` with `remedies` `["use-host"]`
- **WHEN** Settings → Vault renders
- **THEN** the callout SHALL be shown with exactly one row (use-host)
- **AND** the generic "Couldn't load the vault" line SHALL NOT be shown

#### Scenario: Low-tier device with sign-in

- **GIVEN** `remedies` `["use-host", "re-pair", "sign-in"]`
- **WHEN** the callout renders
- **THEN** it SHALL show three rows in that order

#### Scenario: Retry after pairing elsewhere

- **GIVEN** the callout is shown and the device is then given a valid `operate` credential
- **WHEN** the user activates the retry control
- **THEN** the vault SHALL be loaded again and, on success, the callout SHALL be replaced by the vault content

#### Scenario: Retry is single-flight

- **GIVEN** the callout is shown
- **WHEN** the user activates the retry control twice before the first load settles
- **THEN** exactly one vault request SHALL be issued, the control SHALL be disabled and the callout `aria-busy` until it settles

#### Scenario: Unknown remedy from a newer server

- **GIVEN** `remedies` `["use-host", "request-access"]` and a client that does not recognise `request-access`
- **WHEN** the callout renders
- **THEN** it SHALL show only the use-host row

#### Scenario: Older server without remedies

- **GIVEN** the vault load returns 403 `operate_required` without a `remedies` field
- **WHEN** Settings → Vault renders
- **THEN** the existing "Couldn't load the vault: …" line SHALL be shown and no callout

#### Scenario: Other failure unchanged

- **GIVEN** the vault load fails with a network error or a 500
- **WHEN** Settings → Vault renders
- **THEN** the existing "Couldn't load the vault: …" line SHALL be shown and no callout
