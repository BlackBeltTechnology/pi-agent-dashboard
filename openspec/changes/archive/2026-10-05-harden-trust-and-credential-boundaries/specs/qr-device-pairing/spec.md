## MODIFIED Requirements

### Requirement: Compare-code approval; code consumed on approval, not redemption
Redeeming a valid code SHALL create a PENDING device whose token is unusable until
approval. The pairing code SHALL be consumed only on **approval** or on an
operator **deny**, never on redemption, so a premature redemption cannot lock out
the legitimate device. The
trust decision SHALL rely on a **server-generated numeric confirmation code shown
on BOTH the dashboard and the pairing device** for compare-and-match — NOT on any
client-supplied device label. The approval action (`POST /api/pair/approve`, `POST /api/pair/approve-pending`)
SHALL require an operator proof — a dashboard login session, a valid local-proof
cookie (see `trust-and-credential-boundaries`), or a valid `X-Pi-Local-Token` —
and SHALL NOT honor a bare loopback/tunnel exemption in any mode, regardless of
`requireLocalProof`. A paired-device bearer SHALL never approve.
A pairing payload SHALL permit at most ONE active pending device at a time
(further redemptions overwrite the slot or are hard rate-limited), bounding memory
and approval-prompt flooding. The confirmation code SHALL have enough entropy to
resist brute-force within its short validity window. Approval SHALL be ACTIVE: the
user TYPES the code shown on the physical device into the dashboard. The dashboard
MAY push a prompt announcing the pending device, but that prompt SHALL NOT display
the confirmation code and SHALL NOT offer a one-click approve. Repeated invalid
approvals SHALL be rate-limited and locked out. The budget SHALL belong to one
pending device (a re-redemption creates a new pending device with a new
confirmation code and its own budget) and SHALL be shared by every approval entry
point for that pending device. Approval SHALL be rejected
if the pairing code has expired, and this check SHALL hold independently of any
lazy sweep, so the server remains the sole authority on code validity even when no
`poll`/mint has run.

#### Scenario: Premature redemption does not lock out the user
- **WHEN** an attacker redeems a shoulder-surfed code before the intended device AND the operator has not denied that request
- **THEN** the code is NOT consumed and the legitimate device can still redeem and be approved

#### Scenario: Deny ends the code for every device
- **WHEN** the operator denies a pending device
- **THEN** the code SHALL be consumed and no device, including a later legitimate one, SHALL be able to redeem it

#### Scenario: Spoofed label cannot be mistaken for the real device
- **WHEN** the user approves a pending device
- **THEN** approval requires matching the numeric confirmation code shown on the real device, so an attacker's chosen label cannot impersonate it

#### Scenario: Approval cannot be self-satisfied via a bypass
- **WHEN** an approval is attempted without a genuine authenticated browser session (e.g. via a loopback/tunnel path)
- **THEN** the approval SHALL be rejected

#### Scenario: Bare loopback cannot approve
- **WHEN** an approval request arrives from `127.0.0.1` with no forwarding header, no login session, no local-proof cookie, and no local token, with `requireLocalProof` disabled
- **THEN** the approval SHALL be rejected with 401 and the pending device SHALL stay pending

#### Scenario: Local-proof cookie approves on an auth-off install
- **WHEN** authentication is disabled and a browser bootstrapped via the launcher presents a valid local-proof cookie with the matching confirmation code
- **THEN** the approval SHALL succeed

#### Scenario: Redemption flood cannot exhaust the server
- **WHEN** an attacker replays a QR payload to redeem many times
- **THEN** at most one pending device exists per payload and further attempts are rate-limited, so memory and approval prompts stay bounded

#### Scenario: Active typed approval defeats blind-approve
- **WHEN** the user approves a device, including from a pushed approval prompt
- **THEN** they must type the code displayed on the physical pairing device, so a passively-pushed attacker request cannot be approved by habituated clicking
- **AND** the pushed prompt SHALL NOT contain the confirmation code

#### Scenario: Approval of an expired code rejected
- **WHEN** the operator submits the correct confirmation code after the pairing code has expired
- **THEN** the server SHALL reject the approval with an expired error and pair no device
- **AND** the rejection SHALL hold even if no intervening sweep has removed the entry

#### Scenario: Lockout budget shared across entry points
- **WHEN** the operator submits wrong confirmation codes for one pending device through both the Gateway view and the approval dialog
- **THEN** the attempts SHALL count against one budget and the device SHALL be locked out once that budget is exhausted
