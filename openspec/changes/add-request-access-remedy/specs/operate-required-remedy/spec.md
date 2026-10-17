## MODIFIED Requirements

### Requirement: Operate refusals carry a reason and remedies

Every vault (`/api/vault*`) and services (`/api/services*`) route that refuses a
caller with `error: "operate_required"` SHALL respond
with status 403 and a body containing `success: false`, `error: "operate_required"`,
a `message`, a `reason`, and a `remedies` array. Which callers are admitted and
refused SHALL NOT change. Refusals issued earlier in the request by the network
guard (`network_not_allowed`) or the route-tier gate (`insufficient_scope`) are
out of scope and SHALL keep their current bodies.

`reason` SHALL be `tier-too-low` when the request authenticated with a valid
paired-device credential, or a login session, whose tier is below `operate`, and
`no-credential` otherwise — including a presented credential that did not verify.

`remedies` SHALL be an ordered, duplicate-free list. This requirement defines the
values `use-host`, `re-pair`, `request-access` and `sign-in`, in that relative
order; a later change MAY add values by modifying this requirement, and clients
SHALL ignore values they do not recognise.
- `use-host` SHALL be present exactly when the request is not genuinely local
  (loopback without a proxy forwarding header);
- `re-pair` SHALL be present exactly when `reason` is `tier-too-low` and the
  credential is a paired-device credential;
- `request-access` SHALL be present exactly when both hold: (a) the request
  carries no credential the server verified while authenticating it — no verified paired-device bearer, login
  session, identity principal, or verified local credential (local-proof cookie
  or local token); a presented credential that did not verify, or that the
  server did not verify because a trusted-network entry admitted the request
  first, counts as none; and (b) the knock route's
  admission gates that precede its operator switch (`lan-knock-pairing` "Knock
  admission gates": Host admission, then network position / `knock_not_lan`)
  would pass for the same request. Its presence SHALL NOT depend on
  `pairing.acceptLanRequests`, on whether any knock is pending, or on any knock
  rate limit or cooldown. When a later change widens or narrows those knock
  gates, this remedy SHALL follow them;
- `sign-in` SHALL be present exactly when a usable login method is configured at
  the time of the refusal: an OAuth provider with a non-empty client id, enabled
  passkeys, or an identity browser-login configuration while identity is enforced.

`message` SHALL be one of these fixed strings:

| route family | `no-credential` | `tier-too-low` |
|---|---|---|
| vault | the vault needs an operate-tier credential or a locally trusted caller | the vault needs an operate-tier credential; this device's credential has a lower tier |
| services | service mutations need an operate-tier credential or a locally trusted caller | service mutations need an operate-tier credential; this device's credential has a lower tier |

#### Scenario: Network-admitted browser without a credential

- **GIVEN** no usable login method, and a request with no credential, admitted by the network guard (e.g. via a trusted-network entry), whose peer fails the knock's network-position gate (e.g. a point-to-point VPN peer the knock refuses with `knock_not_lan`)
- **WHEN** it calls `GET /api/vault`
- **THEN** the response SHALL be 403 with `error` `operate_required`, `reason` `no-credential`, `remedies` exactly `["use-host"]` and the vault `no-credential` message
- **AND** the response SHALL carry no vault data

#### Scenario: On-link LAN browser without a credential can request access

- **GIVEN** no usable login method, trusted networks containing `192.168.16.0/24`, and a request with no credential and no forwarding header, admitted by the network guard, whose socket peer is `192.168.16.40` on the server's `192.168.16.0/24` interface subnet, with an admitted `Host`
- **WHEN** it calls `GET /api/vault`
- **THEN** `reason` SHALL be `no-credential` and `remedies` SHALL be exactly `["use-host", "request-access"]`

#### Scenario: Usable login method configured

- **GIVEN** an OAuth provider with a non-empty client id and the caller of "Network-admitted browser without a credential"
- **WHEN** it is refused
- **THEN** `remedies` SHALL be `["use-host", "sign-in"]`

#### Scenario: All no-credential remedies in order

- **GIVEN** an OAuth provider with a non-empty client id and the caller of "On-link LAN browser without a credential can request access"
- **WHEN** it is refused
- **THEN** `remedies` SHALL be `["use-host", "request-access", "sign-in"]`

#### Scenario: Request access does not depend on the LAN-request switch or knock state

- **GIVEN** the caller of "On-link LAN browser without a credential can request access"
- **WHEN** it is refused once with `pairing.acceptLanRequests` `false`, once with it `true`, and once while a knock from the same peer is pending
- **THEN** the three response bodies SHALL be byte-identical and each SHALL contain `request-access`

#### Scenario: Forwarded request gets no request-access

- **GIVEN** a credential-less request admitted by the network guard whose socket peer is on-link and private but which carries an `X-Forwarded-For` header
- **WHEN** it is refused with `operate_required`
- **THEN** `remedies` SHALL NOT contain `request-access`

#### Scenario: Non-admitted Host gets no request-access

- **GIVEN** the host gate in report mode and an on-link credential-less request admitted by the network guard whose `Host` is not admitted
- **WHEN** it is refused with `operate_required`
- **THEN** `remedies` SHALL NOT contain `request-access`

#### Scenario: Verified local credential gets no request-access

- **GIVEN** an on-link request admitted by the network guard that carries a verified local token or a valid local-proof cookie but holds no `operate` authority
- **WHEN** it is refused with `operate_required`
- **THEN** `remedies` SHALL NOT contain `request-access`

#### Scenario: Provider without a client id is not a login method

- **GIVEN** the only configured OAuth provider has an empty client id, passkeys are disabled and identity is not enforced
- **WHEN** a credential-less trusted-network caller is refused
- **THEN** `remedies` SHALL NOT contain `sign-in`

#### Scenario: Trusted-network paired device below operate tier

- **GIVEN** no usable login method and a request from a trusted-network address authenticated with a paired-device bearer of tier `control`
- **WHEN** it calls `GET /api/vault`
- **THEN** `reason` SHALL be `tier-too-low`, `remedies` SHALL be `["use-host", "re-pair"]` and `message` the vault `tier-too-low` string
- **AND** `remedies` SHALL NOT contain `request-access`, whether or not the peer is on-link
- **AND** the refusal SHALL come from the vault's operate rule; the route-tier gate's trusted-source exemption SHALL be unchanged

#### Scenario: Low-tier device on the host itself

- **GIVEN** strict local-proof mode is off, no usable login method, and a genuinely local request authenticated with an `observe`-tier bearer
- **WHEN** it calls `GET /api/vault`
- **THEN** `reason` SHALL be `tier-too-low` and `remedies` SHALL be `["re-pair"]`

#### Scenario: Revoked bearer counts as no credential

- **GIVEN** no usable login method and a request admitted by the network guard whose peer fails the knock's network-position gate, presenting a revoked device bearer
- **WHEN** it calls `GET /api/vault`
- **THEN** `reason` SHALL be `no-credential` and `remedies` SHALL be `["use-host"]`

#### Scenario: Revoked bearer on the LAN can request access again

- **GIVEN** no usable login method and the caller of "On-link LAN browser without a credential can request access" presenting a revoked device bearer
- **WHEN** it calls `GET /api/vault`
- **THEN** `reason` SHALL be `no-credential` and `remedies` SHALL be `["use-host", "request-access"]`

#### Scenario: Off-network low-tier device keeps the tier refusal

- **GIVEN** a request from an address that is neither local nor trusted, authenticated with a `control`-tier bearer
- **WHEN** it calls `GET /api/vault`
- **THEN** the response SHALL be the existing `insufficient_scope` refusal, unchanged

#### Scenario: Service mutation refusal uses the same reason and remedies

- **GIVEN** a credential-less caller admitted by the network guard, once failing and once passing the knock's network-position gate
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
method. The presence of `request-access` is the other: whether the knock route's
admission gates before its operator switch (Host admission, network position)
would pass for this request. It SHALL carry no information the same caller cannot
obtain from the public knock route (`POST /api/pair/request`) by a same-origin
request with the same peer, forwarding headers and `Host` — whether that route
refuses with `host_not_admitted` or `knock_not_lan` or not. It SHALL NOT vary with
`pairing.acceptLanRequests`, pending knocks, or knock limits.

#### Scenario: Body carries no network, host, device or vault data

- **GIVEN** trusted networks `192.168.16.0/24`, a server host name, a paired device with id `dev-1` labelled `robson-mbp`, and a vault holding one account, one binding and one grant
- **WHEN** a credential-less caller from that range is refused, and a `control`-tier bearer of `dev-1` from that range is refused
- **THEN** each body SHALL have exactly the keys `success`, `error`, `message`, `reason`, `remedies`
- **AND** no string in either body SHALL contain `192.168.`, the CIDR, the host name, `dev-1`, `robson-mbp`, or the account, binding or grant names

#### Scenario: Request access mirrors the public knock gates

- **GIVEN** a credential-less caller admitted by the network guard, in each of these variants: on-link with admitted `Host`; on-link with `X-Forwarded-For`; on-link with non-admitted `Host` (host gate in report mode); peer failing the knock's network-position gate
- **WHEN** it is refused with `operate_required` and, separately, a same-origin JSON `POST /api/pair/request` with the same peer, forwarding headers and `Host` is sent with `pairing.acceptLanRequests` `false`
- **THEN** `request-access` SHALL be present exactly in the variant where the knock route refuses with `knock_disabled` (its gates before the switch passed), and absent where it refuses with `host_not_admitted` or `knock_not_lan`

#### Scenario: LAN-request switch state is not disclosed

- **GIVEN** an on-link credential-less caller
- **WHEN** it is refused with `pairing.acceptLanRequests` `false` and again with it `true`
- **THEN** the two bodies SHALL be byte-identical

### Requirement: Vault settings explain an operate refusal

When loading Settings → Vault fails with `operate_required` and the body carries a
`remedies` list, the section SHALL render an explanatory callout instead of the
generic load-error line. The callout SHALL state that this device cannot open the
vault and SHALL render one instructional row per remedy it recognises, in the
order received, ignoring values it does not recognise. The `sign-in` row SHALL
link to the dashboard login page. The `request-access` row SHALL say that access
can be requested from this device when the dashboard accepts requests from the
local network and that someone at the dashboard machine approves it by typing a
code, and SHALL offer a "Request access" link that targets the server whose
refusal the callout is showing — the API base the refused load was sent to, fixed
when the refusal arrived: when that server is the page's own origin it SHALL
navigate to `/pair?request` in the same browsing context; when it is another
server it SHALL open that server's own `/pair?request` in a new browsing context
without an opener reference. The callout SHALL offer a control that retries
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

#### Scenario: On-link browser sees a request-access row

- **GIVEN** `remedies` `["use-host", "request-access", "sign-in"]`
- **WHEN** the callout renders
- **THEN** it SHALL show three rows in that order, and the request-access row SHALL contain a "Request access" link

#### Scenario: Request access on the page's own server

- **GIVEN** the page origin is `http://192.168.16.31:8000`, the refused vault load was sent to the page origin, and the callout shows a request-access row
- **WHEN** the user activates "Request access"
- **THEN** the page SHALL navigate to `/pair?request` on its own origin (resolving to `http://192.168.16.31:8000/pair?request`) in the same browsing context

#### Scenario: Request access on another server

- **GIVEN** the page origin is `http://192.168.16.31:8000`, the refused vault load was sent to `http://192.168.16.204:8000`, and the callout shows a request-access row
- **WHEN** the user activates "Request access"
- **THEN** a new browsing context SHALL open `http://192.168.16.204:8000/pair?request` with no opener reference
- **AND** the current page SHALL stay where it is

#### Scenario: Link keeps targeting the refusing server

- **GIVEN** the callout shows a request-access row for a refusal from `http://192.168.16.204:8000`, and the active API base then changes to another server without the vault reloading
- **WHEN** the user activates "Request access"
- **THEN** it SHALL target `http://192.168.16.204:8000/pair?request`

#### Scenario: Retry after pairing elsewhere

- **GIVEN** the callout is shown and the device is then given a valid `operate` credential
- **WHEN** the user activates the retry control
- **THEN** the vault SHALL be loaded again and, on success, the callout SHALL be replaced by the vault content

#### Scenario: Retry is single-flight

- **GIVEN** the callout is shown
- **WHEN** the user activates the retry control twice before the first load settles
- **THEN** exactly one vault request SHALL be issued, the control SHALL be disabled and the callout `aria-busy` until it settles

#### Scenario: Unknown remedy from a newer server

- **GIVEN** `remedies` `["use-host", "future-remedy"]` and a client that does not recognise `future-remedy`
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
