## ADDED Requirements

### Requirement: Request-access remedy is the one recorded exception to the access-posture disclosure predicate

Notwithstanding the sentence "Access-posture disclosure keeps its existing
predicate" in "Opt-in local proof for loopback trust", the access-posture
disclosure predicate (the caller is authenticated or genuinely local) SHALL keep
governing every disclosure of access posture, unchanged, with exactly one
recorded exception: the `request-access` remedy of an `operate_required` refusal
(`operate-required-remedy`) SHALL be disclosed to a caller that is neither
authenticated nor genuinely local when that remedy's presence rule holds. The
exception SHALL be limited to facts the same caller can already obtain from the
public knock route by a same-origin request with the same peer, forwarding
headers and `Host` — whether the knock's admission gates
before its operator switch (Host admission, network position) would pass. It
SHALL NOT disclose `pairing.acceptLanRequests`, pending knocks, knock limits or
cooldowns, the host-gate mode, trusted-network entries, interface addresses or
subnets, or any other posture. Any further exception SHALL be recorded by
modifying this requirement.

#### Scenario: Exception carries only the knock-gate verdict

- **GIVEN** a caller with no credential, not genuinely local, admitted by the network guard, whose socket peer is on-link and private, with an admitted `Host`
- **WHEN** it is refused with `operate_required`
- **THEN** the body SHALL contain the `request-access` remedy
- **AND** the body SHALL contain no address, subnet, interface, trusted-network entry, LAN-request switch state or knock state

#### Scenario: Other posture surfaces keep the predicate

- **GIVEN** the caller of "Exception carries only the knock-gate verdict"
- **WHEN** it calls `GET /api/health`
- **THEN** the response SHALL carry no access-grant or trust-posture data (`accessGrants` and `trustPosture` stay withheld), exactly as before this change
