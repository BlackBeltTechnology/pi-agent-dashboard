## RENAMED Requirements

- FROM: `### Requirement: Request-access remedy is the one recorded exception to the access-posture disclosure predicate`
- TO: `### Requirement: Recorded exceptions to the access-posture disclosure predicate`

## MODIFIED Requirements

### Requirement: Recorded exceptions to the access-posture disclosure predicate

Notwithstanding the sentence "Access-posture disclosure keeps its existing
predicate" in "Opt-in local proof for loopback trust", the access-posture
disclosure predicate (the caller is authenticated or genuinely local) SHALL keep
governing every disclosure of access posture, unchanged, with exactly two
recorded exceptions.

First: the `request-access` remedy of an `operate_required` refusal
(`operate-required-remedy`) SHALL be disclosed to a caller that is neither
authenticated nor genuinely local when that remedy's presence rule holds. This
exception SHALL be limited to facts the same caller can already obtain from the
public knock route by a same-origin request with the same peer, forwarding
headers and `Host` — whether the knock's admission gates
before its operator switch (Host admission, network position) would pass.

Second: the `networkAccess` field of `GET /api/health` ("Health reports the
caller's own network-guard verdict") SHALL be disclosed to any caller. This
exception SHALL be limited to the caller's own admission outcome, which the same
caller already observes from the WebSocket upgrade and from guarded routes. It is
weaker than the first exception in one respect, recorded here: those observations
are recorded as block events, while the health verdict is not.

Neither exception's content SHALL disclose `pairing.acceptLanRequests`, pending
knocks, knock limits or cooldowns, the host-gate mode, the trust mode,
trusted-network entries, interface addresses or subnets, or any other posture.
The presence of the second exception's field reveals only whether the caller
itself is admitted. Any further
exception SHALL be recorded by modifying this requirement.

#### Scenario: Exception carries only the knock-gate verdict

- **GIVEN** a caller with no credential, not genuinely local, admitted by the network guard, whose socket peer is on-link and private, with an admitted `Host`
- **WHEN** it is refused with `operate_required`
- **THEN** the body SHALL contain the `request-access` remedy
- **AND** the body SHALL contain no address, subnet, interface, trusted-network entry, LAN-request switch state or knock state

#### Scenario: Other posture surfaces keep the predicate

- **GIVEN** the caller of "Exception carries only the knock-gate verdict"
- **WHEN** it calls `GET /api/health`
- **THEN** the response SHALL carry no access-grant or trust-posture data (`accessGrants` and `trustPosture` stay withheld), exactly as before this change
- **AND** the response SHALL NOT contain `networkAccess`, because the network guard admits that caller

#### Scenario: Health verdict carries no posture

- **GIVEN** an unpaired remote caller refused in `pair` mode, and separately one refused in `legacy` mode by a trusted list that does not cover it
- **WHEN** each requests `/api/health`
- **THEN** both bodies SHALL carry an identical `networkAccess` value
- **AND** neither SHALL carry `accessGrants`, `trustPosture`, the trust mode, or any address, list entry or switch state

#### Scenario: Presence reveals only the caller's own admission

- **GIVEN** a remote caller with no credential, once in `pair` mode and once in `legacy` mode with a trusted list covering it
- **WHEN** it requests `/api/health` in each mode
- **THEN** the field SHALL be present in `pair` and absent in `legacy`, matching whether its per-route-guarded requests are admitted

## ADDED Requirements

### Requirement: Health reports the caller's own network-guard verdict
`GET /api/health` SHALL include `networkAccess: { error: "network_not_allowed", hint }` if and only if the REST network pass predicate would refuse that request, and the caller is not one for which `localProof: "required"` is reported; the admission list MAY be read up to 1 s stale. The REST network guards and the health field SHALL share one predicate function. The `hint` SHALL be the generic `403 network_not_allowed` hint constant.

#### Scenario: Unpaired remote caller is told it is refused
- **GIVEN** `network.trustMode: "pair"` with no OAuth provider
- **WHEN** a non-loopback caller with no device cookie, bearer or session requests `/api/health`
- **THEN** the response SHALL be `200` with `networkAccess.error === "network_not_allowed"` and the generic hint
- **AND** a per-route-guarded route from the same caller SHALL answer `403 network_not_allowed` with the same hint

#### Scenario: Signed-out caller on an OAuth server also gets the verdict
- **GIVEN** `network.trustMode: "pair"` with a sign-in method configured (OAuth provider or passkeys)
- **WHEN** a non-loopback caller with no device cookie, bearer or session requests `/api/health`
- **THEN** the response SHALL be `200` with the same `networkAccess` value
- **AND** guarded routes from that caller SHALL keep answering `401` from the auth hook, unchanged

#### Scenario: Admitted callers see no field
- **WHEN** `/api/health`, with or without a query string, is requested by a genuinely-local proofed caller, a local-token caller, a paired device (bearer or device cookie), a signed-in session, or (in `legacy` mode) a trusted-network caller
- **THEN** the body SHALL NOT contain `networkAccess`

#### Scenario: Local-proof caller gets only the local-proof field
- **WHEN** a bare-loopback caller lacking proof requests `/api/health` under `requireLocalProof`
- **THEN** the body SHALL contain `localProof: "required"` and SHALL NOT contain `networkAccess`

#### Scenario: Verdict failure omits the field
- **WHEN** evaluating the verdict throws
- **THEN** `/api/health` SHALL answer `200` without `networkAccess`

### Requirement: Health network verdict has no admission side effects
Reporting `networkAccess` on `/api/health` SHALL NOT admit the caller, record a block event, raise an access-grant prompt, change any network-only admission counter, or emit a per-request trusted-list or network-only log line. Existing config-snapshot diagnostics are unchanged.

#### Scenario: Refused caller polling health has no side effects
- **WHEN** an unpaired remote caller requests `/api/health` repeatedly
- **THEN** no block event SHALL be recorded and no access-grant prompt SHALL be raised
- **AND** (accepted residual) credential probing against `/api/health` alone is therefore unrecorded, while WebSocket and per-route-guarded attempts stay recorded

#### Scenario: Trusted legacy caller polling health is not counted
- **GIVEN** `legacy` mode and a caller admitted only by a trusted-network entry
- **WHEN** it requests `/api/health` repeatedly
- **THEN** the network-only admission snapshot (admissions, distinct peers) SHALL be unchanged
