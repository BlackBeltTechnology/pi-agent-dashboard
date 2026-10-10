# passkey-user-auth Specification

## Purpose
Native passkey (WebAuthn) users for the dashboard: an operator-managed user directory with per-user tiers, invite-by-QR enrollment, passkey login, sign-in-with-phone approval, the relying-party ID bound to the primary domain with a stable-origin gate, orphan warnings on a primary switch, and secret-free lifecycle logging.

## Requirements

### Requirement: User directory with passkey-only accounts
The dashboard SHALL maintain a directory of users, each with a display name, a
tier (`observe`, `control`, or `operate`), a status (`invited`, `active`,
`revoked`), and zero or more passkey credentials. Users SHALL NOT have
passwords. Only an operator (a login session with tier `operate`, or a
genuine-local request) SHALL create, re-tier, or revoke users. Revoking a user
SHALL invalidate that user's sessions at their next request.

#### Scenario: Operator adds a user with a tier
- **WHEN** an operator creates user "Anna" with tier `observe`
- **THEN** the directory SHALL contain Anna with status `invited` and tier `observe`

#### Scenario: Non-operator cannot manage users
- **WHEN** a session with tier `observe` or `control`, or a paired-device bearer, calls a user-management route
- **THEN** the server SHALL refuse with 401 or 403 and the directory SHALL be unchanged

#### Scenario: Revocation takes effect immediately
- **GIVEN** Anna has an active session
- **WHEN** an operator revokes Anna
- **THEN** Anna's next request SHALL be treated as unauthenticated

#### Scenario: First operator is bootstrapped locally
- **GIVEN** the directory is empty
- **WHEN** a genuine-local request creates the first user
- **THEN** that user SHALL be created with tier `operate`
- **AND** a remote request to create the first user SHALL be refused

### Requirement: Invite by QR enrolls a passkey
An operator SHALL be able to mint an invite for a user, with an expiry and a
usage limit (default: single use, 24 h). The dashboard SHALL render the invite
as a QR code and a copyable link on the primary domain. Opening the invite
SHALL let the invitee enroll a passkey with user verification required. After
a successful enrollment, the user SHALL become `active` and the invite usage
SHALL be counted. Expired or exhausted invites SHALL be rejected.

#### Scenario: Phone enrolls from the invite QR
- **WHEN** Anna scans a valid invite QR on her phone and completes passkey registration
- **THEN** Anna SHALL become `active` with one credential bound to the current RP ID

#### Scenario: Exhausted invite is rejected
- **GIVEN** a single-use invite that has already been used
- **WHEN** it is opened again
- **THEN** enrollment SHALL be refused and no credential SHALL be added

#### Scenario: Expired invite is rejected
- **WHEN** an invite is opened after its expiry
- **THEN** enrollment SHALL be refused

### Requirement: Passkey login
The login page SHALL offer "Sign in with passkey" alongside the configured
OAuth providers. A successful assertion from an `active` user's credential
bound to the current RP ID SHALL issue the session cookie with the user's tier.
Challenges SHALL be single-use and short-lived, and user verification SHALL be
required.

#### Scenario: Successful passkey login carries the tier
- **WHEN** active user Anna (tier `observe`) completes a passkey assertion
- **THEN** the server SHALL set `pi_dash_token` with `sub` identifying Anna and `tier: "observe"`

#### Scenario: Replayed assertion is rejected
- **WHEN** an assertion is submitted a second time for the same challenge
- **THEN** the server SHALL refuse it

#### Scenario: OAuth providers remain available
- **GIVEN** passkeys and a GitHub provider are both configured
- **WHEN** the login page renders
- **THEN** both options SHALL be offered

### Requirement: Sign in with phone
The login page SHALL offer "Sign in with phone". It SHALL display a QR code
and a short code for a sign-in request valid for at most 5 minutes. Opening
the request on a phone SHALL show the requesting device's browser, OS, host,
and IP (bounded and sanitised). The phone SHALL approve by performing a
passkey assertion, or deny. When approved, the waiting browser SHALL receive
the session for the approving user on the primary domain. When denied, the
waiting browser SHALL show that the request was declined. A request SHALL be
single-use, and short-code attempts SHALL be rate-limited.

#### Scenario: Phone approves a desktop sign-in
- **WHEN** Anna scans the desktop's sign-in QR with her phone and approves with her passkey
- **THEN** the desktop SHALL be signed in as Anna with Anna's tier

#### Scenario: Phone denies
- **WHEN** the phone denies the request
- **THEN** the desktop SHALL show "declined" and no session SHALL be issued

#### Scenario: Request expires
- **WHEN** 5 minutes pass without approval
- **THEN** the request SHALL be expired, and a later approval SHALL be refused

#### Scenario: Approval screen does not reflect raw headers
- **WHEN** the requester sends a User-Agent containing control characters or more than 256 characters
- **THEN** the approval screen SHALL show a bounded, sanitised description

### Requirement: Relying-party ID is the primary domain
The passkey RP ID SHALL be the hostname of the resolved auth base: the
`auth.redirectBaseUrl` override if set, otherwise the primary tunnel provider's
URL. This is the same resolution that produces the OAuth redirect base. Every
credential SHALL record the RP ID it was created under. Credentials whose RP
ID differs from the current one SHALL NOT be offered in ceremonies and SHALL
be listed as orphaned.

#### Scenario: RP ID follows the primary
- **GIVEN** Tailscale is primary at `https://host.tailnet.ts.net` and zrok is also connected
- **WHEN** a passkey is enrolled
- **THEN** its RP ID SHALL be `host.tailnet.ts.net`

#### Scenario: Override wins
- **GIVEN** `auth.redirectBaseUrl` is `https://dash.example.com`
- **WHEN** a passkey is enrolled
- **THEN** its RP ID SHALL be `dash.example.com`

#### Scenario: Orphaned credential is excluded
- **GIVEN** Anna's credential was created under RP ID `a.share.zrok.io`
- **AND** the current RP ID is `host.tailnet.ts.net`
- **WHEN** Anna attempts passkey login
- **THEN** that credential SHALL NOT be offered, and Settings ▸ Users SHALL mark it orphaned

### Requirement: Passkeys gated on a stable origin
Passkey login, sign in with phone, and invite minting SHALL be available only
when the resolved auth base is a stable origin: an `https` URL whose hostname
is neither an IP literal nor `localhost`, and whose source is the override, a
Tailscale primary, a zrok primary with a reserved name, or a provider reporting
itself stable. Otherwise these routes SHALL respond `409` with reason
`unstable_origin`, and the login page and Settings ▸ Users SHALL show the
options disabled with that reason, not hidden.

#### Scenario: Ephemeral zrok primary disables passkeys
- **GIVEN** the primary is an ephemeral zrok share
- **WHEN** the login page renders
- **THEN** "Sign in with passkey" and "Sign in with phone" SHALL be shown disabled with an explanation
- **AND** minting an invite SHALL return 409 `unstable_origin`

#### Scenario: Reserved zrok primary enables passkeys
- **GIVEN** the primary is a zrok share with a reserved name
- **WHEN** the login page renders
- **THEN** passkey options SHALL be enabled

### Requirement: Primary switch warns about orphaned passkeys
Before the operator confirms a change of the primary tunnel provider (or of
`auth.redirectBaseUrl`) that would change the RP ID, the dashboard SHALL show
how many credentials and users would become orphaned. It SHALL NOT delete any
credential. Switching back to the original RP ID SHALL make those credentials
usable again.

#### Scenario: Switch shows impact
- **GIVEN** 3 credentials for 2 users exist under the current RP ID
- **WHEN** the operator starts switching the primary to a provider with a different hostname
- **THEN** the confirmation SHALL state that 3 passkeys for 2 users will stop working

#### Scenario: Switching back revives credentials
- **WHEN** the primary is switched back to the original hostname
- **THEN** the previously orphaned credentials SHALL be usable again

### Requirement: Passkey events are logged without secrets
The server SHALL log passkey lifecycle events (invite created, enrolled,
login, phone pending/approved/denied/expired, revoked, orphaned) with the
`[passkey]` prefix. Each line SHALL include only an event name and a truncated
identifier. Lines SHALL NOT contain codes, challenges, credential ids, User-Agent,
IP, or CR/LF from client input.

#### Scenario: Log line shape
- **WHEN** any passkey event occurs
- **THEN** the log line SHALL match `^\[passkey\] [a-z_]+ id=[0-9a-f]{8}$`
